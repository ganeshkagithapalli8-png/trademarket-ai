/**
 * Simulated market engine.
 *
 * Deterministic by design: a symbol's whole price history is a pure function of
 * (seed, time). Two servers started a week apart produce the identical series,
 * so backtests, charts and open P&L all agree and nothing drifts on restart.
 *
 * Construction:
 *   1. A fixed epoch. Daily log-returns are drawn from a seeded Gaussian.
 *   2. Prefix sums over those daily returns give the exact close of any day in
 *      O(days-since-epoch) — memoised, so effectively O(1).
 *   3. Only the most recent WINDOW_DAYS are expanded into 5-minute bars. Each
 *      day's 288 intraday deltas are generated then rescaled so they sum to that
 *      day's total, which keeps the intraday series perfectly continuous with
 *      the daily closes without materialising years of ticks.
 *
 * This is synthetic data. It is not a quote, not a feed, and not investable.
 */

import { getInstrument, INSTRUMENTS } from './instruments.js';

const EPOCH = Date.UTC(2024, 0, 1); // 2024-01-01T00:00:00Z
const DAY = 86_400_000;
const STEP = 5 * 60_000; // 5-minute bars
const STEPS_PER_DAY = DAY / STEP; // 288
const WINDOW_DAYS = 46; // how much intraday history we materialise
const TRADING_DAYS_PER_YEAR = 252;

// ── deterministic randomness ────────────────────────────────────────────────

function hashInt(seed, i) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
}

const u01 = (seed, i) => hashInt(seed, i) / 4294967296;

/** Box–Muller: standard normal from two uniforms. */
function gauss(seed, i) {
  const u = Math.max(u01(seed, i * 2), 1e-12);
  const v = u01(seed, i * 2 + 1);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Smooth [0,1] fade used to interpolate intraday shape. */
const smooth = (x) => x * x * (3 - 2 * x);

// ── per-instrument state ────────────────────────────────────────────────────

const cache = new Map();

function stateFor(inst) {
  let s = cache.get(inst.symbol);
  if (!s) {
    s = {
      inst,
      sigmaDaily: inst.vol / Math.sqrt(TRADING_DAYS_PER_YEAR),
      driftDaily: inst.drift / TRADING_DAYS_PER_YEAR,
      dailyPrefix: new Map(), // dayIndex -> cumulative log price at that day's close
      series: null, // { startDay, startIdx, log: Float64Array }
      lastLivePrice: null,
      lastLiveAt: 0,
    };
    cache.set(inst.symbol, s);
  }
  return s;
}

const dayIndexOf = (t) => Math.floor((t - EPOCH) / DAY);

/** Cumulative log-price at the CLOSE of day `d` (d may be negative-safe). */
function dailyLog(s, d) {
  if (s.dailyPrefix.has(d)) return s.dailyPrefix.get(d);

  // Anchor on a cached day near `d` so we never sum from the epoch twice.
  let anchor = 0;
  let best = Infinity;
  for (const k of s.dailyPrefix.keys()) {
    const dist = Math.abs(k - d);
    if (dist < best) {
      best = dist;
      anchor = k;
    }
  }

  let log = s.dailyPrefix.has(anchor) ? s.dailyPrefix.get(anchor) : Math.log(s.inst.base);
  if (!s.dailyPrefix.has(anchor)) s.dailyPrefix.set(anchor, log);

  if (d > anchor) {
    for (let i = anchor + 1; i <= d; i++) {
      log += s.driftDaily + s.sigmaDaily * gauss(s.inst.seed, i);
      s.dailyPrefix.set(i, log);
    }
  } else if (d < anchor) {
    for (let i = anchor; i > d; i--) {
      const step = s.driftDaily + s.sigmaDaily * gauss(s.inst.seed, i);
      log -= step;
      s.dailyPrefix.set(i - 1, log);
    }
  }
  return s.dailyPrefix.get(d);
}

/**
 * Build the 5-minute log-price series covering the last WINDOW_DAYS through now.
 * startDay is aligned to a fixed offset from the epoch so restarts are stable
 * within the same day, and it re-materialises at most once per day.
 */
function buildSeries(s, now) {
  const today = dayIndexOf(now);
  const startDay = today - (WINDOW_DAYS - 1);

  if (s.series && s.series.startDay === startDay && s.series.coveredThrough >= now - STEP) {
    return s.series;
  }

  const days = today - startDay + 1;
  const len = days * STEPS_PER_DAY;
  const log = new Float64Array(len);

  let cursor = dailyLog(s, startDay - 1); // close of the day before the window

  for (let d = startDay; d <= today; d++) {
    const dayTotal = dailyLog(s, d) - cursor; // exact total move for this day
    const offset = (d - startDay) * STEPS_PER_DAY;

    // Raw intraday deltas: Gaussian, but shaped so overnight gaps and the
    // opening hour carry more of the move than the lunchtime lull.
    const raw = new Float64Array(STEPS_PER_DAY);
    let rawSum = 0;
    for (let k = 0; k < STEPS_PER_DAY; k++) {
      const n = gauss(s.inst.seed * 7 + 13, d * STEPS_PER_DAY + k);
      const shape = intradayShape(k, s.inst.market);
      raw[k] = n * shape;
      rawSum += raw[k];
    }

    // Rescale so the day's intraday path lands exactly on its daily close.
    const scale = rawSum === 0 ? 0 : dayTotal / rawSum;
    let running = cursor;
    for (let k = 0; k < STEPS_PER_DAY; k++) {
      running += raw[k] * scale;
      log[offset + k] = running;
    }
    cursor = dailyLog(s, d);
  }

  s.series = { startDay, log, coveredThrough: today * DAY + EPOCH + DAY };
  return s.series;
}

/** Relative volatility across the trading day: gaps and opens move, lunch does not. */
function intradayShape(k, market) {
  if (market === 'crypto') return 0.85 + 0.3 * Math.sin((k / STEPS_PER_DAY) * Math.PI * 2);
  const frac = k / STEPS_PER_DAY; // 0..1 across 24h
  const hour = frac * 24;
  // Indian session ~03:45–10:00 UTC
  const inSession = hour >= 3.5 && hour <= 10.5;
  if (!inSession) return 0.06; // near-flat outside the session
  const t = (hour - 3.5) / 7;
  const openBoost = Math.exp(-t * 9) * 1.9; // opening burst
  const closeBoost = Math.exp(-(1 - t) * 7) * 1.1; // closing burst
  const lunch = 1 - 0.45 * Math.exp(-Math.pow((t - 0.52) / 0.12, 2));
  return Math.max(0.12, (0.75 + openBoost + closeBoost) * lunch);
}

function logAt(s, t) {
  const series = buildSeries(s, t);
  const idx = Math.floor((t - EPOCH) / STEP);
  const startIdx = (series.startDay * DAY) / STEP;
  const rel = idx - startIdx;
  if (rel < 0) {
    // Outside the materialised window — fall back to the daily close model.
    return dailyLog(s, dayIndexOf(t));
  }
  if (rel >= series.log.length) return series.log[series.log.length - 1];

  const next = Math.min(rel + 1, series.log.length - 1);
  const frac = smooth(((t - EPOCH) / STEP) - idx);
  return series.log[rel] * (1 - frac) + series.log[next] * frac;
}

// ── live crypto overlay (read-only, optional) ───────────────────────────────

let liveOverlay = null;
export function setLiveOverlay(map) {
  liveOverlay = map; // { BTCINR: { price, at } }
}

// ── public API ──────────────────────────────────────────────────────────────

export function priceAt(symbol, t = Date.now()) {
  const inst = getInstrument(symbol);
  if (!inst) return null;
  const s = stateFor(inst);

  if (inst.live && liveOverlay && liveOverlay[inst.symbol]) {
    const o = liveOverlay[inst.symbol];
    if (Date.now() - o.at < 120_000) return { price: round(o.price, inst), source: 'live', at: o.at };
  }
  return { price: round(Math.exp(logAt(s, t)), inst), source: 'simulated', at: t };
}

/* Real-exchange references pushed in by marketData whenever a live tick lands
   (Upstox keyless/WS or Finnhub). While a reference exists it REPLACES the
   simulated walk level for that symbol everywhere — fills, marks, P&L — so
   paper money always trades at real prices. */
const liveRef = new Map();
export function setLiveReference(symbol, q) {
  if (!q || q.price == null) return;
  liveRef.set(symbol, { ...q, at: Date.now() });
}
export function getLiveReference(symbol) { return liveRef.get(symbol) || null; }

export function quote(symbol, now = Date.now()) {
  const inst = getInstrument(symbol);
  if (!inst) return null;

  const ref = liveRef.get(symbol);
  if (ref && ref.price > 0) {
    const fresh = Date.now() - ref.at < 90_000;
    const change = ref.change ?? (ref.prevClose ? ref.price - ref.prevClose : null);
    const changePct = ref.changePct ?? (ref.prevClose ? (change / ref.prevClose) * 100 : null);
    return {
      symbol: inst.symbol, name: inst.name, market: inst.market, sector: inst.sector,
      lot: inst.lot, decimals: inst.decimals ?? 2, currency: inst.currency || 'USD',
      price: ref.price,
      prevClose: ref.prevClose ?? ref.price,
      open: ref.open ?? ref.price,
      high: ref.high ?? ref.price,
      low: ref.low ?? ref.price,
      change: change ?? 0, changePct: changePct ?? 0,
      volume: ref.volume ?? null,
      source: fresh ? 'live' : 'frozen', // frozen = last real price, feed currently down
      at: ref.at,
    };
  }

  const live = priceAt(symbol, now);
  const prevCloseT = dayStart(now) - 1; // last ms of yesterday
  const prevClose = priceAt(symbol, prevCloseT).price;

  const dayOpen = priceAt(symbol, dayStart(now) + STEP).price;
  const samples = [];
  for (let k = 0; k < 96; k++) {
    samples.push(priceAt(symbol, dayStart(now) + k * 15 * 60_000).price);
  }
  samples.push(live.price);
  const dayHigh = Math.max(...samples);
  const dayLow = Math.min(...samples);

  const change = live.price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol: inst.symbol,
    name: inst.name,
    market: inst.market,
    sector: inst.sector,
    lot: inst.lot,
    decimals: inst.decimals ?? 2,
    price: live.price,
    prevClose: round(prevClose, inst),
    open: round(dayOpen, inst),
    high: round(Math.max(dayHigh, live.price), inst),
    low: round(Math.min(dayLow, live.price), inst),
    change: round(change, inst),
    changePct: round(changePct, 3),
    source: live.source,
    at: live.at,
    volume: simulatedVolume(inst, now),
  };
}

export function candles(symbol, interval = '5m', limit = 120, now = Date.now()) {
  const inst = getInstrument(symbol);
  if (!inst) return [];
  const s = stateFor(inst);

  const ms = { '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '1D': DAY }[interval] || 5 * 60_000;
  const n = Math.min(Math.max(limit, 5), 500);

  // Sample 4 points inside each bucket to synthesise O/H/L/C.
  const out = [];
  const endBucket = Math.floor((now - EPOCH) / ms);
  for (let b = endBucket - n + 1; b <= endBucket; b++) {
    const t0 = EPOCH + b * ms;
    if (t0 > now) break;
    const o = Math.exp(logAt(s, t0));
    const c = Math.exp(logAt(s, Math.min(t0 + ms - 1, now)));
    const m1 = Math.exp(logAt(s, Math.min(t0 + ms * 0.33, now)));
    const m2 = Math.exp(logAt(s, Math.min(t0 + ms * 0.66, now)));
    const body = [o, c, m1, m2];
    const jitter = Math.abs(gauss(inst.seed + 31, b)) * s.sigmaDaily * 0.35 * Math.max(o, c);
    out.push({
      t: t0,
      o: round(o, inst),
      h: round(Math.max(...body) + jitter, inst),
      l: round(Math.min(...body) - jitter, inst),
      c: round(c, inst),
      v: simulatedVolume(inst, t0 + ms / 2),
    });
  }
  return out;
}

export function history(symbol, points = 90, now = Date.now()) {
  const inst = getInstrument(symbol);
  if (!inst) return [];
  const out = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = now - i * DAY;
    out.push({ t, p: priceAt(symbol, t).price });
  }
  return out;
}

export function tickers(market, now = Date.now()) {
  const list = market && market !== 'all' ? INSTRUMENTS.filter((i) => i.market === market) : INSTRUMENTS;
  return list.map((i) => quote(i.symbol, now)).filter(Boolean);
}

// ── helpers ─────────────────────────────────────────────────────────────────

const dayStart = (t) => Math.floor(t / DAY) * DAY;

function round(v, inst) {
  const d = inst?.decimals ?? 2;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function simulatedVolume(inst, t) {
  const s = stateFor(inst);
  const d = dayIndexOf(t);
  const base = inst.market === 'crypto' ? 900 : inst.index ? 180_000 : 24_000;
  const seasonal = 1 + 0.55 * Math.sin((d / 7) * Math.PI * 2) + 0.3 * u01(inst.seed + 5, d);
  const intradayK = Math.floor(((t - EPOCH) % DAY) / STEP);
  return Math.max(1, Math.round(base * seasonal * (0.35 + intradayShape(intradayK, inst.market))));
}

export const engineInfo = () => ({
  epoch: EPOCH,
  stepMs: STEP,
  windowDays: WINDOW_DAYS,
  instruments: INSTRUMENTS.length,
  note: 'Synthetic, deterministic price model. Not a real market feed. Not investable.',
});
