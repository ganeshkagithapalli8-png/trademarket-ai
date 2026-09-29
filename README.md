# TradeMarket AI — paper-trading simulator with a learning path and a learning bot

A complete full-stack trading **simulator**. Indian-style instruments across five
market segments, a 14-module curriculum that gates what you are allowed to do,
a deterministic strategy bot that records every simulated trade and updates its
own weights, an honest backtester, live headlines, and a Gemini tutor that runs
entirely on the server.

> **Read this first.** There is no real money anywhere in this project. The
> wallet holds simulated rupees. There is no payment gateway, no custody, no
> broker order-routing code — not behind a flag, not in a branch. Placing
> orders for other people's money without SEBI registration is a criminal
> offence in India, so this application is deliberately unable to do it.
> Module 14 explains the compliant route if you ever want to trade your own
> money: your own broker account, your own API key, your own deterministic
> strategy, at 18+.

---

## What is in the box

| Area | Where | What it does |
|---|---|---|
| Auth & profiles | `server/src/routes/auth.js`, `profile.js` | bcrypt passwords, JWT sessions, multi-device session list with remote revoke, age capture with 16+/18+ gates |
| Simulated wallet | `routes/trading.js` + `client/.../FundsContext.jsx` | INR-only top-ups (min ₹50, max ₹1,00,000 per txn), withdrawals, full reset, transaction ledger. One shared top-up modal reachable from the header chip, the account menu, the dashboard banner and — with the shortfall pre-filled and clamped to the cap — from inside the order ticket when a position does not fit available cash |
| Markets | `routes/market.js` + `services/marketEngine.js` | 5 segments (equities, F&O, IPO, crypto, INR forex pairs), deterministic seeded candles with regime shifts, optional live crypto reference prices |
| Trading | `routes/trading.js` | Market/limit paper orders, ATR-based stops/targets, margin & lot-size enforcement, kill switch, daily loss limit, per-order risk gate |
| Portfolio | `routes/trading.js` | Equity, realised/unrealised P&L, win rate, streaks, equity curve, allocation |
| Learning | `routes/learn.js` + `services/roadmap.js` | 14 sequential modules, lessons, server-graded quizzes; answers never reach the client before an attempt; derivatives unlock only after Risk Management |
| Bot | `routes/bot.js` + `services/bot.js`, `botRunner.js` | 4 deterministic setups, ML filter (online logistic regression over its own closed trades, R-multiple targets), per-setup expectancy, arming gate (modules 1–13 + 18+) |
| Backtester | `services/bot.js` | Fills at the **next** bar's open, includes slippage + costs, reports honest sample caveats |
| Content | `routes/content.js` | Notes / watchlist / journal CRUD with AI summary & coaching |
| News | `services/news.js` | Moneycontrol, Economic Times, CoinDesk RSS, server-side fetch + cache |
| AI | `routes/ai.js` + `services/gemini.js` | Gemini **backend-only**; modes for tutor/analyse/summarise/botreview/roadmap/news; system prompt forbids trade recommendations |
| Security | `middleware.js`, `db/schema.sql` | Row-Level Security per user with a least-privilege app role, Helmet, strict CORS, rate limits, JSON-only errors |

Client: React 18 + Vite + Tailwind (light theme, `#F8FAFC` canvas, white cards,
glass header), hand-rolled SVG candlestick/area/sparkline charts, mobile-first
with a bottom tab bar under 1024px.

---

## Run it locally

Prereqs: Node ≥ 20 and a Postgres ≥ 14 (or set `SUPABASE_DB_URL`).

```bash
npm install                 # root (test tooling)
npm run setup               # installs client + server deps
cp server/.env.example server/.env   # then fill in what you have
npm run migrate             # creates every table, index, role and RLS policy
npm run dev                 # API on :5000 (watch) + web on :5173 (proxying /api)
```

Only two env values are strictly required to start: `JWT_SECRET` and a
`DATABASE_URL`/`SUPABASE_DB_URL`. Without `GEMINI_API_KEY` the AI surfaces
degrade gracefully to an explanatory "not configured" state.

### Tests

```bash
npm test                    # 187 API/RLS/security assertions against a running server
node scripts/e2e-test.mjs http://localhost:5000

npx playwright install chromium --with-deps   # once
node scripts/ui-smoke.mjs                     # 118 browser assertions + screenshots
node scripts/find-overflow.mjs 375 /app/wallet /app/settings   # mobile overflow probe
```

The UI suite drives a real headless Chromium: signup through the form, funding,
completing the curriculum, arming the bot, placing and closing a paper order,
running a backtest, and asserting on every route that there are **no console
errors and no horizontal overflow** at 375px and 360px. Screenshots land in
`scripts/shots/` (gitignored).

---

## Security model

- **Row-Level Security is the backstop.** The app connects as `tm_app`, a
  non-superuser role without `BYPASSRLS`. Every transaction sets
  `app.user_id`; policies allow a row only when it belongs to that id. The
  test suite attacks the database directly with raw SQL to prove a second
  user cannot read or insert another's rows.
- **Secrets never ship to the browser.** The UI talks only to `/api/*`.
  Gemini, RSS and any broker-quote adapters are fetched server-side. The UI
  suite greps the built bundle for key-shaped strings.
- **Every limit is enforced server-side.** The client can hide a button; it
  cannot bypass the risk gate, the lot size, the margin cap, the daily loss
  limit or the kill switch.

## Deployment

GitHub → Render (API) → Vercel (SPA). See `scripts/deploy/deploy.mjs`:

```bash
GITHUB_TOKEN=ghp_... RENDER_TOKEN=rnd_... VERCEL_TOKEN=vcp_... \
  node scripts/deploy/deploy.mjs
```

It creates the repo, pushes, provisions the Render service rooted at `server/`,
waits for `/api/health`, creates the Vercel project rooted at `client/` with
`VITE_API_BASE_URL`, deploys, then writes `CLIENT_URL` back into Render and
redeploys so CORS is correct on both sides. `render.yaml` documents the same
service for dashboard-based setup.

## Repository layout

```
client/   user-facing React app — no secrets, ever
server/   Express API, services, migrations, RLS schema
scripts/  e2e-test.mjs · ui-smoke.mjs · find-overflow.mjs · deploy/
```

## Live market data (Upstox, NSE/BSE)

Market data flows one way only: **NSE/BSE → Upstox → this backend → WebSocket/REST → frontend**.
The frontend never holds a provider key; it only talks to `/api/...`, `/ws/market` and `/udf/...`.

### 1 · Configure (server-side only)

```bash
# server/.env — never commit, never serve
UPSTOX_CLIENT_ID=your_client_id
UPSTOX_CLIENT_SECRET=your_client_secret     # optional if you use the OAuth flow
UPSTOX_ACCESS_TOKEN=your_daily_access_token # optional if you use the OAuth flow
UPSTOX_REDIRECT_URI=https://your-api-host/api/provider/upstox/callback
```

Two ways to obtain an access token (Upstox tokens expire daily):

* **Pasted token** — set `UPSTOX_ACCESS_TOKEN` from the Upstox developer console, restart.
* **In-app OAuth** — with client id+secret set, open
  `GET /api/provider/upstox/auth-url` (authenticated), follow the redirect to
  Upstox's dialog, and land on `/api/provider/upstox/callback`. The exchanged
  token is stored **server-side in memory only** and used until expiry.

### 1b · Keyless "public mode" (no credentials needed)

With `UPSTOX_CLIENT_ID` / `SECRET` / `ACCESS_TOKEN` all absent, the backend
still serves **real NSE prices** through Upstox's publicly-answering REST
candle endpoints (`/v2/historical-candle/...` — they respond 200 without a
token). No HTML is scraped and no auth is bypassed; these are official API
routes that Upstox serves unauthenticated.

* Boot probes the feed (`probePublic`). When reachable, subscribed symbols
  (≤ 10) are polled every `UPSTOX_POLL_MS` (default 30 s — 1-minute candles
  carry no faster information) for **1-minute intraday candles**, turned
  into ticks and streamed over the normal `/ws/market`. Poll cycles never
  overlap.
* The feed chip reads **`LIVE · UPSTOX 1-MIN`** during NSE hours
  (09:15–15:30 IST) and **`MARKET CLOSED`** outside them — showing the real
  last-traded price and previous close, never a simulated number.
* Timeframes Upstox doesn't serve keyless are **aggregated server-side**
  from the ones it does (`1minute`, `30minute`, `day`, `week`, `month`):
  5m/15m from 1-minute candles, 1h/4h from 30-minute candles.
* Previous close comes from daily candles with IST-date awareness (today's
  daily bar is only finalised after market close).
* No bid/ask or market depth in this mode — the quote strip shows `—`
  instead of inventing numbers.
* Rate limits: these endpoints carry a per-IP request budget. On `429` the
  poller backs off (doubling its interval, honouring `Retry-After`, capped
  at 5 min) and returns to the default cadence once requests succeed again;
  a `429` during the boot probe schedules backoff re-probes (30 s → 10 min
  cap) instead of latching "unreachable". On `401/403` public mode disables itself. If the feed is
  unreachable, everything falls back to the clearly labelled **PAPER VENUE**.
* The moment real credentials land (env restart or in-app OAuth), polling
  stops and the official protobuf **WebSocket feed** takes over
  (`LIVE · UPSTOX WS`, with bid/ask + depth) — no config change needed.

### 2 · Backend service surface (`server/src/services/marketData.js`)

`getQuote(symbol)` · `getHistoricalCandles(symbol, timeframe)` ·
`subscribeToMarketData(symbols)` · `unsubscribeFromMarketData(symbols)` —
backed by `services/providers/upstox.js` (official `upstox-js-sdk`: REST v3
quotes/history + `MarketDataStreamerV3` protobuf WebSocket feed), with
reconnect, 429 backoff, a no-tick watchdog and an instrument-master download.

### 3 · Frontend

* `/ws/market` streams ticks + server-aggregated candles (1m…1M); the chart
  updates the live candle in place and rolls over on timeframe expiry.
* Status chip shows exactly one of `● LIVE · ● DELAYED · ● MARKET CLOSED ·
  ● CONNECTION ERROR`; LIVE only while provider ticks are actually arriving.
* With no Upstox credentials the app first tries the keyless public mode
  (§ 1b); only if that feed is unreachable or rate-limited does it stay on
  the clearly labelled paper venue — simulated prices are never presented
  as live quotes.

### 4 · TradingView (official paths only)

* `GET /udf/*` implements TradingView's UDF datafeed protocol over **our**
  backend, and `client/src/lib/tvDatafeed.js` is the JS-API datafeed adapter
  (with `subscribeBars` bridged to the WebSocket). Drop the licensed Charting
  Library bundle into the client and it mounts automatically; until then the
  built-in ChartPro renders the same datafeed.
* "Open TradingView" / per-symbol chart links open tradingview.com in a new
  tab. We never scrape TradingView and never treat its widgets as a data API.

### 5 · Paper trading only

Orders, positions and P&L are virtual. No broker execution exists in this
codebase; a future broker adapter must be a separate, explicitly authorised
module.

## Real-time US equities (Finnhub, user key)

US-listed stocks (AAPL, TSLA, NVDA, MSFT, …) trade at **real exchange prices**
through the Finnhub free tier with the key stored as `FINNHUB_API_KEY`
(server env only — never shipped to the client):

- `GET /v1/quote` is polled every 10 s for symbols currently on screen
  (≤ 8 symbols → far under the 60 req/min budget; 429s back off and honour
  `Retry-After`; a rejected key disables the poller instead of hammering).
- Every real tick becomes the symbol's price **everywhere** — watchlist,
  quote strip, paper fills, marks, P&L (engine `liveRef` overlay), and is
  persisted as genuine 1-minute candles in the `live_candles` table.
  Charts render those real bars (larger timeframes derived on read); the
  free tier has no candle-history endpoint, so history simply *builds up
  live* from this server's first real tick — never simulated bars under a
  real-feed label.
- Chips stay honest: `LIVE · FINNHUB` while streaming, `MARKET CLOSED`
  outside NYSE hours (09:30–16:00 ET), `CONNECTION ERROR` when the feed
  drops, `REAL BARS · FINNHUB` on charts whose bars came from real prints.
- Free-tier limits, verified: ❌ candle history, ❌ India (NSE/BSE stays on
  the keyless Upstox feed), ❌ forex quotes. Crypto stays on CoinGecko.
- `GET /api/provider/finnhub/status` exposes keyless health for the UI.

Rotate `FINNHUB_API_KEY` if it was ever pasted into a chat or screenshot.

## Live routing — your own Zerodha account (fenced, opt-in)

Real-money trading happens **only** through your own SEBI-registered broker. This app never holds
funds; it sends *your confirmed* orders to *your* Kite Connect account and reads back positions.

**Setup (one-time):** 18+ with a KYC-complete Zerodha account → sign up at `developers.kite.trade`
→ free **Personal plan** (order placement + portfolio; live *data* stays on our Upstox/Finnhub feeds)
→ create an app with redirect URL `https://trademarket-api.onrender.com/api/live/callback` → put
`ZERODHA_API_KEY` + `ZERODHA_API_SECRET` in the server env (never the client).

**Daily:** terminal → `LIVE · broker` tab → **Connect Zerodha** (official Kite login; token expires
~6am IST) → **Enable LIVE mode** (re-checks 18+).

**Fences (server-enforced, shown in the UI):**
- live OFF by default; explicit per-user opt-in; every enable re-verifies 18+
- every order requires `confirm:true` through a review modal — nothing silent
- daily loss stop `LIVE_DAILY_LOSS_INR` (default ₹2,000) blocks new orders; paper keeps working
- per-order notional cap `LIVE_MAX_ORDER_NOTIONAL_INR` (default ₹1,00,000)
- PANIC kill switch: cancels every OPEN broker order and drops to paper
- full audit trail (`live_orders`); access tokens AES-256-GCM encrypted at rest
- MARKET orders always carry 0.5% market protection (broker requirement)
- the AI bot can **never** place live orders — live is self-directed only
- NSE instruments only in v1 (US/crypto/live-foreign stays paper)

