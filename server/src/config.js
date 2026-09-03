/**
 * Runtime configuration.
 *
 * Timezone matters here more than in most apps: the reminder engine compares
 * clock-time strings ('YYYY-MM-DD HH:MM') produced by BOTH Node and Postgres.
 * If the two disagree, doses fire at the wrong hour. So one timezone is pinned
 * for the whole system and applied to the Node process and every DB session.
 *
 * It must be set before any Date is constructed, so this module is imported
 * first by every entry point.
 */
export const TIMEZONE = process.env.SHIFORA_TZ ?? 'Asia/Tashkent';

process.env.TZ = TIMEZONE;

export const DATABASE_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';

/** Shared secret required by the cron endpoint that drives reminders. */
export const CRON_SECRET = process.env.CRON_SECRET ?? '';

export const IS_VERCEL = Boolean(process.env.VERCEL);

export const PORT = Number(process.env.PORT ?? 4000);

/** Gemini powers transcription, image reading, embeddings and reply wording.
 *  Everything that uses it degrades safely when the key is absent. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
export const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? 'text-embedding-004';

/** Per-patient daily caps, enforced in the backend. */
export const VOICE_DAILY_LIMIT = Number(process.env.SHIFORA_VOICE_LIMIT ?? 2);
export const IMAGE_DAILY_LIMIT = Number(process.env.SHIFORA_IMAGE_LIMIT ?? 1);
