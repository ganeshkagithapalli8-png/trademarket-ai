/**
 * User-owned content: notes (the "items" CRUD), watchlist, journal.
 * Every query runs through withUser(), so RLS enforces ownership at the
 * database level as well as in the WHERE clause.
 */

import { Router } from 'express';
import { withUser } from '../db/index.js';
import { asyncH, requireAuth, badRequest, notFound, requireFields, toNumber } from '../middleware.js';
import { getInstrument } from '../services/instruments.js';
import { quote } from '../services/marketEngine.js';
import { generate, aiConfigured } from '../services/gemini.js';

const router = Router();

// Only guard this router's own paths so unmatched /api/* URLs fall through to
// the JSON 404 handler instead of being answered with a 401 from here.
const OWNED = /^\/(notes|watchlist|journal)(\/|$)/;
router.use((req, res, next) => (OWNED.test(req.path) ? requireAuth(req, res, next) : next()));

const str = (v, max, field) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  return s;
};

const tagList = (v) =>
  Array.isArray(v)
    ? [...new Set(v.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 8)
    : [];

// ══ NOTES (the "items" CRUD) ═══════════════════════════════════════════════

router.get('/notes', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from notes where user_id=$1 order by created_at desc limit 200`, [req.userId])
  );
  res.json({ notes: rows });
}));

router.get('/notes/:id', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from notes where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  if (!rows[0]) throw notFound('That note does not exist (or is not yours).');
  res.json({ note: rows[0] });
}));

router.post('/notes', asyncH(async (req, res) => {
  requireFields(req.body, ['title']);
  const title = str(req.body.title, 160, 'Title');
  if (!title) throw badRequest('Title cannot be empty.');
  const description = str(req.body.description, 20000, 'Description') || '';

  let aiSummary = null;
  if (req.body.generateSummary && aiConfigured() && description.length > 40) {
    try {
      const r = await generate({ mode: 'summarize', prompt: `Summarise this trading note: ${title}`, context: description });
      aiSummary = r.text;
    } catch (err) {
      // A failing AI call must never block saving the user's own data.
      console.error('[notes] summary failed:', err.message);
    }
  }

  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `insert into notes (user_id, title, description, ai_summary, tags)
       values ($1,$2,$3,$4,$5) returning *`,
      [req.userId, title, description, aiSummary, tagList(req.body.tags)]
    )
  );
  res.status(201).json({ note: rows[0] });
}));

router.patch('/notes/:id', asyncH(async (req, res) => {
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (req.body.title !== undefined) {
    const t = str(req.body.title, 160, 'Title');
    if (!t) throw badRequest('Title cannot be empty.');
    push('title', t);
  }
  if (req.body.description !== undefined) push('description', str(req.body.description, 20000, 'Description') || '');
  if (req.body.aiSummary !== undefined) push('ai_summary', str(req.body.aiSummary, 20000, 'Summary'));
  if (req.body.tags !== undefined) push('tags', tagList(req.body.tags));
  if (!sets.length) throw badRequest('Nothing to update.');

  vals.push(req.params.id, req.userId);
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`update notes set ${sets.join(', ')} where id=$${vals.length - 1} and user_id=$${vals.length} returning *`, vals)
  );
  if (!rows[0]) throw notFound('That note does not exist (or is not yours).');
  res.json({ note: rows[0] });
}));

router.delete('/notes/:id', asyncH(async (req, res) => {
  const { rowCount } = await withUser(req.userId, (c) =>
    c.query(`delete from notes where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  if (!rowCount) throw notFound('That note does not exist (or is not yours).');
  res.json({ ok: true });
}));

router.post('/notes/:id/summarize', asyncH(async (req, res) => {
  if (!aiConfigured()) throw badRequest('Gemini is not configured yet. Add GEMINI_API_KEY to server/.env.');
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from notes where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  const note = rows[0];
  if (!note) throw notFound('That note does not exist (or is not yours).');
  if (!note.description || note.description.length < 20) throw badRequest('Add more detail to the note before summarising.');

  const r = await generate({
    mode: 'summarize',
    prompt: `Summarise this trading note so a beginner retains the essentials: ${note.title}`,
    context: note.description,
  });
  const { rows: upd } = await withUser(req.userId, (c) =>
    c.query(`update notes set ai_summary=$1 where id=$2 and user_id=$3 returning *`, [r.text, note.id, req.userId])
  );
  res.json({ note: upd[0], model: r.model });
}));

// ══ WATCHLIST ══════════════════════════════════════════════════════════════

router.get('/watchlist', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from watchlist where user_id=$1 order by created_at desc`, [req.userId])
  );
  res.json({
    watchlist: rows.map((r) => {
      const q = quote(r.symbol);
      return { ...r, quote: q };
    }),
  });
}));

router.post('/watchlist', asyncH(async (req, res) => {
  requireFields(req.body, ['symbol']);
  const symbol = String(req.body.symbol).toUpperCase().trim();
  const inst = getInstrument(symbol);
  if (!inst) throw notFound(`Unknown instrument "${symbol}".`);

  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `insert into watchlist (user_id, symbol, note) values ($1,$2,$3)
       on conflict (user_id, symbol) do update set note = coalesce($3, watchlist.note)
       returning *`,
      [req.userId, symbol, str(req.body.note, 300, 'Note')]
    )
  );
  res.status(201).json({ item: rows[0], quote: quote(symbol) });
}));

router.patch('/watchlist/:id', asyncH(async (req, res) => {
  const note = str(req.body.note, 300, 'Note');
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`update watchlist set note=$1 where id=$2 and user_id=$3 returning *`, [note, req.params.id, req.userId])
  );
  if (!rows[0]) throw notFound('That watchlist item does not exist (or is not yours).');
  res.json({ item: rows[0] });
}));

router.delete('/watchlist/:id', asyncH(async (req, res) => {
  const { rowCount } = await withUser(req.userId, (c) =>
    c.query(`delete from watchlist where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  if (!rowCount) throw notFound('That watchlist item does not exist (or is not yours).');
  res.json({ ok: true });
}));

// ══ JOURNAL ════════════════════════════════════════════════════════════════

const EMOTIONS = ['calm', 'fear', 'greed', 'anger', 'hope', 'neutral'];

router.get('/journal', asyncH(async (req, res) => {
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from journal where user_id=$1 order by created_at desc limit 200`, [req.userId])
  );
  res.json({ entries: rows });
}));

router.post('/journal', asyncH(async (req, res) => {
  requireFields(req.body, ['body']);
  const body = str(req.body.body, 20000, 'Entry');
  if (!body || body.length < 10) throw badRequest('Write at least a sentence or two — a one-word journal entry cannot teach you anything.');

  let emotion = 'neutral';
  if (req.body.emotion !== undefined && req.body.emotion !== null) {
    if (!EMOTIONS.includes(req.body.emotion)) {
      throw badRequest(`emotion must be one of: ${EMOTIONS.join(', ')}.`);
    }
    emotion = req.body.emotion;
  }
  const rating = req.body.rating != null ? Math.min(5, Math.max(1, Math.round(toNumber(req.body.rating, 3)))) : null;
  const followedPlan = req.body.followedPlan == null ? null : Boolean(req.body.followedPlan);
  const symbol = req.body.symbol ? String(req.body.symbol).toUpperCase().trim() : null;
  if (symbol && !getInstrument(symbol)) throw notFound(`Unknown instrument "${symbol}".`);

  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `insert into journal (user_id, symbol, side, emotion, followed_plan, rating, body)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.userId, symbol, ['long', 'short', null].includes(req.body.side) ? req.body.side : null,
       emotion, followedPlan, rating, body]
    )
  );

  // Opportunistic AI feedback — never blocks the write.
  if (aiConfigured() && req.body.aiFeedback !== false) {
    try {
      const r = await generate({
        mode: 'journal',
        prompt: 'Coach this paper-trading journal entry.',
        context: `Emotion: ${emotion}\nFollowed plan: ${followedPlan}\nSelf rating: ${rating ?? 'n/a'}\nSymbol: ${symbol ?? 'n/a'}\n\n${body}`,
      });
      const upd = await withUser(req.userId, (c) =>
        c.query(`update journal set ai_feedback=$1 where id=$2 and user_id=$3 returning *`, [r.text, rows[0].id, req.userId])
      );
      return res.status(201).json({ entry: upd[0], aiModel: r.model });
    } catch (err) {
      console.error('[journal] ai feedback failed:', err.message);
    }
  }
  res.status(201).json({ entry: rows[0] });
}));

router.patch('/journal/:id', asyncH(async (req, res) => {
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (req.body.body !== undefined) {
    const b = str(req.body.body, 20000, 'Entry');
    if (!b || b.length < 10) throw badRequest('Entry is too short.');
    push('body', b);
  }
  if (req.body.emotion !== undefined) {
    if (!EMOTIONS.includes(req.body.emotion)) throw badRequest(`emotion must be one of: ${EMOTIONS.join(', ')}.`);
    push('emotion', req.body.emotion);
  }
  if (req.body.rating !== undefined) push('rating', req.body.rating == null ? null : Math.min(5, Math.max(1, Math.round(toNumber(req.body.rating, 3)))));
  if (req.body.followedPlan !== undefined) push('followed_plan', req.body.followedPlan == null ? null : Boolean(req.body.followedPlan));
  if (req.body.symbol !== undefined) push('symbol', req.body.symbol ? String(req.body.symbol).toUpperCase().trim() : null);
  if (!sets.length) throw badRequest('Nothing to update.');

  vals.push(req.params.id, req.userId);
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`update journal set ${sets.join(', ')} where id=$${vals.length - 1} and user_id=$${vals.length} returning *`, vals)
  );
  if (!rows[0]) throw notFound('That journal entry does not exist (or is not yours).');
  res.json({ entry: rows[0] });
}));

router.delete('/journal/:id', asyncH(async (req, res) => {
  const { rowCount } = await withUser(req.userId, (c) =>
    c.query(`delete from journal where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  if (!rowCount) throw notFound('That journal entry does not exist (or is not yours).');
  res.json({ ok: true });
}));

router.post('/journal/:id/feedback', asyncH(async (req, res) => {
  if (!aiConfigured()) throw badRequest('Gemini is not configured yet. Add GEMINI_API_KEY to server/.env.');
  const { rows } = await withUser(req.userId, (c) =>
    c.query(`select * from journal where id=$1 and user_id=$2`, [req.params.id, req.userId])
  );
  const e = rows[0];
  if (!e) throw notFound('That journal entry does not exist (or is not yours).');

  const r = await generate({
    mode: 'journal',
    prompt: 'Coach this paper-trading journal entry.',
    context: `Emotion: ${e.emotion}\nFollowed plan: ${e.followed_plan}\nSelf rating: ${e.rating ?? 'n/a'}\nSymbol: ${e.symbol ?? 'n/a'}\n\n${e.body}`,
  });
  const upd = await withUser(req.userId, (c) =>
    c.query(`update journal set ai_feedback=$1 where id=$2 and user_id=$3 returning *`, [r.text, e.id, req.userId])
  );
  res.json({ entry: upd[0], model: r.model });
}));

export default router;
