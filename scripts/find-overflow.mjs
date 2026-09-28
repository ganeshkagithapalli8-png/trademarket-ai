#!/usr/bin/env node
/** Report the DEEPEST elements that overflow the viewport, with their ancestor chain. */
import { chromium } from 'playwright';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:5000';
const W = Number(process.argv[2] || 375);
const routes = process.argv.slice(3);

const stamp = Date.now();
const email = `ovf.${stamp}@test.dev`;
let token;
{
  const r = await fetch(`${API}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123', fullName: 'Overflow Probe', dateOfBirth: '1995-01-01' }),
  });
  ({ token } = await r.json());
}
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
await fetch(`${API}/api/wallet/deposit`, { method: 'POST', headers: H, body: JSON.stringify({ amount: 400000 }) });
// Build the same rich state the smoke test had.
const { ROADMAP } = await import('../server/src/services/roadmap.js');
for (const m of ROADMAP) await fetch(`${API}/api/learn/module/${m.id}/quiz`, { method: 'POST', headers: H, body: JSON.stringify({ answers: m.quiz.map((q) => q.answer) }) });
await fetch(`${API}/api/bot/arm`, { method: 'POST', headers: H, body: JSON.stringify({ armed: true }) });
await fetch(`${API}/api/bot/config`, { method: 'POST', headers: H, body: JSON.stringify({ enabled: true, riskPerTrade: 1, maxOpenPositions: 4 }) });
await fetch(`${API}/api/notes`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Pullback entry rules', description: 'Only buy dips above the 50 SMA when RSI resets below 40 and turns back up. Stop goes 1.5 × ATR below entry.', tags: ['strategy', 'rules'] }) });
await fetch(`${API}/api/watchlist`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'TCS', note: 'Watch for IT rotation into large caps before the results season' }) });
await fetch(`${API}/api/journal`, { method: 'POST', headers: H, body: JSON.stringify({ body: 'Planned a pullback entry above the 50 SMA with a 1.5 ATR stop. I moved the stop lower instead of accepting the loss.', emotion: 'fear', followedPlan: false, rating: 2, symbol: 'RELIANCE', side: 'long', aiFeedback: false }) });
// A second session so Settings has rows to render.
await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123' }) });
await fetch(`${API}/api/trade/order`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'RELIANCE', side: 'buy', type: 'MARKET', qty: 10 }) });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: 800 } });
await page.goto(`${WEB}/auth`, { waitUntil: 'networkidle' });
await page.evaluate((t) => localStorage.setItem('tm_token', t), token);
await page.evaluate((u) => localStorage.setItem('tm_user', JSON.stringify(u)), { email, fullName: 'Overflow Probe', role: 'retail', ageVerified: true, marketsEnabled: ['stocks'] });

for (const path of routes) {
  await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1) over.push(el);
    }
    // keep only elements with no overflowing descendant = the true leaves
    const leaves = over.filter((el) => !over.some((o) => o !== el && el.contains(o)));
    const chain = (el) => {
      const parts = [];
      let n = el;
      while (n && parts.length < 5) {
        const c = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '').toString().trim().slice(0, 70);
        parts.push(`${n.tagName.toLowerCase()}${c ? '.' + c.split(/\s+/).slice(0, 4).join('.') : ''}`);
        n = n.parentElement;
      }
      return parts.join('  ⊂  ');
    };
    return {
      vw, scrollWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth - vw,
      leaves: leaves.slice(0, 10).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          chain: chain(el),
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
          w: Math.round(r.width), right: Math.round(r.right),
          minW: cs.minWidth, ws: cs.whiteSpace, disp: cs.display, ofx: cs.overflowX,
        };
      }),
    };
  });
  const flag = out.overflow > 1 ? '✖' : '✔';
  console.log(`\n${flag} ${path} — vw ${out.vw} scrollWidth ${out.scrollWidth} overflow ${out.overflow}px`);
  out.leaves.forEach((l) => {
    console.log(`    w=${l.w} right=${l.right} min-width=${l.minW} white-space=${l.ws} display=${l.disp}`);
    console.log(`      chain: ${l.chain}`);
    console.log(`      text:  "${l.text}"`);
  });
}
await browser.close();
