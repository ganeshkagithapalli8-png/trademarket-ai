/**
 * finnhub-shot.mjs — visual proof that the user's Finnhub key powers REAL-TIME
 * prices/charts in prod. Loads the deployed app in a sandboxed iframe (same as
 * the preview environment), opens the terminal, selects AAPL, lets real ticks
 * accumulate for ~50s (10s poll cadence), then captures:
 *   • watchlist AAPL price (should be the real ~$330s, not paper ~$230s)
 *   • chart chips (LIVE · FINNHUB feed chip, REAL BARS · FINNHUB bars chip)
 *   • a screenshot of the chart with bars aggregated from real ticks
 */
import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'https://trademarket-api.onrender.com';
const WAIT_MS = Number(process.env.SHOT_WAIT || 50_000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.setContent(`<!doctype html><html><body style="margin:0">
  <iframe id="app" sandbox="allow-scripts allow-forms allow-popups" src="${URL}" style="width:100%;height:96vh;border:0"></iframe>
</body></html>`);
const frame = page.frameLocator('#app');

await frame.locator('text=Skip the paperwork').first().waitFor({ timeout: 30_000 }).catch(() => {});
const enter = frame.locator('button:has-text("Enter"), a:has-text("Enter"), button:has-text("markets"), a:has-text("markets")').first();
if (await enter.count()) await enter.click().catch(() => {});
await frame.locator('a[href="/app/terminal"]').first().waitFor({ timeout: 30_000 });
await frame.locator('a[href="/app/terminal"]').first().click();

// make sure AAPL is on the watchlist, then select it
if (!(await frame.locator('[data-testid="wl-row-AAPL"]').count())) {
  await frame.locator('[data-testid="watchlist-add"]').click().catch(() => {});
  await frame.locator('[data-testid="watchlist-add-AAPL"]').click().catch(() => {});
}
await frame.locator('[data-testid="wl-row-AAPL"]').first().click();
await frame.locator('[data-testid="chartpro"]').first().waitFor({ timeout: 25_000 });

console.log('waiting', WAIT_MS / 1000, 's for real Finnhub ticks to aggregate into live candles…');
await page.waitForTimeout(WAIT_MS);

const wlPrice = (await frame.locator('[data-testid="wl-price-AAPL"]').textContent().catch(() => '?')) || '?';
const chips = await frame.locator('[data-testid="chartpro"] span').allTextContents();
const chipLine = chips.filter((c) => /FINNHUB|LIVE|CLOSED|STREAMING|BARS|ERROR|PAPER/.test(c)).join(' | ');
const barsSrc = await frame.locator('[data-testid="chart-bars-src"]').textContent().catch(() => '(none)');
const rectCount = await frame.locator('[data-testid="chartpro"] svg rect').count();

console.log('AAPL watchlist price :', wlPrice.trim());
console.log('chart chips          :', chipLine);
console.log('bars-source chip     :', barsSrc?.trim());
console.log('svg rects (candles)  :', rectCount);

const el = await frame.locator('[data-testid="chartpro"]').elementHandle();
await el.screenshot({ path: 'finnhub-aapl.png' });
await page.screenshot({ path: 'finnhub-terminal.png' });
await browser.close();
console.log('saved finnhub-aapl.png + finnhub-terminal.png');
