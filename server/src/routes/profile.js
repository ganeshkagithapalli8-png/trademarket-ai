import { Router } from 'express';
import { config } from '../config.js';
import { withUser } from '../db/index.js';
import { asyncH, requireAuth, badRequest, toNumber, ageFromDob, requireFields, publicProfile } from '../middleware.js';
import { MARKETS } from '../services/instruments.js';
import { MARKET_GATES } from '../services/roadmap.js';

const router = Router();
router.use(requireAuth);

const VALID_MARKETS = Object.keys(MARKETS);

router.get(
  '/',
  asyncH(async (req, res) => {
    res.json({ profile: req.user });
  })
);

router.patch(
  '/',
  asyncH(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const push = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };

    if (b.fullName !== undefined) {
      const n = String(b.fullName).trim();
      if (n.length < 2 || n.length > 120) throw badRequest('Full name must be 2–120 characters.');
      push('full_name', n);
    }

    if (b.riskPerTrade !== undefined) {
      const v = toNumber(b.riskPerTrade);
      if (!(v >= 0.1 && v <= 5)) throw badRequest('Risk per trade must be between 0.1% and 5%.');
      push('risk_per_trade', v);
    }

    if (b.maxDailyLoss !== undefined) {
      const v = toNumber(b.maxDailyLoss);
      if (!(v >= 0.5 && v <= 20)) throw badRequest('Daily loss limit must be between 0.5% and 20%.');
      push('max_daily_loss', v);
    }

    if (b.maxOpenPositions !== undefined) {
      const v = Math.round(toNumber(b.maxOpenPositions));
      if (!(v >= 1 && v <= 10)) throw badRequest('Max open positions must be between 1 and 10.');
      push('max_open_positions', v);
    }

    if (b.marketsEnabled !== undefined) {
      if (!Array.isArray(b.marketsEnabled)) throw badRequest('marketsEnabled must be an array.');
      const clean = [...new Set(b.marketsEnabled.filter((m) => VALID_MARKETS.includes(m)))];
      if (!clean.length) throw badRequest('Select at least one market.');
      push('markets_enabled', clean);
    }

    if (b.onboarded !== undefined) push('onboarded', Boolean(b.onboarded));

    // Age re-verification. Never allows going below the legal minimum.
    if (b.dateOfBirth !== undefined) {
      requireFields(b, ['dateOfBirth']);
      const age = ageFromDob(String(b.dateOfBirth).trim());
      if (age === null) throw badRequest('Enter a valid date of birth (YYYY-MM-DD).');
      if (age < config.safety.minUserAge) {
        throw badRequest(`Date of birth implies age ${age}. The legal minimum for trading in India is ${config.safety.minUserAge}.`);
      }
      push('date_of_birth', String(b.dateOfBirth).trim());
      push('age_verified', true);
    }

    if (!sets.length) throw badRequest('Nothing to update.');
    vals.push(req.userId);

    const { rows } = await withUser(req.userId, (c) =>
      c.query(`update profiles set ${sets.join(', ')} where id = $${vals.length} returning *`, vals)
    );
    if (!rows[0]) throw badRequest('Could not update profile.');

    res.json({ profile: publicProfile(rows[0]) });
  })
);

/** Which markets this user may actually use, and what is blocking the others. */
router.get(
  '/market-access',
  asyncH(async (req, res) => {
    const { rows } = await withUser(req.userId, (c) =>
      c.query(
        `select module_id from learning_progress where user_id = $1 and status = 'completed'`,
        [req.userId]
      )
    );
    const completed = rows.map((r) => r.module_id);

    const access = VALID_MARKETS.map((id) => {
      const gates = MARKET_GATES[id] || [];
      const missing = gates.filter((g) => !completed.includes(g));
      const ageOk = req.user.ageVerified;
      return {
        id,
        label: MARKETS[id].label,
        blurb: MARKETS[id].blurb,
        accent: MARKETS[id].accent,
        enabled: req.user.marketsEnabled.includes(id),
        unlocked: missing.length === 0 && ageOk,
        missingModules: missing,
        needsAge: !ageOk,
        reason: missing.length
          ? `Complete the Risk Management module first. Derivatives and leveraged FX amplify losses as fast as gains.`
          : !ageOk
            ? 'Verify you are 18+ in Settings.'
            : null,
      };
    });

    res.json({ access, completedModules: completed.length });
  })
);

export default router;
