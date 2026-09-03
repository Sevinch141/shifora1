/**
 * Daily caps on voice and image messages.
 *
 * The count lives in the database and is incremented in the same transaction
 * that consumes it, so a client cannot spend more by retrying or by editing
 * anything on its side. The date key comes from the application clock (one
 * pinned timezone), which is what makes "resets every calendar day" mean the
 * same thing for every patient.
 */
import { get, run, transaction } from '../db/index.js';
import { VOICE_DAILY_LIMIT, IMAGE_DAILY_LIMIT } from '../config.js';
import { ApiError } from '../lib/http.js';
import { toDateKey } from '../lib/time.js';

export const LIMIT_MESSAGE = {
  voice: 'Bugungi ovozli xabar limiti tugadi. Iltimos matn orqali yozing.',
  image: 'Bugungi rasm yuborish limiti tugadi.',
};

const LIMITS = { voice: VOICE_DAILY_LIMIT, image: IMAGE_DAILY_LIMIT };
const COLUMN = { voice: 'voice_count', image: 'image_count' };

async function ensureRow(patientId, date) {
  await run(
    `INSERT INTO ai_usage_daily (patient_id, usage_date) VALUES (?, ?)
     ON CONFLICT (patient_id, usage_date) DO NOTHING`,
    patientId,
    date,
  );
  return get(
    'SELECT voice_count, image_count FROM ai_usage_daily WHERE patient_id = ? AND usage_date = ?',
    patientId,
    date,
  );
}

/** What the chat settings panel shows. Read-only. */
export async function usageToday(patientId) {
  const date = toDateKey();
  const row = await ensureRow(patientId, date);
  return {
    date,
    voice: { used: row?.voice_count ?? 0, limit: LIMITS.voice },
    image: { used: row?.image_count ?? 0, limit: LIMITS.image },
  };
}

/**
 * Consumes one unit of the day's allowance, or throws.
 *
 * The check and the increment are one transaction: two requests arriving
 * together cannot both see the last remaining unit.
 */
export async function consume(patientId, kind) {
  const date = toDateKey();
  const limit = LIMITS[kind];
  const column = COLUMN[kind];

  return transaction(async () => {
    await ensureRow(patientId, date);
    const row = await get(
      `SELECT ${column} AS used FROM ai_usage_daily
        WHERE patient_id = ? AND usage_date = ? FOR UPDATE`,
      patientId,
      date,
    );
    if ((row?.used ?? 0) >= limit) {
      throw new ApiError(429, LIMIT_MESSAGE[kind]);
    }
    await run(
      `UPDATE ai_usage_daily
          SET ${column} = ${column} + 1, updated_at = datetime('now')
        WHERE patient_id = ? AND usage_date = ?`,
      patientId,
      date,
    );
    return { used: (row?.used ?? 0) + 1, limit };
  });
}
