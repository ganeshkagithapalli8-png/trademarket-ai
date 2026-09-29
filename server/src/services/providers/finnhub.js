/**
 * Finnhub market-data provider — REAL-TIME QUOTES for US equities & crypto.
 *
 * The user-supplied FINNHUB_API_KEY (free tier) unlocks:
 *   ✅ /v1/quote for US stocks (AAPL, MSFT, …) and crypto (BINANCE:BTCUSDT…)
 *   ❌ candle history, ❌ India, ❌ forex  (403 on the free tier — verified)
 *
 * So this provider supplies real-time quote ticks; real intraday candles are
 * BUILT from those ticks server-side and persisted (db.live_candles), which is
 * what the charts render. Nothing here is simulated: when the feed is down the
 * last real price freezes and the chips say so.
 *
 * Free-tier budget ≈ 60 req/min — the poller stays far below it and backs off
 * on 429 (honouring Retry-After). A 401/403 disables the provider instead of
 * hammering a bad key.
 */
import { EventEmitter } from 'node:events';
import { config } from '../../config.js';

const log = (...a) => console.log('[finnhub]', ...a);

class FinnhubProvider extends EventEmitter {
  constructor() {
    super();
    this.id = 'finnhub';
    this.label = 'Finnhub · US equities & crypto';
    this.state = config.finnhub.apiKey ? 'live' : 'unconfigured';
    this.reason = config.finnhub.apiKey ? 'real-time quote feed armed' : 'FINNHUB_API_KEY not set';
    this.lastTickAt = null;
    this.pollTimer = null;
    this.pollMs = config.finnhub.pollMs;
    this.failStreak = 0;
    this.subscribed = new Set();
    this.reprobeTimer = null;
    this.reprobeDelayMs = 0;
  }

  get configured() { return Boolean(config.finnhub.apiKey); }

  /** US-equity symbols this key can serve (free tier). Crypto uses BINANCE: pairs. */
  resolve(symbol) {
    if (!this.configured) return null;
    return symbol; // US tickers map 1:1; marketData only routes sector 'US' here
  }

  status() {
    return {
      provider: this.id, label: this.label, state: this.state, reason: this.reason,
      lastTickAt: this.lastTickAt, symbols: this.subscribed.size,
    };
  }

  /** NYSE session (09:30–16:00 America/New_York, Mon–Fri) — for honest chips. */
  marketOpen(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const wd = get('weekday');
    if (wd === 'Sat' || wd === 'Sun') return false;
    const mins = Number(get('hour')) * 60 + Number(get('minute'));
    return mins >= 570 && mins < 960; // 09:30 → 16:00 ET
  }

  setState(state, reason = '') {
    this.state = state; this.reason = reason;
    this.emit('status', this.status());
  }

  async fetchQuote(symbol) {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${config.finnhub.apiKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (r.status === 429) {
      throw Object.assign(new Error('finnhub rate-limited'), { code: 429, retryAfter: Number(r.headers.get('retry-after')) || 0 });
    }
    if (r.status === 401 || r.status === 403) {
      throw Object.assign(new Error(`finnhub rejected the key (${r.status})`), { code: r.status, fatal: true });
    }
    if (!r.ok) throw new Error(`finnhub ${r.status}`);
    const j = await r.json();
    if (!j || j.c == null) throw new Error('finnhub: no quote in response');
    return j;
  }

  toTick(symbol, j) {
    return {
      provider: 'finnhub', transport: 'finnhub-poll',
      symbol, instrumentKey: symbol,
      price: Number(j.c),
      prevClose: Number(j.pc) || null,
      change: Number(j.d) || null,
      changePct: Number(j.dp) || null,
      open: Number(j.o) || null,
      high: Number(j.h) || null,
      low: Number(j.l) || null,
      volume: null, // the quote endpoint carries no volume — never invent one
      bid: null, ask: null, bidQty: null, askQty: null,
      ltt: (Number(j.t) || 0) * 1000,
      at: Date.now(),
    };
  }

  async getQuote(symbol) {
    const j = await this.fetchQuote(symbol);
    const t = this.toTick(symbol, j);
    return { ...t, source: 'live' };
  }

  /* ── polling ─────────────────────────────────────────────────────────── */
  subscribe(symbols) {
    for (const s of symbols) this.subscribed.add(s);
    this.startPoll();
  }

  unsubscribe(symbols) {
    symbols.forEach((s) => this.subscribed.delete(s));
    if (!this.subscribed.size) this.stopPoll();
  }

  startPoll() {
    if (!this.configured || this.pollTimer) return;
    let inFlight = false;
    const run = async () => {
      const symbols = [...this.subscribed].slice(0, 8); // keep ≤ 48 req/min at 10s cadence
      if (!symbols.length) return;
      let ok = 0;
      for (const sym of symbols) {
        try {
          const j = await this.fetchQuote(sym);
          ok++;
          this.lastTickAt = Date.now();
          this.emit('tick', this.toTick(sym, j));
        } catch (e) {
          if (e.fatal) {
            this.stopPoll();
            this.setState('error', e.message);
            log('disabled:', e.message);
            return;
          }
          if (e.code === 429) {
            const retryMs = Number(e.retryAfter) > 0 ? e.retryAfter * 1000 : 0;
            this.pollMs = Math.min(Math.max(this.pollMs * 2, retryMs), 300_000);
            this.restartPoll();
            return;
          }
        }
      }
      this.failStreak = ok ? 0 : this.failStreak + 1;
      if (ok && this.pollMs !== config.finnhub.pollMs) { this.pollMs = config.finnhub.pollMs; this.restartPoll(); }
      if (this.failStreak >= 3) this.setState('error', 'finnhub unreachable');
      else if (ok) this.setState(this.marketOpen() ? 'live' : 'market_closed',
        this.marketOpen() ? 'real-time US quotes streaming' : 'US session closed — showing last traded prices');
    };
    this.pollTimer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      run().catch((e) => log('poll failed:', e.message)).finally(() => { inFlight = false; });
    }, this.pollMs);
    this.pollTimer.unref?.();
    run().catch(() => {});
  }

  restartPoll() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; this.startPoll(); }
  }

  stopPoll() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async init() {
    if (!this.configured) { this.setState('unconfigured', 'FINNHUB_API_KEY not set'); return; }
    try {
      await this.fetchQuote('AAPL');
      this.setState(this.marketOpen() ? 'live' : 'market_closed',
        this.marketOpen() ? 'real-time US quotes streaming' : 'US session closed — showing last traded prices');
      log('connected — real-time US equity & crypto quotes enabled');
    } catch (e) {
      this.setState(e.fatal ? 'error' : 'unconfigured', e.message);
      log('init failed:', e.message);
    }
  }
}

export const finnhubProvider = new FinnhubProvider();
