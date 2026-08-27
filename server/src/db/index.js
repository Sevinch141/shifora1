import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DATABASE_URL, TIMEZONE } from '../config.js';
import { ApiError } from '../lib/http.js';

const here = dirname(fileURLToPath(import.meta.url));

// node-postgres returns 64-bit ints (COUNT, SUM) and NUMERIC as strings to
// avoid precision loss. Every such value here is a small count or a clinical
// reading, so they are parsed as numbers — otherwise `count + 1` would
// concatenate and every dashboard statistic would be quietly wrong.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => (value === null ? null : Number(value)));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));

/**
 * Configuration is validated but NOT thrown at import time.
 *
 * A module-level throw takes the whole serverless function down before it can
 * handle a request, and the platform reports only an opaque
 * FUNCTION_INVOCATION_FAILED — every route, including ones that never touch the
 * database, returns a 500 with no indication of why. Deferring the error to the
 * first query keeps the app importable, so /api/health still answers and the
 * database routes return this message instead of a blank crash.
 */
const configError = (() => {
  if (!DATABASE_URL) {
    return 'DATABASE_URL belgilanmagan. Postgres ulanish manzilini .env faylida yoki Vercel muhit sozlamalarida kiriting.';
  }
  // Most often an unreplaced placeholder, which otherwise surfaces deep in the
  // pool as a bare ENOTFOUND naming a fragment of the placeholder as the host.
  // Only the scheme is echoed back, because a real URL carries a password.
  if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    const shown = DATABASE_URL.includes('@') ? '<parol bor, ko\u2018rsatilmadi>' : DATABASE_URL;
    return `DATABASE_URL Postgres manzili emas: ${shown}. `
      + 'Kutilgan ko\u2018rinish: postgresql://foydalanuvchi:parol@host/baza?sslmode=require';
  }
  return null;
})();

if (configError) console.error('[db]', configError);

/**
 * Postgres access layer.
 *
 * Serverless notes: the pool is module-scoped so it is reused across warm
 * invocations, and kept small because each concurrent function instance opens
 * its own. Point DATABASE_URL at a POOLED connection string (Neon's `-pooler`
 * host) so short-lived instances do not exhaust backend connections.
 */
let pool = null;

function getPool() {
  if (configError) throw new ApiError(503, configError);
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // Every session speaks the same clock as the Node process (see config.js).
    // Sent as a startup parameter rather than a post-connect query, so it is
    // already in effect for the very first statement on the connection.
    options: `-c timezone=${TIMEZONE}`,
    // Managed Postgres (Neon, Supabase, Vercel) terminates TLS with certificates
    // this client does not need to verify itself; local development has no TLS.
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error('[pg pool]', err.message);
  });

  return pool;
}

/** Transaction-scoped client, so nested helpers join the open transaction. */
const txStore = new AsyncLocalStorage();

/**
 * Queries are written with SQLite-style `?` placeholders and variadic params.
 * Postgres wants $1..$n, so they are rewritten here — string literals and
 * casts (`::`) are skipped so only real placeholders are touched.
 */
function toPgPlaceholders(sql) {
  let out = '';
  let index = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '?') {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

async function execute(sql, params) {
  const text = toPgPlaceholders(sql);
  const client = txStore.getStore();
  try {
    return client ? await client.query(text, params) : await getPool().query(text, params);
  } catch (err) {
    // A configuration error is about the setup, not the statement; appending
    // SQL to it only buries the instruction the reader needs.
    if (err instanceof ApiError) throw err;
    err.message = `${err.message}\nSQL: ${text.trim().slice(0, 300)}`;
    throw err;
  }
}

/** Run a statement; returns { changes }. */
export async function run(sql, ...params) {
  const result = await execute(sql, params);
  return { changes: result.rowCount };
}

/**
 * Insert helper returning the new row id. `RETURNING id` is appended when the
 * caller has not written one. Returns null when nothing was inserted, which is
 * what an `ON CONFLICT DO NOTHING` insert should report.
 */
export async function insert(sql, ...params) {
  const withReturning = /returning/i.test(sql) ? sql : `${sql.trimEnd().replace(/;$/, '')} RETURNING id`;
  const result = await execute(withReturning, params);
  return result.rows.length > 0 ? Number(result.rows[0].id) : null;
}

/** Fetch a single row, or undefined. */
export async function get(sql, ...params) {
  const result = await execute(sql, params);
  return result.rows[0];
}

/** Fetch all rows. */
export async function all(sql, ...params) {
  const result = await execute(sql, params);
  return result.rows;
}

/**
 * Run a function inside a transaction. Re-entrant: a nested call joins the
 * outer transaction using a savepoint, so a service that manages its own
 * transaction still composes inside a larger one.
 */
export async function transaction(fn) {
  const existing = txStore.getStore();

  if (existing) {
    const name = `sp_${Math.random().toString(36).slice(2, 10)}`;
    await existing.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await existing.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (err) {
      await existing.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw err;
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Applies schema.sql. Safe to run repeatedly. */
export async function migrate() {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  await getPool().query(sql);
}

export async function closePool() {
  if (pool) await pool.end();
}

export { getPool };
