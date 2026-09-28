/**
 * Market-data provider control surface.
 *
 * SECURITY: the OAuth handshake happens entirely server-side. The browser is
 * only ever redirected to Upstox's own authorization dialog and back to our
 * callback; client secret and tokens are read from / written to server env +
 * in-memory store. Status responses carry NO secrets.
 */
import { Router } from 'express';
import { asyncH, requireAuth, apiLimiter } from '../middleware.js';
import { upstoxProvider } from '../services/providers/upstox.js';

const router = Router();

/** Public, secret-free provider health for status chips. */
router.get('/upstox/status', (_req, res) => {
  res.json(upstoxProvider.status());
});

/** Where the provider's WS feed stands right now (live/down/closed/unconfigured). */
router.get('/upstox/feed', (_req, res) => {
  const st = upstoxProvider.status();
  res.json({
    connected: st.state === 'live',
    state: st.state,
    reason: st.reason,
    lastTickAt: st.lastTickAt,
    marketOpen: upstoxProvider.marketOpen(),
    subscribedSymbols: [...new Set([...upstoxProvider.subscribed.values()].flatMap((s) => [...s]))],
  });
});

/** Step 1 of OAuth: hand the browser a Upstox authorize URL (no secrets in it). */
router.get('/upstox/auth-url', requireAuth, apiLimiter, asyncH(async (_req, res) => {
  res.json({ url: upstoxProvider.authorizeUrl() });
}));

/** Step 2: Upstox redirects here with ?code&state. We exchange server-side. */
router.get('/upstox/callback', asyncH(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(html(false, `Upstox said: ${error}`));
  if (!code) return res.status(400).send(html(false, 'Missing authorization code.'));
  try {
    const out = await upstoxProvider.handleCallback(String(code), String(state));
    res.send(html(true, `Connected. Access token stored server-side; expires ${new Date(out.expiresAt).toLocaleString('en-IN')}. You can close this tab.`));
  } catch (e) {
    res.status(400).send(html(false, e.message));
  }
}));

const html = (ok, msg) => `<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;background:#0b1020;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:34rem">
  <div style="font-size:2.4rem">${ok ? '🟢' : '🔴'}</div>
  <h1 style="font-size:1.1rem">${ok ? 'Upstox market data connected' : 'Upstox connection failed'}</h1>
  <p style="color:#94a3b8;font-size:.85rem">${msg}</p>
</div></body>`;

export default router;
