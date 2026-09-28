/**
 * The bot.
 *
 * Design rules that are load-bearing:
 *
 *   • Deterministic. Signals come from indicator maths, never from an LLM.
 *     An LLM cannot be backtested, has no calibrated probability and cannot be
 *     audited, so it is nowhere in this file's decision path. Gemini is used
 *     only AFTER a trade closes, to write a human-readable review.
 *   • Every candidate order passes a risk gate that can refuse it.
 *   • It learns from its own closed paper trades: per-setup expectancy stats
 *     plus a small online logistic scorer over entry-time features. Both are
 *     inspectable — the weights are stored as JSON and surfaced in the UI.
 *   • It only ever trades the simulated wallet. There is no broker client,
 *     no order-routing code and no live capital anywhere in this repository.
 */

import { candles, quote } from './marketEngine.js';
import { analyse, candlePatterns } from './indicators.js';
import { getInstrument, listInstruments, MARKETS } from './instruments.js';
import { MARKET_GATES, BOT_ARMABLE_MODULES } from './roadmap.js';

const TF = '15m';
const BARS = 160;

// ── feature vector for the online logistic scorer ───────────────────────────

export const FEATURES = [
  'rsi',
  'trend',
  'trendStr',
  'atrPct',
  'distSup',
  'distRes',
  'ret5',
  'ret20',
  'bodyRatio',
  'riskPct',
];

/** Fixed normalisers keep the feature scale stable across instruments. */
export function featureVector(a, side, riskPct) {
  const price = a.price || 1;
  const dir = side === 'short' ? -1 : 1;
  return [
    clamp(((a.rsi ?? 50) - 50) / 50, -1, 1),
    (a.trend === 'up' ? 1 : -1) * dir,
    clamp((a.trendStrength ?? 0) / 2, -1, 1) * dir,
    clamp((a.atrPct ?? 0) / 3, 0, 1),
    clamp(a.support ? ((price - a.support) / price) * 10 : 0, -1, 1) * dir,
    clamp(a.resistance ? ((a.resistance - price) / price) * 10 : 0, -1, 1) * dir,
    clamp((a.ret5 ?? 0) / 3, -1, 1) * dir,
    clamp((a.ret20 ?? 0) / 6, -1, 1) * dir,
    clamp(a.bodyRatio ?? 0, 0, 1),
    clamp(riskPct / 3, 0, 1),
  ];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

/** One SGD step on the closed-trade label (1 = win, 0 = loss). */
export function trainWeights(weights, features, label, lr = 0.06, l2 = 0.0015) {
  const w = Array.isArray(weights) && weights.length === FEATURES.length ? [...weights] : new Array(FEATURES.length).fill(0);
  const bias = typeof weights?.bias === 'number' ? weights.bias : 0;
  const z = features.reduce((s, f, i) => s + f * w[i], 0) + bias;
  const err = sigmoid(z) - label;
  const next = w.map((wi, i) => wi - lr * (err * features[i] + l2 * wi));
  return { coefficients: next, bias: bias - lr * err };
}

export function scoreEntry(weights, features) {
  if (!weights || !Array.isArray(weights.coefficients)) return null;
  const z = features.reduce((s, f, i) => s + f * (weights.coefficients[i] || 0), 0) + (weights.bias || 0);
  return sigmoid(z);
}

// ── setups ──────────────────────────────────────────────────────────────────

/**
 * Each setup returns null (no trade) or { side, reason, confidence }.
 * All of them are pure functions of the indicator snapshot.
 */
export const SETUPS = {
  'trend-pullback': {
    label: 'Trend pullback',
    description: 'Buy dips inside a confirmed uptrend, triggered by RSI resetting below 40 and turning back up.',
    evaluate(a) {
      if (!a.ema9 || !a.ema21 || !a.sma50 || a.rsi == null) return null;
      const upTrend = a.price > a.sma50 && a.ema9 > a.ema21;
      const rsiReset = a.rsiPrev != null && a.rsiPrev < 40 && a.rsi >= 40;
      if (upTrend && rsiReset && a.atr) return { side: 'long', reason: `Uptrend + RSI reset ${a.rsiPrev?.toFixed(1)}→${a.rsi.toFixed(1)}`, confidence: 0.62 };
      return null;
    },
  },
  'breakout-retest': {
    label: 'Breakout',
    description: 'Close above the recent resistance zone on an expanding body.',
    evaluate(a) {
      if (!a.resistance || !a.atr) return null;
      const brokeOut = a.price > a.resistance && a.momentum > 0 && a.bodyRatio > 0.55;
      const notExtended = a.resistance && (a.price - a.resistance) / a.resistance < 0.02;
      if (brokeOut && notExtended) return { side: 'long', reason: `Closed above resistance ${round(a.resistance)}`, confidence: 0.55 };
      return null;
    },
  },
  'mean-reversion': {
    label: 'Mean reversion',
    description: 'Fade extremes back toward the pivot when RSI is stretched and price is at a band.',
    evaluate(a) {
      if (a.rsi == null || !a.support || !a.resistance) return null;
      if (a.rsi < 27 && a.price <= a.support * 1.012) return { side: 'long', reason: `RSI ${a.rsi.toFixed(1)} at support ${round(a.support)}`, confidence: 0.5 };
      if (a.rsi > 73 && a.price >= a.resistance * 0.988) return { side: 'short', reason: `RSI ${a.rsi.toFixed(1)} at resistance ${round(a.resistance)}`, confidence: 0.5 };
      return null;
    },
  },
  'momentum-continuation': {
    label: 'Momentum continuation',
    description: 'Join a strong aligned move with a dominant-body candle in the trend direction.',
    evaluate(a) {
      if (!a.ema9 || !a.ema21 || a.ret5 == null) return null;
      const strong = a.bodyRatio > 0.7 && a.trendStrength > 0.35 && Math.abs(a.ret5) > 0.8;
      if (strong && a.trend === 'up' && a.rsi < 78) return { side: 'long', reason: `Strong bullish body, +${a.ret5.toFixed(2)}% over 5 bars`, confidence: 0.52 };
      if (strong && a.trend === 'down' && a.rsi > 22) return { side: 'short', reason: `Strong bearish body, ${a.ret5.toFixed(2)}% over 5 bars`, confidence: 0.52 };
      return null;
    },
  },
};

const round = (v) => (v == null ? null : Math.round(v * 100) / 100);

// ── eligibility ─────────────────────────────────────────────────────────────

export function marketUnlocked(market, completedModuleIds, ageOk) {
  const gates = MARKET_GATES[market] || [];
  const missing = gates.filter((g) => !completedModuleIds.includes(g));
  return {
    unlocked: missing.length === 0 && ageOk,
    missing,
    reason: missing.length
      ? `Complete ${missing.map((m) => `"${m}"`).join(', ')} first — derivatives need the risk module.`
      : !ageOk
        ? 'Age verification (18+) required.'
        : null,
  };
}

export function botArmable(completedModuleIds) {
  const missing = BOT_ARMABLE_MODULES.filter((m) => !completedModuleIds.includes(m));
  return { armable: missing.length === 0, missing, completed: BOT_ARMABLE_MODULES.length - missing.length, total: BOT_ARMABLE_MODULES.length };
}

// ── signal scan ─────────────────────────────────────────────────────────────

/**
 * Scan instruments and return ranked candidate entries.
 * Purely informational when `dryRun` is true; the risk gate is applied by
 * the caller before anything touches the wallet.
 */
export function scanSignals({ markets = ['stocks'], completedModuleIds = [], ageOk = true, setups = {}, weights = null, minTradesForMl = 15, tradesSeen = 0, limit = 12 }) {
  const out = [];
  const activeSetups = Object.keys(SETUPS).filter((k) => setups?.[k]?.disabled !== true);

  for (const market of markets) {
    if (!MARKETS[market]) continue;
    const gate = marketUnlocked(market, completedModuleIds, ageOk);
    if (!gate.unlocked) continue;

    for (const inst of listInstruments(market)) {
      let a;
      try {
        a = analyse(candles(inst.symbol, TF, BARS));
      } catch {
        continue;
      }
      if (!a || !a.atr) continue;

      for (const setupId of activeSetups) {
        const hit = SETUPS[setupId].evaluate(a);
        if (!hit) continue;

        const stat = setups?.[setupId];
        const setupWeight = stat && stat.n >= 10 ? stat.weight : 1;
        if (setupWeight <= 0.15) continue; // learned to be worthless → skip

        const fv = featureVector(a, hit.side, 1);
        const ml = tradesSeen >= minTradesForMl ? scoreEntry(weights, fv) : null;
        if (ml != null && ml < 0.42) continue; // learned filter

        const q = quote(inst.symbol);
        out.push({
          symbol: inst.symbol,
          name: inst.name,
          market,
          lot: inst.lot,
          setup: setupId,
          setupLabel: SETUPS[setupId].label,
          side: hit.side,
          reason: hit.reason,
          confidence: round(clamp(hit.confidence * setupWeight * (ml != null ? 0.6 + ml * 0.8 : 1), 0, 0.99)),
          mlScore: ml == null ? null : round(ml),
          setupWeight: round(setupWeight),
          price: q?.price ?? round(a.price),
          changePct: q?.changePct ?? null,
          indicators: {
            rsi: round(a.rsi),
            ema9: round(a.ema9),
            ema21: round(a.ema21),
            sma50: round(a.sma50),
            atr: round(a.atr),
            atrPct: round(a.atrPct),
            support: round(a.support),
            resistance: round(a.resistance),
            trend: a.trend,
          },
          patterns: candlePatterns(candles(inst.symbol, TF, 3)),
          features: fv.map((v) => round(v)),
        });
      }
    }
  }

  return out.sort((x, y) => y.confidence - x.confidence).slice(0, limit);
}

// ── risk gate & sizing ──────────────────────────────────────────────────────

/**
 * The most important function in the file. It can — and routinely should —
 * refuse a trade. Returns { ok:false, reason } or { ok:true, qty, ... }.
 */
export function riskGate({
  signal,
  price,
  atr,
  balance,
  equity,
  riskPerTradePct,
  maxDailyLossPct,
  maxOpenPositions,
  openPositions,
  dailyPnl,
  killSwitch,
  dailyLossHit,
  lot = 1,
  stopMultiple = 1.5,
  targetMultiple = 2,
}) {
  if (killSwitch) return { ok: false, reason: 'Kill switch is ON. Disarm it before the bot can trade.' };
  if (dailyLossHit) return { ok: false, reason: 'Daily loss limit already hit — no new entries today.' };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'No valid price.' };
  if (!Number.isFinite(atr) || atr <= 0) return { ok: false, reason: 'Volatility (ATR) unavailable — cannot size safely.' };
  if (equity <= 0) return { ok: false, reason: 'No capital. Add simulated funds first.' };
  if (openPositions.length >= maxOpenPositions) return { ok: false, reason: `Max open positions (${maxOpenPositions}) reached.` };
  if (openPositions.some((p) => p.symbol === signal.symbol)) return { ok: false, reason: `Already exposed to ${signal.symbol}.` };

  const dailyLimitAbs = (equity * maxDailyLossPct) / 100;
  if (dailyPnl <= -dailyLimitAbs) return { ok: false, reason: `Daily loss limit (${maxDailyLossPct}%) reached.` };

  const stopDistance = atr * stopMultiple;
  const stopPrice = signal.side === 'long' ? price - stopDistance : price + stopDistance;
  const targetPrice = signal.side === 'long' ? price + stopDistance * targetMultiple : price - stopDistance * targetMultiple;
  if (stopPrice <= 0) return { ok: false, reason: 'Stop distance exceeds price — instrument too volatile to size.' };

  const riskAmount = (equity * riskPerTradePct) / 100;
  const rawQty = riskAmount / stopDistance;
  const qty = Math.floor(rawQty / lot) * lot;
  if (qty <= 0) return { ok: false, reason: `Position too small to size at ${riskPerTradePct}% risk (lot ${lot}).` };

  const notional = qty * price;
  // Never commit more than a third of the wallet to one paper position.
  if (notional > equity * 0.34) return { ok: false, reason: 'Notional would exceed 34% of capital — reducing exposure is mandatory.' };

  return {
    ok: true,
    qty,
    stopPrice: round(stopPrice),
    targetPrice: round(targetPrice),
    riskAmount: round(riskAmount),
    notional: round(notional),
    stopDistance: round(stopDistance),
    rewardRisk: targetMultiple,
    balanceAfterMargin: round(balance),
  };
}

// ── learning ────────────────────────────────────────────────────────────────

/**
 * Fold one closed trade into the bot's memory:
 *   • per-setup frequency stats → expectancy → entry weight
 *   • one SGD step on the logistic scorer
 *   • a human-readable lesson
 */
export function learnFromTrade({ setups = {}, weights = null, tradesSeen = 0 }, trade) {
  const nextSetups = { ...setups };
  const s = nextSetups[trade.setup] || { n: 0, wins: 0, losses: 0, scratches: 0, grossProfit: 0, grossLoss: 0, rSum: 0, weight: 1 };

  s.n += 1;
  if (trade.outcome === 'win') s.wins += 1;
  else if (trade.outcome === 'loss') s.losses += 1;
  else s.scratches += 1;
  if (trade.pnl > 0) s.grossProfit += trade.pnl;
  else s.grossLoss += Math.abs(trade.pnl);
  s.rSum += Number.isFinite(trade.rMultiple) ? trade.rMultiple : 0;

  s.winRate = s.n ? s.wins / s.n : 0;
  s.avgR = s.n ? s.rSum / s.n : 0;
  s.profitFactor = s.grossLoss > 0 ? s.grossProfit / s.grossLoss : s.grossProfit > 0 ? 99 : 0;
  s.expectancy = s.n ? (s.grossProfit - s.grossLoss) / s.n : 0;

  // Weight: only trust the stats once there are enough samples.
  if (s.n >= 10) {
    const edge = clamp(s.avgR / 1.5, -1, 1); // ~1.5R is an excellent average
    s.weight = round(clamp(0.35 + 0.65 * (0.5 + edge / 2) * 2 - 0.65, 0.1, 1.6));
    s.weight = round(clamp(0.35 + (0.5 + edge / 2) * 1.25, 0.1, 1.6));
  } else {
    s.weight = 1;
  }
  s.lastOutcome = trade.outcome;
  s.lastUpdated = new Date().toISOString();
  nextSetups[trade.setup] = s;

  const fv = trade.features;
  const nextWeights = Array.isArray(fv) && fv.length === FEATURES.length
    ? trainWeights(weights, fv, trade.outcome === 'win' ? 1 : 0)
    : weights;

  const lesson = buildLesson(trade, s);

  return { setups: nextSetups, weights: nextWeights, tradesSeen: tradesSeen + 1, lesson };
}

function buildLesson(trade, s) {
  const dir = trade.pnl >= 0 ? 'won' : 'lost';
  const rTxt = Number.isFinite(trade.rMultiple) ? `${trade.rMultiple > 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R` : 'n/a';
  const sample = s.n >= 10 ? 'Sample is now large enough to trust.' : `Still only ${s.n} sample${s.n === 1 ? '' : 's'} — treat this as noise, not evidence.`;
  const pf = s.profitFactor ? s.profitFactor.toFixed(2) : '—';

  const parts = [
    `${s.n ? '' : ''}${trade.setup.replace(/-/g, ' ')} on ${trade.symbol} (${trade.side}) ${dir} ${rTxt}.`,
    `Setup now ${s.wins}W/${s.losses}L, profit factor ${pf}, avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R.`,
  ];

  if (trade.outcome === 'loss') {
    if (trade.exitReason === 'stop_loss') parts.push('Stopped out — the risk budget did its job; this is the cost of doing business, not an error.');
    else if (trade.exitReason === 'daily_limit') parts.push('Closed by the daily loss limit. Correct behaviour: the system protected capital.');
    else if (trade.exitReason === 'kill_switch') parts.push('Closed by the kill switch.');
    else parts.push('Closed at target/exit rule.');
    if (s.n >= 10 && s.avgR < 0) parts.push(`This setup has negative expectancy over ${s.n} trades — entry weight reduced to ${s.weight}.`);
  } else {
    if (s.n >= 10 && s.avgR > 0.4) parts.push(`Positive expectancy confirmed over ${s.n} trades — entry weight raised to ${s.weight}.`);
    else parts.push('One win changes nothing on its own; expectancy is what matters.');
  }
  parts.push(sample);
  return parts.join(' ');
}

// ── position management ─────────────────────────────────────────────────────

/** Check open positions against stops/targets. Returns exit instructions. */
export function managePosition(position, price) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const long = position.side === 'long';
  const sl = Number(position.stop_loss);
  const tp = Number(position.target);

  if (long) {
    if (Number.isFinite(sl) && sl > 0 && price <= sl) return { exit: true, reason: 'stop_loss', price };
    if (Number.isFinite(tp) && tp > 0 && price >= tp) return { exit: true, reason: 'target', price };
  } else {
    if (Number.isFinite(sl) && sl > 0 && price >= sl) return { exit: true, reason: 'stop_loss', price };
    if (Number.isFinite(tp) && tp > 0 && price <= tp) return { exit: true, reason: 'target', price };
  }
  return { exit: false, price };
}

export const pnlOf = (side, qty, entry, exit) =>
  Number(side === 'long' ? (exit - entry) * qty : (entry - exit) * qty);

// ── backtester ──────────────────────────────────────────────────────────────

/**
 * Replay the exact production signal code over historical bars.
 * Fills happen on the NEXT bar's open — never the signal bar's close — which
 * is the single most common way beginners fool themselves.
 */
export function backtest({
  symbol,
  setupId = 'trend-pullback',
  interval = '15m',
  bars = 400,
  capital = 100000,
  riskPerTradePct = 1,
  stopMultiple = 1.5,
  targetMultiple = 2,
  costBps = 8,
  slippageBps = 3,
}) {
  const inst = getInstrument(symbol);
  if (!inst) return { error: `Unknown instrument ${symbol}` };
  const setup = SETUPS[setupId];
  if (!setup) return { error: `Unknown setup ${setupId}` };

  const full = candles(symbol, interval, bars);
  if (full.length < 60) return { error: 'Not enough history for a meaningful backtest.' };

  const trades = [];
  let equity = capital;
  let peak = capital;
  let maxDrawdown = 0;
  let open = null;
  let longestLossStreak = 0;
  let currentStreak = 0;

  for (let i = 55; i < full.length - 1; i++) {
    const window = full.slice(0, i + 1);
    const price = full[i + 1].o; // honest fill: next bar open

    if (open) {
      const bar = full[i + 1];
      const long = open.side === 'long';
      let exit = null;
      let reason = null;
      if (long) {
        if (bar.l <= open.stop) { exit = open.stop; reason = 'stop_loss'; }
        else if (bar.h >= open.target) { exit = open.target; reason = 'target'; }
      } else {
        if (bar.h >= open.stop) { exit = open.stop; reason = 'stop_loss'; }
        else if (bar.l <= open.target) { exit = open.target; reason = 'target'; }
      }
      if (!exit && i === full.length - 2) { exit = bar.c; reason = 'end_of_data'; }

      if (exit) {
        const gross = long ? (exit - open.entry) * open.qty : (open.entry - exit) * open.qty;
        const costs = (open.entry + exit) * open.qty * ((costBps + slippageBps) / 10_000);
        const pnl = gross - costs;
        equity += pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
        const r = open.riskAmount ? pnl / open.riskAmount : 0;
        trades.push({
          entryAt: open.entryAt,
          exitAt: bar.t,
          side: open.side,
          entry: round(open.entry),
          exit: round(exit),
          qty: open.qty,
          pnl: round(pnl),
          r: round(r),
          reason,
          equity: round(equity),
        });
        if (pnl < 0) { currentStreak += 1; longestLossStreak = Math.max(longestLossStreak, currentStreak); }
        else currentStreak = 0;
        open = null;
      }
      continue;
    }

    // Look for an entry using only information available at bar i.
    const a = analyse(window);
    if (!a || !a.atr) continue;
    const hit = setup.evaluate(a);
    if (!hit) continue;

    const stopDistance = a.atr * stopMultiple;
    if (stopDistance <= 0) continue;
    const riskAmount = (equity * riskPerTradePct) / 100;
    const rawQty = riskAmount / stopDistance;
    const qty = Math.max(Math.floor(rawQty / inst.lot) * inst.lot, 0);
    if (qty <= 0) continue;
    if (qty * price > equity * 0.34) continue;

    open = {
      side: hit.side,
      entry: price,
      entryAt: full[i + 1].t,
      qty,
      riskAmount,
      stop: hit.side === 'long' ? price - stopDistance : price + stopDistance,
      target: hit.side === 'long' ? price + stopDistance * targetMultiple : price - stopDistance * targetMultiple,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netPnl = equity - capital;

  return {
    symbol,
    setup: setupId,
    setupLabel: setup.label,
    interval,
    bars: full.length,
    capitalIn: capital,
    capitalOut: round(equity),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? 99 : 0,
    expectancy: trades.length ? round(netPnl / trades.length) : 0,
    avgR: trades.length ? round(trades.reduce((s, t) => s + t.r, 0) / trades.length) : 0,
    netPnl: round(netPnl),
    returnPct: round((netPnl / capital) * 100),
    maxDrawdownPct: round(maxDrawdown),
    longestLossStreak,
    costAssumptionBps: costBps + slippageBps,
    series: trades.map((t) => ({ t: t.exitAt, equity: t.equity })),
    tradeList: trades.slice(-40),
    dataIsSimulated: true,
    verdict: verdictFor(trades.length, netPnl, capital, maxDrawdown, wins.length),
  };
}

function verdictFor(n, netPnl, capital, dd, wins) {
  if (n < 30) return { level: 'insufficient', text: `Only ${n} trades. Below ~100 samples you cannot distinguish skill from luck. Keep going.` };
  const retPct = (netPnl / capital) * 100;
  if (retPct <= 0) return { level: 'negative', text: `Negative expectancy over ${n} trades (${retPct.toFixed(2)}% after costs). Do not trade this setup. Re-examine the filter or the regime.` };
  if (dd > 20) return { level: 'risky', text: `Positive (${retPct.toFixed(2)}%) but a ${dd.toFixed(1)}% drawdown is survivable only at much smaller size. Cut risk per trade.` };
  if (wins / n < 0.35) return { level: 'fragile', text: `Profitable, but a ${((wins / n) * 100).toFixed(0)}% win rate means long losing streaks. Verify you could actually hold through them.` };
  return { level: 'promising', text: `Positive expectancy over ${n} trades with a ${dd.toFixed(1)}% max drawdown. Worth continued paper validation — this is still not evidence it will persist.` };
}

export const setupCatalogue = () =>
  Object.entries(SETUPS).map(([id, s]) => ({ id, label: s.label, description: s.description }));
