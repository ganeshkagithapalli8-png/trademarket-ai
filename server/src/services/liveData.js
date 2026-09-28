/**
 * Optional live market data. READ-ONLY.
 *
 * Two adapters, both strictly quote-only:
 *   • CoinGecko — free, no key, real crypto prices in INR.
 *   • Kite Connect — only if the user supplies their OWN broker API credentials.
 *
 * Neither adapter can place, modify or cancel an order. There is no order
 * routing anywhere in this codebase. Anything they return is used only to make
 * the simulator's displayed prices closer to reality; fills are still paper.
 */

import { config } from '../config.js';
import { setLiveOverlay } from './marketEngine.js';
import { INSTRUMENTS } from './instruments.js';

const overlay = new Map();
let lastRun = { at: null, crypto: null, kite: null, errors: [] };

const COINGECKO_IDS = [...new Set(INSTRUMENTS.filter((i) => i.live && i.coin).map((i) => i.coin))];

async function refreshCrypto() {
  if (!config.market.liveCrypto || COINGECKO_IDS.length === 0) return;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_IDS.join(',')}&vs_currencies=inr&include_24hr_change=true`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'TradeMarketAI/1.0 (educational simulator)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();

  for (const inst of INSTRUMENTS) {
    if (!inst.live || !inst.coin) continue;
    const price = data?.[inst.coin]?.inr;
    if (typeof price === 'number' && price > 0) {
      overlay.set(inst.symbol, { price, at: Date.now(), change24h: data[inst.coin].inr_24h_change ?? null, source: 'coingecko' });
    }
  }
  lastRun.crypto = { at: new Date().toISOString(), pairs: overlay.size };
}

/**
 * Kite Connect quote endpoint — read-only.
 * Requires the user's own api_key AND a same-day access_token obtained through
 * their broker's OAuth flow. Disabled unless both are present.
 */
async function refreshKite() {
  const { kiteApiKey, kiteAccessToken } = config.market;
  if (!kiteApiKey || !kiteAccessToken) return;

  const wanted = INSTRUMENTS.filter((i) => i.market === 'stocks' && !i.index).slice(0, 20).map((i) => `NSE:${i.symbol}`);
  if (!wanted.length) return;

  const url = `https://api.kite.trade/quote?i=${wanted.map(encodeURIComponent).join('&i=')}`;
  const res = await fetch(url, {
    headers: {
      'X-Kite-Version': '3',
      Authorization: `token ${kiteApiKey}:${kiteAccessToken}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Kite HTTP ${res.status} (access tokens expire daily)`);
  const json = await res.json();
  const data = json?.data || {};

  for (const [key, q] of Object.entries(data)) {
    const symbol = key.split(':')[1];
    const price = q?.last_price;
    if (typeof price === 'number' && price > 0) {
      overlay.set(symbol, { price, at: Date.now(), source: 'kite' });
    }
  }
  lastRun.kite = { at: new Date().toISOString(), symbols: Object.keys(data).length };
}

export async function refreshLiveOnce() {
  const errors = [];
  await refreshCrypto().catch((e) => errors.push(`crypto: ${e.message}`));
  await refreshKite().catch((e) => errors.push(`kite: ${e.message}`));

  // Drop anything stale so the simulator falls back cleanly.
  const cutoff = Date.now() - 120_000;
  for (const [k, v] of overlay) if (v.at < cutoff) overlay.delete(k);

  setLiveOverlay(Object.fromEntries(overlay));
  lastRun = { ...lastRun, at: new Date().toISOString(), errors };
  return lastRun;
}

export function startLiveData(intervalMs = 60_000) {
  refreshLiveOnce().catch(() => {});
  const t = setInterval(() => refreshLiveOnce().catch(() => {}), intervalMs);
  t.unref?.();
  return t;
}

export const liveStatus = () => ({
  enabled: { crypto: config.market.liveCrypto, kite: Boolean(config.market.kiteApiKey && config.market.kiteAccessToken) },
  pairs: overlay.size,
  lastRun,
  note: 'Quote adapters are read-only. No broker order-routing exists in this application.',
});
