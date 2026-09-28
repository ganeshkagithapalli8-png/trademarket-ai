import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler, notFoundHandler, apiLimiter } from './middleware.js';
import { dbEnabled, adminPool } from './db/index.js';
import { startLiveData } from './services/liveData.js';
import { runAllBots } from './services/botRunner.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import marketRoutes from './routes/market.js';
import tradingRoutes from './routes/trading.js';
import contentRoutes from './routes/content.js';
import learnRoutes from './routes/learn.js';
import botRoutes from './routes/bot.js';
import aiRoutes from './routes/ai.js';

if (!config.jwt.secret || config.jwt.secret === 'replace_me_with_a_long_random_string') {
  console.warn('\n⚠  JWT_SECRET is missing or still the placeholder. Generate one with:\n' +
    '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
}

const app = express();

app.set('trust proxy', 1); // Render / Vercel sit behind a proxy
app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // API only — no HTML is served from here
  })
);
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = curl / server-to-server / same-origin. Allow it.
      if (!origin) return cb(null, true);
      const allowed = config.clientUrls;
      const ok = allowed.some((a) => origin === a || origin.endsWith(`.${new URL(a).hostname}`));
      if (ok) return cb(null, true);
      // Fail closed in production; stay permissive locally so dev is frictionless.
      return config.isProd
        ? cb(new Error(`CORS: origin ${origin} is not in CLIENT_URL`))
        : cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// ── routes ──────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    service: 'TradeMarket AI API',
    version: '1.0.0',
    mode: 'PAPER TRADING — SIMULATED CAPITAL ONLY',
    realMoney: false,
    brokerOrderRouting: false,
    health: '/api/health',
    docs: {
      auth: 'POST /api/auth/signup · POST /api/auth/login · GET /api/auth/me',
      profile: 'GET|PATCH /api/profile · GET /api/profile/market-access',
      market: 'GET /api/market/{markets,instruments,tickers,news} · /api/market/quote/:symbol · /api/market/candles/:symbol',
      wallet: 'GET /api/wallet · POST /api/wallet/{deposit,withdraw,reset} · GET /api/wallet/transactions',
      trade: 'POST /api/trade/order · POST /api/trade/close/:id · GET /api/trade/{positions,orders}',
      portfolio: 'GET /api/portfolio',
      content: 'CRUD /api/notes · /api/watchlist · /api/journal',
      learn: 'GET /api/learn/roadmap · GET /api/learn/module/:id · POST /api/learn/module/:id/{read,quiz,reset}',
      bot: 'GET /api/bot/{state,signals,learning,memory,setups} · POST /api/bot/{config,arm,kill-switch,backtest,run}',
      ai: 'POST /api/ai/generate · GET /api/ai/{modes,status,briefing}',
    },
  });
});

app.get('/api/health', async (_req, res) => {
  let db = 'not-configured';
  if (dbEnabled) {
    try {
      await adminPool.query('select 1');
      db = 'ok';
    } catch (err) {
      db = `error: ${err.message}`;
    }
  }
  res.json({
    ok: db === 'ok' || db === 'not-configured',
    time: new Date().toISOString(),
    env: config.env,
    database: db,
    gemini: config.hasGemini ? 'configured' : 'not-configured',
    paperTradingOnly: config.safety.paperTradingOnly,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/api/auth', (req, res, next) => {
  res.on('finish', () => {
    console.log(`[auth] ${req.method} ${req.path} -> ${res.status} origin=${req.headers.origin || '-'}`);
  });
  next();
});
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/market', marketRoutes);
app.use('/api', tradingRoutes); // /api/wallet, /api/trade/*, /api/portfolio
app.use('/api', contentRoutes); // /api/notes, /api/watchlist, /api/journal
app.use('/api/learn', learnRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/ai', aiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ── background loops ────────────────────────────────────────────────────────

const loops = [];

function startLoops() {
  loops.push(startLiveData(60_000));

  // Stops/targets are checked often; new entries less often.
  const manage = setInterval(() => {
    runAllBots().catch((e) => console.error('[bot] tick failed:', e.message));
  }, 30_000);
  manage.unref?.();
  loops.push(manage);
}

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  TradeMarket AI API`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  ▸ http://0.0.0.0:${config.port}   (${config.env})`);
  console.log(`  ▸ database : ${dbEnabled ? 'configured' : 'NOT CONFIGURED — set SUPABASE_DB_URL and run npm run migrate'}`);
  console.log(`  ▸ gemini   : ${config.hasGemini ? 'configured' : 'not configured'}`);
  console.log(`  ▸ mode     : PAPER TRADING · simulated capital only`);
  console.log(`  ▸ origins  : ${config.clientUrls.join(', ') || '(any, dev only)'}\n`);

  if (dbEnabled) startLoops();
});

// ── graceful shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[${signal}] shutting down…`);
  for (const t of loops) clearInterval(t);
  server.close(async () => {
    try {
      await adminPool?.end();
    } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));

export default app;
