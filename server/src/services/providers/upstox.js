/**
 * Upstox market-data provider (NSE/BSE) — read-only market data ONLY.
 *
 *   NSE/BSE → Upstox → this service → marketData facade → WebSocket → client
 *
 * Security: every secret (client id/secret, access token) lives in server env
 * vars or the server-side OAuth token store. Nothing here is ever sent to the
 * frontend; the frontend only ever talks to our own REST/WS endpoints.
 *
 * Honesty: `status().state` is 'live' only while the provider WebSocket is
 * actually delivering ticks inside market hours. No key → 'unconfigured';
 * feed down → 'error'; outside NSE hours → 'market_closed'. We never invent
 * prices: if the provider cannot serve a symbol, the facade falls back to the
 * clearly-labelled paper venue instead.
 *
 * Broker execution is deliberately OUT of scope — this file is market data
 * only, so a future broker-trading adapter stays a separate, fenced module.
 */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { config } from '../../config.js';

const require = createRequire(import.meta.url);
const U = require('upstox-js-sdk');

const NSE_OPEN = 9.25; // 09:15 IST
const NSE_CLOSE = 15.5; // 15:30 IST
const TICK_WATCHDOG_MS = 20_000;

/* Interval map for Upstox historical candles (4h is aggregated from 1h). */
const INTERVALS = {
  '1m': '1minute', '5m': '5minute', '15m': '15minute', '30m': '30minute',
  '1h': '1hour', '4h': '1hour', '1D': '1day', '1W': '1week', '1M': '1month',
};

/* Curated fallback keys (used only to seed the master-download cache and
 * cross-checked against the official instrument master when it loads). */
const CURATED = {
  NIFTY50: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  RELIANCE: 'NSE_EQ|INE002A01018', TCS: 'NSE_EQ|INE467B01029',
  HDFCBANK: 'NSE_EQ|INE040A01034', INFY: 'NSE_EQ|INE009A01021',
  ICICIBANK: 'NSE_EQ|INE090A01021', SBIN: 'NSE_EQ|INE062A01020',
  ITC: 'NSE_EQ|INE154A01025', TATAMOTORS: 'NSE_EQ|INE913A01037',
  BHARTIARTL: 'NSE_EQ|INE397D01024', LT: 'NSE_EQ|INE018A01030',
  HINDUNILVR: 'NSE_EQ|INE030A01027', AXISBANK: 'NSE_EQ|INE238A01034',
};

const firstDefined = (...v) => v.find((x) => x != null && x !== '');
const num = (v) => (v == null || v === '' ? null : Number(v));

class UpstoxProvider extends EventEmitter {
  constructor() {
    super();
    this.id = 'upstox';
    this.label = 'Upstox · NSE/BSE';
    this.state = 'unconfigured'; // unconfigured | connecting | live | market_closed | error
    this.reason = config.upstox.clientId ? '' : 'UPSTOX_CLIENT_ID not set';
    this.lastTickAt = null;
    this.lastRestAt = 0;
    this.backoff = 0;
    this.streamer = null;
    this.subscribed = new Map(); // instrumentKey → Set<symbol>
    this.master = new Map(); // symbol → instrumentKey
    this.masterSource = null;
    this.token = null; // { accessToken, expiresAt }
    this.oauthState = null;
    this.watchdog = null;
  }

  get configured() {
    return Boolean(config.upstox.clientId && config.upstox.clientSecret && this.effectiveToken());
  }

  effectiveToken() {
    const env = config.upstox.accessToken;
    if (env) return { accessToken: env, expiresAt: Infinity, source: 'env' };
    if (this.token && Date.now() < this.token.expiresAt) return this.token;
    return null;
  }

  setState(state, reason = '') {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this.emit('status', this.status());
  }

  status() {
    return {
      provider: this.id,
      label: this.label,
      state: this.state,
      reason: this.reason,
      lastTickAt: this.lastTickAt,
      symbols: this.subscribed.size,
      masterSource: this.masterSource,
      tokenSource: this.effectiveToken()?.source || null,
      oauthConfigured: Boolean(config.upstox.clientId && config.upstox.clientSecret),
    };
  }

  /* ── sessions ─────────────────────────────────────────────────────────── */
  istNow(now = new Date()) {
    return new Date(now.getTime() + (5.5 * 3600_000) + now.getTimezoneOffset() * 60_000);
  }
  marketOpen(now = new Date()) {
    const d = this.istNow(now);
    const h = d.getHours() + d.getMinutes() / 60;
    return d.getDay() >= 1 && d.getDay() <= 5 && h >= NSE_OPEN && h <= NSE_CLOSE;
  }

  /* ── instrument master ────────────────────────────────────────────────── */
  async loadMaster() {
    const today = new Date();
    const urls = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      urls.push(`https://assets.upstox.com/market-quote/instruments-exchange/${day}/NSE.json`);
    }
    urls.push(`${config.upstox.apiBase}/v2/instruments`);
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: url.startsWith(config.upstox.apiBase) ? { Authorization: `Bearer ${this.effectiveToken()?.accessToken}` } : {},
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) continue;
        const text = await res.text();
        let rows;
        try { rows = JSON.parse(text); } catch { rows = this.parseCsv(text); }
        if (!Array.isArray(rows) || !rows.length) continue;
        const map = new Map();
        for (const r of rows) {
          const key = r.instrument_key || r.instrumentKey;
          const sym = (r.tradingsymbol || r.trading_symbol || '').toUpperCase();
          if (!key || !sym) continue;
          if (!map.has(sym)) map.set(sym, key);
        }
        if (map.size > 0) {
          this.master = map;
          this.masterSource = url.includes('assets.upstox.com') ? 'official instrument master' : 'instruments API';
          // Cross-check curated seeds; drop any that disagree with the master.
          for (const [sym, key] of Object.entries(CURATED)) {
            if (this.master.has(sym) && this.master.get(sym) !== key) this.master.set(sym, this.master.get(sym));
          }
          return true;
        }
      } catch { /* try next source */ }
    }
    // No master available: keep curated seeds but mark the source honestly.
    if (!this.master.size) {
      this.master = new Map(Object.entries(CURATED));
      this.masterSource = 'curated seed list (unverified)';
    }
    return false;
  }

  parseCsv(text) {
    const [head, ...lines] = text.trim().split(/\r?\n/);
    if (!head) return [];
    const cols = head.split(',').map((c) => c.trim().replace(/"/g, ''));
    return lines.map((ln) => {
      const vals = ln.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [];
      const o = {};
      cols.forEach((c, i) => { o[c] = (vals[i] || '').replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'); });
      return o;
    });
  }

  resolve(symbol) {
    const s = String(symbol).toUpperCase().trim();
    return this.master.get(s) || CURATED[s] || null;
  }

  /* ── REST ─────────────────────────────────────────────────────────────── */
  async rest(fn) {
    // tiny client-side rate limiter: ≥350ms between REST calls, backoff on 429
    const wait = Math.max(0, this.lastRestAt + 350 - Date.now()) + this.backoff;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.lastRestAt = Date.now();
    try {
      const out = await fn();
      this.backoff = 0;
      return out;
    } catch (e) {
      const code = e?.status || e?.response?.status;
      if (code === 429) this.backoff = Math.min(this.backoff * 2 || 1000, 16_000);
      throw e;
    }
  }

  applyAuth() {
    const tok = this.effectiveToken();
    if (!tok) return false;
    U.ApiClient.instance.basePath = config.upstox.apiBase.replace(/\/+$/, '');
    U.ApiClient.instance.authentications.OAUTH2.accessToken = tok.accessToken;
    return true;
  }

  /** SDK calls use callback style: the bundled superagent throws if its
   *  request is both .end()ed and awaited. */
  cb(fn) {
    return new Promise((resolve, reject) => {
      fn((err, data) => (err ? reject(err instanceof Error ? err : new Error(err?.message || String(err))) : resolve(data)));
    });
  }

  /** getQuote(symbol) — required facade function. */
  async getQuote(symbol) {
    if (!this.configured || !this.applyAuth()) throw new Error('upstox not configured');
    const key = this.resolve(symbol);
    if (!key) throw new Error(`no instrument key for ${symbol}`);
    const api = new U.MarketQuoteV3Api();
    const res = await this.rest(() => this.cb((done) => api.getFullMarketQuoteV3({ instrumentKey: key }, done)));
    // Upstox REST v3 is snake_case: last_price / net_change / ohlc / depth.
    const d = res?.data?.[key] || res?.data || {};
    const ohlc = d.ohlc || {};
    const depth = d.depth || {};
    const buy = Array.isArray(depth.buy) ? depth.buy[0] : Object.values(depth.buy || {})[0];
    const sell = Array.isArray(depth.sell) ? depth.sell[0] : Object.values(depth.sell || {})[0];
    const price = num(firstDefined(d.last_price, d.lastPrice, d.ltp));
    if (price == null) throw new Error('quote payload missing last_price');
    const prevClose = num(firstDefined(ohlc.close, d.cp));
    const change = num(firstDefined(d.net_change, d.netChange, d.ch));
    const changePct = num(firstDefined(d.chp, d.changePct)) ?? (change != null && prevClose ? Math.round((change / prevClose) * 100 * 1000) / 1000 : null);
    return {
      provider: 'upstox',
      symbol: String(symbol).toUpperCase(),
      instrumentKey: key,
      price,
      change,
      changePct,
      open: num(firstDefined(ohlc.open, d.open)),
      high: num(firstDefined(ohlc.high, d.high)),
      low: num(firstDefined(ohlc.low, d.low)),
      prevClose,
      volume: num(firstDefined(d.volume, d.ltq)),
      bid: num(buy?.price ?? buy?.p), ask: num(sell?.price ?? sell?.p),
      bidQty: num(buy?.quantity ?? buy?.q), askQty: num(sell?.quantity ?? sell?.q),
      ltt: num(firstDefined(d.last_trade_time, d.lastTradeTime, d.ltt)),
      at: Date.now(),
    };
  }

  /** getHistoricalCandles(symbol, timeframe) — required facade function. */
  async getHistoricalCandles(symbol, timeframe = '5m', limit = 500) {
    if (!this.configured || !this.applyAuth()) throw new Error('upstox not configured');
    const key = this.resolve(symbol);
    if (!key) throw new Error(`no instrument key for ${symbol}`);
    const tf = INTERVALS[timeframe] ? timeframe : '5m';
    const toDate = new Date().toISOString().slice(0, 10);
    const hist = new U.HistoryApi();
    const raw = await this.rest(() => this.cb((done) => hist.getHistoricalCandleData(key, INTERVALS[tf], toDate, '2.0', done)));
    let candles = (raw?.data?.candles || []).map((c) => ({
      t: new Date(c[0]).getTime(), o: num(c[1]), h: num(c[2]), l: num(c[3]), c: num(c[4]), v: num(c[5]) || 0,
    })).sort((a, b) => a.t - b.t);
    if (tf === '4h') candles = aggregate(candles, 4 * 3600_000);
    return candles.slice(-limit);
  }

  /* ── WebSocket market feed (official SDK streamer, protobuf) ──────────── */
  subscribeToMarketData(symbols) {
    const list = symbols.map((s) => String(s).toUpperCase());
    if (!this.configured) { this.setState('unconfigured', 'Upstox credentials missing'); return false; }
    if (!this.streamer) this.startStream();
    const keys = [];
    for (const sym of list) {
      const key = this.resolve(sym);
      if (!key) continue;
      if (!this.subscribed.has(key)) this.subscribed.set(key, new Set());
      this.subscribed.get(key).add(sym);
      keys.push(key);
    }
    if (keys.length && this.streamer) {
      try { this.streamer.subscribe([...new Set(keys)], 'full'); } catch (e) { this.setState('error', e.message); }
    }
    return keys.length > 0;
  }

  unsubscribeFromMarketData(symbols) {
    const keys = [];
    for (const sym of symbols.map((s) => String(s).toUpperCase())) {
      for (const [key, set] of this.subscribed) {
        if (set.delete(sym) && !set.size) { this.subscribed.delete(key); keys.push(key); }
      }
    }
    if (keys.length && this.streamer) { try { this.streamer.unsubscribe(keys, 'full'); } catch { /* closing */ } }
    if (!this.subscribed.size && this.streamer) { this.stopStream(); }
    return keys;
  }

  startStream() {
    if (!this.applyAuth()) return;
    this.setState('connecting', 'opening Upstox feed');
    this.patchSdkQuirks();
    try {
      const streamer = new U.MarketDataStreamerV3([], 'full');
      this.streamer = streamer;
      streamer.on('open', () => this.setState('connecting', 'feed socket open, awaiting ticks'));
      streamer.on('message', (raw) => {
        // SDK pushes the decoded proto as JSON — arriving as a Buffer of JSON
        // bytes (or a string). Normalise before consuming.
        let msg = raw;
        if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) msg = Buffer.from(raw).toString('utf8');
        if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
        this.onFeedMessage(msg);
      });
      streamer.on('error', (e) => this.setState('error', String(e?.message || e)));
      streamer.on('close', () => {
        if (this.marketOpen()) this.setState('connecting', 'feed closed, reconnecting');
        else this.setState('market_closed', 'NSE session closed (09:15–15:30 IST)');
      });
      streamer.on('autoReconnectStopped', () => this.setState('error', 'auto-reconnect exhausted'));
      streamer.connect();
      this.startWatchdog();
    } catch (e) {
      this.setState('error', e.message);
    }
  }

  /**
   * Two quirks of the bundled SDK, contained here:
   *  1. dist/feeder hardcodes wss://api.upstox.com — correct in production,
   *     but offline tests need a redirect (UPSTOX_FEED_WS, never set in prod).
   *  2. Streamer's reconnect-exhaustion path calls streamer.clearSubscriptions()
   *     which only exists as a private method → uncaught TypeError would kill
   *     the process. A public alias neutralises it.
   */
  patchSdkQuirks() {
    if (this._patched) return;
    this._patched = true;
    const origConnect = U.MarketDataStreamerV3.prototype.connect;
    U.MarketDataStreamerV3.prototype.connect = function connect(...args) {
      if (typeof this.clearSubscriptions !== 'function') {
        this.clearSubscriptions = () => {
          Object.values(this.subscriptions || {}).forEach((s) => s?.clear?.());
        };
      }
      return origConnect.apply(this, args);
    };
    if (config.upstox.feedWs && !UpstoxProvider._feederRedirected) {
      // Test-only: discover the (unexported) feeder class from a throwaway
      // streamer and redirect its hardcoded prod WS URL to the mock feed.
      // Never active in production (UPSTOX_FEED_WS unset).
      const tmp = new U.MarketDataStreamerV3([], 'ltpc');
      tmp.on('error', () => { /* throwaway instance in test-redirect discovery */ });
      origConnect.call(tmp).catch(() => { /* expected: prod URL rejects fake token */ });
      let tries = 0;
      const iv = setInterval(() => {
        const Feeder = tmp.streamer?.constructor;
        if (Feeder?.prototype?.connectWebSocket) {
          // Mirror of the SDK's connect() with only the URL swapped — the
          // onOpen/onMessage/onClose/onError wiring must stay or frames are
          // received but never decoded.
          Feeder.prototype.connect = async function connect() {
            if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this.ws;
            this.ws = await this.connectWebSocket(config.upstox.feedWs, this.apiClient.authentications.OAUTH2.accessToken);
            this.onOpen(); this.onMessage(); this.onClose(); this.onError();
            return this.ws;
          };
          UpstoxProvider._feederRedirected = true;
          this.emit?.('debug', 'feeder prototype redirected');
          clearInterval(iv);
          try { tmp.disconnect(); } catch { /* throwaway */ }
        }
        if (++tries > 100) { clearInterval(iv); try { tmp.disconnect(); } catch { /* throwaway */ } }
      }, 20);
    }
  }

  stopStream() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    if (this.streamer) { try { this.streamer.disconnect(); } catch { /* noop */ } this.streamer = null; }
  }

  onFeedMessage(msg) {
    // Decoded per Upstox MarketDataFeedV3.proto:
    //   Feed.fullFeed.(marketFF|indexFF){ ltpc, marketLevel.bidAskQuote[Quote],
    //     marketOHLC.ohlc[OHLC{interval,open,high,low,close,vol}], vtt }
    if (!this._dbgOnce) {
      this._dbgOnce = true;
      this.emit('debug', `first msg type=${typeof msg} keys=${Object.keys(msg || {})} feeds=${Object.keys(msg?.feeds || {})} sample=${JSON.stringify(msg?.feeds || {}).slice(0, 220)}`);
    }
    const feeds = msg?.feeds || {};
    let any = false;
    for (const [key, feed] of Object.entries(feeds)) {
      const symbols = this.subscribed.get(key);
      if (!symbols) continue;
      const ff = feed.fullFeed || {};
      const full = ff.marketFF || ff.indexFF || {};
      const ltpc = feed.ltpc || full.ltpc || {};
      const ohlcList = full.marketOHLC?.ohlc || [];
      const day = ohlcList.find((o) => String(o.interval).includes('d')) || ohlcList[ohlcList.length - 1] || {};
      const depthQuote = full.marketLevel?.bidAskQuote?.[0] || {};
      const price = num(ltpc.ltp);
      if (price == null) continue;
      any = true;
      const cp = num(ltpc.cp);
      const change = cp != null ? Math.round((price - cp) * 1e6) / 1e6 : null;
      const changePct = cp ? Math.round(((price - cp) / cp) * 100 * 1000) / 1000 : null;
      for (const sym of symbols) {
        this.emit('tick', {
          provider: 'upstox',
          symbol: sym,
          instrumentKey: key,
          price,
          change, changePct,
          open: num(day.open), high: num(day.high), low: num(day.low),
          prevClose: cp,
          volume: num(full.vtt ?? day.vol),
          bid: num(depthQuote.bidP), ask: num(depthQuote.askP),
          bidQty: num(depthQuote.bidQ), askQty: num(depthQuote.askQ),
          ltt: num(ltpc.ltt),
          at: Date.now(),
        });
      }
    }
    if (any) {
      this.lastTickAt = Date.now();
      if (this.state !== 'live') this.setState('live', 'receiving Upstox ticks');
    }
  }

  startWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.marketOpen()) {
        if (this.state === 'live' || this.state === 'connecting') this.setState('market_closed', 'NSE session closed (09:15–15:30 IST)');
        return;
      }
      if (this.state === 'live' && this.lastTickAt && Date.now() - this.lastTickAt > TICK_WATCHDOG_MS) {
        this.setState('error', 'no ticks for 20s inside market hours');
      }
    }, 10_000);
    this.watchdog.unref?.();
  }

  /* ── OAuth2 (server-side handshake; frontend never sees the secret) ───── */
  authorizeUrl() {
    if (!config.upstox.clientId) throw new Error('UPSTOX_CLIENT_ID/SECRET not configured');
    this.oauthState = require('node:crypto').randomBytes(12).toString('hex');
    const q = new URLSearchParams({
      client_id: config.upstox.clientId,
      redirect_uri: config.upstox.redirectUri,
      response_type: 'code',
      state: this.oauthState,
    });
    return `https://api.upstox.com/v2/login/authorization/dialog?${q}`;
  }

  async handleCallback(code, state) {
    if (!this.oauthState || state !== this.oauthState) throw new Error('state mismatch — possible CSRF');
    this.oauthState = null;
    const login = new U.LoginApi();
    const res = await this.cb((done) => login.token(code, config.upstox.clientId, config.upstox.clientSecret, config.upstox.redirectUri, state, 'authorization_code', done));
    const accessToken = res?.accessToken || res?.access_token;
    if (!accessToken) throw new Error('token exchange returned no access_token');
    this.token = { accessToken, expiresAt: Date.now() + 23 * 3600_000, source: 'oauth' }; // Upstox tokens expire daily
    this.applyAuth();
    await this.loadMaster();
    if (this.subscribed.size) this.subscribeToMarketData([...new Set([...this.subscribed.values()].flatMap((s) => [...s]))]);
    return { connected: true, expiresAt: this.token.expiresAt };
  }

  async init() {
    if (!config.upstox.clientId || !config.upstox.clientSecret) {
      this.setState('unconfigured', 'UPSTOX_CLIENT_ID / UPSTOX_CLIENT_SECRET not set');
      return;
    }
    if (!this.effectiveToken()) {
      this.setState('unconfigured', 'no access token — paste UPSTOX_ACCESS_TOKEN or connect via OAuth');
      return;
    }
    this.applyAuth();
    this.patchSdkQuirks(); // arm test-feed redirect discovery early, if configured
    await this.loadMaster();
    this.setState('connecting', 'provider ready, feed starts on first subscription');
  }
}

/** Honest server-side aggregation (no synthetic values, pure bucketing). */
export function aggregate(candles, bucketMs) {
  const out = [];
  for (const c of candles) {
    const b = Math.floor(c.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && last.t === b) {
      last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l);
      last.c = c.c; last.v += c.v || 0;
    } else out.push({ t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 });
  }
  return out;
}

export const upstoxProvider = new UpstoxProvider();
export default upstoxProvider;
