/**
 * UDF — TradingView's official Universal Data Feed protocol.
 *
 *   TradingView Charting Library → (UDF HTTP) → this router → marketData
 *     → Upstox (live NSE/BSE) or the labelled paper venue.
 *
 * This is the sanctioned way to put your own market data into a TradingView
 * chart: the library calls these endpoints; we never scrape TradingView and
 * never pretend their widgets are a data API. Read-only, no secrets served.
 * If the Charting Library files are not licensed into the client yet, the
 * app's built-in ChartPro renders the exact same backend data.
 */
import { Router } from 'express';
import { apiLimiter, asyncH } from '../middleware.js';
import marketData, { TIMEFRAMES } from '../services/marketData.js';
import { listInstruments } from '../services/instruments.js';

const router = Router();
router.use(apiLimiter);

const RES = ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'];
const resToTf = (r) => ({ 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', '1D': '1D', '1W': '1W', '1M': '1M' }[r] || '5m');

router.get('/config', (_req, res) => {
  res.json({
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    supported_resolutions: RES,
    has_intraday: true,
    intraday_multipliers: ['1', '5', '15', '30', '60'],
    timezone: 'Asia/Kolkata',
    // Honest banner the library shows on the chart itself:
    exchanges_desc: 'Data via trademarket.ai backend (Upstox live or labelled paper venue)',
  });
});

router.get('/time', (_req, res) => res.send(String(Math.floor(Date.now() / 1000))));

router.get('/symbols', asyncH(async (req, res) => {
  const sym = String(req.query.symbol || '').toUpperCase().split(':').pop();
  const inst = listInstruments(null).find((i) => i.symbol === sym);
  if (!inst) return res.status(404).json({ s: 'error', errmsg: `unknown symbol ${sym}` });
  const feed = marketData.feedInfo(sym);
  res.json({
    name: inst.symbol,
    ticker: inst.symbol,
    description: `${inst.name} [${feed.latency === 'live' ? 'live' : feed.latency === 'delayed' ? 'delayed' : 'paper venue'}]`,
    type: inst.market === 'crypto' ? 'crypto' : inst.market === 'forex' ? 'forex' : 'stock',
    exchange: inst.market === 'stocks' || inst.market === 'fno' ? 'NSE' : inst.market === 'crypto' ? 'COIN' : 'FX',
    session: '24x7',
    timezone: 'Asia/Kolkata',
    minmov: 1,
    pricescale: 100,
    supported_resolutions: RES,
    has_intraday: true,
    currency_code: inst.currency || 'INR',
  });
}));

router.get('/search', (req, res) => {
  const q = String(req.query.query || '').toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const d = listInstruments(null)
    .filter((i) => !q || i.symbol.includes(q) || i.name.toUpperCase().includes(q))
    .slice(0, limit)
    .map((i) => ({ symbol: i.symbol, full_name: i.symbol, description: i.name, exchange: 'NSE', type: 'stock', ticker: i.symbol }));
  res.json({ s: 'ok', d });
});

router.get('/history', asyncH(async (req, res) => {
  const sym = String(req.query.symbol || '').toUpperCase().split(':').pop();
  const tf = resToTf(String(req.query.resolution || '5'));
  const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
  const from = Number(req.query.from) || to - 90 * 86_400;
  const spanMs = (to - from) * 1000;
  const tfMs = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1D': 86_400_000, '1W': 604_800_000, '1M': 2_592_000_000 }[tf];
  const need = Math.max(30, Math.min(Math.ceil(spanMs / tfMs) + 2, 500));
  const candles = await marketData.getHistoricalDataAsync(sym, tf, need);
  const inRange = candles.filter((c) => c.t / 1000 <= to && c.t / 1000 >= from - tfMs / 1000);
  if (!inRange.length) return res.json({ s: 'no_data' });
  res.json({
    s: 'ok',
    t: inRange.map((c) => Math.floor(c.t / 1000)),
    o: inRange.map((c) => c.o),
    h: inRange.map((c) => c.h),
    l: inRange.map((c) => c.l),
    c: inRange.map((c) => c.c),
    v: inRange.map((c) => c.v || 0),
  });
}));

export { TIMEFRAMES };
export default router;
