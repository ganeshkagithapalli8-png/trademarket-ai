/**
 * Zerodha Kite Connect REST client — LIVE order routing through the USER'S
 * OWN broker account. The app never touches money: funds stay at Zerodha
 * (SEBI-registered); we only send the user's confirmed orders and read back
 * their positions/margins/order book.
 *
 * Free "Personal" Kite plan covers everything used here (orders, portfolio,
 * margins, order book). Market orders MUST carry market protection or the
 * broker rejects them — we always send a 0.5% protection slice.
 *
 * Access tokens are daily (~6am IST expiry); the user re-logins each trading
 * day through the official Kite login page. Tokens are stored AES-256-GCM
 * encrypted, server-side only.
 */
import crypto from 'node:crypto';
import { config } from '../../config.js';

const API = 'https://api.kite.trade';
const KITE_VERSION = '3';

export const zerodha = {
  get configured() { return Boolean(config.zerodha.apiKey && config.zerodha.apiSecret); },

  /** Official Kite login page for the daily request-token flow. */
  loginUrl() {
    return `https://kite.trade/connect/login?v=3&api_key=${encodeURIComponent(config.zerodha.apiKey)}`;
  },

  /** Exchange a request_token for a daily session (access token). */
  async exchangeSession(requestToken) {
    const checksum = crypto
      .createHash('sha256')
      .update(config.zerodha.apiKey + requestToken + config.zerodha.apiSecret)
      .digest('hex');
    const r = await fetch(`${API}/session/token`, {
      method: 'POST',
      headers: {
        'X-Kite-Version': KITE_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Kite-Checksum': checksum,
      },
      body: new URLSearchParams({
        api_key: config.zerodha.apiKey,
        request_token: requestToken,
        checksum,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.data?.access_token) {
      throw new Error(j?.message || `Kite session exchange failed (${r.status})`);
    }
    return {
      accessToken: j.data.access_token,
      userId: j.data.user_id || null,
      // Kite sessions expire at ~6:00am IST the next day
      expiresAt: nextSixAmIST(),
    };
  },

  /** Authenticated Kite REST call. `accessToken` is the plaintext daily token. */
  async call(accessToken, method, path, body) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        'X-Kite-Version': KITE_VERSION,
        Authorization: `token ${config.zerodha.apiKey}:${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || `Kite ${method} ${path} failed (${r.status})`);
    return j.data;
  },

  placeOrder(accessToken, o) {
    return this.call(accessToken, 'POST', '/orders/regular', o);
  },
  cancelOrder(accessToken, orderId) {
    return this.call(accessToken, 'DELETE', `/orders/regular/${encodeURIComponent(orderId)}`);
  },
  orderBook(accessToken) {
    return this.call(accessToken, 'GET', '/orders');
  },
  positions(accessToken) {
    return this.call(accessToken, 'GET', '/portfolio/positions');
  },
  holdings(accessToken) {
    return this.call(accessToken, 'GET', '/portfolio/holdings');
  },
  margins(accessToken) {
    return this.call(accessToken, 'GET', '/user/margins');
  },
  invalidate(accessToken) {
    return this.call(accessToken, 'DELETE', '/session/token').catch(() => null);
  },
};

/** Next 06:00 Asia/Kolkata as an ISO string (Kite's daily token expiry). */
export function nextSixAmIST(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(6, 0, 0, 0);
  if (ist.getTime() <= now.getTime() + 5.5 * 3600_000) ist.setUTCDate(ist.getUTCDate() + 1);
  return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
}

/* ── token encryption at rest (server-side only) ─────────────────────── */
const KEK = crypto.createHash('sha256').update(`${config.jwt?.secret || 'tm'}:live-kek`).digest();

export function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEK, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { ct: enc.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

export function decryptToken({ ct, iv, tag }) {
  const d = crypto.createDecipheriv('aes-256-gcm', KEK, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
