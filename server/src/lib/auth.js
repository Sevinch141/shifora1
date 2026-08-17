import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, insert, run } from '../db/index.js';
import { addDays, toLocal } from './time.js';

const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = toLocal(addDays(new Date(), SESSION_DAYS));
  await insert(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?) RETURNING token',
    token,
    userId,
    expiresAt,
  );
  return { token, expiresAt };
}

export async function resolveSession(token) {
  if (!token) return null;
  const row = await get(
    `SELECT s.token, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.is_active = 1`,
    token,
  );
  if (!row) return null;
  if (row.expires_at < toLocal()) {
    await run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  const { token: _t, expires_at: _e, password_hash: _p, ...user } = row;
  return user;
}

export async function destroySession(token) {
  await run('DELETE FROM sessions WHERE token = ?', token);
}
