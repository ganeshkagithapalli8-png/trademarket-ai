/**
 * Google Gemini — BACKEND ONLY.
 *
 * The API key never leaves this process. The client talks to
 * POST /api/ai/generate and receives only text.
 *
 * Hard rules baked into every system prompt:
 *   • education and analysis only — never a trade recommendation to act on
 *   • never claims of guaranteed profit, never encourages real-money deposits
 *   • never asked to, and never able to, place an order
 */

import { config } from '../config.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Tried in order so a model rename upstream can't take the feature down.
const MODEL_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

const BASE_RULES = `You are the in-app tutor for TradeMarket AI, an educational PAPER-TRADING simulator.

Absolute rules:
1. This app uses SIMULATED money only. Never suggest depositing real money, never mention returns on real capital, never promise or imply guaranteed profit.
2. You are a teacher, not an adviser. Explain concepts, critique reasoning, summarise material. Do not issue personalised buy/sell instructions for real markets.
3. Always name the risk. Every strategy has a failure mode — state it.
4. If asked to place a trade, connect a broker, or manage real funds, refuse and explain that Indian retail algo trading must route through a SEBI-registered broker's approved API on the user's own account, and that this app does not do that.
5. Indian context: trading/demat accounts require age 18+; leveraged forex must go through an RBI-authorised dealer; F&O carries a high probability of loss for retail traders.
6. Be concise, concrete and warm. Use short paragraphs, and bullet lists or markdown tables where they help. Never invent numbers — if you do not know, say so.`;

const MODES = {
  tutor: {
    label: 'Learn a concept',
    system: `${BASE_RULES}

Mode: TUTOR. Teach the requested trading/quant concept step by step, with one small worked example on paper. End with a 3-question self-check.`,
    maxTokens: 1400,
  },
  summarize: {
    label: 'Summarise',
    system: `${BASE_RULES}

Mode: SUMMARISE. Condense the supplied material into the key points a retail learner must retain. Preserve every number exactly as given. 5–8 bullets, then one "so what" line.`,
    maxTokens: 800,
  },
  news: {
    label: 'Market briefing',
    system: `${BASE_RULES}

Mode: NEWS BRIEFING. From the supplied headlines, produce: (a) the 3 stories that matter most, (b) which sectors/instruments each touches, (c) the risk each headline implies. Do NOT predict prices and do NOT recommend trades.`,
    maxTokens: 900,
  },
  journal: {
    label: 'Trade journal coach',
    system: `${BASE_RULES}

Mode: JOURNAL COACH. Read the learner's paper-trade journal entry. Reflect back the behavioural pattern (fear, greed, revenge trading, plan drift), name one thing done well, one thing to change, and one concrete process rule to try next session. Never comment on real money.`,
    maxTokens: 700,
  },
  analyse: {
    label: 'Read the chart',
    system: `${BASE_RULES}

Mode: CHART READER. Given indicator values from the simulator, describe what the technical picture literally shows — trend, momentum, volatility, distance to support/resistance — and what would invalidate each reading. You are describing, not forecasting. State that these are synthetic simulator prices.`,
    maxTokens: 900,
  },
  botreview: {
    label: 'Bot post-mortem',
    system: `${BASE_RULES}

Mode: BOT POST-MORTEM. Given a bot's own closed-trade statistics, identify which setups have positive expectancy and which are bleeding, explain the likely statistical cause, and recommend process changes (risk per trade, filters, sample size). Be explicit when the sample is too small to conclude anything.`,
    maxTokens: 1000,
  },
  roadmap: {
    label: 'Study plan',
    system: `${BASE_RULES}

Mode: STUDY PLAN. Given the learner's progress through a 14-module path, tell them exactly what to do next and why the sequencing matters. Emphasise that paper trading and backtesting come before any consideration of live markets.`,
    maxTokens: 800,
  },
};

export const aiModes = () =>
  Object.entries(MODES).map(([id, m]) => ({ id, label: m.label }));

export function aiConfigured() {
  return config.hasGemini;
}

/**
 * Call Gemini. Returns { text, model, usage }.
 * Throws an Error with `.status` on failure so the route can respond cleanly.
 */
export async function generate({ mode = 'tutor', prompt, context = '', temperature = 0.6 }) {
  if (!config.hasGemini) {
    const err = new Error(
      'Gemini is not configured yet. Add GEMINI_API_KEY to server/.env and restart the API.'
    );
    err.status = 503;
    throw err;
  }

  const spec = MODES[mode] || MODES.tutor;
  const userContent = context
    ? `CONTEXT (from the simulator / user data):\n${String(context).slice(0, 12_000)}\n\nREQUEST:\n${String(prompt).slice(0, 4_000)}`
    : String(prompt).slice(0, 8_000);

  const body = {
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: spec.system }] },
    generationConfig: {
      temperature: Math.min(Math.max(Number(temperature) || 0.6, 0), 1),
      maxOutputTokens: spec.maxTokens,
      topP: 0.95,
    },
    safetySettings: ['HARM_CATEGORY_FINANCIAL_ADVICE', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT'].map(
      (category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })
    ),
  };

  let lastErr;
  for (const model of MODEL_FALLBACKS) {
    try {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.gemini.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });

      if (res.status === 404) {
        lastErr = new Error(`model ${model} unavailable`);
        continue;
      }
      if (res.status === 429) {
        lastErr = new Error('Gemini rate limit reached — try again in a moment.');
        lastErr.status = 429;
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        lastErr = new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
        lastErr.status = res.status >= 500 ? 502 : 400;
        continue;
      }

      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p?.text || '')
        .join('\n')
        .trim();

      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'empty response';
        lastErr = new Error(`Gemini returned no text (${reason}).`);
        lastErr.status = 422;
        continue;
      }

      return {
        text,
        model,
        mode,
        usage: data?.usageMetadata || null,
      };
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        lastErr = new Error('Gemini timed out. Try a shorter prompt.');
        lastErr.status = 504;
      } else {
        lastErr = err;
      }
    }
  }

  lastErr = lastErr || new Error('Gemini request failed.');
  if (!lastErr.status) lastErr.status = 502;
  throw lastErr;
}
