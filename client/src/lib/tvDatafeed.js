/**
 * TradingView datafeed bridge — the sanctioned integration path.
 *
 *   TradingView Charting Library  →  this adapter (IChartingLibraryDatafeed)
 *     → trademarket.ai backend (/udf UDF endpoints + /ws/market stream)
 *       → Upstox (live NSE/BSE) or the labelled paper venue.
 *
 * No scraping, no unofficial use of TradingView widgets as a data source.
 * If the official Charting Library bundle is not licensed into this client
 * yet, `mountTradingViewChart` returns null and the app keeps rendering
 * ChartPro — which consumes the exact same backend datafeed.
 */
import { marketSocket } from './marketSocket.js';

const TF_TO_RES = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1D': '1D', '1W': '1W', '1M': '1M' };
const RES_TO_TF = Object.fromEntries(Object.entries(TF_TO_RES).map(([a, b]) => [b, a]));

/** UDF-backed JS-API datafeed for the TradingView Charting Library. */
export class BackendDatafeed {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.subs = new Map(); // subscriberId → { symbol, tf, unsub }
  }

  onReady(cb) {
    fetch(`${this.baseUrl}/udf/config`).then((r) => r.json()).then((cfg) => cb({
      supports_search: cfg.supports_search,
      supports_group_request: cfg.supports_group_request,
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
      supported_resolutions: cfg.supported_resolutions,
      has_intraday: true,
      timezone: cfg.timezone || 'Asia/Kolkata',
    })).catch(() => cb({
      supports_search: true, supports_group_request: false, supports_marks: false,
      supports_timescale_marks: false, supports_time: true,
      supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
      has_intraday: true, timezone: 'Asia/Kolkata',
    }));
  }

  searchSymbols(query, _type, _exchange, limit, cb) {
    fetch(`${this.baseUrl}/udf/search?query=${encodeURIComponent(query)}&limit=${limit}`)
      .then((r) => r.json()).then((d) => cb(d.d || [])).catch(() => cb([]));
  }

  resolveSymbol(symbol, cb, onError) {
    fetch(`${this.baseUrl}/udf/symbols?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('404'))))
      .then((s) => cb({
        name: s.name, ticker: s.ticker, description: s.description, type: s.type,
        session: s.session, exchange: s.exchange, timezone: s.timezone,
        minmov: s.minmov || 1, pricescale: s.pricescale || 100,
        supported_resolutions: s.supported_resolutions, has_intraday: true,
        currency_code: s.currency_code,
      }))
      .catch(() => onError?.(`unknown symbol ${symbol}`));
  }

  getBars(symbol, resolution, periodParams, cb, onError) {
    const { from, to, firstDataRequest } = periodParams;
    fetch(`${this.baseUrl}/udf/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((h) => {
        if (h.s !== 'ok' || !h.t?.length) { cb([], { noData: true }); return; }
        cb(h.t.map((t, i) => ({ time: t * 1000, open: h.o[i], high: h.h[i], low: h.l[i], close: h.c[i], volume: h.v[i] })),
          { noData: false, firstDataRequest });
      })
      .catch((e) => onError?.(e.message));
  }

  /** Live bars: our WebSocket pushes the in-progress candle; TV updates in place. */
  subscribeBars(symbol, resolution, onTick, listenerGUID) {
    const tf = RES_TO_TF[resolution] || '5m';
    const unsub = marketSocket.subscribeCandle(symbol, tf, (msg) => {
      const c = msg.candle;
      onTick({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v });
    });
    this.subs.set(listenerGUID, { symbol, tf, unsub });
  }

  unsubscribeBars(listenerGUID) {
    const s = this.subs.get(listenerGUID);
    if (s) { s.unsub(); this.subs.delete(listenerGUID); }
  }

  getServerTime(cb) {
    fetch(`${this.baseUrl}/udf/time`).then((r) => r.text()).then((t) => cb(Number(t))).catch(() => cb(Math.floor(Date.now() / 1000)));
  }
}

/**
 * Mount an official TradingView Charting Library widget if (and only if) the
 * licensed library bundle has been added to the client (window.TradingView).
 * Returns the widget, or null when the library is absent — callers then fall
 * back to the built-in ChartPro on the same datafeed.
 */
export function mountTradingViewChart(container, { symbol = 'RELIANCE', interval = '5m', theme = 'light' } = {}) {
  const TV = window.TradingView;
  if (!TV?.widget) return null;
  // eslint-disable-next-line no-new
  return new TV.widget({
    container,
    autosize: true,
    symbol,
    interval: TF_TO_RES[interval] || '5',
    datafeed: new BackendDatafeed(),
    library_path: TV.libraryPath || '/charting_library/',
    locale: 'en',
    theme,
    timezone: 'Asia/Kolkata',
    overrides: { 'paneProperties.background': theme === 'dark' ? '#0b1020' : '#ffffff' },
  });
}

export default BackendDatafeed;
