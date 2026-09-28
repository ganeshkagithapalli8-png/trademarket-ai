import { Router } from 'express';
import { withUser, admin } from '../db/index.js';
import { asyncH, requireAuth, badRequest, forbidden, toNumber } from '../middleware.js';
import {
  SETUPS, setupCatalogue, backtest, botArmable, scanSignals, FEATURES,
} from '../services/bot.js';
import { getInstrument } from '../services/instruments.js';
import { BOT_ARMABLE_MODULES, MARKET_GATES } from '../services/roadmap.js';
import { getBotLearning, runBotCycle, manageOpenPositions, recordClosedTrade } from '../services/botRunner.js';
import { candles } from '../services/marketEngine.js';
import { analyse, candlePatterns } from '../services/indicators.js';

const router = Router();
router.use(requireAuth);

async function state(userId) {
  const { rows } = await withUser(userId, (c) =>
    c.query(`select * from bot_state where user_id=$1`, [userId])
  );
  return rows[0] || null;
}

async function completedModules(userId) {
  const { rows } = await withUser(userId, (c) =>
    c.query(`select module_id from learning_progress where user_id=$1 and status='completed'`, [userId])
  );
  return rows.map((r) => r.module_id);
}

router.get('/setups', (_req, res) => {
  res.json({ setups: setupCatalogue(), features: FEATURES });
});

router.get('/state', asyncH(async (req, res) => {
  const s = await state(req.userId);
  const completed = await completedModules(req.userId);
  const arm = botArmable(completed);

  res.json({
    enabled: Boolean(s?.enabled),
    killSwitch: Boolean(s?.kill_switch),
    tradesSeen: Number(s?.trades_seen ?? 0),
    lastRunAt: s?.last_run_at ?? null,
    setups: s?.setups ?? {},
    weights: s?.weights ?? null,
    armed: req.user.botArmed,
    armable: arm.armable,
    armProgress: `${arm.completed}/${arm.total}`,
    missingModules: arm.missing,
    risk: {
      riskPerTrade: req.user.riskPerTrade,
      maxDailyLoss: req.user.maxDailyLoss,
      maxOpenPositions: req.user.maxOpenPositions,
    },
    marketsEnabled: req.user.marketsEnabled,
    gatedMarkets: Object.entries(MARKET_GATES)
      .filter(([, g]) => g.length)
      .map(([m, g]) => ({ market: m, requires: g, unlocked: g.every((x) => completed.includes(x)) })),
    paperTradingOnly: true,
  });
}));

router.post('/config', asyncH(async (req, res) => {
  const s = (await state(req.userId)) || { setups: {}, weights: null, trades_seen: 0 };
  const setups = { ...(s.setups || {}) };

  if (req.body.enabled !== undefined) {
    if (req.body.enabled && !req.user.botArmed) {
      throw forbidden('Arm the bot first. Arming requires the full 13-module path to be complete.');
    }
    await withUser(req.userId, (c) =>
      c.query(
        `insert into bot_state (user_id, enabled) values ($1,$2)
         on conflict (user_id) do update set enabled=$2, updated_at=now()`,
        [req.userId, Boolean(req.body.enabled)]
      )
    );
  }

  if (req.body.setups && typeof req.body.setups === 'object') {
    for (const [id, val] of Object.entries(req.body.setups)) {
      if (!SETUPS[id]) throw badRequest(`Unknown setup "${id}".`);
      setups[id] = { ...(setups[id] || {}), disabled: Boolean(val?.disabled) };
    }
    await withUser(req.userId, (c) =>
      c.query(
        `insert into bot_state (user_id, setups) values ($1,$2::jsonb)
         on conflict (user_id) do update set setups=$2::jsonb, updated_at=now()`,
        [req.userId, JSON.stringify(setups)]
      )
    );
  }

  // Risk settings live on the profile.
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (req.body.riskPerTrade !== undefined) {
    const v = toNumber(req.body.riskPerTrade);
    if (!(v >= 0.1 && v <= 5)) throw badRequest('Risk per trade must be between 0.1% and 5%.');
    push('risk_per_trade', v);
  }
  if (req.body.maxDailyLoss !== undefined) {
    const v = toNumber(req.body.maxDailyLoss);
    if (!(v >= 0.5 && v <= 20)) throw badRequest('Daily loss limit must be between 0.5% and 20%.');
    push('max_daily_loss', v);
  }
  if (req.body.maxOpenPositions !== undefined) {
    const v = Math.round(toNumber(req.body.maxOpenPositions));
    if (!(v >= 1 && v <= 10)) throw badRequest('Max open positions must be between 1 and 10.');
    push('max_open_positions', v);
  }
  if (sets.length) {
    vals.push(req.userId);
    await withUser(req.userId, (c) =>
      c.query(`update profiles set ${sets.join(', ')} where id=$${vals.length}`, vals)
    );
  }

  res.json({ ok: true, setups, message: 'Bot configuration saved. All of this applies to simulated capital only.' });
}));

/**
 * Arming is deliberately hard to do: the entire 13-module path must be
 * complete and age must be verified. This mirrors the user's own step 14.
 */
router.post('/arm', asyncH(async (req, res) => {
  const want = req.body?.armed !== false;
  if (!want) {
    await admin((c) => c.query('update profiles set bot_armed=false where id=$1', [req.userId]));
    await withUser(req.userId, (c) =>
      c.query(
        `insert into bot_state (user_id, enabled) values ($1,false)
         on conflict (user_id) do update set enabled=false, updated_at=now()`,
        [req.userId]
      )
    );
    return res.json({ armed: false, message: 'Bot disarmed. Open positions are still managed for stops and targets.' });
  }

  const completed = await completedModules(req.userId);
  const arm = botArmable(completed);
  if (!req.user.ageVerified) throw forbidden('Verify you are 18+ in Settings before arming the bot.');
  if (!arm.armable) {
    throw forbidden(
      `The bot cannot be armed yet: ${arm.missing.length} of ${arm.total} modules remain (${arm.missing.join(', ')}). The path is sequential on purpose — paper trading only makes sense once risk management is internalised.`
    );
  }

  await admin((c) => c.query('update profiles set bot_armed=true where id=$1', [req.userId]));
  res.json({
    armed: true,
    message: 'Bot armed for PAPER trading. It will only ever move simulated rupees.',
    paperTradingOnly: true,
  });
}));

router.post('/kill-switch', asyncH(async (req, res) => {
  const on = req.body?.on !== false;
  await withUser(req.userId, async (c) => {
    await c.query(
      `insert into bot_state (user_id, kill_switch) values ($1,$2)
       on conflict (user_id) do update set kill_switch=$2, updated_at=now()`,
      [req.userId, on]
    );
    if (on) {
      // Kill switch means STOP: flatten everything now.
      const open = await c.query(`select * from positions where user_id=$1 and status='open'`, [req.userId]);
      for (const p of open.rows) {
        const { quote } = await import('../services/marketEngine.js');
        const q = quote(p.symbol);
        const price = q?.price ?? Number(p.current_price);
        const exitPrice = p.side === 'long' ? price * 0.9997 : price * 1.0003;
        const pnl = Math.round((p.side === 'long' ? (exitPrice - Number(p.entry_price)) : (Number(p.entry_price) - exitPrice)) * Number(p.qty) * 100) / 100;
        await c.query(
          `update positions set status='closed', exit_price=$3, pnl=$4, exit_reason='kill_switch', closed_at=now(), current_price=$3 where id=$1 and user_id=$2`,
          [p.id, req.userId, exitPrice, pnl]
        );
        await c.query('update wallets set sim_balance = sim_balance + $2 where user_id=$1', [req.userId, Number(p.margin_used) + pnl]);
      }
      await c.query(
        `insert into bot_state (user_id, enabled) values ($1,false)
         on conflict (user_id) do update set enabled=false`,
        [req.userId]
      );
    }
  });
  res.json({ killSwitch: on, message: on ? 'Kill switch ON — all open positions flattened, bot disabled.' : 'Kill switch OFF. Re-enable the bot when ready.' });
}));

router.get('/signals', asyncH(async (req, res) => {
  const s = await state(req.userId);
  const completed = await completedModules(req.userId);
  const signals = scanSignals({
    markets: req.user.marketsEnabled,
    completedModuleIds: completed,
    ageOk: req.user.ageVerified,
    setups: s?.setups || {},
    weights: s?.weights || null,
    tradesSeen: Number(s?.trades_seen ?? 0),
    limit: toNumber(req.query.limit, 12),
  });
  res.json({
    signals,
    armed: req.user.botArmed,
    running: Boolean(s?.enabled),
    mlActive: Number(s?.trades_seen ?? 0) >= 15,
    notice: 'These are simulator observations, not investment advice and not real-time market data.',
  });
}));

router.get('/learning', asyncH(async (req, res) => {
  res.json(await getBotLearning(req.userId));
}));

router.get('/memory', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `select id, symbol, market, side, setup, qty, entry_price, exit_price, pnl, pnl_pct,
              r_multiple, outcome, exit_reason, lesson, opened_by, created_at
         from bot_memory where user_id=$1 order by created_at desc limit $2`,
      [req.userId, Math.min(Math.max(toNumber(req.query.limit, 50), 5), 200)]
    )
  );
  res.json({ memory: rows });
}));

router.post('/memory/reset', asyncH(async (req, res) => {
  await withUser(req.userId, async (c) => {
    await c.query('delete from bot_memory where user_id=$1', [req.userId]);
    await c.query(
      `update bot_state set setups='{}'::jsonb, weights=null, trades_seen=0, updated_at=now() where user_id=$1`,
      [req.userId]
    );
  });
  res.json({ ok: true, message: 'Learning memory cleared. Setup weights are back to 1.0.' });
}));

router.post('/backtest', asyncH(async (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || 'RELIANCE').toUpperCase();
  const inst = getInstrument(symbol);
  if (!inst) throw badRequest(`Unknown instrument "${symbol}".`);
  if (!SETUPS[b.setup || 'trend-pullback']) throw badRequest(`Unknown setup. Choose one of: ${Object.keys(SETUPS).join(', ')}.`);

  const result = backtest({
    symbol,
    setupId: b.setup || 'trend-pullback',
    interval: ['5m', '15m', '1h', '1D'].includes(b.interval) ? b.interval : '15m',
    bars: Math.min(Math.max(toNumber(b.bars, 400), 100), 500),
    capital: Math.min(Math.max(toNumber(b.capital, 100000), 1000), 10_000_000),
    riskPerTradePct: Math.min(Math.max(toNumber(b.riskPerTrade, req.user.riskPerTrade), 0.1), 5),
    stopMultiple: Math.min(Math.max(toNumber(b.stopMultiple, 1.5), 0.5), 5),
    targetMultiple: Math.min(Math.max(toNumber(b.targetMultiple, 2), 0.5), 8),
    costBps: Math.min(Math.max(toNumber(b.costBps, 8), 0), 100),
    slippageBps: Math.min(Math.max(toNumber(b.slippageBps, 3), 0), 100),
  });
  if (result.error) throw badRequest(result.error);

  res.json({
    ...result,
    reminder: 'Backtested on SYNTHETIC simulator prices. A good backtest proves the code works — it does not prove an edge exists.',
  });
}));

router.post('/run', asyncH(async (req, res) => {
  const result = await runBotCycle(req.userId);
  res.json({ ok: true, ...result });
}));

router.post('/manage-positions', asyncH(async (req, res) => {
  const exits = await manageOpenPositions(req.userId);
  for (const e of exits) await recordClosedTrade(req.userId, e).catch(() => {});
  res.json({ ok: true, closed: exits.length });
}));

/** Read the chart for one instrument — feeds the AI "analyse" mode. */
router.get('/analyse/:symbol', asyncH(async (req, res) => {
  const inst = getInstrument(req.params.symbol.toUpperCase());
  if (!inst) throw badRequest(`Unknown instrument "${inst}".`);
  const interval = ['5m', '15m', '1h', '1D'].includes(req.query.interval) ? req.query.interval : '15m';
  const c = candles(inst.symbol, interval, 160);
  const a = analyse(c);
  if (!a) throw badRequest('Not enough history to analyse.');
  res.json({
    symbol: inst.symbol,
    name: inst.name,
    market: inst.market,
    interval,
    indicators: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10000) / 10000 : v])),
    patterns: candlePatterns(c.slice(-3)),
    dataIsSimulated: true,
  });
}));

export default router;
