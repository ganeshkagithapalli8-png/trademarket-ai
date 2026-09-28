import { Router } from 'express';
import crypto from 'node:crypto';
import { ROADMAP } from '../services/roadmap.js';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { admin, withUser } from '../db/index.js';
import {
  asyncH, badRequest, conflict, requireAuth, unauthorized, requireFields,
  validEmail, passwordIssues, ageFromDob, issueSession, publicProfile,
  cookieOpts, COOKIE_NAME, HttpError, authLimiter, demoLimiter,
} from '../middleware.js';

const router = Router();
const STARTING_SIM_BALANCE = 0; // user must add simulated funds themselves (min ₹50)

function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || 'Unknown');
  const short = ua.length > 90 ? ua.slice(0, 90) + '…' : ua;
  return short;
}

async function attachSession(res, req, user) {
  const s = issueSession(user, { deviceLabel: deviceLabel(req), ip: req.ip });
  await admin((c) =>
    c.query(
      `insert into sessions (user_id, jti, device_label, ip, expires_at)
       values ($1,$2,$3,$4,$5)`,
      [user.id, s.jti, s.deviceLabel, s.ip, s.expiresAt]
    )
  );
  res.cookie(COOKIE_NAME, s.token, cookieOpts());
  return s.token;
}

// ── signup ──────────────────────────────────────────────────────────────────

router.post(
  '/signup',
  authLimiter,
  asyncH(async (req, res) => {
    requireFields(req.body, ['email', 'password', 'fullName', 'dateOfBirth']);

    const email = String(req.body.email).trim().toLowerCase();
    const fullName = String(req.body.fullName).trim().slice(0, 120);
    const password = String(req.body.password);
    const dob = String(req.body.dateOfBirth).trim();

    if (!validEmail(email)) throw badRequest('Enter a valid email address.');
    const pwIssues = passwordIssues(password);
    if (pwIssues.length) throw badRequest(`Password needs ${pwIssues.join(', ')}.`);
    if (fullName.length < 2) throw badRequest('Enter your full name.');

    const age = ageFromDob(dob);
    if (age === null) throw badRequest('Enter a valid date of birth (YYYY-MM-DD).');
    if (age > 120) throw badRequest('Enter a valid date of birth.');
    if (age < config.safety.minUserAge) {
      throw new HttpError(
        403,
        `TradeMarket AI is for users ${config.safety.minUserAge} and over. In India a trading or demat account legally requires you to be 18+, and contracts with minors are void — so this cannot be lowered.`,
        { code: 'UNDERAGE', minimumAge: config.safety.minUserAge, yourAge: age }
      );
    }

    const hash = await bcrypt.hash(password, config.bcryptRounds);

    const existing = await admin((c) => c.query('select id from profiles where email = $1', [email]));
    if (existing.rowCount > 0) throw conflict('An account with that email already exists. Try signing in.');

    const user = await admin(async (c) => {
      const { rows } = await c.query(
        `insert into profiles (email, full_name, password_hash, date_of_birth, age_verified, onboarded)
         values ($1,$2,$3,$4,true,false) returning *`,
        [email, fullName, hash, dob]
      );
      await c.query(
        `insert into wallets (user_id, sim_balance) values ($1, $2) on conflict (user_id) do nothing`,
        [rows[0].id, STARTING_SIM_BALANCE]
      );
      await c.query(
        `insert into bot_state (user_id) values ($1) on conflict (user_id) do nothing`,
        [rows[0].id]
      );
      return rows[0];
    });

    const token = await attachSession(res, req, user);
    res.status(201).json({
      token,
      user: publicProfile(user),
      notice:
        'Wallet is SIMULATED Indian rupees. No real money is held, moved or traded by this application.',
    });
  })
);

// ── one-click demo account ────────────────────────────────────────────────
// A funded, fully-unlocked PAPER account so anyone can touch a working app
// in two clicks. Simulated rupees only, exactly like every other account;
// rate-limited like the rest of auth. Nothing here can hold real money.
// No per-route limiter here: guest creation is cheap (no bcrypt) and the global
// apiLimiter already floods-guards /api. A dedicated quota turned reload storms
// into "app won't open" walls for real users.
router.post(
  '/demo',
  asyncH(async (req, res) => {
    const email = `demo.${Date.now()}@paper.trademarket`;
    // Guest accounts are session-only and must never password-login, so skip the
    // bcrypt work entirely: this placeholder can never verify (cheap guest creation
    // also keeps the guest quota from costing CPU under reload storms).
    const hash = '$2b$10$' + '.'.repeat(53); // valid shape, never verifies

    const user = await admin(async (c) => {
      const { rows } = await c.query(
        `insert into profiles (email, full_name, password_hash, date_of_birth, age_verified, onboarded)
         values ($1,$2,$3,$4,true,true) returning *`,
        [email, 'Demo Trader', hash, '1994-04-12']
      );
      const id = rows[0].id;
      await c.query(
        `insert into wallets (user_id, sim_balance) values ($1, 500000) on conflict (user_id) do nothing`,
        [id]
      );
      await c.query(`insert into bot_state (user_id) values ($1) on conflict (user_id) do nothing`, [id]);
      // Curriculum complete, so derivatives and the bot-arming gate are open
      // for exploration. Module 14 stays what it is: knowledge, not a licence.
      for (const m of ROADMAP) {
        await c.query(
          `insert into learning_progress (user_id, module_id, status, lessons_read, quiz_score, quiz_attempts, completed_at)
           values ($1,$2,'completed',$3::text[],100,1,now())
           on conflict (user_id, module_id) do nothing`,
          [id, m.id, m.lessons.map((l) => l.id)]
        );
      }
      await c.query(
        `insert into watchlist (user_id, symbol, note) values
           ($1,'RELIANCE','Large-cap bellwether'),
           ($1,'TCS','Watch for IT rotation into results'),
           ($1,'INFY','IT pair-trade vs TCS'),
           ($1,'HDFCBANK','Bank NIFTY heavyweight'),
           ($1,'AAPL','US major (paper venue, USD)'),
           ($1,'NVDA','US major (paper venue, USD)'),
           ($1,'BTCINR','Live crypto reference pair'),
           ($1,'USDINR','FX reference — ECB daily')
         on conflict (user_id, symbol) do nothing`,
        [id]
      );
      return rows[0];
    });

    const token = await attachSession(res, req, user);
    res.status(201).json({
      token,
      user: publicProfile(user),
      demo: true,
      notice: 'Demo account: ₹5,00,000 of simulated cash and the full curriculum unlocked. No real money exists in this application.',
    });
  })
);

// ── login ───────────────────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  asyncH(async (req, res) => {
    requireFields(req.body, ['email', 'password']);
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);

    // Admin pool on purpose: an unauthenticated caller has no app.user_id yet.
    const { rows } = await admin((c) => c.query('select * from profiles where email = $1', [email]));
    const user = rows[0];

    // Compare against a dummy hash when the user is missing so response time
    // does not reveal whether an email is registered.
    const hash = user?.password_hash || '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1uQ0t4zJ8vKq5nQ0p0h0y0y0y0y0y0y';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw unauthorized('Incorrect email or password.');

    const token = await attachSession(res, req, user);
    res.json({ token, user: publicProfile(user) });
  })
);

// ── session ─────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, asyncH(async (req, res) => {
  const wallet = await withUser(req.userId, (c) => c.query('select sim_balance from wallets where user_id = $1', [req.userId]));
  res.json({
    user: req.user,
    wallet: { simBalance: Number(wallet.rows[0]?.sim_balance ?? 0) },
  });
}));

router.post('/logout', requireAuth, asyncH(async (req, res) => {
  const { allDevices } = req.body || {};
  // Revoke the specific jti from this token, or every session on request.
  await withUser(req.userId, (c) =>
    allDevices || !req.tokenPayload?.jti
      ? c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [req.userId])
      : c.query('update sessions set revoked_at = now() where jti = $1 and user_id = $2', [req.tokenPayload.jti, req.userId])
  );
  res.clearCookie(COOKIE_NAME, cookieOpts());
  res.json({ ok: true, allDevices: Boolean(allDevices) });
}));

router.get('/sessions', requireAuth, asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `select id, device_label, ip, created_at, expires_at, revoked_at
         from sessions where user_id = $1 order by created_at desc limit 25`,
      [req.userId]
    )
  );
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      device: r.device_label,
      ip: r.ip,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      active: !r.revoked_at && new Date(r.expires_at) > new Date(),
    })),
  });
}));

router.delete('/sessions/:id', requireAuth, asyncH(async (req, res) => {
  const { rowCount } = await withUser(req.userId, (c) =>
    c.query('update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null', [req.params.id, req.userId])
  );
  if (!rowCount) throw new HttpError(404, 'That session is not active.');
  res.json({ ok: true });
}));

router.post(
  '/password',
  requireAuth,
  authLimiter,
  asyncH(async (req, res) => {
    requireFields(req.body, ['currentPassword', 'newPassword']);
    const user = await admin((c) => c.query('select password_hash from profiles where id = $1', [req.userId]));
    const ok = await bcrypt.compare(String(req.body.currentPassword), user.rows[0]?.password_hash || '');
    if (!ok) throw unauthorized('Current password is incorrect.');

    const issues = passwordIssues(String(req.body.newPassword));
    if (issues.length) throw badRequest(`New password needs ${issues.join(', ')}.`);

    const hash = await bcrypt.hash(String(req.body.newPassword), config.bcryptRounds);
    await admin((c) => c.query('update profiles set password_hash = $1 where id = $2', [hash, req.userId]));
    // Changing a password signs every other device out — standard behaviour.
    await admin((c) => c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [req.userId]));
    res.json({ ok: true, message: 'Password updated. All other devices have been signed out.' });
  })
);

export default router;
