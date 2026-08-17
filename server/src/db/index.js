import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', 'data');
const dbPath = process.env.SHIFORA_DB ?? join(dataDir, 'shifora.db');

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

/** Run a statement and return { changes, lastInsertRowid }. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** Insert helper returning the new row id. */
export function insert(sql, ...params) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** Fetch a single row, or undefined. */
export function get(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : undefined;
}

/** Fetch all rows as plain objects. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map((r) => ({ ...r }));
}

/**
 * Wrap a function in a transaction. Re-entrant: nested calls use savepoints, so
 * a service that manages its own transaction still composes inside a larger one.
 */
let txDepth = 0;

export function transaction(fn) {
  const name = `sp_${txDepth}`;
  db.exec(txDepth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  txDepth += 1;
  try {
    const result = fn();
    txDepth -= 1;
    db.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    txDepth -= 1;
    db.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
    throw err;
  }
}

export { dbPath };
