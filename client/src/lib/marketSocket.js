/**
 * Market WebSocket client — streaming prices and live candles.
 *
 * One socket per tab, reference-counted subscriptions, automatic reconnect
 * with backoff, and an observable connection status so the UI can show
 * LIVE / RECONNECTING honestly instead of pretending.
 */
import { useEffect, useRef, useState } from 'react';
import { Market } from './api';

const WS_PATH = '/ws/market';
const MAX_BACKOFF = 8000;

class MarketSocket {
  constructor() {
    this.ws = null;
    this.status = 'idle'; // idle | connecting | live | reconnecting | closed
    this.quoteSymbols = new Map(); // symbol → Set<cb>
    this.candleKeys = new Map(); // `${symbol}|${tf}` → Set<cb>
    this.statusListeners = new Set();
    this.provider = null; // upstox status object from the server
    this.providerListeners = new Set();
    this.backoff = 500;
    this.retryTimer = null;
    this.manualClose = false;
  }

  get wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${WS_PATH}`;
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.manualClose = false;
    this.setStatus(this.backoff > 500 ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(this.wsUrl); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.setStatus('live');
      this.resendSubs();
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'hello' && msg.upstox) this.setProvider(msg.upstox);
      if (msg.t === 'status' && msg.upstox) this.setProvider(msg.upstox);
      if (msg.t === 'tick') {
        const cbs = this.quoteSymbols.get(msg.q?.symbol);
        if (cbs) cbs.forEach((fn) => fn(msg.q));
      } else if (msg.t === 'candle') {
        const cbs = this.candleKeys.get(`${msg.c?.symbol}|${msg.c?.timeframe}`);
        if (cbs) cbs.forEach((fn) => fn(msg.c));
      }
    };
    ws.onclose = () => {
      if (this.manualClose) { this.setStatus('closed'); return; }
      this.setStatus('reconnecting');
      this.scheduleRetry();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
      this.connect();
    }, this.backoff);
  }

  resendSubs() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const candles = [...this.candleKeys.keys()].map((k) => k.split('|'));
    const symbols = [...new Set([...this.quoteSymbols.keys(), ...candles.map((c) => c[0])])];
    try { this.ws.send(JSON.stringify({ op: 'sub', symbols, candles })); } catch { /* noop */ }
  }

  ensureConnected() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
  }

  subscribeQuote(symbol, cb) {
    if (!this.quoteSymbols.has(symbol)) this.quoteSymbols.set(symbol, new Set());
    this.quoteSymbols.get(symbol).add(cb);
    this.ensureConnected();
    this.resendSubs();
    return () => {
      const set = this.quoteSymbols.get(symbol);
      if (set) { set.delete(cb); if (!set.size) this.quoteSymbols.delete(symbol); }
      this.resendSubs();
    };
  }

  subscribeCandle(symbol, tf, cb) {
    const key = `${symbol}|${tf}`;
    if (!this.candleKeys.has(key)) this.candleKeys.set(key, new Set());
    this.candleKeys.get(key).add(cb);
    this.ensureConnected();
    this.resendSubs();
    return () => {
      const set = this.candleKeys.get(key);
      if (set) { set.delete(cb); if (!set.size) this.candleKeys.delete(key); }
      this.resendSubs();
    };
  }

  setProvider(st) {
    this.provider = st;
    this.providerListeners.forEach((fn) => fn(st));
  }

  onProvider(fn) {
    this.providerListeners.add(fn);
    if (this.provider) fn(this.provider);
    return () => this.providerListeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
}

export const marketSocket = new MarketSocket();

/** React hook: live quote map for a list of symbols + connection status. */
export function useLiveQuotes(symbols) {
  const [quotes, setQuotes] = useState({});
  const [status, setStatus] = useState(marketSocket.status);
  const key = [...symbols].sort().join(',');

  useEffect(() => marketSocket.onStatus(setStatus), []);
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const unsubs = list.map((s) =>
      marketSocket.subscribeQuote(s, (q) => setQuotes((prev) => ({ ...prev, [q.symbol]: q })))
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  // One-shot REST prime: paint real provider prices immediately on mount
  // instead of showing "…" until the first socket tick lands (provider prime
  // can take 10-30s after a cold boot). Socket ticks take over instantly and
  // never get overwritten by stale prime data (seed-only-if-empty).
  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (!list.length) return undefined;
    let alive = true;
    Promise.allSettled(list.map((s) => Market.quote(s).catch(() => null))).then((res) => {
      if (!alive) return;
      setQuotes((prev) => {
        const next = { ...prev };
        res.forEach((r, i) => {
          const sym = list[i];
          const q = r.status === 'fulfilled' ? (r.value?.quote ?? r.value) : null;
          if (q?.price != null && !next[sym]) next[sym] = q;
        });
        return next;
      });
    });
    return () => { alive = false; };
  }, [key]);

  // REST fallback: if the socket can't get through (some proxies don't
  // forward WebSocket upgrades), keep values honest with slow polling of
  // the same provider facade. The moment the socket goes live it takes over.
  useEffect(() => {
    if (status === 'live' || !key) return undefined;
    const list = key.split(',');
    let alive = true;
    const pull = async () => {
      try {
        const [tk, feeds] = await Promise.all([
          Market.tickers('all'),
          Market.feedStatus(list),
        ]);
        if (!alive) return;
        const feedBySym = {};
        for (const f of feeds?.feeds || []) feedBySym[f.symbol] = f;
        const next = {};
        for (const r of tk?.tickers || []) {
          if (list.includes(r.symbol)) next[r.symbol] = { ...r, feed: feedBySym[r.symbol] };
        }
        setQuotes((prev) => ({ ...prev, ...next }));
      } catch { /* transient — retry on next interval */ }
    };
    pull();
    const iv = setInterval(pull, 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [status, key]);

  return { quotes, status };
}

/** React hook: server-reported Upstox provider status (live/closed/error/unconfigured). */
export function useProviderStatus() {
  const [st, setSt] = useState(marketSocket.provider);
  useEffect(() => marketSocket.onProvider(setSt), []);
  return st;
}

/** React hook: connection status only. */
export function useSocketStatus() {
  const [status, setStatus] = useState(marketSocket.status);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const off = marketSocket.onStatus((s) => { if (mounted.current) setStatus(s); });
    return () => { mounted.current = false; off(); };
  }, []);
  return status;
}
