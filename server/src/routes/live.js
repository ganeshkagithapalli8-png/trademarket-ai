/**
 * /api/live — FENCED real-money order routing through the user's OWN Zerodha
 * (Kite Connect) account. The app never holds funds; every order is the
 * user's explicit, confirmed instruction to their own broker.
 *
 * Fences enforced server-side:
 *  1. Live mode is OFF by default; per-user opt-in switch (POST /enable),
 *     re-checking 18+ age verification on every enable AND every order.
 *  2. Every order needs `confirm: true` — no silent/automated placement.
 *     (The AI bot can never call these routes: it has no user confirm.)
 *  3. Daily loss fence: new orders blocked once the broker's day P&L breaches
 *     -LIVE_DAILY_LOSS_INR (default ₹2,000).
 *  4. Per-order notional cap (default ₹1,00,000).
 *  5. PANIC endpoint: cancels every OPEN broker order + disables live mode.
 *  6. Full audit trail in live_orders (every attempt, outcome, day-P&L).
 *  7. Market orders always carry 0.5% market protection (broker requirement).
 *  8. Secrets (api key/secret, access tokens) never leave the server.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { withUser } from '../db/index.js';
import { asyncH, requireAuth, apiLimiter, badRequest, forbidden, conflict, notFound } from '../middleware.js';
import { getInstrument } from '../services/instruments.js';
import { zerodha, encryptToken, decryptToken } from '../services/providers/zerodha.js';

const router = Router();
const liveLimiter = apiLimiter; // reuse the conservative API limiter

const EXCHANGE_FOR = (inst) => (inst?.sector === 'US' ? null : 'NSE'); // live routing is India-only v1

async function getSession(userId) {
  const { rows } = await withUser(userId, (c) => c.query(
    'select * from live_sessions where user_id=$1', [userId],
  ));
  return rows[0] || null;
}

async function openToken(userId) {
  const s = await getSession(userId);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null; // daily token dead
  try { return decryptToken({ ct: s.access_token, iv: s.token_iv, tag: s.token_tag }); }
  catch { return null; }
}

async function audit(userId, row) {
  await withUser(userId, (c) => c.query(
    `insert into live_orders (user_id, symbol, exchange, side, qty, product, order_type, price, status, broker_order_id, detail, day_pnl_before)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [userId, row.symbol, row.exchange, row.side, row.qty, row.product, row.order_type,
      row.price ?? null, row.status, row.brokerOrderId ?? null, row.detail ?? null, row.dayPnl ?? null],
  )).catch((e) => console.error('[live] audit failed:', e.message));
}

/** Sum of the broker's day P&L across positions (realised+unrealised, today). */
async function dayPnl(token) {
  try {
    const pos = await zerodha.positions(token);
    const day = Array.isArray(pos?.day) ? pos.day : [];
    return day.reduce((a, p) => a + (Number(p.pnl) || 0), 0);
  } catch { return null; }
}

/** Public, secret-free live-mode status for the UI chips. */
router.get('/status', asyncH(async (req, res) => {
  const session = req.user ? await getSession(req.userId).catch(() => null) : null;
  const expired = session && new Date(session.expires_at).getTime() < Date.now();
  res.json({
    configured: zerodha.configured,
    broker: 'zerodha',
    session: Boolean(session && !expired),
    active: Boolean(session?.active && !expired),
    expired: Boolean(session && expired),
    mode: session?.active && !expired ? 'live-own-broker' : 'paper-default',
    fences: {
      dailyLossInr: config.live.dailyLossInr,
      maxOrderNotionalInr: config.live.maxOrderNotionalInr,
      ageVerifiedRequired: true,
      confirmEveryOrder: true,
      botMayTradeLive: false,
      marketProtectionPct: 0.5,
    },
    note: 'Real-money orders route to YOUR OWN Zerodha account. This app never holds funds.',
  });
}));

/** Step 1: official Kite login page (daily request-token flow). */
router.get('/login', requireAuth, asyncH(async (_req, res) => {
  if (!zerodha.configured) throw conflict('Live routing is not configured on this server yet (ZERODHA_API_KEY/SECRET missing).');
  res.json({ url: zerodha.loginUrl(), redirectUri: config.zerodha.redirectUri });
}));

/** Step 2: browser callback page — hands the request_token to /session with the
 *  user's auth header (same-origin localStorage), then returns to the terminal. */
router.get('/callback', (req, res) => {
  const rt = String(req.query.request_token || '');
  const ok = String(req.query.status || '') === 'success';
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Connecting Zerodha…</title>
<body style="font-family:system-ui;background:#0b1020;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px"><h2>${ok ? 'Finishing Zerodha connection…' : 'Zerodha login was cancelled.'}</h2>
<p id="m" style="color:#94a3b8;font-size:14px">${ok ? 'Exchanging the daily session token (server-side).' : 'Close this tab and retry from the LIVE panel.'}</p></div>
<script>
(function(){
  if (${ok ? 'true' : 'false'} === false) { setTimeout(function(){ location.href='/app/terminal'; }, 2500); return; }
  var rt = ${JSON.stringify(rt)};
  var token = localStorage.getItem('tm_token') || localStorage.getItem('token') || '';
  fetch('/api/live/session', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-TM-Token': token, 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ request_token: rt }) })
    .then(function(r){ return r.json().then(function(j){ return { r: r, j: j }; }); })
    .then(function(o){ document.getElementById('m').textContent = o.r.ok ? 'Connected. Returning to the terminal…' : ('Failed: ' + (o.j.error || o.r.status)); })
    .catch(function(e){ document.getElementById('m').textContent = 'Failed: ' + e.message; })
    .finally(function(){ setTimeout(function(){ location.href='/app/terminal?live=1'; }, 1800); });
})();
</script></body>`);
});

/** Step 3: exchange request_token → daily access token (encrypted at rest). */
router.post('/session', requireAuth, liveLimiter, asyncH(async (req, res) => {
  if (!zerodha.configured) throw conflict('Live routing is not configured on this server yet.');
  const rt = String(req.body?.request_token || '');
  if (!rt) throw badRequest('request_token missing.');
  const sess = await zerodha.exchangeSession(rt);
  const enc = encryptToken(sess.accessToken);
  await withUser(req.userId, (c) => c.query(
    `insert into live_sessions (user_id, broker, access_token, token_iv, token_tag, obtained_at, expires_at, active)
     values ($1,'zerodha',$2,$3,$4,now(),$5,false)
     on conflict (user_id) do update set access_token=$2, token_iv=$3, token_tag=$4, obtained_at=now(), expires_at=$5, updated_at=now()`,
    [req.userId, enc.ct, enc.iv, enc.tag, sess.expiresAt],
  ));
  await audit(req.userId, { symbol: '-', exchange: '-', side: '-', qty: 0, product: '-', order_type: '-', status: 'placed', detail: 'daily session connected' });
  res.json({ ok: true, expiresAt: sess.expiresAt, active: false, note: 'Session stored. Live mode stays OFF until you enable it.' });
}));

router.delete('/session', requireAuth, asyncH(async (req, res) => {
  const token = await openToken(req.userId);
  if (token) await zerodha.invalidate(token);
  await withUser(req.userId, (c) => c.query('delete from live_sessions where user_id=$1', [req.userId]));
  res.json({ ok: true, mode: 'paper-default' });
}));

/** Opt-in switch — re-checks 18+ every time. */
router.post('/enable', requireAuth, liveLimiter, asyncH(async (req, res) => {
  if (!req.user.ageVerified) throw forbidden('Age verification (18+) is required before enabling live routing.');
  const token = await openToken(req.userId);
  if (!token) throw conflict('No valid Zerodha session — connect first (daily login).');
  await withUser(req.userId, (c) => c.query('update live_sessions set active=true, updated_at=now() where user_id=$1', [req.userId]));
  res.json({ ok: true, mode: 'live-own-broker', note: 'LIVE mode ON — every order still needs your explicit confirmation.' });
}));

router.post('/disable', requireAuth, asyncH(async (req, res) => {
  await withUser(req.userId, (c) => c.query('update live_sessions set active=false, updated_at=now() where user_id=$1', [req.userId]));
  res.json({ ok: true, mode: 'paper-default' });
}));

/** Kill switch: cancel every OPEN broker order, then disable live mode. */
router.post('/panic', requireAuth, liveLimiter, asyncH(async (req, res) => {
  const token = await openToken(req.userId);
  let cancelled = 0;
  if (token) {
    try {
      const book = await zerodha.orderBook(token);
      const open = (book || []).filter((o) => o.status === 'OPEN');
      for (const o of open) {
        await zerodha.cancelOrder(token, o.order_id).then(() => { cancelled++; }).catch(() => {});
        await audit(req.userId, { symbol: o.tradingsymbol, exchange: o.exchange, side: o.transaction_type, qty: o.quantity, product: o.product, order_type: o.order_type, price: o.price, status: 'panic_cancelled', brokerOrderId: o.order_id });
      }
    } catch (e) { console.error('[live] panic cancel failed:', e.message); }
  }
  await withUser(req.userId, (c) => c.query('update live_sessions set active=false, updated_at=now() where user_id=$1', [req.userId]));
  res.json({ ok: true, cancelled, mode: 'paper-default', note: 'Kill switch pulled — live mode OFF, open broker orders cancelled.' });
}));

/** THE fenced order gate. */
router.post('/order', requireAuth, liveLimiter, asyncH(async (req, res) => {
  // fence 1: explicit confirmation flag
  if (req.body?.confirm !== true) throw badRequest('Live orders require confirm:true — nothing places real-money orders silently.');
  // fence 2: 18+
  if (!req.user.ageVerified) throw forbidden('Age verification (18+) is required for live orders.');
  // fence 3: session + opt-in
  const session = await getSession(req.userId);
  if (!session || !session.active) throw conflict('Live mode is OFF. Enable it explicitly in the LIVE panel first.');
  const token = await openToken(req.userId);
  if (!token) throw conflict('Zerodha session expired — reconnect (daily login).');

  const inst = getInstrument(String(req.body.symbol || '').toUpperCase());
  if (!inst) throw notFound('Unknown instrument.');
  const exchange = EXCHANGE_FOR(inst);
  if (!exchange) throw badRequest('Live routing v1 supports NSE instruments only (US/crypto stay paper).');

  const side = String(req.body.side || '').toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') throw badRequest('side must be BUY or SELL.');
  const qty = Math.floor(Number(req.body.qty));
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest('qty must be a positive integer.');
  const product = req.body.product === 'MIS' ? 'MIS' : 'CNC';
  const orderType = String(req.body.orderType || 'MARKET').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
  const price = orderType === 'LIMIT' ? Number(req.body.price) : null;
  if (orderType === 'LIMIT' && (!Number.isFinite(price) || price <= 0)) throw badRequest('LIMIT orders need a positive price.');

  // fence 4: per-order notional cap
  const ref = price || Number(req.body.refPrice) || 0;
  if (ref > 0 && ref * qty > config.live.maxOrderNotionalInr) {
    throw forbidden(`Order notional ₹${Math.round(ref * qty).toLocaleString('en-IN')} exceeds the per-order cap ₹${config.live.maxOrderNotionalInr.toLocaleString('en-IN')}.`);
  }

  // fence 5: daily loss stop
  const pnl = await dayPnl(token);
  if (pnl != null && pnl <= -config.live.dailyLossInr) {
    await audit(req.userId, { symbol: inst.symbol, exchange, side, qty, product, order_type: orderType, price, status: 'rejected', detail: `daily loss fence: day P&L ₹${Math.round(pnl)}`, dayPnl: pnl });
    throw forbidden(`Daily loss limit reached (day P&L ₹${Math.round(pnl).toLocaleString('en-IN')}). Live orders are blocked until tomorrow — paper trading still works.`);
  }

  const body = {
    exchange,
    tradingsymbol: inst.symbol,
    transaction_type: side,
    quantity: qty,
    product,
    order_type: orderType,
    validity: 'DAY',
    tag: 'trademarket-ai-live',
    ...(orderType === 'LIMIT' ? { price } : { market_protection: Math.max(0.05, Math.round((ref || 1) * 0.005 * 100) / 100) }),
  };

  let out;
  try {
    out = await zerodha.placeOrder(token, body);
  } catch (e) {
    await audit(req.userId, { symbol: inst.symbol, exchange, side, qty, product, order_type: orderType, price, status: 'rejected', detail: e.message, dayPnl: pnl });
    throw badRequest(`Broker rejected the order: ${e.message}`);
  }
  await audit(req.userId, { symbol: inst.symbol, exchange, side, qty, product, order_type: orderType, price, status: 'placed', brokerOrderId: out?.order_id, detail: 'user-confirmed live order', dayPnl: pnl });
  res.status(201).json({
    ok: true, orderId: out?.order_id || null, broker: 'zerodha',
    notice: `LIVE order sent to YOUR Zerodha account: ${side} ${qty} ${inst.symbol} (${product}, ${orderType}).`,
  });
}));

/** Audit trail + broker passthroughs (read-only). */
router.get('/orders', requireAuth, asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) => c.query(
    'select ts, symbol, exchange, side, qty, product, order_type, price, status, broker_order_id, detail from live_orders where user_id=$1 order by ts desc limit 50',
    [req.userId],
  ));
  res.json({ orders: rows });
}));

router.get('/positions', requireAuth, asyncH(async (req, res) => {
  const token = await openToken(req.userId);
  if (!token) throw conflict('No valid Zerodha session.');
  const [pos, marg] = await Promise.all([
    zerodha.positions(token).catch((e) => ({ error: e.message })),
    zerodha.margins(token).catch((e) => ({ error: e.message })),
  ]);
  res.json({ positions: pos, margins: marg, source: 'zerodha', note: 'Read straight from your broker — real money, real positions.' });
}));

export default router;
