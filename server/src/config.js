import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
// Load server/.env by absolute path — `import 'dotenv/config'` resolves against
// process.cwd(), which silently misses the file when the API is started from the repo root.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: num(process.env.PORT, 5000),
  clientUrls: list(process.env.CLIENT_URL).concat(
    process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']
  ),

  jwt: {
    secret: process.env.JWT_SECRET || '',
    // Sessions are effectively permanent: no expiry popups, no kick-outs.
    expiresIn: process.env.JWT_EXPIRES_IN || '10y',
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    dbUrl: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '',
    accessToken: process.env.SUPABASE_ACCESS_TOKEN || '',
    projectRef: process.env.SUPABASE_PROJECT_REF || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  market: {
    liveCrypto: bool(process.env.LIVE_CRYPTO, true),
    liveForex: bool(process.env.LIVE_FOREX, true),
    kiteApiKey: process.env.KITE_API_KEY || '',
    kiteApiSecret: process.env.KITE_API_SECRET || '',
    kiteAccessToken: process.env.KITE_ACCESS_TOKEN || '',
  },

  upstox: {
    clientId: process.env.UPSTOX_CLIENT_ID || '',
    clientSecret: process.env.UPSTOX_CLIENT_SECRET || '',
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
    redirectUri: process.env.UPSTOX_REDIRECT_URI || 'http://localhost:5000/api/provider/upstox/callback',
    apiBase: process.env.UPSTOX_API_BASE || 'https://api.upstox.com', // test override only
    feedWs: process.env.UPSTOX_FEED_WS || '', // test-only WS override (SDK hardcodes the prod feed URL)
    pollMs: Number(process.env.UPSTOX_POLL_MS || 30_000), // keyless public-feed cadence; 1-min candles need no faster poll and this respects Upstox's per-IP budget
  },
  finnhub: {
    apiKey: process.env.FINNHUB_API_KEY || '',   // server-side only — never shipped to the client
    pollMs: Number(process.env.FINNHUB_POLL_MS || 10_000),
  },
  safety: {
    // Hard rail. There is no order-routing code in this repository at all.
    paperTradingOnly: bool(process.env.PAPER_TRADING_ONLY, true),
    minSimDeposit: num(process.env.MIN_SIM_DEPOSIT_INR, 50),
    maxSimDeposit: num(process.env.MAX_SIM_DEPOSIT_INR, 1_000_000),
    minUserAge: num(process.env.MIN_USER_AGE, 18),
  },

  get hasDb() {
    return Boolean(this.supabase.dbUrl || (this.supabase.accessToken && this.supabase.projectRef));
  },
  get hasGemini() {
    return Boolean(this.gemini.apiKey);
  },
};

export default config;
