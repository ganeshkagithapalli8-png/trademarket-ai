/**
 * Market-data facade — the single door between providers and the app.
 *
 *   Provider (CoinGecko / ECB / broker kite / paper venue engine)
 *     → marketData (quotes, history, feed status, tick hub)
 *       → WebSocket + REST
 *         → Trading application (prices, candles, watchlist, paper trading)
 *
 * Honesty rules (spec §11): every quote carries its true feed status.
 *  · 'live'    – provider streams/refreshes real market prices (crypto)
 *  · 'delayed' – provider supplies a real but stale reference (ECB daily FX)
 *  · 'paper'   – simulated venue price, never presented as a real quote
 * Nothing here invents a "real-time" claim the provider cannot back.
 */
import { EventEmitter } from 'node:events';
import { quote as engineQuote, candles as engineCandles } from './marketEngine.js';
import { getInstrument } from './instruments.js';

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];
const TF_MS = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '4h': 14_400_000, '1D': 86_400_000, '1W': 604_800_000, '1M': 2_592_000_000,
};
export const tfMs = (tf) => TF_MS[tf] || TF_MS['5m'];

/** True when the instrument's venue is open right now (IST session or 24/7). */
export function sessionOpen(inst, now = new Date()) {
  if (!inst) return false;
  if (inst.market === 'crypto') return true;
  if (inst.market === 'forex') return now.getUTCDay() >= 1 && now.getUTCDay() <= 5; // 24/5
  // IST session 09:15–15:30 approximated from UTC offset +5:30.
  const ist = new Date(now.getTime() + (5.5 * 3600_000) + now.getTimezoneOffset() * 60_000);
  const h = ist.getHours() + ist.getMinutes() / 60;
  return ist.getDay() >= 1 && ist.getDay() <= 5 && h >= 9.25 && h <= 15.5;
}

/** Feed truth for a symbol: source, latency class, human label, session state. */
export function feedInfo(symbol, q) {
  const inst = getInstrument(symbol);
  const quote_ = q || engineQuote(symbol);
  const source = quote_?.source === 'live' ? 'live' : 'paper';
  let latency = 'paper';
  let label = 'PAPER VENUE';
  if (source === 'live') {
    if (inst?.market === 'forex') { latency = 'delayed'; label = 'DELAYED · ECB daily ref'; }
    else { latency = 'live'; label = 'LIVE'; }
  }
  return { source, latency, label, marketOpen: sessionOpen(inst), currency: inst?.currency || 'INR' };
}

export function getQuote(symbol) {
  const q = engineQuote(symbol);
  if (!q) return null;
  return { ...q, feed: feedInfo(symbol, q) };
}

export function getHistoricalData(symbol, timeframe = '5m', limit = 240) {
  const tf = TIMEFRAMES.includes(timeframe) ? timeframe : '5m';
  return engineCandles(symbol, tf, limit).map((c) => ({ ...c, timeframe: tf }));
}

/**
 * Tick hub: one server-side loop produces quotes for every subscribed symbol
 * and aggregates candles per timeframe. Candles and the displayed price come
 * from the same quote object, satisfying the single-source requirement.
 */
class TickHub extends EventEmitter {
  constructor() {
    super();
    this.quotes = new Set();
    this.candles = new Map(); // key `${symbol}|${tf}` → { bucket, candle }
    this.timer = null;
  }

  start(intervalMs = 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), intervalMs);
    this.timer.unref?.();
  }

  subscribeQuotes(symbols) {
    for (const s of symbols) this.quotes.add(s);
    return () => symbols.forEach((s) => this.quotes.delete(s));
  }

  subscribeCandles(symbol, tf) {
    const key = `${symbol}|${tf}`;
    if (!this.candles.has(key)) this.prime(symbol, tf);
    this.quotes.add(symbol);
    return () => { this.candles.delete(key); this.quotes.delete(symbol); };
  }

  prime(symbol, tf) {
    const hist = getHistoricalData(symbol, tf, 2);
    const last = hist[hist.length - 1];
    const q = engineQuote(symbol);
    const bucket = Math.floor(Date.now() / tfMs(tf)) * tfMs(tf);
    this.candles.set(key(symbol, tf), {
      bucket,
      candle: last
        ? { t: bucket, o: last.o, h: Math.max(last.h, q?.price ?? last.c), l: Math.min(last.l, q?.price ?? last.c), c: q?.price ?? last.c, v: last.v }
        : { t: bucket, o: q?.price ?? 0, h: q?.price ?? 0, l: q?.price ?? 0, c: q?.price ?? 0, v: 0 },
    });
  }

  pump(now = Date.now()) {
    for (const symbol of this.quotes) {
      const q = getQuote(symbol);
      if (!q) continue;
      this.emit('tick', q);
      for (const [k, st] of this.candles) {
        if (!k.startsWith(`${symbol}|`)) continue;
        const tf = k.slice(symbol.length + 1);
        const bucket = Math.floor(now / tfMs(tf)) * tfMs(tf);
        if (bucket !== st.bucket) {
          this.emit('candle', { symbol, timeframe: tf, candle: { ...st.candle, closed: true } });
          st.bucket = bucket;
          st.candle = { t: bucket, o: q.price, h: q.price, l: q.price, c: q.price, v: 0 };
        } else {
          const c = st.candle;
          c.h = Math.max(c.h, q.price);
          c.l = Math.min(c.l, q.price);
          c.c = q.price;
          c.v = q.volume ?? c.v;
        }
        this.emit('candle', { symbol, timeframe: tf, candle: { ...st.candle, closed: false } });
      }
    }
  }
}
const key = (s, tf) => `${s}|${tf}`;

export const hub = new TickHub();

/* Spec §10 surface — everything else in the app goes through these. */
export const marketData = {
  getQuote,
  getHistoricalData,
  subscribeToQuotes: (symbols) => hub.subscribeQuotes(symbols),
  subscribeToCandles: (symbol, timeframe) => hub.subscribeCandles(symbol, timeframe),
  feedInfo,
  sessionOpen,
  TIMEFRAMES,
};
export default marketData;
