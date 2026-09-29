import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.setContent(`<!doctype html><html><body style="margin:0">
  <iframe id="app" sandbox="allow-scripts allow-forms allow-popups" src="https://trademarket-api.onrender.com" style="width:100%;height:96vh;border:0"></iframe>
</body></html>`);
const frame = page.frameLocator('#app');
await frame.locator('text=Skip the paperwork').first().waitFor({ timeout: 25000 }).catch(() => {});
const enter = frame.locator('button:has-text("Enter"), a:has-text("Enter"), button:has-text("markets"), a:has-text("markets")').first();
if (await enter.count()) await enter.click().catch(() => {});
await frame.locator('a[href="/app/terminal"]').first().waitFor({ timeout: 30000 });
await frame.locator('a[href="/app/terminal"]').first().click();
await frame.locator('[data-testid="chartpro"] svg rect').first().waitFor({ timeout: 25000 });
await page.waitForTimeout(2500);
// screenshot the chart in 5m (default) then after clicking 1m
const shot = async (name) => {
  const el = await frame.locator('[data-testid="chartpro"]').elementHandle();
  await el.screenshot({ path: name });
};
await shot('chart-5m.png');
await frame.locator('[data-testid="chartpro"] button:has-text("1m")').first().click();
await page.waitForTimeout(3500);
await shot('chart-1m.png');
await browser.close();
console.log('shots saved');
