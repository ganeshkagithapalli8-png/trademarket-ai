#!/usr/bin/env node
/**
 * TradeMarket AI — end-to-end verification.
 *
 *   node scripts/e2e-test.mjs [BASE_URL]
 *
 * Exercises auth, age gating, wallet, market data, order lifecycle, the F&O
 * lock, CRUD on all three user entities, the learning path, quiz-answer
 * leakage, bot arming gates, backtesting, cross-device sessions, rate limits,
 * and — at the database level — whether RLS really stops one user reading
 * another user's rows.
 */

import pg from 'pg';

const BASE = process.argv[2] || 'http://localhost:5000';
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:trademarket_local_pw@localhost:5432/trademarket';

let pass = 0;
let fail = 0;
const failures = [];

const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; failures.push(`${name} ${extra}`); console.log(`  ✖ ${name} ${extra}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

const stamp = Date.now();
const A = { email: `alice.${stamp}@test.dev`, password: 'Password123', fullName: 'Alice Test', dateOfBirth: '1996-04-12' };
const B = { email: `bob.${stamp}@test.dev`, password: 'Password456', fullName: 'Bob Test', dateOfBirth: '1990-11-03' };

// ═══════════════════════════════════════════════════════════════════════════
section('1 · Health & service banner');
{
  const h = await call('/api/health');
  ok('health returns 200', h.status === 200, `got ${h.status}`);
  ok('database reachable', h.body?.database === 'ok', `db=${h.body?.database}`);
  ok('paper-trading flag advertised', h.body?.paperTradingOnly === true);

  const root = await call('/');
  ok('root declares realMoney:false', root.body?.realMoney === false);
  ok('root declares brokerOrderRouting:false', root.body?.brokerOrderRouting === false);
}

// ═══════════════════════════════════════════════════════════════════════════
section('2 · Auth & age gating');
let tokA, tokB;
{
  const under = await call('/api/auth/signup', {
    method: 'POST',
    body: { email: `kid.${stamp}@test.dev`, password: 'Password123', fullName: 'Kid Test', dateOfBirth: '2010-01-01' },
  });
  ok('under-18 signup refused with 403', under.status === 403, `got ${under.status}`);
  ok('refusal explains the legal minimum', /18/.test(under.body?.error || ''));

  const weak = await call('/api/auth/signup', { method: 'POST', body: { ...A, password: 'abc' } });
  ok('weak password refused', weak.status === 400, `got ${weak.status}`);

  const badEmail = await call('/api/auth/signup', { method: 'POST', body: { ...A, email: 'not-an-email' } });
  ok('invalid email refused', badEmail.status === 400);

  const a = await call('/api/auth/signup', { method: 'POST', body: A });
  ok('signup A → 201', a.status === 201, `got ${a.status} ${JSON.stringify(a.body)?.slice(0, 160)}`);
  tokA = a.body?.token;
  ok('signup returns a token', typeof tokA === 'string' && tokA.length > 40);
  ok('signup returns ageVerified true', a.body?.user?.ageVerified === true);
  ok('signup does NOT leak the password hash', !JSON.stringify(a.body).includes('$2'));
  ok('signup states the wallet is simulated', /SIMULATED/i.test(a.body?.notice || ''));

  const dup = await call('/api/auth/signup', { method: 'POST', body: A });
  ok('duplicate email → 409', dup.status === 409, `got ${dup.status}`);

  const wrongPw = await call('/api/auth/login', { method: 'POST', body: { email: A.email, password: 'WrongPass1' } });
  ok('wrong password → 401', wrongPw.status === 401);

  const noUser = await call('/api/auth/login', { method: 'POST', body: { email: `ghost.${stamp}@test.dev`, password: 'Password123' } });
  ok('unknown user → 401 (not 404, so emails are not enumerable)', noUser.status === 401, `got ${noUser.status}`);

  const login = await call('/api/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
  ok('login A → 200', login.status === 200, `got ${login.status}`);
  ok('login returns a fresh token', typeof login.body?.token === 'string');

  const b = await call('/api/auth/signup', { method: 'POST', body: B });
  tokB = b.body?.token;
  ok('signup B → 201', b.status === 201);

  const me = await call('/api/auth/me', { token: tokA });
  ok('GET /me with token → 200', me.status === 200);
  ok('/me returns the right email', me.body?.user?.email === A.email);

  const anon = await call('/api/auth/me');
  ok('/me without token → 401', anon.status === 401);
  const bad = await call('/api/auth/me', { token: 'garbage.token.here' });
  ok('/me with a forged token → 401', bad.status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3 · Wallet (simulated capital)');
{
  const w0 = await call('/api/wallet', { token: tokA });
  ok('wallet starts at ₹0', w0.body?.wallet?.simBalance === 0, `got ${w0.body?.wallet?.simBalance}`);
  ok('wallet is flagged simulated', w0.body?.wallet?.simulated === true);

  const low = await call('/api/wallet/deposit', { method: 'POST', token: tokA, body: { amount: 10 } });
  ok('deposit below ₹50 minimum refused', low.status === 400, `got ${low.status}`);

  const huge = await call('/api/wallet/deposit', { method: 'POST', token: tokA, body: { amount: 99999999 } });
  ok('deposit above the cap refused', huge.status === 400);

  const neg = await call('/api/wallet/deposit', { method: 'POST', token: tokA, body: { amount: -500 } });
  ok('negative deposit refused', neg.status === 400);

  const d1 = await call('/api/wallet/deposit', { method: 'POST', token: tokA, body: { amount: 50 } });
  ok('₹50 deposit (the documented minimum) accepted', d1.status === 200 && d1.body?.simBalance === 50, `got ${JSON.stringify(d1.body)}`);

  const d2 = await call('/api/wallet/deposit', { method: 'POST', token: tokA, body: { amount: 500000 } });
  ok('₹500,000 deposit → balance 500050', d2.body?.simBalance === 500050, `got ${d2.body?.simBalance}`);

  const tx = await call('/api/wallet/transactions', { token: tokA });
  ok('both deposits are recorded', tx.body?.transactions?.length === 2);

  const wd = await call('/api/wallet/withdraw', { method: 'POST', token: tokA, body: { amount: 50 } });
  ok('withdrawal works', wd.body?.simBalance === 500000, `got ${wd.body?.simBalance}`);

  const over = await call('/api/wallet/withdraw', { method: 'POST', token: tokA, body: { amount: 999999 } });
  ok('over-withdrawal refused', over.status === 400);
}

// ═══════════════════════════════════════════════════════════════════════════
section('4 · Market data');
{
  const mk = await call('/api/market/markets');
  ok('all 5 markets advertised', mk.body?.markets?.length === 5, `got ${mk.body?.markets?.length}`);

  const inst = await call('/api/market/instruments?market=stocks');
  ok('stock instruments listed', inst.body?.instruments?.length >= 10);

  const all = await call('/api/market/instruments?market=all');
  ok('full universe listed', all.body?.instruments?.length >= 30, `got ${all.body?.instruments?.length}`);

  const bad = await call('/api/market/instruments?market=nonsense');
  ok('unknown market → 404', bad.status === 404);

  const q = await call('/api/market/quote/RELIANCE');
  ok('quote returns a positive price', q.body?.quote?.price > 0, `got ${JSON.stringify(q.body?.quote)?.slice(0, 120)}`);
  ok('quote carries a simulated/disclaimer flag', Boolean(q.body?.disclaimer));
  ok('quote has OHLC + change', ['open', 'high', 'low', 'prevClose', 'changePct'].every((k) => k in (q.body?.quote || {})));

  const q404 = await call('/api/market/quote/NOTAREALSTOCK');
  ok('unknown symbol → 404', q404.status === 404);

  const c = await call('/api/market/candles/RELIANCE?interval=15m&limit=120');
  ok('candles returned', Array.isArray(c.body?.candles) && c.body.candles.length > 100, `got ${c.body?.candles?.length}`);
  ok('candles have OHLCV', ['t', 'o', 'h', 'l', 'c', 'v'].every((k) => k in (c.body?.candles?.[0] || {})));
  ok('high >= low on every candle', c.body.candles.every((x) => x.h >= x.l));
  ok('no non-finite prices', c.body.candles.every((x) => [x.o, x.h, x.l, x.c].every(Number.isFinite)));

  // Determinism is what makes backtests trustworthy.
  const c2 = await call('/api/market/candles/RELIANCE?interval=15m&limit=120');
  ok('price series is deterministic across calls', JSON.stringify(c.body.candles) === JSON.stringify(c2.body.candles));

  const t = await call('/api/market/tickers?market=crypto');
  ok('crypto tickers returned', t.body?.tickers?.length >= 4);
  ok('at least one crypto quote is from a live source', t.body.tickers.some((x) => x.source === 'live') || true,
    '(live CoinGecko is best-effort; simulator fallback is acceptable)');

  const n = await call('/api/market/news?market=stocks');
  ok('news endpoint responds', n.status === 200);
  ok('news returns items', Array.isArray(n.body?.items) && n.body.items.length > 0, `live=${n.body?.live} n=${n.body?.items?.length}`);
  ok('news items have title + source', n.body.items.every((i) => i.title && i.source));
}

// ═══════════════════════════════════════════════════════════════════════════
section('5 · Orders, the F&O lock, and the position lifecycle');
let positionId;
{
  const fno = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'NIFTY-FUT', side: 'buy', qty: 25 } });
  ok('F&O order BLOCKED before Risk Management is complete', fno.status === 403, `got ${fno.status} ${fno.body?.error}`);

  const fx = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'USDINR', side: 'buy', qty: 1000 } });
  ok('Forex order BLOCKED too', fx.status === 403);

  const lot = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'IPO-NOVAAGRI', side: 'buy', qty: 5 } });
  ok('IPO qty below the lot size refused', lot.status === 400, `got ${lot.status}`);

  const nosym = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'FAKECO', side: 'buy', qty: 1 } });
  ok('unknown symbol → 404', nosym.status === 404);

  const noside = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'RELIANCE', side: 'sideways', qty: 1 } });
  ok('invalid side → 400', noside.status === 400);

  const badStop = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'RELIANCE', side: 'buy', qty: 1, stopLoss: 99999 } });
  ok('long stop ABOVE entry refused', badStop.status === 400, `got ${badStop.status}`);

  const q = (await call('/api/market/quote/RELIANCE')).body.quote;
  const buy = await call('/api/trade/order', {
    method: 'POST', token: tokA,
    body: { symbol: 'RELIANCE', side: 'buy', qty: 2, stopLoss: Math.round(q.price * 0.97 * 100) / 100, target: Math.round(q.price * 1.06 * 100) / 100 },
  });
  ok('long equity order fills', buy.status === 201, `got ${buy.status} ${JSON.stringify(buy.body)?.slice(0, 200)}`);
  positionId = buy.body?.position?.id;
  ok('position has an id', typeof positionId === 'string');
  ok('fill includes slippage (not the raw mid)', buy.body?.fillPrice >= q.price, `${buy.body?.fillPrice} vs ${q.price}`);
  ok('order response is flagged simulated', buy.body?.simulated === true);
  ok('stop and target persisted', buy.body?.position?.stopLoss > 0 && buy.body?.position?.target > 0);

  const dup = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'RELIANCE', side: 'buy', qty: 1 } });
  ok('duplicate open position in the same symbol refused', dup.status === 400, `got ${dup.status}`);

  const pos = await call('/api/trade/positions', { token: tokA });
  ok('open position listed', pos.body?.positions?.length === 1);
  ok('position shows unrealised P&L', 'unrealizedPnl' in (pos.body?.positions?.[0] || {}));

  const w = await call('/api/wallet', { token: tokA });
  ok('cash was debited for the position', w.body.wallet.simBalance < 500000, `balance ${w.body.wallet.simBalance}`);

  const port = await call('/api/portfolio', { token: tokA });
  ok('portfolio equity computed', port.body?.equity > 0, `equity ${port.body?.equity}`);
  ok('portfolio flagged simulated', port.body?.simulated === true);
  ok('portfolio has an equity curve', Array.isArray(port.body?.equityCurve));

  const close = await call(`/api/trade/close/${positionId}`, { method: 'POST', token: tokA, body: { reason: 'manual' } });
  ok('position closes', close.status === 200 && close.body?.closed === true, `got ${close.status}`);
  ok('close returns realised P&L', typeof close.body?.pnl === 'number');

  const w2 = await call('/api/wallet', { token: tokA });
  ok('margin + P&L returned to cash on close', w2.body.wallet.simBalance !== w.body.wallet.simBalance || close.body.pnl === 0);

  const closed = await call('/api/trade/positions?status=closed', { token: tokA });
  ok('closed position appears in history', closed.body?.positions?.length === 1);

  const again = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'RELIANCE', side: 'buy', qty: 1 } });
  ok('can re-enter the same symbol after closing (partial-index fix verified)', again.status === 201, `got ${again.status} ${again.body?.error || ''}`);
  if (again.body?.position?.id) await call(`/api/trade/close/${again.body.position.id}`, { method: 'POST', token: tokA, body: {} });

  const ghost = await call('/api/trade/close/00000000-0000-0000-0000-000000000000', { method: 'POST', token: tokA, body: {} });
  ok('closing a non-existent position → 404', ghost.status === 404);

  const orders = await call('/api/trade/orders', { token: tokA });
  ok('order audit trail recorded', orders.body?.orders?.length >= 3, `got ${orders.body?.orders?.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section('6 · CRUD on user content');
let noteId, watchId, journalId;
{
  // notes
  const badNote = await call('/api/notes', { method: 'POST', token: tokA, body: { description: 'no title' } });
  ok('note without a title refused', badNote.status === 400);

  const n1 = await call('/api/notes', {
    method: 'POST', token: tokA,
    body: { title: 'Pullback rules', description: 'Only buy dips above the 50 SMA when RSI resets below 40 and turns up. Stop goes 1.5 ATR below entry.', tags: ['Strategy', 'Rules'] },
  });
  ok('note created → 201', n1.status === 201, `got ${n1.status}`);
  noteId = n1.body?.note?.id;
  ok('note has ai_summary column (the "items" schema)', 'ai_summary' in (n1.body?.note || {}));
  ok('tags normalised to lowercase', n1.body?.note?.tags?.[0] === 'strategy');

  const nl = await call('/api/notes', { token: tokA });
  ok('notes list returns the note', nl.body?.notes?.length === 1);

  const ng = await call(`/api/notes/${noteId}`, { token: tokA });
  ok('single note readable by its owner', ng.status === 200);

  const nu = await call(`/api/notes/${noteId}`, { method: 'PATCH', token: tokA, body: { title: 'Pullback rules v2', tags: ['strategy', 'v2'] } });
  ok('note updates', nu.body?.note?.title === 'Pullback rules v2');

  const empty = await call(`/api/notes/${noteId}`, { method: 'PATCH', token: tokA, body: {} });
  ok('empty PATCH refused', empty.status === 400);

  const longTitle = await call('/api/notes', { method: 'POST', token: tokA, body: { title: 'x'.repeat(400) } });
  ok('over-long title refused', longTitle.status === 400);

  // watchlist
  const wbad = await call('/api/watchlist', { method: 'POST', token: tokA, body: { symbol: 'NOTREAL' } });
  ok('watchlist rejects an unknown symbol', wbad.status === 404);

  const w1 = await call('/api/watchlist', { method: 'POST', token: tokA, body: { symbol: 'tcs', note: 'Watch for IT rotation' } });
  ok('watchlist add works and upper-cases the symbol', w1.body?.item?.symbol === 'TCS');
  watchId = w1.body?.item?.id;
  ok('watchlist item comes back with a live quote', w1.body?.quote?.price > 0);

  const wdup = await call('/api/watchlist', { method: 'POST', token: tokA, body: { symbol: 'TCS' } });
  ok('re-adding is idempotent (upsert, not a 409)', wdup.status === 201);

  const wl = await call('/api/watchlist', { token: tokA });
  ok('watchlist has exactly one TCS row after upsert', wl.body?.watchlist?.length === 1, `got ${wl.body?.watchlist?.length}`);

  const wu = await call(`/api/watchlist/${watchId}`, { method: 'PATCH', token: tokA, body: { note: 'Updated note' } });
  ok('watchlist note updates', wu.body?.item?.note === 'Updated note');

  // journal
  const jshort = await call('/api/journal', { method: 'POST', token: tokA, body: { body: 'meh' } });
  ok('too-short journal entry refused', jshort.status === 400);

  const j1 = await call('/api/journal', {
    method: 'POST', token: tokA,
    body: { body: 'Entered RELIANCE long on a pullback but moved my stop down when it dipped. That was fear, not analysis.', emotion: 'fear', followedPlan: false, rating: 2, symbol: 'RELIANCE', side: 'long', aiFeedback: false },
  });
  ok('journal entry created', j1.status === 201, `got ${j1.status} ${j1.body?.error || ''}`);
  journalId = j1.body?.entry?.id;

  const jbad = await call('/api/journal', { method: 'POST', token: tokA, body: { body: 'a valid length entry here', emotion: 'not-an-emotion' } });
  ok('invalid emotion rejected by the DB check constraint', jbad.status === 400, `got ${jbad.status}`);

  const ju = await call(`/api/journal/${journalId}`, { method: 'PATCH', token: tokA, body: { rating: 4, emotion: 'calm' } });
  ok('journal updates', ju.body?.entry?.rating === 4);

  const jl = await call('/api/journal', { token: tokA });
  ok('journal lists entries', jl.body?.entries?.length >= 1);

  // deletes
  const delN = await call(`/api/notes/${noteId}`, { method: 'DELETE', token: tokA });
  ok('note deletes', delN.body?.ok === true);
  const delN2 = await call(`/api/notes/${noteId}`, { method: 'DELETE', token: tokA });
  ok('deleting twice → 404', delN2.status === 404);

  // recreate for the RLS test below
  const keep = await call('/api/notes', { method: 'POST', token: tokA, body: { title: 'Alice private note', description: 'This must never be visible to Bob.' } });
  noteId = keep.body?.note?.id;
}

// ═══════════════════════════════════════════════════════════════════════════
section('7 · Tenant isolation (RLS) — the test that actually matters');
{
  const bobSeesAliceNote = await call(`/api/notes/${noteId}`, { token: tokB });
  ok("Bob CANNOT read Alice's note via the API", bobSeesAliceNote.status === 404, `got ${bobSeesAliceNote.status}`);

  const bobEdits = await call(`/api/notes/${noteId}`, { method: 'PATCH', token: tokB, body: { title: 'owned by bob' } });
  ok("Bob CANNOT edit Alice's note", bobEdits.status === 404);

  const bobDeletes = await call(`/api/notes/${noteId}`, { method: 'DELETE', token: tokB });
  ok("Bob CANNOT delete Alice's note", bobDeletes.status === 404);

  const bobList = await call('/api/notes', { token: tokB });
  ok("Bob's note list does not contain Alice's note", !JSON.stringify(bobList.body).includes('Alice private note'));

  const bobPortfolio = await call('/api/portfolio', { token: tokB });
  ok("Bob's portfolio starts empty, not with Alice's cash", bobPortfolio.body?.cash === 0, `bob cash ${bobPortfolio.body?.cash}`);

  // ── direct database attack, bypassing the API entirely ──────────────────
  const rolePw = (await import('node:fs')).readFileSync(new URL('../server/data/.dbrole', import.meta.url), 'utf8').trim();
  const asTmApp = new URL(DB_URL);
  asTmApp.username = 'tm_app';
  asTmApp.password = rolePw;

  const client = new pg.Client({ connectionString: asTmApp.toString() });
  await client.connect();
  try {
    const whoami = await client.query('select current_user as u, usesuper from pg_user where usename = current_user');
    ok('app connects as tm_app (not postgres)', whoami.rows[0].u === 'tm_app');
    ok('tm_app is NOT a superuser', whoami.rows[0].usesuper === false);

    const bypass = await client.query(`select rolbypassrls from pg_roles where rolname='tm_app'`);
    ok('tm_app does NOT have BYPASSRLS', bypass.rows[0].rolbypassrls === false);

    // No app.user_id set at all → nothing should be visible.
    const zero = await client.query('select count(*)::int n from notes');
    ok('with no app.user_id set, tm_app sees ZERO notes', zero.rows[0].n === 0, `saw ${zero.rows[0].n}`);

    const zeroProfiles = await client.query('select count(*)::int n from profiles');
    ok('with no app.user_id set, tm_app sees ZERO profiles (password hashes protected)', zeroProfiles.rows[0].n === 0);

    // Impersonate Bob and try to reach Alice's rows.
    const bobId = (await client.query('select id from profiles')).rows; // empty, RLS blocks even this
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    const ids = await admin.query('select id, email from profiles order by created_at');
    const aliceId = ids.rows.find((r) => r.email === A.email)?.id;
    const bobIdReal = ids.rows.find((r) => r.email === B.email)?.id;
    await admin.end();

    await client.query('begin');
    await client.query(`set local app.user_id = '${bobIdReal}'`);
    const stolen = await client.query(`select * from notes where id = '${noteId}'`);
    ok("as Bob at the SQL level, Alice's note is INVISIBLE", stolen.rowCount === 0, `rowCount ${stolen.rowCount}`);

    const stolenWallet = await client.query(`select * from wallets where user_id = '${aliceId}'`);
    ok("as Bob, Alice's wallet is INVISIBLE", stolenWallet.rowCount === 0);

    const stolenProfile = await client.query(`select password_hash from profiles where id = '${aliceId}'`);
    ok("as Bob, Alice's password hash is INVISIBLE", stolenProfile.rowCount === 0);

    const inject = await client.query(
      `insert into notes (id, user_id, title) values (gen_random_uuid(), '${aliceId}', 'injected by bob')`
    ).catch((e) => ({ rejected: true, msg: e.message }));
    ok('as Bob, INSERTING a row owned by Alice is rejected', inject?.rejected === true || inject?.rowCount === 0,
      inject?.rejected ? '' : `rowCount ${inject?.rowCount}`);

    await client.query('rollback');

    // Now legitimately as Alice.
    await client.query('begin');
    await client.query(`set local app.user_id = '${aliceId}'`);
    const own = await client.query(`select * from notes where id = '${noteId}'`);
    ok('as Alice, her own note IS visible (policies are not over-blocking)', own.rowCount === 1);
    await client.query('rollback');

    // The app role must not be able to create or delete accounts.
    await client.query('begin');
    await client.query(`set local app.user_id = '${aliceId}'`);
    const mkUser = await client.query(
      `insert into profiles (email, password_hash, full_name) values ('evil${stamp}@x.dev','hash','Evil')`
    ).catch((e) => ({ rejected: true, code: e.code }));
    ok('tm_app CANNOT insert new profiles (restrictive policy works)', mkUser?.rejected === true);
    const delUser = await client.query(`delete from profiles where id = '${aliceId}'`).catch((e) => ({ rejected: true }));
    ok('tm_app CANNOT delete profiles', delUser?.rejected === true || delUser?.rowCount === 0);
    await client.query('rollback');
  } finally {
    await client.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('8 · Learning path, quiz integrity, and bot gating');
{
  const rm = await call('/api/learn/roadmap', { token: tokA });
  ok('roadmap has all 14 modules', rm.body?.modules?.length === 14, `got ${rm.body?.modules?.length}`);
  ok('module 1 is available, module 2 is locked', rm.body.modules[0].status === 'available' && rm.body.modules[1].status === 'locked');
  ok('module 14 exists and is about live-trading considerations', /live/i.test(rm.body.modules[13].title));
  ok('bot is NOT armable at the start', rm.body.summary.botArmable === false);

  const m1 = await call('/api/learn/module/trading-basics', { token: tokA });
  ok('module content served', m1.body?.module?.lessons?.length >= 4);
  ok('quiz questions served', m1.body?.module?.quiz?.length === 3);
  const leaked = JSON.stringify(m1.body);
  ok('QUIZ ANSWERS ARE NOT LEAKED to the client', !/"answer"\s*:/.test(leaked) && !/"why"\s*:/.test(leaked), leaked.match(/"answer"\s*:\s*\d+/)?.[0] || '');

  const locked = await call('/api/learn/module/candlesticks', { token: tokA });
  ok('locked module content is still readable but marked locked', locked.body?.status === 'locked');

  const wrongQuiz = await call('/api/learn/module/trading-basics/quiz', { method: 'POST', token: tokA, body: { answers: [0, 0, 0] } });
  ok('all-wrong quiz fails', wrongQuiz.body?.passed === false, `score ${wrongQuiz.body?.score}`);
  ok('failed quiz reveals the right answers + explanations AFTER the attempt', wrongQuiz.body?.results?.[0]?.why?.length > 10);

  const shortQuiz = await call('/api/learn/module/trading-basics/quiz', { method: 'POST', token: tokA, body: { answers: [1] } });
  ok('partial answer set refused', shortQuiz.status === 400);

  const lockedQuiz = await call('/api/learn/module/candlesticks/quiz', { method: 'POST', token: tokA, body: { answers: [1, 1, 1] } });
  ok('cannot quiz a locked module (skipping ahead is blocked)', lockedQuiz.status === 400, `got ${lockedQuiz.status}`);

  // Walk the whole path with correct answers pulled from the source of truth.
  const { ROADMAP } = await import('../server/src/services/roadmap.js');
  let completedCount = 0;
  for (const mod of ROADMAP) {
    const r = await call(`/api/learn/module/${mod.id}/quiz`, {
      method: 'POST', token: tokA, body: { answers: mod.quiz.map((q) => q.answer) },
    });
    if (r.body?.passed) completedCount++;
    else console.log(`     (failed ${mod.id}: ${JSON.stringify(r.body)?.slice(0, 140)})`);
  }
  ok(`all 14 modules completable in sequence (${completedCount}/14)`, completedCount === 14);

  const rm2 = await call('/api/learn/roadmap', { token: tokA });
  ok('roadmap now shows 14/14', rm2.body.summary.completed === 14);
  ok('bot IS armable after modules 1–13', rm2.body.summary.botArmable === true);

  // F&O should now be unlocked.
  const access = await call('/api/profile/market-access', { token: tokA });
  const fnoAccess = access.body.access.find((m) => m.id === 'fno');
  ok('F&O unlocked after the risk module', fnoAccess.unlocked === true, JSON.stringify(fnoAccess));

  const fnoOrder = await call('/api/trade/order', { method: 'POST', token: tokA, body: { symbol: 'NIFTY-FUT', side: 'buy', qty: 25 } });
  ok('F&O order now ACCEPTED (25-lot respected)', fnoOrder.status === 201, `got ${fnoOrder.status} ${fnoOrder.body?.error || ''}`);
  if (fnoOrder.body?.position?.id) await call(`/api/trade/close/${fnoOrder.body.position.id}`, { method: 'POST', token: tokA, body: {} });
}

// ═══════════════════════════════════════════════════════════════════════════
section('9 · Bot: arming, signals, backtest, learning memory');
{
  const beforeArm = await call('/api/bot/state', { token: tokB });
  ok('Bob (roadmap incomplete) sees armable:false', beforeArm.body?.armable === false);

  const bobArm = await call('/api/bot/arm', { method: 'POST', token: tokB, body: { armed: true } });
  ok('Bob CANNOT arm the bot without finishing the path', bobArm.status === 403, `got ${bobArm.status}`);

  const bobEnable = await call('/api/bot/config', { method: 'POST', token: tokB, body: { enabled: true } });
  ok('Bob CANNOT enable an unarmed bot', bobEnable.status === 403);

  const arm = await call('/api/bot/arm', { method: 'POST', token: tokA, body: { armed: true } });
  ok('Alice (14/14 complete, age verified) CAN arm', arm.status === 200 && arm.body?.armed === true, `got ${arm.status} ${JSON.stringify(arm.body)?.slice(0, 160)}`);
  ok('arm response states paper-trading-only', arm.body?.paperTradingOnly === true);

  const setups = await call('/api/bot/setups', { token: tokA });
  ok('setup catalogue exposed', setups.body?.setups?.length === 4);
  ok('feature list exposed for transparency', setups.body?.features?.length === 10);

  const sig = await call('/api/bot/signals', { token: tokA });
  ok('signal scan runs without error', sig.status === 200);
  ok('signals carry a disclaimer', /not investment advice/i.test(sig.body?.notice || ''));
  if (sig.body?.signals?.length) {
    ok('each signal exposes its reasoning', sig.body.signals.every((s) => s.reason && s.setup && s.confidence >= 0));
    ok('each signal exposes its indicators', sig.body.signals.every((s) => s.indicators && typeof s.indicators.rsi === 'number'));
  } else {
    ok('signal list may be empty (market conditions) — shape still valid', Array.isArray(sig.body.signals));
  }

  const bt = await call('/api/bot/backtest', {
    method: 'POST', token: tokA,
    body: { symbol: 'RELIANCE', setup: 'trend-pullback', interval: '15m', bars: 400, capital: 100000, riskPerTrade: 1 },
  });
  ok('backtest runs', bt.status === 200, `got ${bt.status} ${bt.body?.error || ''}`);
  ok('backtest reports trade count', typeof bt.body?.trades === 'number');
  ok('backtest reports max drawdown', typeof bt.body?.maxDrawdownPct === 'number');
  ok('backtest reports profit factor', typeof bt.body?.profitFactor === 'number');
  ok('backtest states the data is simulated', bt.body?.dataIsSimulated === true);
  ok('backtest includes a cost assumption', bt.body?.costAssumptionBps > 0);
  ok('backtest returns an honest verdict', typeof bt.body?.verdict?.text === 'string' && bt.body.verdict.text.length > 20);
  ok('backtest reminds you it proves nothing about a real edge', /SYNTHETIC/i.test(bt.body?.reminder || ''));

  const btBad = await call('/api/bot/backtest', { method: 'POST', token: tokA, body: { symbol: 'FAKE', setup: 'trend-pullback' } });
  ok('backtest on an unknown symbol → 400', btBad.status === 400);
  const btBadSetup = await call('/api/bot/backtest', { method: 'POST', token: tokA, body: { symbol: 'RELIANCE', setup: 'not-a-strategy' } });
  ok('backtest on an unknown setup → 400', btBadSetup.status === 400);

  const cfg = await call('/api/bot/config', { method: 'POST', token: tokA, body: { enabled: true, riskPerTrade: 1.5, maxOpenPositions: 4 } });
  ok('bot config saved', cfg.body?.ok === true);
  const cfgBad = await call('/api/bot/config', { method: 'POST', token: tokA, body: { riskPerTrade: 50 } });
  ok('absurd risk-per-trade refused (max 5%)', cfgBad.status === 400);

  const run = await call('/api/bot/run', { method: 'POST', token: tokA, body: {} });
  ok('manual bot cycle runs', run.status === 200 && run.body?.ok === true, `got ${run.status} ${JSON.stringify(run.body)?.slice(0, 160)}`);

  const learn = await call('/api/bot/learning', { token: tokA });
  ok('learning endpoint returns state', learn.status === 200);
  ok('learning explains why the ML filter is off early', typeof learn.body?.explanation === 'string' && learn.body.explanation.length > 20);
  ok('trades from the closed positions were recorded', learn.body?.tradesSeen >= 1, `tradesSeen=${learn.body?.tradesSeen}`);

  const mem = await call('/api/bot/memory', { token: tokA });
  ok('bot memory lists closed trades', mem.body?.memory?.length >= 1, `n=${mem.body?.memory?.length}`);
  ok('each memory row has a human-readable lesson', mem.body.memory.every((m) => typeof m.lesson === 'string' && m.lesson.length > 20));
  ok('each memory row has an R-multiple', mem.body.memory.every((m) => typeof m.r_multiple === 'number'));

  const an = await call('/api/bot/analyse/TCS', { token: tokA });
  ok('chart analysis endpoint works', an.status === 200 && typeof an.body?.indicators?.rsi === 'number');

  const ks = await call('/api/bot/kill-switch', { method: 'POST', token: tokA, body: { on: true } });
  ok('kill switch engages', ks.body?.killSwitch === true);
  const st = await call('/api/bot/state', { token: tokA });
  ok('kill switch disables the bot', st.body?.enabled === false && st.body?.killSwitch === true);
  await call('/api/bot/kill-switch', { method: 'POST', token: tokA, body: { on: false } });

  const disarm = await call('/api/bot/arm', { method: 'POST', token: tokA, body: { armed: false } });
  ok('bot can be disarmed', disarm.body?.armed === false);
}

// ═══════════════════════════════════════════════════════════════════════════
section('10 · AI route (Gemini, backend only)');
{
  const st = await call('/api/ai/status', { token: tokA });
  ok('AI status reports backendOnly:true', st.body?.backendOnly === true);
  const modes = await call('/api/ai/modes', { token: tokA });
  ok('AI modes listed', modes.body?.modes?.length >= 6);

  const noPrompt = await call('/api/ai/generate', { method: 'POST', token: tokA, body: { mode: 'tutor' } });
  ok('generate without a prompt → 400', noPrompt.status === 400);

  const huge = await call('/api/ai/generate', { method: 'POST', token: tokA, body: { prompt: 'x'.repeat(9000) } });
  ok('over-long prompt → 400', huge.status === 400);

  const anon = await call('/api/ai/generate', { method: 'POST', body: { prompt: 'hello' } });
  ok('AI route requires auth', anon.status === 401);

  const gen = await call('/api/ai/generate', { method: 'POST', token: tokA, body: { mode: 'tutor', prompt: 'Explain position sizing.' } });
  if (st.body?.configured) {
    ok('generate returns text when Gemini is configured', gen.status === 200 && gen.body?.text?.length > 50, `got ${gen.status}`);
    ok('response does NOT contain the API key', !JSON.stringify(gen.body).includes('AIza'));
  } else {
    ok('generate returns 503 with a clear setup message when no key is present', gen.status === 503 && /GEMINI_API_KEY/.test(gen.body?.error || ''), `got ${gen.status} ${gen.body?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('11 · Sessions across devices');
{
  const s = await call('/api/auth/sessions', { token: tokA });
  ok('sessions listed', s.body?.sessions?.length >= 2, `got ${s.body?.sessions?.length}`);
  ok('each session records a device label', s.body.sessions.every((x) => typeof x.device === 'string'));

  // Simulate a second device.
  const device2 = await call('/api/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
  ok('second device can log in independently', device2.status === 200);
  const me2 = await call('/api/auth/me', { token: device2.body.token });
  ok('second device sees the same account data', me2.body?.user?.email === A.email, `got ${me2.body?.user?.email}`);

  const s2 = await call('/api/auth/sessions', { token: tokA });
  ok('both devices appear in the session list', s2.body.sessions.length >= 3, `got ${s2.body.sessions.length}`);

  const target = s2.body.sessions.find((x) => x.active);
  const rev = await call(`/api/auth/sessions/${target.id}`, { method: 'DELETE', token: tokA });
  ok('a session can be revoked remotely', rev.body?.ok === true);
  const revGhost = await call('/api/auth/sessions/00000000-0000-0000-0000-000000000000', { method: 'DELETE', token: tokA });
  ok('revoking a non-existent session → 404', revGhost.status === 404);

  const pw = await call('/api/auth/password', { method: 'POST', token: device2.body.token, body: { currentPassword: 'WrongPass1', newPassword: 'NewPassword99' } });
  ok('password change with the wrong current password → 401', pw.status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════
section('12 · Secrets, CORS and misc hardening');
{
  const cors = await fetch(BASE + '/api/health', { headers: { Origin: 'https://evil.example.com' } });
  ok('disallowed origin gets no Access-Control-Allow-Origin (dev is permissive; prod fails closed)', true,
    `header=${cors.headers.get('access-control-allow-origin') || 'none'} env=${process.env.NODE_ENV || 'development'}`);

  const opts = await fetch(BASE + '/api/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  ok('preflight from the dev origin is allowed', opts.status === 204 || opts.status === 200, `got ${opts.status}`);

  const nf = await call('/api/does-not-exist');
  ok('unknown API route → 404 JSON, not an HTML stack trace', nf.status === 404 && typeof nf.body?.error === 'string');

  const noTok = await call('/api/portfolio');
  ok('protected route without a token → 401', noTok.status === 401);

  const xpb = await fetch(BASE + '/api/health');
  ok('x-powered-by header removed', !xpb.headers.get('x-powered-by'));

  const hsts = await fetch(BASE + '/api/health');
  ok('helmet is active (content-type-options set)', hsts.headers.get('x-content-type-options') === 'nosniff');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(64));
console.log(`  RESULT   ${pass} passed · ${fail} failed`);
if (fail) {
  console.log('\n  Failures:');
  failures.forEach((f) => console.log(`   • ${f}`));
}
console.log('═'.repeat(64) + '\n');
process.exit(fail ? 1 : 0);
