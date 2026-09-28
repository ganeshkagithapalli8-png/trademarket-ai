/**
 * Technical indicators, implemented over the candle arrays produced by the
 * market engine. Plain functions, no dependencies, no hidden state.
 */

export const sma = (values, period) => {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
};

export const ema = (values, period) => {
  const out = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / Math.min(period, values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      out[i] = prev;
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

/** Wilder's RSI. */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Average True Range (Wilder). */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prev = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev));
  });
  let a = trs.slice(1, period + 1).reduce((x, y) => x + y, 0) / period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

/** Recent swing highs/lows as proxy support & resistance. */
export function supportResistance(candles, lookback = 60) {
  const slice = candles.slice(-lookback);
  if (slice.length < 8) return { support: null, resistance: null };
  const highs = slice.map((c) => c.h).sort((a, b) => a - b);
  const lows = slice.map((c) => c.l).sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    support: q(lows, 0.12),
    resistance: q(highs, 0.88),
    pivot: (q(lows, 0.5) + q(highs, 0.5)) / 2,
  };
}

/**
 * One-shot feature snapshot for the most recent closed candle.
 * This is the *only* thing the bot is allowed to reason about.
 */
export function analyse(candles) {
  if (!candles || candles.length < 40) return null;
  const closes = candles.map((c) => c.c);
  const last = closes.length - 1;

  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const trend200 = sma(closes, Math.min(50, closes.length));
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const sr = supportResistance(candles);

  const price = closes[last];
  const prev = closes[last - 1];
  const body = Math.abs(candles[last].c - candles[last].o);
  const range = Math.max(candles[last].h - candles[last].l, 1e-9);

  return {
    price,
    ema9: fast[last],
    ema21: slow[last],
    sma50: trend200[last],
    rsi: r[last],
    rsiPrev: r[last - 1],
    atr: a[last],
    atrPct: a[last] ? (a[last] / price) * 100 : null,
    support: sr.support,
    resistance: sr.resistance,
    pivot: sr.pivot,
    momentum: ((price - prev) / prev) * 100,
    ret5: ((price - closes[last - 5]) / closes[last - 5]) * 100,
    ret20: last >= 20 ? ((price - closes[last - 20]) / closes[last - 20]) * 100 : null,
    bodyRatio: body / range,
    trend: fast[last] > slow[last] ? 'up' : 'down',
    trendStrength: Math.abs(((fast[last] - slow[last]) / price) * 100),
    volatilityRegime: a[last] && trend200[last] ? (a[last] / price) * 100 : 0,
  };
}

/** Classic candlestick pattern flags — the vocabulary taught in module 2. */
export function candlePatterns(candles) {
  if (!candles || candles.length < 3) return [];
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const body = Math.abs(c.c - c.o);
  const range = Math.max(c.h - c.l, 1e-9);
  const upper = c.h - Math.max(c.c, c.o);
  const lower = Math.min(c.c, c.o) - c.l;
  const out = [];

  if (body / range < 0.12) out.push('Doji — indecision');
  if (lower > body * 2 && upper < body * 0.6) out.push('Hammer — potential reversal up');
  if (upper > body * 2 && lower < body * 0.6) out.push('Shooting star — potential reversal down');
  if (c.c > c.o && p.c < p.o && c.c > p.o && c.o < p.c) out.push('Bullish engulfing');
  if (c.c < c.o && p.c > p.o && c.o > p.c && c.c < p.o) out.push('Bearish engulfing');
  if (body / range > 0.75) out.push(c.c > c.o ? 'Strong bullish marubozu' : 'Strong bearish marubozu');
  return out;
}
