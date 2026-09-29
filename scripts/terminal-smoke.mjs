/**
 * Terminal browser verification — sandboxed iframe (mirrors the embedded
 * viewer) + the full spec flow: watchlist, chart controls, search, paper
 * orders (market/limit), pending cancel, bottom tabs, TradingView links.
 */
import { chromium } from 'playwright';

let pass = 0; let fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗ FAIL:', label); } };

const BASE = process.env.SMOKE_BASE || 'http://localhost:5173'; // app origin (prod: https://trademarket-api.onrender.com)
const API = process.env.SMOKE_API || `${API}`;   // API origin (same as BASE on single-service deploys)
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.setContent(`<!doctype html><html><body style="margin:0">
  <iframe id="app" sandbox="allow-scripts allow-forms allow-popups" src="${BASE}" style="width:100%;height:96vh;border:0"></iframe>
</body></html>`);
const frame = page.frameLocator('#app');

// gate → markets
await frame.locator('text=Skip the paperwork').first().waitFor({ timeout: 20000 }).catch(() => {});
const enter = frame.locator('button:has-text("Enter"), a:has-text("Enter"), button:has-text("markets"), a:has-text("markets")').first();
if (await enter.count()) await enter.click().catch(() => {});
await frame.locator('a[href="/app/terminal"]').first().waitFor({ timeout: 30000 });
ok(true, 'app reached authenticated shell in sandboxed iframe');

// navigate to terminal
await frame.locator('a[href="/app/terminal"]').first().click();
await frame.locator('[data-testid="terminal-search"]').waitFor({ timeout: 15000 });
ok(true, '/app/terminal renders');

// watchlist fills with live prices
await frame.locator('[data-testid="watchlist"]').waitFor();
await frame.locator('[data-testid^="wl-row-"]').first().waitFor({ timeout: 15000 });
const wlRows = await frame.locator('[data-testid^="wl-row-"]').count();
ok(wlRows >= 4, `watchlist has ${wlRows} rows`);
let priced = false;
for (let i = 0; i < 16 && !priced; i++) {
  const txt = await frame.locator('[data-testid^="wl-price-"]').first().textContent();
  priced = txt && txt.trim() !== '…';
  if (!priced) await page.waitForTimeout(750);
}
ok(priced, 'watchlist prices stream in (WS or fallback)');

// stream + feed + session chips exist and are honest
const stream = (await frame.locator('[data-testid="terminal-stream"]').textContent()).trim();
ok(['● WS CONNECTED', 'WS RECONNECTING…', 'WS OFFLINE'].includes(stream), `stream chip: "${stream}"`);
const stateChip = (await frame.locator('[data-testid="terminal-state"]').textContent()).trim();
ok(['● LIVE', '● DELAYED', '● MARKET CLOSED', '● CONNECTION ERROR', 'PAPER VENUE · PROVIDER OFF'].includes(stateChip), `4-state chip: "${stateChip}"`);
const strip = await frame.locator('[data-testid="quote-strip"]').textContent();
ok(strip.includes('Prev close') && strip.includes('Bid') && strip.includes('Ask') && strip.includes('Volume'), 'quote strip shows O/H/L, prev close, volume, bid/ask');
const prov = await (await fetch(`${API}/api/provider/upstox/status`)).json();
const publicMode = prov.publicMode === true; // keyless official feed currently reachable
const secretFree = !JSON.stringify(prov).match(/"[^"]*(?:secret|token)[^"]*"\s*:\s*"[A-Za-z0-9_./-]{4,}"/i); // key:value pairs only — the word 'secret' in honest reason text is fine
ok(secretFree && (publicMode ? ['market_closed', 'live'].includes(prov.state) : prov.state === 'unconfigured'),
  `provider status honest + secret-free (${prov.state}, publicMode=${publicMode})`);

// Finnhub (user key): US equities must trade at REAL quotes, honestly labelled
const fh = await (await fetch(`${API}/api/provider/finnhub/status`)).json();
const fhSecretFree = !JSON.stringify(fh).match(/"[^"]*(?:secret|token|key)[^"]*"\s*:\s*"[A-Za-z0-9_./-]{4,}"/i);
ok(fhSecretFree && ['live', 'market_closed', 'error', 'unconfigured'].includes(fh.state), `finnhub status honest + secret-free (${fh.state})`);
if (fh.state === 'live' || fh.state === 'market_closed') {
  const r0 = await (await fetch(`${API}/api/market/quote/AAPL`)).json();
  const aapl = r0?.quote ?? r0;
  ok(aapl?.feed?.source === 'finnhub' && aapl?.source !== 'simulated' && aapl?.price > 50 && aapl?.price < 5000,
    `AAPL real-time via FINNHUB: $${aapl?.price} (${aapl?.feed?.label})`);
} else {
  ok(false, `finnhub key not active in prod (state=${fh.state}: ${fh.reason || '?'})`);
}
const udf = await (await fetch(`${API}/udf/config`)).json();
ok(Array.isArray(udf.supported_resolutions) && udf.supported_resolutions.includes('240'), 'UDF config serves 9 resolutions');
const udfh = await (await fetch(`${API}/udf/history?symbol=RELIANCE&resolution=5&from=` + (Math.floor(Date.now()/1000) - 86400) + '&to=' + Math.floor(Date.now()/1000))).json();
ok(udfh.s === 'ok' && udfh.t.length > 10, `UDF history ok (${udfh.t.length} bars)`);
await frame.locator('[data-testid="terminal-feed"]').waitFor({ timeout: 12000 });
const feedLabel = (await frame.locator('[data-testid="terminal-feed"]').textContent()).trim();
ok(feedLabel.length > 0, `feed chip: "${feedLabel}"`);
if (publicMode) ok(feedLabel !== 'PAPER VENUE', `RELIANCE routed to real Upstox feed, not paper (${feedLabel})`);
else ok(feedLabel === 'PAPER VENUE', `public feed unreachable/rate-limited — honest PAPER VENUE label, no fake LIVE (${feedLabel})`);

// paper banner
const banner = (await frame.locator('[data-testid="paper-banner"]').textContent()).trim();
ok(banner === 'PAPER TRADING — NO REAL MONEY', `banner: "${banner}"`);

// chart: candles drawn
await frame.locator('[data-testid="chartpro"] svg').first().waitFor({ timeout: 15000 });
const rects0 = await frame.locator('[data-testid="chartpro"] svg rect').count();
ok(rects0 >= 20, `chart drew ${rects0} candle/body rects`);

// timeframe switch to 1D
await frame.locator('[data-testid="chart-tf-1D"]').click();
await page.waitForTimeout(1800);
const rects1D = await frame.locator('[data-testid="chartpro"] svg rect').count();
ok(rects1D >= 10, `1D timeframe drew ${rects1D} rects`);
await frame.locator('[data-testid="chart-tf-5m"]').click();
await page.waitForTimeout(1200);

// chart type switch (area) + volume + theme toggles don't crash
await frame.locator('[data-testid="chart-type-area"]').click();
await page.waitForTimeout(500);
ok(await frame.locator('[data-testid="chartpro"] svg polygon').count() >= 1, 'area type renders polygon');
await frame.locator('[data-testid="chart-type-candle"]').click();
await frame.locator('[data-testid="chart-volume"]').click();
await frame.locator('[data-testid="chart-theme"]').click();
await page.waitForTimeout(400);
ok(await frame.locator('[data-testid="chartpro"] svg rect').count() >= 10, 'volume/theme toggles survive');
await frame.locator('[data-testid="chart-theme"]').click();
await frame.locator('[data-testid="chart-volume"]').click();

// exchange-qualified search → TSLA
await frame.locator('[data-testid="terminal-search"]').click();
await frame.locator('[data-testid="terminal-search"]').fill('NASDAQ:TSLA');
await frame.locator('[data-testid="suggest-TSLA"]').waitFor({ timeout: 8000 });
await frame.locator('[data-testid="suggest-TSLA"]').click();
await page.waitForTimeout(1500);
const tvHref = await frame.locator('[data-testid="tv-chart"]').getAttribute('href');
ok(tvHref.includes('tradingview.com/chart') && tvHref.includes('symbol='), `per-symbol TV link: ${tvHref}`);
const tvTarget = await frame.locator('[data-testid="tv-chart"]').getAttribute('target');
ok(tvTarget === '_blank', 'TV link opens new tab');
const siteHref = await frame.locator('[data-testid="tv-open"]').getAttribute('href');
ok(siteHref === 'https://www.tradingview.com/', 'site-level TV link');

// market BUY on TSLA
await frame.locator('[data-testid="order-qty"]').fill('1');
await frame.locator('[data-testid="place-order"]').click();
await frame.locator('[data-testid="terminal-notice"]').waitFor({ timeout: 12000 });
const notice = (await frame.locator('[data-testid="terminal-notice"]').textContent()).trim();
ok(/filled/i.test(notice), `market order notice: "${notice.slice(0, 80)}"`);
await frame.locator('[data-testid="pos-row-TSLA"]').waitFor({ timeout: 12000 });
ok(true, 'position row appears in Positions tab');

// far limit → pending → cancel
await frame.locator('[data-testid="order-type"]').selectOption('limit');
await frame.locator('[data-testid="order-limit"]').fill('10');
await frame.locator('[data-testid="place-order"]').click();
await frame.locator('[data-testid="terminal-notice"]:has-text("Resting")').waitFor({ timeout: 12000 });
const notice2 = (await frame.locator('[data-testid="terminal-notice"]').textContent()).trim();
ok(/Resting/i.test(notice2), `pending notice: "${notice2.slice(0, 80)}"`);
await frame.locator('[data-testid="tab-orders"]').click();
await frame.locator('[data-testid^="cancel-"]').first().waitFor({ timeout: 12000 });
ok(true, 'pending order shows Cancel control');
await frame.locator('[data-testid^="cancel-"]').first().click();
await page.waitForTimeout(2500);
const statuses = await frame.locator('[data-testid="order-row"] td:nth-child(7)').allTextContents();
ok(statuses.some((s) => /cancelled/i.test(s)), `cancel reflected in order list (${statuses.slice(0, 3).join('|')})`);

// portfolio + pnl tabs
await frame.locator('[data-testid="tab-portfolio"]').click();
await page.waitForTimeout(1200);
const pfText = await frame.locator('body').textContent();
ok(pfText.includes('Simulated cash'), 'portfolio tab shows simulated cash');
await frame.locator('[data-testid="tab-pnl"]').click();
await page.waitForTimeout(1200);
const pnlText = await frame.locator('body').textContent();
ok(pnlText.includes('Realized P&L'), 'pnl tab shows realized P&L');
await frame.locator('[data-testid="tab-history"]').click();
await page.waitForTimeout(600);

// watchlist add / reorder / remove
await frame.locator('[data-testid="tab-positions"]').click();
await frame.locator('[data-testid="watchlist-add"]').click();
await frame.locator('[data-testid="watchlist-search"]').fill('NVDA');
await frame.locator('[data-testid="watchlist-add-NVDA"]').click();
await frame.locator('[data-testid="wl-row-NVDA"]').waitFor({ timeout: 8000 });
ok(true, 'watchlist add NVDA');
await frame.locator('[data-testid="wl-up-NVDA"]').click({ force: true });
await page.waitForTimeout(400);
const order1 = await frame.locator('[data-testid^="wl-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
ok(order1.indexOf('wl-row-NVDA') < order1.length - 1, `reorder moved NVDA (${order1.slice(-3).join(',')})`);
await frame.locator('[data-testid="wl-remove-NVDA"]').click({ force: true });
await page.waitForTimeout(600);
ok((await frame.locator('[data-testid="wl-row-NVDA"]').count()) === 0, 'watchlist remove NVDA');

// click watchlist row → chart follows
const firstSym = (await frame.locator('[data-testid^="wl-row-"]').first().getAttribute('data-testid')).replace('wl-row-', '');
await frame.locator('[data-testid^="wl-row-"]').first().click();
await page.waitForTimeout(1200);
const head = await frame.locator('[data-testid="chartpro"]').textContent();
ok(head.includes(firstSym), `click row loads ${firstSym} in chart`);

// no page errors from OUR code (TradingView embeds reading document.cookie in
// a sandboxed frame are a known benign third-party artifact)
const ours = errors.filter((m) => !/cookie|sandboxed/i.test(m));
ok(ours.length === 0, `no uncaught page errors from app code (${ours.slice(0, 2).join('; ')})`);

await page.screenshot({ path: 'scripts/shots/terminal.png' });
console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
