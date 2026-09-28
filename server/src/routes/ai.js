/**
 * Gemini, reachable ONLY through this backend route.
 * The API key lives in server/.env and is never serialised into any response.
 */

import { Router } from 'express';
import { withUser } from '../db/index.js';
import { asyncH, requireAuth, badRequest, aiLimiter, toNumber } from '../middleware.js';
import { generate, aiModes, aiConfigured } from '../services/gemini.js';
import { getNews } from '../services/news.js';
import { tickers, quote } from '../services/marketEngine.js';
import { getBotLearning } from '../services/botRunner.js';
import { analyse, candlePatterns } from '../services/indicators.js';
import { candles } from '../services/marketEngine.js';
import { getInstrument } from '../services/instruments.js';
import { roadmapWithStatus } from '../services/roadmap.js';

const router = Router();
router.use(requireAuth);

const DISCLAIMER =
  '\n\n---\n_Educational content about a paper-trading simulator. Simulated prices, simulated money. Not investment advice, not a solicitation, and no real order was or will be placed._';

router.get('/modes', (_req, res) => {
  res.json({ modes: aiModes(), configured: aiConfigured() });
});

router.get('/status', (_req, res) => {
  res.json({
    configured: aiConfigured(),
    backendOnly: true,
    note: aiConfigured()
      ? 'Gemini is wired up on the server. Your browser never talks to Google directly.'
      : 'Add GEMINI_API_KEY to server/.env and restart the API to enable the AI tutor.',
  });
});

/**
 * POST /api/ai/generate
 * { mode, prompt, context?, refs? }
 *
 * `refs` lets the server build context from the user's OWN data, so the client
 * never has to paste private numbers into a prompt.
 */
router.post('/generate', aiLimiter, asyncH(async (req, res) => {
  const mode = String(req.body?.mode || 'tutor');
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) throw badRequest('Include a prompt.');
  if (prompt.length > 4000) throw badRequest('Prompt is too long (max 4000 characters).');

  let context = String(req.body?.context || '').slice(0, 12000);

  // Server-side context enrichment from the caller's own rows.
  const refs = req.body?.refs || {};
  const extra = [];

  if (refs.symbol) {
    const inst = getInstrument(String(refs.symbol).toUpperCase());
    if (inst) {
      const q = quote(inst.symbol);
      const a = analyse(candles(inst.symbol, '15m', 160));
      if (q) extra.push(`SIMULATED QUOTE ${q.symbol}: price ${q.price}, change ${q.changePct}%, day range ${q.low}–${q.high}, source ${q.source}.`);
      if (a) extra.push(`INDICATORS: RSI ${a.rsi?.toFixed(1)}, EMA9 ${a.ema9?.toFixed(2)}, EMA21 ${a.ema21?.toFixed(2)}, SMA50 ${a.sma50?.toFixed(2)}, ATR ${a.atr?.toFixed(2)} (${a.atrPct?.toFixed(2)}%), support ${a.support?.toFixed(2)}, resistance ${a.resistance?.toFixed(2)}, trend ${a.trend}.`);
      const pats = candlePatterns(candles(inst.symbol, '15m', 3));
      if (pats.length) extra.push(`CANDLE PATTERNS: ${pats.join('; ')}.`);
    }
  }

  if (refs.includeNews) {
    try {
      const news = await getNews(refs.market || 'all');
      if (news.items?.length) {
        extra.push(
          'CURRENT HEADLINES:\n' +
            news.items.slice(0, 12).map((n) => `• [${n.source}] ${n.title}`).join('\n')
        );
      }
    } catch {
      /* news is optional */
    }
  }

  if (refs.includeBotStats) {
    const learning = await getBotLearning(req.userId);
    extra.push(
      `BOT LEARNING STATE: ${learning.tradesSeen} closed paper trades. ML filter ${learning.mlActive ? 'active' : 'inactive (needs 15 trades)'}. ` +
        `Per-setup results: ${learning.setups.map((s) => `${s.setup} ${s.wins}W/${s.losses}L avgR ${s.avgR} weight ${s.learnedWeight}`).join('; ') || 'none yet'}.`
    );
  }

  if (refs.includePortfolio) {
    const p = await withUser(req.userId, async (c) => {
      const w = await c.query('select sim_balance from wallets where user_id=$1', [req.userId]);
      const s = await c.query(
        `select count(*)::int n, coalesce(sum(pnl),0) pnl, count(*) filter (where pnl>0)::int wins from positions where user_id=$1 and status='closed'`,
        [req.userId]
      );
      const o = await c.query(`select count(*)::int n from positions where user_id=$1 and status='open'`, [req.userId]);
      return { cash: Number(w.rows[0]?.sim_balance ?? 0), closed: s.rows[0], open: o.rows[0] };
    });
    extra.push(
      `PAPER PORTFOLIO: simulated cash ₹${p.cash.toFixed(2)}, ${p.open.n} open positions, ${p.closed.n} closed with realised P&L ₹${Number(p.closed.pnl).toFixed(2)} (${p.closed.wins} winners).`
    );
  }

  if (refs.includeRoadmap) {
    const { rows } = await withUser(req.userId, (c) =>
      c.query(`select * from learning_progress where user_id=$1`, [req.userId])
    );
    const map = Object.fromEntries(rows.map((r) => [r.module_id, r]));
    const mods = roadmapWithStatus(map);
    extra.push(`LEARNING PATH: ${mods.filter((m) => m.status === 'completed').length}/${mods.length} modules complete. Next: ${mods.find((m) => m.status !== 'completed')?.title || 'all done'}.`);
  }

  const fullContext = [context, ...extra].filter(Boolean).join('\n\n');

  const result = await generate({
    mode,
    prompt,
    context: fullContext,
    temperature: toNumber(req.body?.temperature, 0.6),
  });

  const text = result.text + DISCLAIMER;

  await withUser(req.userId, (c) =>
    c.query(
      `insert into ai_requests (user_id, mode, prompt, chars_in, chars_out, ok) values ($1,$2,$3,$4,$5,true)`,
      [req.userId, mode, prompt.slice(0, 2000), fullContext.length + prompt.length, text.length]
    )
  ).catch(() => {});

  res.json({ text, mode, model: result.model, usage: result.usage });
}));

/**
 * GET /api/ai/briefing?market=stocks
 * Server assembles live headlines + simulated tickers and asks Gemini to
 * synthesise a briefing. One call, no client-side plumbing.
 */
router.get('/briefing', aiLimiter, asyncH(async (req, res) => {
  const market = ['stocks', 'fno', 'ipo', 'crypto', 'forex', 'all'].includes(req.query.market) ? req.query.market : 'stocks';
  const news = await getNews(market === 'all' ? 'stocks' : market);
  const ticks = tickers(market).slice(0, 10);

  const context = [
    'HEADLINES:\n' + (news.items || []).slice(0, 14).map((n) => `• [${n.source}] ${n.title} — ${n.summary || ''}`.slice(0, 300)).join('\n'),
    'SIMULATED MOVERS:\n' + ticks
      .map((t) => `• ${t.symbol} ${t.price} (${t.changePct >= 0 ? '+' : ''}${t.changePct}%)`)
      .join('\n'),
  ].join('\n\n');

  const result = await generate({
    mode: 'news',
    prompt: 'Produce today\'s market briefing from these headlines and simulated movers.',
    context,
  });

  res.json({
    market,
    text: result.text + DISCLAIMER,
    model: result.model,
    newsLive: news.live,
    headlines: (news.items || []).slice(0, 14),
    pricesAreSimulated: true,
  });
}));

export default router;
