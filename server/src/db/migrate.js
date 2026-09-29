/**
 * Automated migration runner.
 *
 * PostgREST (what the anon / service_role keys talk to) cannot execute DDL, so
 * the service_role key alone CANNOT create tables. This script instead uses one
 * of:
 *
 *   A. SUPABASE_DB_URL                – direct Postgres connection string
 *   B. SUPABASE_ACCESS_TOKEN (sbp_…)  – Supabase Management API
 *      + SUPABASE_PROJECT_REF           POST /v1/projects/{ref}/database/query
 *
 * Locally it falls back to DATABASE_URL / a local Postgres instance.
 *
 *   node src/db/migrate.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

function loadAppRolePassword() {
  if (process.env.APP_DB_ROLE_PASSWORD) return process.env.APP_DB_ROLE_PASSWORD;
  try {
    return readFileSync(join(__dirname, '..', '..', 'data', '.dbrole'), 'utf8').trim();
  } catch {
    return null; // managed hosts: file is gitignored; tm_app auth simply degrades to forced-RLS admin pool
  }
}
const APP_DB_ROLE_PASSWORD = loadAppRolePassword();

async function runViaConnectionString(connectionString, label) {
  const client = new pg.Client({ connectionString, ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  console.log(`→ connected (${label})`);

  await client.query('begin');
  try {
    await client.query(SQL);

    // Set the tm_app password separately — never stored in schema.sql.
    // Managed Postgres (e.g. Render) may forbid ALTER ROLE for the admin user;
    // the server degrades gracefully to the admin pool with forced RLS (SET ROLE),
    // so a failure here must not abort the migration.
    await client.query('savepoint tm_app_pw');
    if (!APP_DB_ROLE_PASSWORD) throw new Error('no APP_DB_ROLE_PASSWORD available');
    try {
      await client.query(`alter role tm_app with login nobypassrls password ${client.escapeLiteral(APP_DB_ROLE_PASSWORD)}`);
    } catch {
      await client.query('rollback to savepoint tm_app_pw');
      await client.query('savepoint tm_app_pw2');
      try {
        await client.query(`alter role tm_app with password ${client.escapeLiteral(APP_DB_ROLE_PASSWORD)}`);
        console.log('→ tm_app password set (password-only ALTER accepted)');
      } catch (e2) {
        await client.query('rollback to savepoint tm_app_pw2');
        console.warn(`→ tm_app password NOT set (${e2.message}) — app will use the admin pool with forced RLS`);
      }
    }

    await client.query('commit');
    console.log('→ schema + RLS + tm_app role applied');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }

  const tables = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  );
  const rls = await client.query(
    `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity = true order by relname`
  );
  console.log(`→ ${tables.rowCount} tables: ${tables.rows.map((r) => r.table_name).join(', ')}`);
  console.log(`→ RLS enabled on ${rls.rowCount} tables: ${rls.rows.map((r) => r.relname).join(', ')}`);

  await client.end();
}

async function runViaManagementApi() {
  const { accessToken, projectRef } = config.supabase;
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  console.log(`→ using Supabase Management API for project ${projectRef}`);

  const post = async (query) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Supabase Management API ${res.status}: ${await res.text()}`);
    return res.json();
  };

  await post(SQL);
  await post(`alter role tm_app with login nobypassrls password '${APP_DB_ROLE_PASSWORD.replace(/'/g, "''")}'`);

  const tables = await post(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`
  );
  console.log(`→ ${tables.length} tables created: ${tables.map((r) => r.table_name).join(', ')}`);
}

async function main() {
  console.log('\n══ TradeMarket AI — migration ══\n');

  if (config.supabase.dbUrl) {
    await runViaConnectionString(config.supabase.dbUrl, 'SUPABASE_DB_URL');
  } else if (process.env.DATABASE_URL) {
    await runViaConnectionString(process.env.DATABASE_URL, 'DATABASE_URL');
  } else if (config.supabase.accessToken && config.supabase.projectRef) {
    await runViaManagementApi();
  } else {
    console.error(
      [
        '✖ No database credentials found. Supply ONE of:',
        '    SUPABASE_DB_URL=postgres://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres',
        '    SUPABASE_ACCESS_TOKEN=sbp_... + SUPABASE_PROJECT_REF=...',
        '    DATABASE_URL=postgres://user:pass@host:5432/db   (local dev)',
        '',
        '  Note: SUPABASE_SERVICE_ROLE_KEY cannot create tables — PostgREST has no DDL.',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log('\n✔ Migration complete.\n');
}

// Only run when invoked directly (`npm run migrate`), never on import.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('\n✖ Migration failed:', err.message);
    process.exit(1);
  });
}

export { main as runMigration };
