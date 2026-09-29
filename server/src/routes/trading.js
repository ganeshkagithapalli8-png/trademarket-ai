/**
 * Wallet, orders, positions, portfolio.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  SIMULATED CAPITAL ONLY.                                             │
 * │  "Deposit" mints simulated INR inside this database. There is no     │
 * │  payment gateway, no bank connection, no custody of real funds, and  │
 * │  no broker order routing anywhere in this repository.                │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { Router } from 'express';
import { config } from '../config.js';
import { withUser } from '../db/index.js';
import {
  asyncH, requireAuth, badRequest, notFound, forbidden, toNumber, requireFields, tradeLimiter,
} from '../middleware.js';
import { getInstrument, MARKETS } from '../services/instruments.js';
import { quote } from '../services/marketEngine.js';
import { providerFor, getQuoteAsync } from '../services/marketData.js';
import { invalidatePending } from '../services/pendingOrders.js';
import { MARKET_GATES } from '../services/roadmap.js';
import { pnlOf } from '../services/bot.js';

const router = Router();

// Scope the auth gate to this router's own paths. Without this, a router
// mounted at /api would swallow every unmatched /api/* URL and answer 401
// instead of letting it fall through to the JSON 404 handler.
const OWNED = /^\/(wallet|trade|portfolio)(\/|$)/;
router.use((req, res, next) => (OWNED.test(req.path) ? requireAuth(req, res, next) : next()));
const MARGIN_FACTOR = { stocks: 1, ipo: 1, crypto: 1, fno: 0.2, forex: 0.1 };
const SLIPPAGE_BPS = 3; // adverse fill assumption, applied to every paper order

// ── wallet ──────────────────────────────────────────────────────────────────

router.get('/wallet', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query('select sim_balance, total_deposits from wallets where user_id = $1', [req.userId])
  );
  res.json({
    wallet: {
      simBalance: Number(rows[0]?.sim_balance ?? 0),
      totalSimDeposits: Number(rows[0]?.total_deposits ?? 0),
      currency: 'INR',
      simulated: true,
    },
    limits: { min: config.safety.minSimDeposit, max: config.safety.maxSimDeposit },
    notice: 'These are simulated rupees. No real money exists in this application.',
  });
}));

router.post('/wallet/deposit', asyncH(async (req, res) => {
  requireFields(req.body, ['amount']);
  const amount = Math.round(toNumber(req.body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter an amount greater than zero.');
  if (amount < config.safety.minSimDeposit) throw badRequest(`Minimum simulated top-up is ₹${config.safety.minSimDeposit}.`);
  if (amount > config.safety.maxSimDeposit) throw badRequest(`Maximum simulated top-up is ₹${config.safety.maxSimDeposit.toLocaleString('en-IN')} at a time.`);

  const out = await withUser(req.userId, async (c) => {
    const { rows } = await c.query(
      `update wallets
          set sim_balance = sim_balance + $2, total_deposits = total_deposits + $2
        where user_id = $1
        returning sim_balance`,
      [req.userId, amount]
    );
    if (!rows[0]) await c.query('insert into wallets (user_id, sim_balance, total_deposits) values ($1,$2,$2)', [req.userId, amount]);
    const bal = Number(rows[0]?.sim_balance ?? amount);
    await c.query(
      `insert into wallet_transactions (user_id, kind, amount, balance_after, note)
       values ($1,'deposit',$2,$3,$4)`,
      [req.userId, amount, bal, 'Simulated top-up — no real money moved']
    );
    return bal;
  });

  res.json({ simBalance: out, deposited: amount, simulated: true });
}));

router.post('/wallet/withdraw', asyncH(async (req, res) => {
  requireFields(req.body, ['amount']);
  const amount = Math.round(toNumber(req.body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter an amount greater than zero.');

  const out = await withUser(req.userId, async (c) => {
    const { rows } = await c.query('select sim_balance from wallets where user_id = $1 for update', [req.userId]);
    const bal = Number(rows[0]?.sim_balance ?? 0);
    if (amount > bal) throw badRequest(`Only ₹${bal.toFixed(2)} of simulated cash is free (the rest is in open positions).`);
    await c.query('update wallets set sim_balance = sim_balance - $2 where user_id = $1', [req.userId, amount]);
    await c.query(
      `insert into wallet_transactions (user_id, kind, amount, balance_after, note)
       values ($1,'withdraw',$2,$3,$4)`,
      [req.userId, -amount, bal - amount, 'Simulated withdrawal — no real money moved']
    );
    return bal - amount;
  });

  res.json({ simBalance: out, withdrawn: amount, simulated: true });
}));

router.get('/wallet/transactions', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `select id, kind, amount, balance_after, note, created_at
         from wallet_transactions where user_id = $1 order by created_at desc limit 100`,
      [req.userId]
    )
  );
  res.json({ transactions: rows });
}));

router.post('/wallet/reset', asyncH(async (req, res) => {
  const out = await withUser(req.userId, async (c) => {
    await c.query(`update positions set status='closed', closed_at=now(), exit_reason='account_reset', pnl=0, exit_price=current_price where user_id=$1 and status='open'`, [req.userId]);
    await c.query(`update wallets set sim_balance=0, total_deposits=0 where user_id=$1`, [req.userId]);
    await c.query(`insert into wallet_transactions (user_id, kind, amount, balance_after, note) values ($1,'reset',0,0,'Paper account reset')`, [req.userId]);
    return 0;
  });
  res.json({ simBalance: out, reset: true });
}));

// ── orders ──────────────────────────────────────────────────────────────────

async function loadCompletedModules(userId) {
  const { rows } = await withUser(userId, (c) =>
    c.query(`select module_id from learning_progress where user_id=$1 and status='completed'`, [userId])
  );
  return rows.map((r) => r.module_id);
}

router.post('/trade/order', tradeLimiter, asyncH(async (req, res) => {
  requireFields(req.body, ['symbol', 'side', 'qty']);

  const symbol = String(req.body.symbol).toUpperCase().trim();
  const inst = getInstrument(symbol);
  if (!inst) throw notFound(`Unknown instrument "${symbol}".`);

  const sideRaw = String(req.body.side).toLowerCase();
  const side = sideRaw === 'buy' || sideRaw === 'long' ? 'buy' : sideRaw === 'sell' || sideRaw === 'short' ? 'sell' : null;
  if (!side) throw badRequest('side must be "buy" or "sell".');

  // ── market gate ──────────────────────────────────────────────────────────
  const completed = await loadCompletedModules(req.userId);
  const gates = MARKET_GATES[inst.market] || [];
  const missing = gates.filter((g) => !completed.includes(g));
  if (missing.length) {
    throw forbidden(
      `${MARKETS[inst.market].label} is locked. Complete the Risk Management module before trading derivatives — they amplify losses as fast as gains.`
    );
  }
  if ((inst.market === 'fno' || inst.market === 'forex') && !req.user.ageVerified) {
    throw forbidden('Age verification (18+) is required before trading derivatives or leveraged FX.');
  }

  // ── quantity ─────────────────────────────────────────────────────────────
  const lot = inst.lot || 1;
  const qty = Math.floor(toNumber(req.body.qty) / lot) * lot;
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`Quantity must be at least ${lot} (the lot size for ${inst.symbol}).`);

  // Fill at the REAL exchange price whenever a live provider owns the symbol.
  // Streaming symbols already carry a live reference in the engine; for
  // finnhub-owned US symbols not currently ticked, pull one fresh real quote
  // (a single REST call per order — well inside the free-tier budget).
  let q = quote(inst.symbol);
  if (providerFor(inst.symbol) === 'finnhub' && q?.source !== 'live') {
    const live = await getQuoteAsync(inst.symbol).catch(() => null);
    if (live?.price != null) q = live;
  }
  if (!q) throw badRequest('No price available for that instrument.');

  const orderType = req.body.orderType === 'limit' ? 'limit' : req.body.orderType === 'stop' ? 'stop' : 'market';
  const limitPrice = orderType === 'limit' ? toNumber(req.body.limitPrice) : null;
  const stopPrice = orderType === 'stop' ? toNumber(req.body.stopPrice ?? req.body.limitPrice) : null;
  if (orderType === 'limit' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) throw badRequest('A limit order needs a valid limit price.');
  if (orderType === 'stop' && (!Number.isFinite(stopPrice) || stopPrice <= 0)) throw badRequest('A stop order needs a valid trigger price.');

  // Resting orders: a limit away from the touch, or a stop waiting for its
  // trigger, rests as 'pending' and fills from the tick stream when crossed.
  const touch = orderType === 'limit' ? limitPrice : orderType === 'stop' ? stopPrice : null;
  if (touch != null) {
    const marketable = orderType === 'limit'
      ? (side === 'buy' ? limitPrice >= q.price : limitPrice <= q.price)
      : (side === 'buy' ? stopPrice <= q.price : stopPrice >= q.price);
    if (!marketable) {
      const sl = req.body.stopLoss != null ? toNumber(req.body.stopLoss) : null;
      const tg = req.body.target != null ? toNumber(req.body.target) : null;
      const { rows } = await withUser(req.userId, (c) =>
        c.query(
          `insert into orders (user_id, symbol, market, side, qty, order_type, limit_price, stop_price, stop_loss, target, status, opened_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','user') returning *`,
          [req.userId, inst.symbol, inst.market, side, qty, orderType, limitPrice, stopPrice, sl, tg]
        )
      );
      invalidatePending();
      return res.status(202).json({
        pending: true,
        order: rows[0],
        simulated: true,
        notice: `Resting ${orderType} order. It fills from the paper tick stream when the price crosses ${touch}.`,
      });
    }
  }

  // Adverse slippage: you never get the mid in a real market. A marketable
  // limit/stop fills at its trigger price, not at the touch.
  const base = orderType === 'market' ? q.price : touch;
  const slip = base * (SLIPPAGE_BPS / 10_000);
  const fillPrice = side === 'buy' ? base + slip : base - slip;

  const posSide = side === 'buy' ? 'long' : 'short';
  const stopLoss = req.body.stopLoss != null ? toNumber(req.body.stopLoss) : null;
  const target = req.body.target != null ? toNumber(req.body.target) : null;
  if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) throw badRequest('Stop loss must be a positive price.');
  if (target != null && (!Number.isFinite(target) || target <= 0)) throw badRequest('Target must be a positive price.');
  if (stopLoss != null && posSide === 'long' && stopLoss >= fillPrice) throw badRequest('For a long position the stop loss must be BELOW the entry price.');
  if (stopLoss != null && posSide === 'short' && stopLoss <= fillPrice) throw badRequest('For a short position the stop loss must be ABOVE the entry price.');

  const notional = qty * fillPrice;
  const factor = MARGIN_FACTOR[inst.market] ?? 1;
  const margin = Math.round(notional * factor * 100) / 100;

  const result = await withUser(req.userId, async (c) => {
    const w = await c.query('select sim_balance from wallets where user_id=$1 for update', [req.userId]);
    const bal = Number(w.rows[0]?.sim_balance ?? 0);
    if (margin > bal) {
      await c.query(
        `insert into orders (user_id, symbol, market, side, qty, order_type, limit_price, status, reason)
         values ($1,$2,$3,$4,$5,$6,$7,'rejected',$8)`,
        [req.userId, inst.symbol, inst.market, side, qty, orderType, limitPrice, `Insufficient simulated cash: need ₹${margin.toFixed(2)}, have ₹${bal.toFixed(2)}.`]
      );
      throw badRequest(`Not enough simulated cash. This trade needs ₹${margin.toFixed(2)} margin; you have ₹${bal.toFixed(2)} free.`);
    }

    const dup = await c.query(
      `select id from positions where user_id=$1 and symbol=$2 and side=$3 and status='open'`,
      [req.userId, inst.symbol, posSide]
    );
    if (dup.rowCount) throw badRequest(`You already have an open ${posSide} position in ${inst.symbol}. Close it first.`);

    await c.query('update wallets set sim_balance = sim_balance - $2 where user_id=$1', [req.userId, margin]);

    const { rows } = await c.query(
      `insert into positions (user_id, symbol, market, side, qty, entry_price, current_price, stop_loss, target, margin_used, opened_by, status)
       values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'user','open') returning *`,
      [req.userId, inst.symbol, inst.market, posSide, qty, fillPrice, stopLoss, target, margin]
    );

    await c.query(
      `insert into orders (user_id, symbol, market, side, qty, order_type, limit_price, filled_price, stop_loss, target, status, opened_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'filled','user')`,
      [req.userId, inst.symbol, inst.market, side, qty, orderType, limitPrice, fillPrice, stopLoss, target]
    );

    const nw = await c.query('select sim_balance from wallets where user_id=$1', [req.userId]);
    return { position: rows[0], simBalance: Number(nw.rows[0].sim_balance), margin };
  });

  res.status(201).json({
    position: shapePosition(result.position, q?.price ?? fillPrice),
    fillPrice: round(fillPrice),
    margin: result.margin,
    simBalance: result.simBalance,
    simulated: true,
    currency: inst.currency || 'INR',
    priceSource: q?.source === 'live' ? 'live' : 'simulated', // honesty: was the fill price a real exchange print?
    notice: 'Paper fill against simulated liquidity. No real order was sent anywhere.',
  });
}));

router.delete('/trade/order/:id', tradeLimiter, asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `update orders set status='cancelled', reason='Cancelled by user.'
       where id=$1 and user_id=$2 and status='pending' returning *`,
      [req.params.id, req.userId]
    )
  );
  if (!rows.length) throw notFound('No pending order with that id (only pending orders can be cancelled).');
  invalidatePending();
  res.json({ cancelled: rows[0], simulated: true });
}));

router.post('/trade/close/:id', tradeLimiter, asyncH(async (req, res) => {
  const id = req.params.id;
  const reason = ['manual', 'stop_loss', 'target', 'daily_limit', 'kill_switch', 'account_reset'].includes(req.body?.reason)
    ? req.body.reason
    : 'manual';

  const out = await withUser(req.userId, async (c) => {
    const p = await c.query(`select * from positions where id=$1 and user_id=$2 and status='open'`, [id, req.userId]);
    const pos = p.rows[0];
    if (!pos) throw notFound('No open position with that id.');

    let q = quote(pos.symbol);
    if (providerFor(pos.symbol) === 'finnhub' && q?.source !== 'live') {
      const live = await getQuoteAsync(pos.symbol).catch(() => null);
      if (live?.price != null) q = live;
    }
    const raw = q?.price ?? Number(pos.current_price);
    const slip = raw * (SLIPPAGE_BPS / 10_000);
    const exitPrice = pos.side === 'long' ? raw - slip : raw + slip;

    const qty = Number(pos.qty);
    const entry = Number(pos.entry_price);
    const pnl = round(pnlOf(pos.side, qty, entry, exitPrice));
    const marginBack = Number(pos.margin_used);

    await c.query(
      `update positions
          set status='closed', exit_price=$3, pnl=$4, exit_reason=$5, closed_at=now(), current_price=$3
        where id=$1 and user_id=$2`,
      [id, req.userId, exitPrice, pnl, reason]
    );
    await c.query('update wallets set sim_balance = sim_balance + $2 where user_id=$1', [req.userId, marginBack + pnl]);
    await c.query(
      `insert into orders (user_id, symbol, market, side, qty, order_type, filled_price, status, opened_by)
       values ($1,$2,$3,$4,$5,'market',$6,'filled','user')`,
      [req.userId, pos.symbol, pos.market, pos.side === 'long' ? 'sell' : 'buy', qty, exitPrice]
    );

    const w = await c.query('select sim_balance from wallets where user_id=$1', [req.userId]);
    return { pnl, exitPrice, simBalance: Number(w.rows[0].sim_balance), position: pos };
  });

  // Feed the closed trade into the bot's learning memory.
  const { recordClosedTrade } = await import('../services/botRunner.js');
  await recordClosedTrade(req.userId, { ...out.position, exit_price: out.exitPrice, pnl: out.pnl, exit_reason: reason }).catch((e) =>
    console.error('[learn] failed to record trade:', e.message)
  );

  res.json({
    closed: true,
    pnl: out.pnl,
    exitPrice: round(out.exitPrice),
    reason,
    simBalance: out.simBalance,
    simulated: true,
  });
}));

router.get('/trade/positions', asyncH(async (req, res) => {
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `select * from positions where user_id=$1 and status=$2 order by opened_at desc limit 200`,
      [req.userId, status]
    )
  );
  const priced = rows.map((r) => shapePosition(r, r.status === 'open' ? quote(r.symbol)?.price ?? Number(r.current_price) : Number(r.exit_price)));
  res.json({ positions: priced });
}));

router.get('/trade/orders', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from orders where user_id=$1 order by created_at desc limit 200`, [req.userId])
  );
  res.json({ orders: rows });
}));

// ── portfolio ───────────────────────────────────────────────────────────────

router.get('/portfolio', asyncH(async (req, res) => {
  const data = await withUser(req.userId, async (c) => {
    const w = await c.query('select sim_balance, total_deposits from wallets where user_id=$1', [req.userId]);
    const open = await c.query(`select * from positions where user_id=$1 and status='open'`, [req.userId]);
    const closed = await c.query(
      `select coalesce(sum(pnl),0) as realized, count(*)::int as n,
              count(*) filter (where pnl > 0)::int as wins,
              count(*) filter (where pnl <= 0)::int as losses
         from positions where user_id=$1 and status='closed' and exit_reason <> 'account_reset'`,
      [req.userId]
    );
    const today = await c.query(
      `select coalesce(sum(pnl),0) as day_pnl, count(*)::int as n
         from positions
        where user_id=$1 and status='closed'
          and closed_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
      [req.userId]
    );
    const curve = await c.query(
      `select date_trunc('day', closed_at at time zone 'Asia/Kolkata') as day, coalesce(sum(pnl),0) as pnl
         from positions where user_id=$1 and status='closed' and closed_at is not null
        group by 1 order by 1 desc limit 60`,
      [req.userId]
    );
    return { w: w.rows[0], open: open.rows, closed: closed.rows[0], today: today.rows[0], curve: curve.rows };
  });

  const cash = Number(data.w?.sim_balance ?? 0);
  const positions = data.open.map((r) => {
    const q = quote(r.symbol);
    return shapePosition(r, q?.price ?? Number(r.current_price));
  });

  const invested = positions.reduce((s, p) => s + Number(p.marginUsed), 0);
  const unrealized = positions.reduce((s, p) => s + Number(p.unrealizedPnl), 0);
  const realized = Number(data.closed?.realized ?? 0);
  const equity = cash + invested + unrealized;
  const totalDeposits = Number(data.w?.total_deposits ?? 0);

  // Build a cumulative equity curve, oldest → newest.
  const dailyPnl = [...data.curve].reverse().map((r) => ({ day: r.day, pnl: Number(r.pnl) }));
  let running = totalDeposits > 0 ? totalDeposits : equity - realized;
  const equityCurve = dailyPnl.map((d) => {
    running += d.pnl;
    return { day: d.day, equity: round(running) };
  });
  equityCurve.push({ day: new Date().toISOString(), equity: round(equity) });

  const n = Number(data.closed?.n ?? 0);
  const wins = Number(data.closed?.wins ?? 0);

  res.json({
    simulated: true,
    cash: round(cash),
    invested: round(invested),
    unrealizedPnl: round(unrealized),
    realizedPnl: round(realized),
    equity: round(equity),
    totalSimDeposits: round(totalDeposits),
    returnPct: totalDeposits > 0 ? round(((equity - totalDeposits) / totalDeposits) * 100) : 0,
    dayPnl: round(Number(data.today?.day_pnl ?? 0)),
    dayTrades: Number(data.today?.n ?? 0),
    closedTrades: n,
    winRate: n ? round((wins / n) * 100) : 0,
    openPositions: positions,
    equityCurve,
    allocation: allocationOf(positions),
  });
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function allocationOf(positions) {
  const byMarket = {};
  for (const p of positions) byMarket[p.market] = round((byMarket[p.market] || 0) + Math.abs(Number(p.marketValue || p.marginUsed)));
  const total = Object.values(byMarket).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(byMarket).map(([market, value]) => ({
    market,
    label: MARKETS[market]?.label || market,
    value,
    pct: round((value / total) * 100),
  }));
}

function shapePosition(r, price) {
  const qty = Number(r.qty);
  const entry = Number(r.entry_price);
  const exit = r.exit_price != null ? Number(r.exit_price) : null;
  const mark = exit ?? price ?? entry;
  const unrealized = r.status === 'open' ? round(pnlOf(r.side, qty, entry, mark)) : 0;
  const realized = r.status === 'closed' ? round(Number(r.pnl ?? 0)) : null;
  const notional = entry * qty;

  return {
    id: r.id,
    symbol: r.symbol,
    name: getInstrument(r.symbol)?.name || r.symbol,
    market: r.market,
    side: r.side,
    qty,
    lot: getInstrument(r.symbol)?.lot || 1,
    entryPrice: round(entry),
    currentPrice: round(mark),
    exitPrice: exit == null ? null : round(exit),
    stopLoss: r.stop_loss != null ? round(Number(r.stop_loss)) : null,
    target: r.target != null ? round(Number(r.target)) : null,
    marginUsed: round(Number(r.margin_used)),
    marketValue: round(Number(r.margin_used) + unrealized),
    notional: round(notional),
    unrealizedPnl: unrealized,
    unrealizedPct: notional ? round((unrealized / notional) * 100) : 0,
    realizedPnl: realized,
    status: r.status,
    openedBy: r.opened_by,
    exitReason: r.exit_reason || null,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  };
}

const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

export default router;
