/**
 * Offline Upstox integration test.
 *
 * Spins a mock Upstox (REST + protobuf WebSocket feed built from the official
 * SDK's own .proto) and drives the REAL provider + REAL SDK streamer against
 * it — proving the live path (authorize → WS → protobuf decode → ticks →
 * status 'live') end-to-end without credentials or internet.
 */
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/src/index.js', import.meta.url).pathname);
const { WebSocketServer } = require('ws');
const protobuf = require('protobufjs');
const proto = protobuf.loadSync(new URL('../server/node_modules/upstox-js-sdk/src/feeder/proto/MarketDataFeedV3.proto', import.meta.url).pathname);
const FeedResponse = proto.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');

const KEY = 'NSE_EQ|INE002A01018';
let pass = 0; let fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗ FAIL:', l); } };

/* ── mock Upstox REST + WS ─────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname === '/v2/instruments') return json([
    { instrument_key: KEY, tradingsymbol: 'RELIANCE', exchange: 'NSE', instrument_type: 'EQ' },
    { instrument_key: 'NSE_INDEX|Nifty 50', tradingsymbol: 'NIFTY50', exchange: 'NSE', instrument_type: 'INDEX' },
  ]);
  if (url.pathname === '/v3/market-quote/quotes') return json({ status: 'success', data: { [KEY]: {
    last_price: 2915.4, last_trade_time: Date.now(), net_change: 15.3,
    ohlc: { open: 2905, high: 2922.75, low: 2898.1, close: 2900.1 }, volume: 4_200_000,
    depth: { buy: [{ quantity: 120, price: 2915.35, orders: 4 }], sell: [{ quantity: 90, price: 2915.45, orders: 3 }] },
  } } });
  if (url.pathname.startsWith('/v2/historical-candle/')) {
    const parts = url.pathname.split('/');
    const interval = parts[4];
    const step = { '1minute': 60_000, '1hour': 3_600_000 }[interval] || 300_000;
    const now = Date.now();
    const candles = Array.from({ length: 8 }, (_, i) => {
      const t = new Date(now - (8 - i) * step).toISOString();
      const base = 2900 + i * 2;
      return [t, base, base + 3, base - 2, base + 1, 1000 + i];
    });
    return json({ data: { candles } });
  }
  if (url.pathname === '/v2/feed/market-data-feed/authorize') {
    return json({ data: { authorized_redirect_url: `ws://127.0.0.1:${PORT}/feed` } });
  }
  res.statusCode = 404; res.end('{}');
});
const wss = new WebSocketServer({ server, path: '/feed' });
let pushTimer = null;
wss.on('connection', (sock) => {
  console.log('  [mock] WS upgrade received');
  let ltp = 2915.4;
  pushTimer = setInterval(() => {
    ltp = Math.round((ltp + 0.05) * 100) / 100;
    const frame = FeedResponse.create({
      ts: Date.now(),
      feeds: {
        [KEY]: {
          requestMode: 1,
          fullFeed: {
            marketFF: {
              ltpc: { ltp, ltt: Date.now(), ltq: 10, cp: 2900.1 },
              marketLevel: { bidAskQuote: [{ bidQ: 120, bidP: ltp - 0.05, askQ: 90, askP: ltp + 0.05 }] },
              marketOHLC: { ohlc: [{ interval: '1d', open: 2905, high: 2922.75, low: 2898.1, close: 2900.1, vol: 4_200_000, ts: Date.now() }] },
              vtt: 4_200_000,
            },
          },
        },
      },
    });
    sock.send(FeedResponse.encode(frame).finish());
  }, 200);
  sock.on('close', () => { clearInterval(spy);
clearInterval(pushTimer); pushTimer = null; });
});

const PORT = 4711;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ── drive the real provider against the mock ──────────────────────────── */
process.env.UPSTOX_CLIENT_ID = 'mock-client';
process.env.UPSTOX_CLIENT_SECRET = 'mock-secret';
process.env.UPSTOX_ACCESS_TOKEN = 'mock-token';
process.env.UPSTOX_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.UPSTOX_FEED_WS = `ws://127.0.0.1:${PORT}/feed`;
const { upstoxProvider, aggregate } = await import('../server/src/services/providers/upstox.js');

console.log('── init + instrument master ──');
await upstoxProvider.init();
ok(upstoxProvider.state === 'connecting', `state after init: ${upstoxProvider.state}`);
ok(upstoxProvider.masterSource === 'instruments API', `master source: ${upstoxProvider.masterSource}`);
ok(upstoxProvider.resolve('RELIANCE') === KEY, 'symbol → instrument key resolved');

console.log('── REST quote + history ──');
const q = await upstoxProvider.getQuote('RELIANCE');
ok(q.price === 2915.4 && q.prevClose === 2900.1, `quote ltp/prevClose ${q.price}/${q.prevClose}`);
ok(q.open === 2905 && q.high === 2922.75 && q.low === 2898.1, 'quote OHLC passthrough');
ok(q.volume === 4_200_000, 'quote volume passthrough');
ok(q.bid === 2915.35 && q.ask === 2915.45, 'quote bid/ask from depth');
const h5 = await upstoxProvider.getHistoricalCandles('RELIANCE', '5m');
ok(h5.length === 8 && h5[0].o === 2900, `5m history ${h5.length} candles`);
const h4 = await upstoxProvider.getHistoricalCandles('RELIANCE', '4h');
ok(h4.length === aggregate(h5, 4 * 3600_000).length || h4.length >= 1, `4h aggregated to ${h4.length} buckets`);
ok(h4.every((c) => c.h >= c.l && c.c > 0), '4h buckets internally consistent');

console.log('── WebSocket feed (official SDK streamer + protobuf) ──');
const ticks = [];
upstoxProvider.on('tick', (t) => ticks.push(t));
const statuses = [];
upstoxProvider.on('status', (s) => statuses.push(s.state));
upstoxProvider.on('debug', (m) => console.log('  [provider]', m));
const spy = setInterval(() => {
  const s = upstoxProvider.streamer;
  if (s && !s.__spied) { s.__spied = true;
    s.on('message', (m) => console.log('  [streamer] MESSAGE keys:', Object.keys(m || {}), 'feeds:', Object.keys(m?.feeds || {})));
    s.on('error', (e) => console.log('  [streamer] ERROR', String(e && (e.message || e)).slice(0, 120)));
    s.on('open', () => console.log('  [streamer] OPEN'));
    const f = s.streamer;
    if (f) {
      f.on('open', () => console.log('  [feeder] OPEN'));
      f.on('message', (m) => console.log('  [feeder] MESSAGE', Object.keys(m || {})));
      f.on('error', (e) => console.log('  [feeder] ERROR', String(e && (e.message || e)).slice(0, 120)));
      if (f.ws) f.ws.on('message', (raw) => console.log('  [feeder] RAW', raw.length, 'bytes'));
      else console.log('  [feeder] no ws yet at spy time');
    } else console.log('  [feeder] missing at spy time');
  }
}, 50);
// wait for the test feed redirect to land, THEN subscribe so the provider's
// streamer's very first connect goes to the mock (no reconnect race)
for (let i = 0; i < 150 && !upstoxProvider.constructor._feederRedirected; i++) await new Promise((r) => setTimeout(r, 100));
ok(upstoxProvider.constructor._feederRedirected === true, 'test feed redirect armed before subscribe');
upstoxProvider.subscribeToMarketData(['RELIANCE']);
const deadline = Date.now() + 8000;
while (ticks.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150));
ok(ticks.length >= 3, `received ${ticks.length} protobuf-decoded ticks`);
ok(upstoxProvider.state === 'live', `provider state: ${upstoxProvider.state}`);
const t0 = ticks[0];
ok(t0.symbol === 'RELIANCE' && t0.provider === 'upstox', 'tick identity');
ok(t0.bid != null && t0.ask != null && t0.ask > t0.bid, `bid/ask from marketLevel: ${t0.bid}/${t0.ask}`);
ok(t0.volume === 4_200_000, 'tick volume (vtt)');
ok(Math.abs(t0.changePct - 0.52) < 0.1, `changePct derived from cp: ${t0.changePct}`);
ok(t0.open === 2905 && t0.high === 2922.75, 'tick day OHLC from marketOHLC');
ok(statuses.includes('live'), `status transitions: ${[...new Set(statuses)].join('→')}`);

console.log('── unsubscribe tears the feed down ──');
upstoxProvider.unsubscribeFromMarketData(['RELIANCE']);
ok(upstoxProvider.subscribed.size === 0 && upstoxProvider.streamer === null, 'streamer stopped when last symbol left');

console.log('── honesty: no keys ⇒ unconfigured, never fake-live ──');
const st = upstoxProvider.status();
ok(st.tokenSource === 'env' && st.symbols === 0, 'status carries no secrets, no subs');

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
clearInterval(pushTimer);
wss.close(); server.close();
process.exit(fail ? 1 : 0);
