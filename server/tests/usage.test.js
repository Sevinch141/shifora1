/**
 * Daily limits are a backend guarantee, so they are tested against the database
 * rather than through the interface.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageToday, consume, LIMIT_MESSAGE } from '../src/services/aiUsage.js';
import { VOICE_DAILY_LIMIT, IMAGE_DAILY_LIMIT } from '../src/config.js';
import { get, run, closePool } from '../src/db/index.js';
import { toDateKey } from '../src/lib/time.js';

const patient = await get('SELECT * FROM patients ORDER BY id LIMIT 1');

async function reset() {
  await run('DELETE FROM ai_usage_daily WHERE patient_id = ? AND usage_date = ?', patient.id, toDateKey());
}

test.after(async () => { await reset(); await closePool(); });

test('a fresh day starts at zero', async () => {
  await reset();
  const usage = await usageToday(patient.id);
  assert.equal(usage.voice.used, 0);
  assert.equal(usage.image.used, 0);
  assert.equal(usage.voice.limit, VOICE_DAILY_LIMIT);
  assert.equal(usage.image.limit, IMAGE_DAILY_LIMIT);
});

test('voice stops at the configured limit', async () => {
  await reset();
  for (let i = 0; i < VOICE_DAILY_LIMIT; i += 1) {
    const result = await consume(patient.id, 'voice');
    assert.equal(result.used, i + 1);
  }
  await assert.rejects(
    () => consume(patient.id, 'voice'),
    (err) => err.status === 429 && err.message === LIMIT_MESSAGE.voice,
  );
});

test('image stops at the configured limit', async () => {
  await reset();
  for (let i = 0; i < IMAGE_DAILY_LIMIT; i += 1) await consume(patient.id, 'image');
  await assert.rejects(
    () => consume(patient.id, 'image'),
    (err) => err.status === 429 && err.message === LIMIT_MESSAGE.image,
  );
});

test('the two allowances are independent', async () => {
  await reset();
  for (let i = 0; i < IMAGE_DAILY_LIMIT; i += 1) await consume(patient.id, 'image');
  const voice = await consume(patient.id, 'voice');
  assert.equal(voice.used, 1, 'exhausting images must not spend voice');
});

test('concurrent requests cannot exceed the limit', async () => {
  await reset();
  const attempts = VOICE_DAILY_LIMIT + 4;
  const results = await Promise.allSettled(
    Array.from({ length: attempts }, () => consume(patient.id, 'voice')),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(ok, VOICE_DAILY_LIMIT, 'the row lock must serialise the spend');

  const usage = await usageToday(patient.id);
  assert.equal(usage.voice.used, VOICE_DAILY_LIMIT);
});

test('yesterday does not spend today', async () => {
  await reset();
  await run(
    `INSERT INTO ai_usage_daily (patient_id, usage_date, voice_count, image_count)
     VALUES (?, ?, ?, ?) ON CONFLICT (patient_id, usage_date) DO NOTHING`,
    patient.id, '2020-01-01', 99, 99,
  );
  const usage = await usageToday(patient.id);
  assert.equal(usage.voice.used, 0);
  await run('DELETE FROM ai_usage_daily WHERE patient_id = ? AND usage_date = ?', patient.id, '2020-01-01');
});
