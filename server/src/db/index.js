/**
 * Data layer.
 *
 * Two connection pools:
 *   adminPool – privileged. Used ONLY for signup, login lookups and migrations.
 *   appPool   – role `tm_app`, which has NOBYPASSRLS. Every user-scoped query
 *               runs through withUser(), pinning app.user_id for the
 *               transaction so Postgres itself refuses foreign rows.
 *
 * If tm_app cannot be reached (e.g. role not yet provisioned) we degrade to the
 * admin pool but still force RLS for that session with
 * `set local row_level_security = on`, so ownership is enforced either way.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const sslFor = (cs) => (cs && /supabase|render|aws|railway|neon/.test(cs) ? { rejectUnauthorized: false } : undefined);

export const adminConnectionString = config.supabase.dbUrl || process.env.DATABASE_URL || '';
export const dbEnabled = Boolean(adminConnectionString);

export const adminPool = dbEnabled
  ? new Pool({
      connectionString: adminConnectionString,
      ssl: sslFor(adminConnectionString),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    })
  : null;

// Postgres returns NUMERIC as a string to protect arbitrary precision. Every
// numeric column here is money or a ratio bounded far inside double precision,
// so parse to number — otherwise the client receives "-0.0200" instead of
// -0.02 and arithmetic silently goes wrong.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

let cachedRolePassword;
export function appRolePassword() {
  if (cachedRolePassword) return cachedRolePassword;
  if (process.env.APP_DB_ROLE_PASSWORD) {
    cachedRolePassword = process.env.APP_DB_ROLE_PASSWORD;
    return cachedRolePassword;
  }
  try {
    cachedRolePassword = readFileSync(join(__dirname, '..', '..', 'data', '.dbrole'), 'utf8').trim();
  } catch {
    cachedRolePassword = '';
  }
  return cachedRolePassword;
}

function buildAppConnectionString() {
  if (!adminConnectionString) return '';
  const pw = appRolePassword();
  if (!pw) return '';
  try {
    const u = new URL(adminConnectionString);
    u.username = 'tm_app';
    u.password = pw;
    return u.toString();
  } catch {
    return adminConnectionString.replace(/\/\/[^:]+:[^@]*@/, `//tm_app:${encodeURIComponent(pw)}@`);
  }
}

let appPoolInstance = null;
let appPoolBroken = false;

export function appPool() {
  if (appPoolBroken) return null;
  if (appPoolInstance) return appPoolInstance;
  const cs = buildAppConnectionString();
  if (!cs) return null;
  appPoolInstance = new Pool({
    connectionString: cs,
    ssl: sslFor(cs),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // If the role can't authenticate, fall back rather than taking the app down.
  appPoolInstance.on('error', (err) => {
    if (/authentication|role .* does not exist|password/i.test(err.message || '')) {
      console.warn('[db] tm_app pool unavailable, falling back to admin pool with forced RLS:', err.message);
      appPoolBroken = true;
      appPoolInstance = null;
    }
  });
  return appPoolInstance;
}

/**
 * Run `fn(client)` in a transaction with app.user_id pinned.
 * RLS is enforced by Postgres, not just by application logic.
 */
export async function withUser(userId, fn) {
  await assertDb();
  const useApp = Boolean(appPool());
  const pool = useApp ? appPool() : adminPool;

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local app.user_id = ${client.escapeLiteral(String(userId))}`);
    if (!useApp) await client.query('set local row_level_security = on');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Privileged query — bypasses RLS. Signup, login and migrations ONLY. */
export async function admin(fn) {
  await assertDb();
  const client = await adminPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export const newId = () => crypto.randomUUID();
export const newJti = () => crypto.randomBytes(18).toString('hex');

export async function assertDb() {
  if (!dbEnabled) {
    const err = new Error(
      'Database not configured. Set SUPABASE_DB_URL (or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF) in server/.env, then run `npm run migrate`.'
    );
    err.status = 503;
    throw err;
  }
}

/** Convenience: one-shot select inside a user transaction. */
export const userQuery = (userId, sql, params) => withUser(userId, (c) => c.query(sql, params));
