import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '../config.js';
import { wrap } from '../lib/http.js';
import { tick } from '../services/scheduler.js';

const router = Router();

function secretMatches(provided) {
  if (!CRON_SECRET) return false;
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(CRON_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Drives the reminder and escalation engine.
 *
 * Nothing runs continuously on a serverless platform, so this endpoint replaces
 * the background timer: Vercel Cron (or any external scheduler) calls it, and
 * one call performs exactly one `tick()`.
 *
 * It is protected by a shared secret because it writes data and sends
 * notifications. Vercel Cron sends it as `Authorization: Bearer $CRON_SECRET`;
 * an external pinger can use the `?key=` query parameter instead.
 */
router.all(
  '/tick',
  wrap(async (req, res) => {
    const header = req.get('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const provided = bearer ?? req.query.key ?? req.get('x-cron-secret');

    if (!CRON_SECRET) {
      return res.status(503).json({ error: 'CRON_SECRET sozlanmagan.' });
    }
    if (!secretMatches(provided)) {
      return res.status(401).json({ error: 'Ruxsat etilmagan.' });
    }

    const result = await tick();
    console.log('[cron] tick', JSON.stringify(result));
    res.json({ ok: true, ...result });
  }),
);

export default router;
