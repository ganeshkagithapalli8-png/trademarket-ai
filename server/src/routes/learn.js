/**
 * The 14-module roadmap.
 *
 * Quiz answers and explanations are NEVER sent to the client — grading happens
 * server-side, so the correct answers cannot be read out of the network tab.
 */

import { Router } from 'express';
import { withUser } from '../db/index.js';
import { asyncH, requireAuth, badRequest, notFound, requireFields } from '../middleware.js';
import { ROADMAP, getModule, roadmapWithStatus, BOT_ARMABLE_MODULES } from '../services/roadmap.js';

const router = Router();
router.use(requireAuth);

const PASS_MARK = 2; // out of 3 — you must get two right to progress

/** Strip everything a client should not see. */
const publicModule = (m) => ({
  id: m.id,
  step: m.step,
  title: m.title,
  tagline: m.tagline,
  minutes: m.minutes,
  lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, body: l.body })),
  quiz: m.quiz.map((q, i) => ({ index: i, question: q.q, options: q.options })),
  passMark: PASS_MARK,
});

async function loadProgress(userId) {
  const { rows } = await withUser(userId, (c) =>
    c.query(`select * from learning_progress where user_id=$1`, [userId])
  );
  const map = {};
  for (const r of rows) map[r.module_id] = r;
  return map;
}

async function ensureRows(userId) {
  await withUser(userId, async (c) => {
    for (const m of ROADMAP) {
      await c.query(
        `insert into learning_progress (user_id, module_id, status)
         values ($1,$2,'locked') on conflict (user_id, module_id) do nothing`,
        [userId, m.id]
      );
    }
  });
}

router.get('/roadmap', asyncH(async (req, res) => {
  await ensureRows(req.userId);
  const progress = await loadProgress(req.userId);
  const modules = roadmapWithStatus(progress);
  const completed = modules.filter((m) => m.status === 'completed').length;

  res.json({
    modules: modules.map((m) => ({
      id: m.id,
      step: m.step,
      title: m.title,
      tagline: m.tagline,
      minutes: m.minutes,
      status: m.status,
      quizScore: m.quizScore,
      quizAttempts: m.quizAttempts,
      lessonsRead: m.lessonsRead,
      lessonCount: m.lessons.length,
      completedAt: m.completedAt,
    })),
    summary: {
      completed,
      total: ROADMAP.length,
      pct: Math.round((completed / ROADMAP.length) * 100),
      currentStep: modules.find((m) => m.status !== 'completed')?.step ?? ROADMAP.length,
      botArmable: BOT_ARMABLE_MODULES.every((id) => progress[id]?.status === 'completed'),
      botModulesDone: BOT_ARMABLE_MODULES.filter((id) => progress[id]?.status === 'completed').length,
      botModulesTotal: BOT_ARMABLE_MODULES.length,
    },
  });
}));

router.get('/module/:id', asyncH(async (req, res) => {
  const m = getModule(req.params.id);
  if (!m) throw notFound('Unknown module.');
  await ensureRows(req.userId);
  const progress = await loadProgress(req.userId);
  const [withStatus] = roadmapWithStatus(progress).filter((x) => x.id === m.id);

  res.json({
    module: publicModule(m),
    status: withStatus.status,
    lessonsRead: withStatus.lessonsRead,
    quizScore: withStatus.quizScore,
    quizAttempts: withStatus.quizAttempts,
    completedAt: withStatus.completedAt,
  });
}));

router.post('/module/:id/read', asyncH(async (req, res) => {
  requireFields(req.body, ['lessonId']);
  const m = getModule(req.params.id);
  if (!m) throw notFound('Unknown module.');
  const lesson = m.lessons.find((l) => l.id === req.body.lessonId);
  if (!lesson) throw notFound('Unknown lesson.');

  await ensureRows(req.userId);
  const { rows } = await withUser(req.userId, (c) =>
    c.query(
      `update learning_progress
          set lessons_read = array(select distinct unnest(lessons_read || $2::text[])),
              status = case when status in ('locked') then 'available'
                            when status = 'available' then 'in_progress'
                            else status end
        where user_id=$1 and module_id=$3 returning *`,
      [req.userId, [lesson.id], m.id]
    )
  );
  res.json({ progress: rows[0] });
}));

router.post('/module/:id/quiz', asyncH(async (req, res) => {
  requireFields(req.body, ['answers']);
  const m = getModule(req.params.id);
  if (!m) throw notFound('Unknown module.');
  if (!Array.isArray(req.body.answers) || req.body.answers.length !== m.quiz.length) {
    throw badRequest(`Submit exactly ${m.quiz.length} answers.`);
  }

  await ensureRows(req.userId);
  const progress = await loadProgress(req.userId);
  const [withStatus] = roadmapWithStatus(progress).filter((x) => x.id === m.id);
  if (withStatus.status === 'locked') {
    throw badRequest('Finish the earlier modules first — the path is sequential on purpose.');
  }

  // Grade server-side. Answers never left this process.
  const results = m.quiz.map((q, i) => {
    const given = Number(req.body.answers[i]);
    const correct = Number.isInteger(given) && given === q.answer;
    return { index: i, correct, yourAnswer: Number.isInteger(given) ? given : null, rightAnswer: q.answer, why: q.why };
  });
  const score = results.filter((r) => r.correct).length;
  const passed = score >= PASS_MARK;

  await withUser(req.userId, async (c) => {
    await c.query(
      `update learning_progress set quiz_attempts = quiz_attempts + 1, quiz_score = $2 where user_id=$1 and module_id=$3`,
      [req.userId, score, m.id]
    );

    if (passed) {
      await c.query(
        `update learning_progress
            set status='completed', completed_at=coalesce(completed_at, now()),
                lessons_read = $3::text[]
          where user_id=$1 and module_id=$2`,
        [req.userId, m.id, m.lessons.map((l) => l.id)]
      );
      // Unlock the next module.
      const next = ROADMAP.find((x) => x.step === m.step + 1);
      if (next) {
        await c.query(
          `update learning_progress set status='available' where user_id=$1 and module_id=$2 and status='locked'`,
          [req.userId, next.id]
        );
      }
    }
  });

  const after = await loadProgress(req.userId);
  const updated = roadmapWithStatus(after);

  res.json({
    score,
    total: m.quiz.length,
    passed,
    passMark: PASS_MARK,
    results,
    completedModules: updated.filter((x) => x.status === 'completed').length,
    totalModules: ROADMAP.length,
    botArmable: BOT_ARMABLE_MODULES.every((id) => after[id]?.status === 'completed'),
    message: passed
      ? m.step === 14
        ? 'You have finished the whole path. Note what module 14 actually says: this app has no live trading, and going live requires SEBI-registered broker infrastructure on your own account.'
        : `Module ${m.step} complete. Module ${m.step + 1} is now unlocked.`
      : `You need ${PASS_MARK} of ${m.quiz.length}. Read the explanations below and try again — the point is understanding, not passing.`,
  });
}));

router.post('/module/:id/reset', asyncH(async (req, res) => {
  const m = getModule(req.params.id);
  if (!m) throw notFound('Unknown module.');
  await withUser(req.userId, (c) =>
    c.query(
      `update learning_progress set status='available', quiz_score=null, quiz_attempts=0, lessons_read='{}', completed_at=null
        where user_id=$1 and module_id=$2`,
      [req.userId, m.id]
    )
  );
  res.json({ ok: true });
}));

export default router;
