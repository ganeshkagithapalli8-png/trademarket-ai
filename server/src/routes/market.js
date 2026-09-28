import { Router } from 'express';
import { optionalAuth, asyncH, notFound, badRequest, requireAuth, toNumber } from '../middleware.js';
import { listInstruments, getInstrument, MARKETS } from '../services/instruments.js';
import { quote, candles, tickers, history, engineInfo } from '../services/marketEngine.js';
import marketData from '../services/marketData.js';
import { getNews, newsSources } from '../services/news.js';
import { liveStatus } from '../services/liveData.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'trademarket-ai-api', time: new Date().toISOString() });
});

router.get('/markets', (_req, res) => {
  res.json({ markets: Object.values(MARKETS) });
});

router.get('/instruments', optionalAuth, (req, res) => {
  const market = req.query.market === 'all' ? null : req.query.market;
  if (market && !MARKETS[market]) throw notFound(`Unknown market "${market}".`);
  res.json({ instruments: listInstruments(market), count: listInstruments(market).length });
});

router.get('/quote/:symbol', optionalAuth, (req, res) => {
  const inst = getInstrument(req.params.symbol);
  if (!inst) throw notFound(`Unknown instrument "${req.params.symbol}".`);
  const q = quote(inst.symbol);
  res.json({ quote: q, disclaimer: 'Simulated or delayed reference price. Not a tradable quote.' });
});

router.get('/candles/:symbol', optionalAuth, (req, res) => {
  const inst = getInstrument(req.params.symbol);
  if (!inst) throw notFound(`Unknown instrument "${req.params.symbol}".`);
  const interval = ['1m', '5m', '15m', '1h', '1D'].includes(req.query.interval) ? req.query.interval : '15m';
  const limit = Math.min(Math.max(toNumber(req.query.limit, 120), 20), 500);
  res.json({ symbol: inst.symbol, interval, candles: candles(inst.symbol, interval, limit) });
});

router.get('/candles-tf/:symbol', (req, res) => {
  const tf = String(req.query.tf || '5m');
  const limit = Math.max(20, Math.min(Number(req.query.limit) || 240, 500));
  const candles = marketData.getHistoricalData(req.params.symbol, tf, limit);
  res.json({ symbol: req.params.symbol, timeframe: tf, candles, feed: marketData.feedInfo(req.params.symbol) });
});

router.get('/feed/status', (req, res) => {
  const symbols = String(req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const list = symbols.length ? symbols : INSTRUMENTS.slice(0, 12).map((i) => i.symbol);
  res.json({ feeds: list.map((s) => ({ symbol: s, ...marketData.feedInfo(s) })) });
});

router.get('/tickers', optionalAuth, (req, res) => {
  const market = req.query.market === 'all' || !req.query.market ? null : req.query.market;
  if (market && !MARKETS[market]) throw notFound(`Unknown market "${market}".`);
  res.json({ tickers: tickers(market) });
});

router.get('/history/:symbol', optionalAuth, (req, res) => {
  const inst = getInstrument(req.params.symbol);
  if (!inst) throw notFound(`Unknown instrument "${req.params.symbol}".`);
  const points = Math.min(Math.max(toNumber(req.query.points, 90), 10), 365);
  res.json({ symbol: inst.symbol, series: history(inst.symbol, points) });
});

router.get('/news', asyncH(async (req, res) => {
  const market = req.query.market && MARKETS[req.query.market] ? req.query.market : 'all';
  const data = await getNews(market, { force: req.query.refresh === '1' });
  res.json({ market, ...data, sources: newsSources().length });
}));

router.get('/live-status', requireAuth, (_req, res) => {
  res.json({ ...liveStatus(), engine: engineInfo() });
});

export default router;
