// Local development entry point. On Vercel the app is served by api/index.js.
import './config.js';

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { PORT } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/index.js';
import { tick } from './services/scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = createApp();

// Serve the built client so the whole prototype runs from one process locally.
// On Vercel the static files are served by the platform instead.
const webDist = join(here, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

// A misconfigured database should not stop the server from starting: booting
// anyway means /api/health answers and the database routes report the real
// reason, instead of the process dying with a stack trace.
try {
  await migrate();
} catch (err) {
  console.error('[db]', err.message);
  console.error('[db] Server ishga tushadi, lekin bazaga bog\u2018liq yo\u2018llar xato qaytaradi.');
}

/**
 * In production the reminder engine is driven by Vercel Cron hitting
 * /api/cron/tick. Locally there is no cron, so a timer stands in for it — the
 * same `tick()`, just triggered differently.
 */
const TICK_MS = Number(process.env.SHIFORA_TICK_MS ?? 60_000);
if (process.env.SHIFORA_LOCAL_SCHEDULER !== 'off') {
  const run = () => tick().catch((err) => console.error('[scheduler]', err));
  await run();
  setInterval(run, TICK_MS).unref?.();
}

app.listen(PORT, () => {
  console.log(`Shifora API → http://localhost:${PORT}`);
  console.log(`Reminder engine → local timer every ${TICK_MS / 1000}s`);
});
