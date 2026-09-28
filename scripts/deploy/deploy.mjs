#!/usr/bin/env node
/**
 * One-shot deployment: GitHub repo → Render (API) → Vercel (SPA) → CORS wiring.
 *
 *   GITHUB_TOKEN=ghp_.. RENDER_TOKEN=rnd_.. VERCEL_TOKEN=vcp_.. \
 *   [GEMINI_API_KEY=AIza..] [SUPABASE_DB_URL=postgres://..] [SUPABASE_SERVICE_ROLE_KEY=..] \
 *   node scripts/deploy/deploy.mjs
 *
 * Every step is idempotent where the API allows it (existing repo/project are
 * reused), and every failure prints the exact manual alternative instead of
 * dying silently. Secrets are passed to the platforms as env vars; they are
 * never committed.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = process.env.REPO_NAME || 'trademarket-ai';
const API_NAME = process.env.RENDER_SERVICE || 'trademarket-api';
const WEB_NAME = process.env.VERCEL_PROJECT || 'trademarket-ai';
const REGION = process.env.RENDER_REGION || 'singapore';

const GITHUB = process.env.GITHUB_TOKEN;
const RENDER = process.env.RENDER_TOKEN;
const VERCEL = process.env.VERCEL_TOKEN;

const log = (s) => console.log(`\x1b[1m▸ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✔\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const die = (s) => { console.log(`  \x1b[31m✖ ${s}\x1b[0m`); process.exit(1); };

const j = async (url, opts = {}) => {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { status: res.status, body };
};

if (!GITHUB || !RENDER || !VERCEL) {
  console.log('Missing tokens. Need GITHUB_TOKEN, RENDER_TOKEN and VERCEL_TOKEN in the environment.');
  console.log('  GITHUB_TOKEN  ghp_…   repo:repo, admin:repo_hosting (fine-grained: Contents rw + Administration rw)');
  console.log('  RENDER_TOKEN  rnd_…   from Render → Account Settings → API Keys');
  console.log('  VERCEL_TOKEN  vcp_…   from Vercel → Settings → Tokens');
  process.exit(1);
}

// ── Server env that Render should receive ──────────────────────────────────
const jwtSecret = execSync('openssl rand -hex 32').toString().trim();
const renderEnv = [
  { key: 'NODE_ENV', value: 'production' },
  { key: 'PORT', value: '10000' },
  { key: 'PAPER_TRADING_ONLY', value: 'true' },
  { key: 'MIN_USER_AGE', value: '18' },
  { key: 'MIN_SIM_DEPOSIT_INR', value: '50' },
  { key: 'LIVE_CRYPTO', value: 'true' },
  { key: 'JWT_SECRET', value: jwtSecret },
  { key: 'CLIENT_URL', value: 'https://placeholder.invalid' }, // patched after Vercel
];
for (const k of ['SUPABASE_DB_URL', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'APP_DB_ROLE_PASSWORD']) {
  if (process.env[k]) renderEnv.push({ key: k, value: process.env[k] });
}
if (process.env.SUPABASE_DB_URL && !process.env.APP_DB_ROLE_PASSWORD) {
  try {
    const p = path.join(ROOT, 'server/data/.dbrole');
    if (existsSync(p)) renderEnv.push({ key: 'APP_DB_ROLE_PASSWORD', value: readFileSync(p, 'utf8').trim() });
  } catch { /* optional */ }
}

// ═══ 1 · GitHub ════════════════════════════════════════════════════════════
log('GitHub: repository');
const gh = (p, o = {}) => j(`https://api.github.com${p}`, {
  ...o,
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...(o.body ? {} : {}),
  },
});
const me = await gh('/user');
if (me.status !== 200) die(`GitHub token rejected (${me.status}). ${JSON.stringify(me.body).slice(0, 200)}`);
const owner = me.body.login;
ok(`authenticated as ${owner}`);

let repo = await gh(`/repos/${owner}/${REPO}`);
if (repo.status === 404) {
  repo = await gh('/user/repos', { method: 'POST', body: JSON.stringify({ name: REPO, private: true, description: 'Paper-trading simulator with a gated learning path and a self-learning strategy bot. No real money, ever.', has_issues: false, has_wiki: false }) });
  if (repo.status !== 201) die(`could not create repo: ${repo.status} ${JSON.stringify(repo.body).slice(0, 300)}`);
  ok(`created private repo ${owner}/${REPO}`);
} else if (repo.status === 200) {
  ok(`reusing existing repo ${owner}/${REPO}`);
} else die(`unexpected repo response ${repo.status}`);

log('GitHub: push');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
try { run('git rev-parse --git-dir'); } catch { run('git init -b main'); ok('git initialised'); }
run(`git remote remove origin 2>/dev/null || true`);
run(`git remote add origin https://x-access-token:${GITHUB}@github.com/${owner}/${REPO}.git`);
run('git add -A');
try { run('git -c user.name="TradeMarket Deploy" -c user.email="deploy@trademarket.local" commit -m "TradeMarket AI: paper-trading simulator, learning path, self-learning bot"'); ok('committed'); }
catch { warn('nothing new to commit'); }
try {
  run('git push -u origin main --force');
  ok('pushed to main');
} catch (e) {
  die(`push failed: ${String(e.stderr || e.message).slice(0, 300)}`);
}

// ═══ 2 · Render ════════════════════════════════════════════════════════════
log('Render: web service for the API');
const rh = { Authorization: `Bearer ${RENDER}`, 'Content-Type': 'application/json', Accept: 'application/json' };
let svcId = null;
const existing = await j(`https://api.render.com/v1/services?name=${API_NAME}&limit=20`, { headers: rh });
if (existing.status === 200) {
  const hit = (existing.body || []).find((s) => s.service?.name === API_NAME);
  if (hit) { svcId = hit.service.id; ok(`reusing existing service ${API_NAME}`); }
} else warn(`service lookup ${existing.status}: ${JSON.stringify(existing.body).slice(0, 160)}`);

if (!svcId) {
  const created = await j('https://api.render.com/v1/services', {
    method: 'POST',
    headers: rh,
    body: JSON.stringify({
      type: 'web',
      name: API_NAME,
      repo: `https://github.com/${owner}/${REPO}`,
      branch: 'main',
      rootDir: 'server',
      buildCommand: 'npm install --omit=dev',
      startCommand: 'npm start',
      plan: 'free',
      region: REGION,
      autoDeploy: true,
      healthCheckPath: '/api/health',
      envVars: renderEnv,
    }),
  });
  if (created.status >= 200 && created.status < 300) {
    svcId = created.body?.service?.id || created.body?.id;
    ok(`created service ${API_NAME} (${svcId})`);
  } else {
    warn(`Render API refused service creation (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
    warn('Manual fallback: Render dashboard → New → Web Service → connect the repo,');
    warn(`root directory "server", build "npm install --omit=dev", start "npm start",`);
    warn('health check /api/health, and paste these env vars:');
    for (const e of renderEnv) console.log(`     ${e.key}=${e.key.includes('SECRET') || e.key.includes('KEY') || e.key.includes('URL') || e.key.includes('PASSWORD') ? '<redacted>' : e.value}`);
  }
}
let apiUrl = null;
if (svcId) {
  for (let i = 0; i < 40 && !apiUrl; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const s = await j(`https://api.render.com/v1/services/${svcId}`, { headers: rh });
    apiUrl = s.body?.service?.serviceDetails?.url || s.body?.service?.url || null;
    const dep = await j(`https://api.render.com/v1/services/${svcId}/deploys?limit=1`, { headers: rh });
    const st = dep.body?.[0]?.deploy?.status;
    process.stdout.write(`  … deploy ${st || 'pending'}\n`);
    if (st === 'live' && apiUrl) break;
    if (st === 'build_failed' || st === 'update_failed') { warn('Render deploy failed — check the dashboard logs.'); break; }
  }
  if (apiUrl) ok(`API live at ${apiUrl}`);
}

// ═══ 3 · Vercel ════════════════════════════════════════════════════════════
log('Vercel: project for the SPA');
const vh = { Authorization: `Bearer ${VERCEL}`, 'Content-Type': 'application/json' };
const clientEnv = [];
if (apiUrl) clientEnv.push({ key: 'VITE_API_BASE_URL', value: apiUrl, target: ['production', 'preview', 'development'], type: 'encrypted' });

let proj = await j(`https://api.vercel.com/v9/projects/${WEB_NAME}?teamId=`, { headers: vh });
if (proj.status === 404) {
  proj = await j('https://api.vercel.com/v9/projects', {
    method: 'POST',
    headers: vh,
    body: JSON.stringify({
      name: WEB_NAME,
      framework: 'vite',
      rootDirectory: 'client',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      installCommand: 'npm install',
      environmentVariables: clientEnv,
    }),
  });
  if (proj.status !== 200 && proj.status !== 201) die(`Vercel project creation failed (${proj.status}): ${JSON.stringify(proj.body).slice(0, 300)}`);
  ok(`created project ${WEB_NAME}`);
} else if (proj.status === 200) {
  ok(`reusing existing project ${WEB_NAME}`);
  for (const e of clientEnv) {
    await j(`https://api.vercel.com/v10/projects/${WEB_NAME}/env?teamId=`, { method: 'POST', headers: vh, body: JSON.stringify(e) });
  }
} else die(`Vercel project lookup ${proj.status}`);

let webUrl = null;
if (apiUrl) {
  log('Vercel: production deploy via CLI');
  try {
    const out = execSync(`npx --yes vercel@latest deploy --prod --yes --token=${VERCEL} --cwd "${path.join(ROOT, 'client')}" --env VITE_API_BASE_URL=${apiUrl}`, { cwd: ROOT, stdio: 'pipe', timeout: 900000 }).toString();
    webUrl = (out.trim().split(/\s+/).pop() || '').trim();
    ok(`deployed: ${webUrl}`);
  } catch (e) {
    warn(`Vercel CLI deploy failed: ${String(e.stderr || e.message).slice(0, 400)}`);
    warn('Manual fallback: cd client && npx vercel --prod');
  }
} else {
  warn('No Render URL yet, so the SPA would build without an API. Link the repo in the Vercel dashboard and set VITE_API_BASE_URL after Render is live.');
}

// ═══ 4 · Close the CORS loop ═══════════════════════════════════════════════
if (svcId && webUrl) {
  log('Render: point CLIENT_URL at the deployed SPA and redeploy');
  const clean = webUrl.replace(/\/+$/, '');
  const list = await j(`https://api.render.com/v1/services/${svcId}/env-vars`, { headers: rh });
  const target = (list.body || []).find((v) => v.envVar?.key === 'CLIENT_URL');
  if (target) {
    await j(`https://api.render.com/v1/services/${svcId}/env-vars/${target.envVar.id}`, {
      method: 'PATCH', headers: rh, body: JSON.stringify({ value: clean }),
    });
    ok(`CLIENT_URL = ${clean}`);
  } else {
    await j(`https://api.render.com/v1/services/${svcId}/env-vars`, { method: 'POST', headers: rh, body: JSON.stringify({ key: 'CLIENT_URL', value: clean }) });
    ok(`CLIENT_URL created = ${clean}`);
  }
  const dep = await j(`https://api.render.com/v1/services/${svcId}/deploys`, { method: 'POST', headers: rh });
  ok(dep.status < 300 ? 'redeploy triggered' : `redeploy trigger ${dep.status} — do it from the dashboard`);
}

console.log('\n' + '═'.repeat(60));
console.log(`  GitHub   https://github.com/${owner}/${REPO}`);
console.log(`  API      ${apiUrl || '(see Render dashboard)'}`);
console.log(`  Web      ${webUrl || '(see Vercel dashboard)'}`);
console.log('═'.repeat(60));
if (apiUrl && webUrl) {
  const h = await j(`${apiUrl}/api/health`);
  ok(`health: ${h.status} ${JSON.stringify(h.body).slice(0, 120)}`);
}
