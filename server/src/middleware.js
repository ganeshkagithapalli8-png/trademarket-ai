import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { withUser, newJti } from './db/index.js';

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Sign in to continue.') => new HttpError(401, m);
export const forbidden = (m) => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

// ── token helpers ───────────────────────────────────────────────────────────

export function signToken(user, jti) {
  return jwt.sign({ sub: user.id, email: user.email, jti }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'trademarket-ai',
  });
}

export function issueSession(user, { deviceLabel, ip } = {}) {
  const jti = newJti();
  const token = signToken(user, jti);
  const expiresAt = new Date(Date.now() + parseExpiry(config.jwt.expiresIn));
  return { jti, token, expiresAt, deviceLabel: deviceLabel || 'Unknown device', ip: ip || null };
}

function parseExpiry(s) {
  const m = String(s).match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

export const cookieOpts = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'none' : 'lax', // cross-origin (Vercel → Render) needs none+secure
  maxAge: parseExpiry(config.jwt.expiresIn),
  path: '/',
});

const COOKIE_NAME = 'tm_token';
export { COOKIE_NAME };

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  return null;
}

/**
 * Verify the JWT, confirm the session is still live, then load the profile
 * through the RLS-pinned app connection — so even a forged-but-valid-signature
 * token cannot read someone else's row.
 */
async function resolveUser(req) {
  const token = extractToken(req);
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { issuer: 'trademarket-ai' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw unauthorized('Session expired. Please sign in again.');
    return null;
  }

  const rows = await withUser(payload.sub, async (c) => {
    const s = await c.query(
      `select 1 from sessions where jti = $1 and revoked_at is null and expires_at > now()`,
      [payload.jti]
    );
    if (s.rowCount === 0) return null;
    const p = await c.query(`select * from profiles where id = $1`, [payload.sub]);
    return p.rows[0] || null;
  });

  if (!rows) throw unauthorized('Session is no longer active. Please sign in again.');
  return { profile: rows, payload };
}

function attach(req, resolved) {
  req.user = publicProfile(resolved.profile);
  req.userId = resolved.profile.id;
  req.rawProfile = resolved.profile;
  req.tokenPayload = resolved.payload;
}

export const requireAuth = asyncH(async (req, _res, next) => {
  const resolved = await resolveUser(req);
  if (!resolved) return next(unauthorized());
  attach(req, resolved);
  next();
});

export const optionalAuth = asyncH(async (req, _res, next) => {
  try {
    const resolved = await resolveUser(req);
    if (resolved) attach(req, resolved);
  } catch {
    /* anonymous is fine here */
  }
  next();
});

/** Gate for anything that could be mistaken for real trading: F&O, forex, bot arming. */
export const requireAgeVerified = (req, _res, next) => {
  if (!req.user?.ageVerified) {
    return next(forbidden('Age verification (18+) is required for this market. Add your date of birth in Settings.'));
  }
  next();
};

export function publicProfile(p) {
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name || '',
    dateOfBirth: p.date_of_birth ? new Date(p.date_of_birth).toISOString().slice(0, 10) : null,
    ageVerified: !!p.age_verified,
    riskPerTrade: Number(p.risk_per_trade),
    maxDailyLoss: Number(p.max_daily_loss),
    maxOpenPositions: Number(p.max_open_positions),
    marketsEnabled: p.markets_enabled || ['stocks'],
    botArmed: !!p.bot_armed,
    onboarded: !!p.onboarded,
    createdAt: p.created_at,
  };
}

// ── validation ──────────────────────────────────────────────────────────────

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw badRequest(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
}

export function validEmail(e) {
  return typeof e === 'string' && EMAIL_RE.test(e.trim()) && e.trim().length <= 254;
}

export function passwordIssues(pw) {
  const issues = [];
  if (typeof pw !== 'string') return ['Password must be a string.'];
  if (pw.length < 8) issues.push('at least 8 characters');
  if (pw.length > 128) issues.push('at most 128 characters');
  if (!/[a-zA-Z]/.test(pw)) issues.push('at least one letter');
  if (!/[0-9]/.test(pw)) issues.push('at least one number');
  return issues;
}

export function ageFromDob(dob) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function toNumber(v, fallback = NaN) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── rate limiting ───────────────────────────────────────────────────────────

const key = (req) => req.userId || req.ip || 'anonymous';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Guest/demo entry is the app's front door now (zero-click), so it gets a
// generous limiter of its own; credential routes keep the strict one.
export const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many guest sessions from this network. Sign in with an email account, or wait a few minutes.' },
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: key,
  message: { error: 'AI rate limit reached (8 requests/minute). Please slow down.' },
});

export const tradeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: key,
  message: { error: 'Too many order requests. Please slow down.' },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isProd ? 400 : 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: key,
  message: { error: 'Rate limit reached. Please slow down.' },
});

// ── error handling ──────────────────────────────────────────────────────────

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `No API route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl} →`, err);

  // Never leak Postgres internals.
  let message = err.message || 'Something went wrong.';
  if (err.code && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    if (err.code === '23505') {
      message = 'That record already exists.';
      return res.status(409).json({ error: message });
    }
    if (err.code === '23503') message = 'Referenced record does not exist.';
    else if (err.code === '23514') message = 'A value was outside its allowed range.';
    else if (err.code === '22P02') message = 'A value had the wrong type.';
    else message = 'Database rejected the request.';
    return res.status(400).json({ error: message });
  }

  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
}
