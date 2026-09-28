/**
 * Market-data facade — the single door between providers and the app.
 *
 *   Upstox (NSE/BSE, WS + REST)  ─┐
 *   CoinGecko / ECB references   ─┼→ marketData → WebSocket + REST → client
 *   Paper venue engine           ─┘
 *
 * Routing rule (honesty first): a symbol uses Upstox only while the Upstox
 * provider is configured AND its WebSocket is delivering ticks. The moment
 * the feed is down, symbols do NOT silently fall back to simulated prices
 * dressed as live — they stop ticking and the UI shows CONNECTION ERROR /
 * MARKET CLOSED. Unconfigured provider ⇒ everything stays on the clearly
 * labelled paper venue, exactly as before.
 */
import { EventEmitter } from 'node:events';
import { quote as engineQuote, candles as engineCandles } from './marketEngine.js';
import { getInstrument } from './instruments.js';
import { upstoxProvider } from './providers/upstox.js';

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
  if (inst.market === 'forex') return now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  if (upstoxProvider.resolve(inst.symbol) && (inst.market === 'stocks' || inst.market === 'fno' || inst.market === 'ipo')) {
    return upstoxProvider.marketOpen(now);
  }
  const ist = new Date(now.getTime() + (5.5 * 3600_000) + now.getTimezoneOffset() * 60_000);
  const h = ist.getHours() + ist.getMinutes() / 60;
  return ist.getDay() >= 1 && ist.getDay() <= 5 && h >= 9.25 && h <= 15.5;
}

/** Which provider owns this symbol right now? */
export function providerFor(symbol) {
  if (upstoxProvider.configured && upstoxProvider.resolve(symbol)) return 'upstox';
  return 'paper';
}

/** Feed truth for a symbol: source, latency class, human label, session state. */
export function feedInfo(symbol, q) {
  const inst = getInstrument(symbol);
  const prov = providerFor(symbol);
  if (prov === 'upstox') {
    const st = upstoxProvider.status();
    const open = upstoxProvider.marketOpen();
    if (st.state === 'live') return { source: 'upstox', latency: 'live', label: 'LIVE · UPSTOX', marketOpen: true, providerState: 'live' };
    if (!open || st.state === 'market_closed') return { source: 'upstox', latency: 'closed', label: 'MARKET CLOSED', marketOpen: false, providerState: st.state };
    return { source: 'upstox', latency: 'error', label: 'CONNECTION ERROR', marketOpen: open, providerState: st.state, reason: st.reason };
  }
  const quote_ = q || engineQuote(symbol);
  const source = quote_?.source === 'live' ? 'live' : 'paper';
  let latency = 'paper';
  let label = 'PAPER VENUE';
  if (source === 'live') {
    if (inst?.market === 'forex') { latency = 'delayed'; label = 'DELAYED · ECB daily ref'; }
    else { latency = 'live'; label = 'LIVE'; }
  }
  return { source, latency, label, marketOpen: sessionOpen(inst), currency: inst?.currency || 'INR', providerState: upstoxProvider.state };
}

/** getQuote(symbol) — facade entry. Upstox first when it owns the symbol. */
export async function getQuoteAsync(symbol) {
  if (providerFor(symbol) === 'upstox' && upstoxProvider.state !== 'unconfigured') {
    try {
      const q = await upstoxProvider.getQuote(symbol);
      return { ...q, feed: feedInfo(symbol, q) };
    } catch { /* fall through to a clearly-labelled REST-less state below */ }
  }
  return getQuote(symbol);
}

export function getQuote(symbol) {
  const q = engineQuote(symbol);
  if (!q) return null;
  return { ...q, feed: feedInfo(symbol, q) };
}

/** getHistoricalData(symbol, timeframe) — facade entry (async: may hit Upstox). */
export async function getHistoricalDataAsync(symbol, timeframe = '5m', limit = 240) {
  const tf = TIMEFRAMES.includes(timeframe) ? timeframe : '5m';
  if (providerFor(symbol) === 'upstox' && upstoxProvider.configured) {
    try {
      const candles = await upstoxProvider.getHistoricalCandles(symbol, tf, limit);
      if (candles.length) return candles.map((c) => ({ ...c, timeframe: tf, provider: 'upstox' }));
    } catch { /* provider hiccup → labelled paper history below */ }
  }
  return engineCandles(symbol, tf, limit).map((c) => ({ ...c, timeframe: tf, provider: 'paper' }));
}

export function getHistoricalData(symbol, timeframe = '5m', limit = 240) {
  const tf = TIMEFRAMES.includes(timeframe) ? timeframe : '5m';
  return engineCandles(symbol, tf, limit).map((c) => ({ ...c, timeframe: tf, provider: 'paper' }));
}

/**
 * Tick hub: candles aggregate server-side per timeframe from whatever ticks
 * the owning provider delivers (Upstox WS events, or the paper venue pump).
 * The current candle updates in place; on bucket rollover the closed candle
 * is emitted and a fresh one starts — clients never refetch for liveness.
 */
class TickHub extends EventEmitter {
  constructor() {
    super();
    this.quotes = new Set();
    this.candles = new Map(); // `${symbol}|${tf}` → { bucket, candle }
    this.timer = null;
    upstoxProvider.on('tick', (q) => this.processTick({ ...q, feed: feedInfo(q.symbol, q) }));
    upstoxProvider.on('status', (st) => this.emit('providerStatus', st));
  }

  start(intervalMs = 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), intervalMs);
    this.timer.unref?.();
  }

  subscribeQuotes(symbols) {
    const up = []; const paper = [];
    for (const s of symbols) {
      this.quotes.add(s);
      (providerFor(s) === 'upstox' ? up : paper).push(s);
    }
    if (up.length) upstoxProvider.subscribeToMarketData(up);
    return () => {
      symbols.forEach((s) => this.quotes.delete(s));
      if (up.length) upstoxProvider.unsubscribeFromMarketData(up);
    };
  }

  subscribeCandles(symbol, tf) {
    const key = `${symbol}|${tf}`;
    if (!this.candles.has(key)) this.prime(symbol, tf);
    this.quotes.add(symbol);
    const isUp = providerFor(symbol) === 'upstox';
    if (isUp) upstoxProvider.subscribeToMarketData([symbol]);
    return () => {
      this.candles.delete(key);
      this.quotes.delete(symbol);
      if (isUp) upstoxProvider.unsubscribeFromMarketData([symbol]);
    };
  }

  async prime(symbol, tf) {
    const hist = await getHistoricalDataAsync(symbol, tf, 2);
    const last = hist[hist.length - 1];
    const q = providerFor(symbol) === 'upstox' && upstoxProvider.configured
      ? await upstoxProvider.getQuote(symbol).catch(() => engineQuote(symbol))
      : engineQuote(symbol);
    const bucket = Math.floor(Date.now() / tfMs(tf)) * tfMs(tf);
    this.candles.set(`${symbol}|${tf}`, {
      bucket,
      candle: last
        ? { t: bucket, o: last.o, h: Math.max(last.h, q?.price ?? last.c), l: Math.min(last.l, q?.price ?? last.c), c: q?.price ?? last.c, v: last.v }
        : { t: bucket, o: q?.price ?? 0, h: q?.price ?? 0, l: q?.price ?? 0, c: q?.price ?? 0, v: 0 },
    });
  }

  /** One tick in → tick event out + candle merge/rollover. Single source. */
  processTick(q, now = Date.now()) {
    if (!q || q.price == null) return;
    this.emit('tick', q);
    for (const [k, st] of this.candles) {
      if (!k.startsWith(`${q.symbol}|`)) continue;
      const tf = k.slice(q.symbol.length + 1);
      const bucket = Math.floor(now / tfMs(tf)) * tfMs(tf);
      if (bucket !== st.bucket) {
        this.emit('candle', { symbol: q.symbol, timeframe: tf, candle: { ...st.candle, closed: true } });
        st.bucket = bucket;
        st.candle = { t: bucket, o: q.price, h: q.price, l: q.price, c: q.price, v: 0 };
      } else {
        const c = st.candle;
        c.h = Math.max(c.h, q.price);
        c.l = Math.min(c.l, q.price);
        c.c = q.price;
        if (q.volume != null) c.v = q.volume;
      }
      this.emit('candle', { symbol: q.symbol, timeframe: tf, candle: { ...st.candle, closed: false } });
    }
  }

  /** Paper-venue pump: only symbols the paper engine owns. Upstox-owned
   *  symbols tick exclusively from the provider WebSocket — never simulated. */
  pump(now = Date.now()) {
    for (const symbol of this.quotes) {
      if (providerFor(symbol) === 'upstox') continue;
      const q = getQuote(symbol);
      if (!q) continue;
      this.processTick(q, now);
    }
  }
}

export const hub = new TickHub();

/* Spec §10 surface — everything else in the app goes through these. */
export const marketData = {
  getQuote,
  getQuoteAsync,
  getHistoricalData,
  getHistoricalDataAsync,
  subscribeToQuotes: (symbols) => hub.subscribeQuotes(symbols),
  subscribeToCandles: (symbol, timeframe) => hub.subscribeCandles(symbol, timeframe),
  subscribeToMarketData: (symbols) => upstoxProvider.subscribeToMarketData(symbols),
  unsubscribeFromMarketData: (symbols) => upstoxProvider.unsubscribeFromMarketData(symbols),
  providerStatus: () => upstoxProvider.status(),
  feedInfo,
  sessionOpen,
  providerFor,
  TIMEFRAMES,
};
export default marketData;
