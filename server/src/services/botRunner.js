/**
 * The bot's runtime loop and its learning memory.
 *
 * Two responsibilities:
 *   1. Manage open positions (stops / targets) and, when armed, take entries
 *      that passed the risk gate.
 *   2. Write every closed trade into bot_memory with its entry-time features,
 *      then fold it into per-setup expectancy stats and the logistic scorer.
 *
 * All of it operates on the SIMULATED wallet. There is no broker client here
 * and no order-routing code anywhere in the project.
 */

import { admin, withUser } from '../db/index.js';
import { quote, candles } from './marketEngine.js';
import { analyse, candlePatterns } from './indicators.js';
import { getInstrument, MARKETS } from './instruments.js';
import { roadmapWithStatus, MARKET_GATES, BOT_ARMABLE_MODULES } from './roadmap.js';
import {
  scanSignals, riskGate, managePosition, pnlOf, learnFromTrade, featureVector, FEATURES,
} from './bot.js';

const MARGIN_FACTOR = { stocks: 1, ipo: 1, crypto: 1, fno: 0.2, forex: 0.1 };
const TF = '15m';
const BARS = 160;

const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Indicator snapshot taken at the moment of entry — the bot's training input. */
export function captureFeatures(symbol, side, riskPct) {
  try {
    const a = analyse(candles(symbol, TF, BARS));
    if (!a) return null;
    return {
      vector: featureVector(a, side, riskPct),
      indicators: {
        rsi: a.rsi, trend: a.trend, trendStrength: a.trendStrength, atrPct: a.atrPct,
        support: a.support, resistance: a.resistance, ret5: a.ret5, ret20: a.ret20,
        bodyRatio: a.bodyRatio, price: a.price, atr: a.atr,
      },
      patterns: candlePatterns(candles(symbol, TF, 3)),
    };
  } catch {
    return null;
  }
}

/**
 * Persist a closed trade into memory and update what the bot knows.
 * Called for BOTH user-closed and bot-closed positions, so a manual mistake
 * teaches the system too.
 */
export async function recordClosedTrade(userId, pos) {
  const inst = getInstrument(pos.symbol);
  if (!inst) return null;

  const qty = Number(pos.qty);
  const entry = Number(pos.entry_price);
  const exit = Number(pos.exit_price ?? pos.current_price);
  const pnl = Number(pos.pnl ?? pnlOf(pos.side, qty, entry, exit));
  const notional = entry * qty || 1;
  const riskAmount = Number(pos.risk_amount) || Math.abs(entry - Number(pos.stop_loss || entry)) * qty || notional * 0.01;
  const pnlPct = (pnl / notional) * 100;
  const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
  const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'scratch';

  const feats = pos.entry_features || captureFeatures(pos.symbol, pos.side, 1);
  const a = feats?.indicators || {};
  const price = a.price || entry;
  const setup = pos.entry_setup || 'manual';

  return withUser(userId, async (c) => {
    const { rows } = await c.query(
      `insert into bot_memory
         (user_id, position_id, symbol, market, side, setup, qty, entry_price, exit_price,
          pnl, pnl_pct, r_multiple, outcome, exit_reason,
          f_rsi, f_trend, f_trend_str, f_atr_pct, f_dist_sup, f_dist_res, f_ret5, f_ret20,
          f_body_ratio, f_risk_pct, opened_by, lesson)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       returning id`,
      [
        userId, pos.id || null, pos.symbol, pos.market, pos.side, setup, qty, entry, exit,
        round(pnl), round(pnlPct), round(rMultiple), outcome, pos.exit_reason || null,
        a.rsi ?? null, a.trend === 'up' ? 1 : -1, a.trendStrength ?? null, a.atrPct ?? null,
        a.support ? ((price - a.support) / price) * 10 : null,
        a.resistance ? ((a.resistance - price) / price) * 10 : null,
        a.ret5 ?? null, a.ret20 ?? null, a.bodyRatio ?? null,
        Number((await c.query('select risk_per_trade from profiles where id=$1', [userId])).rows[0]?.risk_per_trade ?? 1),
        pos.opened_by || 'user',
        '',
      ]
    );

    const memId = rows[0]?.id;

    // Fold this trade into what the bot knows.
    const st = await c.query('select setups, weights, trades_seen from bot_state where user_id=$1', [userId]);
    const state = st.rows[0] || { setups: {}, weights: null, trades_seen: 0 };

    const learned = learnFromTrade(
      { setups: state.setups || {}, weights: state.weights || null, tradesSeen: Number(state.trades_seen || 0) },
      {
        setup,
        symbol: pos.symbol,
        side: pos.side,
        pnl,
        outcome,
        rMultiple,
        exitReason: pos.exit_reason,
        features: feats?.vector || null,
      }
    );

    await c.query(
      `update bot_memory set lesson = $2 where id = $1`,
      [memId, learned.lesson]
    );

    await c.query(
      `insert into bot_state (user_id, setups, weights, trades_seen)
       values ($1,$2,$3,$4)
       on conflict (user_id) do update
         set setups = $2, weights = $3, trades_seen = $4, updated_at = now()`,
      [userId, JSON.stringify(learned.setups), JSON.stringify(learned.weights), learned.tradesSeen]
    );

    return { memoryId: memId, lesson: learned.lesson, outcome, rMultiple: round(rMultiple), setups: learned.setups[setup] };
  });
}

/** Realised P&L for the current Indian trading day — feeds the daily loss limit. */
async function dailyPnl(c, userId) {
  const { rows } = await c.query(
    `select coalesce(sum(pnl),0) as day_pnl
       from positions
      where user_id=$1 and status='closed'
        and closed_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
    [userId]
  );
  return Number(rows[0]?.day_pnl ?? 0);
}

/** Stops and targets on everything currently open. Runs whether armed or not. */
export async function manageOpenPositions(userId) {
  return withUser(userId, async (c) => {
    const { rows } = await c.query(`select * from positions where user_id=$1 and status='open'`, [userId]);
    const exits = [];

    for (const pos of rows) {
      const q = quote(pos.symbol);
      const price = q?.price;
      if (!price) continue;

      await c.query('update positions set current_price=$2 where id=$1', [pos.id, price]);
      const decision = managePosition(pos, price);
      if (!decision?.exit) continue;

      const qty = Number(pos.qty);
      const entry = Number(pos.entry_price);
      const slip = price * 0.0003;
      const exitPrice = pos.side === 'long' ? price - slip : price + slip;
      const pnl = round(pnlOf(pos.side, qty, entry, exitPrice));
      const marginBack = Number(pos.margin_used);

      await c.query(
        `update positions set status='closed', exit_price=$3, pnl=$4, exit_reason=$5, closed_at=now(), current_price=$3 where id=$1 and user_id=$2`,
        [pos.id, userId, exitPrice, pnl, decision.reason]
      );
      await c.query('update wallets set sim_balance = sim_balance + $2 where user_id=$1', [userId, marginBack + pnl]);
      await c.query(
        `insert into orders (user_id, symbol, market, side, qty, order_type, filled_price, status, opened_by, reason)
         values ($1,$2,$3,$4,$5,'market',$6,'filled',$7,$8)`,
        [userId, pos.symbol, pos.market, pos.side === 'long' ? 'sell' : 'buy', qty, exitPrice, pos.opened_by, `Auto-exit: ${decision.reason}`]
      );

      exits.push({ ...pos, exit_price: exitPrice, pnl, exit_reason: decision.reason });
    }
    return exits;
  });
}

/** One full bot cycle for one user: exits first, then (if armed) entries. */
export async function runBotCycle(userId) {
  const exits = await manageOpenPositions(userId);

  // Learn from everything the bot just closed.
  for (const e of exits) {
    await recordClosedTrade(userId, e).catch((err) => console.error('[bot] learn failed:', err.message));
  }

  const ctx = await admin(async (c) => {
    const p = await c.query('select * from profiles where id=$1', [userId]);
    const s = await c.query('select * from bot_state where user_id=$1', [userId]);
    const m = await c.query(`select module_id from learning_progress where user_id=$1 and status='completed'`, [userId]);
    return { profile: p.rows[0], state: s.rows[0], completed: m.rows.map((r) => r.module_id) };
  });

  if (!ctx.profile) return { exits: exits.length, entries: 0, skipped: 'no profile' };
  if (ctx.state?.kill_switch) return { exits: exits.length, entries: 0, skipped: 'kill_switch' };
  if (!ctx.profile.bot_armed || !ctx.state?.enabled) return { exits: exits.length, entries: 0, skipped: 'not armed' };

  const arm = BOT_ARMABLE_MODULES.filter((m) => ctx.completed.includes(m));
  if (arm.length < BOT_ARMABLE_MODULES.length) {
    return { exits: exits.length, entries: 0, skipped: `roadmap incomplete (${arm.length}/${BOT_ARMABLE_MODULES.length})` };
  }

  const markets = (ctx.profile.markets_enabled || ['stocks']).filter((m) => {
    const gates = MARKET_GATES[m] || [];
    return gates.every((g) => ctx.completed.includes(g)) && ctx.profile.age_verified;
  });
  if (!markets.length) return { exits: exits.length, entries: 0, skipped: 'no unlocked markets' };

  const signals = scanSignals({
    markets,
    completedModuleIds: ctx.completed,
    ageOk: Boolean(ctx.profile.age_verified),
    setups: ctx.state.setups || {},
    weights: ctx.state.weights || null,
    tradesSeen: Number(ctx.state.trades_seen || 0),
    limit: 6,
  });

  let entries = 0;
  for (const sig of signals) {
    const taken = await withUser(userId, async (c) => {
      const w = await c.query('select sim_balance from wallets where user_id=$1 for update', [userId]);
      const balance = Number(w.rows[0]?.sim_balance ?? 0);
      const open = await c.query(`select * from positions where user_id=$1 and status='open'`, [userId]);
      const dayPnl = await dailyPnl(c, userId);

      const q = quote(sig.symbol);
      const a = analyse(candles(sig.symbol, TF, BARS));
      if (!q || !a) return { ok: false, reason: 'no data' };

      const inst = getInstrument(sig.symbol);
      const gate = riskGate({
        signal: sig,
        price: q.price,
        atr: a.atr,
        balance,
        equity: balance + open.rows.reduce((s, p) => s + Number(p.margin_used), 0),
        riskPerTradePct: Number(ctx.profile.risk_per_trade),
        maxDailyLossPct: Number(ctx.profile.max_daily_loss),
        maxOpenPositions: Number(ctx.profile.max_open_positions),
        openPositions: open.rows,
        dailyPnl: dayPnl,
        killSwitch: Boolean(ctx.state.kill_switch),
        dailyLossHit: false,
        lot: inst.lot,
      });
      if (!gate.ok) return gate;

      const slip = q.price * 0.0003;
      const fill = sig.side === 'long' ? q.price + slip : q.price - slip;
      const margin = round(gate.qty * fill * (MARGIN_FACTOR[sig.market] ?? 1));
      if (margin > balance) return { ok: false, reason: `insufficient cash (need ₹${margin}, have ₹${round(balance)})` };

      const feats = captureFeatures(sig.symbol, sig.side, Number(ctx.profile.risk_per_trade));

      await c.query('update wallets set sim_balance = sim_balance - $2 where user_id=$1', [userId, margin]);
      const { rows } = await c.query(
        `insert into positions
           (user_id, symbol, market, side, qty, entry_price, current_price, stop_loss, target,
            margin_used, risk_amount, entry_setup, entry_features, opened_by, status)
         values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,'bot','open') returning *`,
        [userId, sig.symbol, sig.market, sig.side, gate.qty, fill, gate.stopPrice, gate.targetPrice,
         margin, gate.riskAmount, sig.setup, JSON.stringify(feats)]
      );
      await c.query(
        `insert into orders (user_id, symbol, market, side, qty, order_type, filled_price, stop_loss, target, status, opened_by, reason)
         values ($1,$2,$3,$4,$5,'market',$6,$7,$8,'filled','bot',$9)`,
        [userId, sig.symbol, sig.market, sig.side === 'long' ? 'buy' : 'sell', gate.qty, fill,
         gate.stopPrice, gate.targetPrice, `[${sig.setupLabel}] ${sig.reason} · confidence ${(sig.confidence * 100).toFixed(0)}%`]
      );
      return { ok: true, position: rows[0], setup: sig.setup, reason: sig.reason };
    });

    if (taken.ok) entries += 1;
  }

  await withUser(userId, (c) =>
    c.query('update bot_state set last_run_at = now() where user_id=$1', [userId])
  );

  return { exits: exits.length, entries, signals: signals.length, markets };
}

/** Tick: manage positions for everyone, and enter for those who are armed. */
export async function runAllBots() {
  if (!admin) return { users: 0 };
  const { rows } = await admin((c) => c.query('select id from profiles'));
  let exits = 0;
  let entries = 0;

  for (const r of rows) {
    try {
      const result = await runBotCycle(r.id);
      exits += result.exits || 0;
      entries += result.entries || 0;
    } catch (err) {
      console.error(`[bot] cycle failed for ${r.id}:`, err.message);
    }
  }
  return { users: rows.length, exits, entries, at: new Date().toISOString() };
}

/** Human-readable explanation of everything the bot has learned so far. */
export async function getBotLearning(userId) {
  return withUser(userId, async (c) => {
    const s = await c.query('select * from bot_state where user_id=$1', [userId]);
    const state = s.rows[0];
    const mem = await c.query(
      `select setup, outcome, count(*)::int as n, coalesce(sum(pnl),0) as pnl, coalesce(avg(r_multiple),0) as avg_r
         from bot_memory where user_id=$1 group by setup, outcome order by setup`,
      [userId]
    );
    const recent = await c.query(
      `select symbol, setup, side, outcome, pnl, r_multiple, lesson, exit_reason, created_at
         from bot_memory where user_id=$1 order by created_at desc limit 12`,
      [userId]
    );

    const bySetup = {};
    for (const r of mem.rows) {
      bySetup[r.setup] = bySetup[r.setup] || { setup: r.setup, n: 0, wins: 0, losses: 0, pnl: 0, rSum: 0 };
      const b = bySetup[r.setup];
      b.n += r.n;
      if (r.outcome === 'win') b.wins += r.n;
      if (r.outcome === 'loss') b.losses += r.n;
      b.pnl += Number(r.pnl);
      b.rSum += Number(r.avg_r) * r.n;
    }

    const setups = Object.values(bySetup).map((b) => ({
      ...b,
      pnl: round(b.pnl),
      avgR: b.n ? round(b.rSum / b.n) : 0,
      winRate: b.n ? round((b.wins / b.n) * 100) : 0,
      learnedWeight: state?.setups?.[b.setup]?.weight ?? 1,
    }));

    return {
      tradesSeen: Number(state?.trades_seen ?? 0),
      enabled: Boolean(state?.enabled),
      killSwitch: Boolean(state?.kill_switch),
      lastRunAt: state?.last_run_at,
      setups,
      weights: state?.weights || null,
      featureNames: FEATURES,
      recent: recent.rows,
      mlActive: Number(state?.trades_seen ?? 0) >= 15,
      explanation: Number(state?.trades_seen ?? 0) < 15
        ? `The ML filter activates after 15 closed trades. Below that, entry weights are flat at 1.0 — with a small sample, adjusting anything would just be fitting noise.`
        : `Logistic scorer is active over ${FEATURES.length} entry-time features, trained online on the bot's own closed paper trades. Per-setup weights above 1.0 mean positive measured expectancy; below 1.0 mean the bot is being told to take fewer of them.`,
    };
  });
}

export const marketLabels = () => Object.values(MARKETS).map((m) => ({ id: m.id, label: m.label }));
