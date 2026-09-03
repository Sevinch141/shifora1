/**
 * Safety tests for Hamshira AI, the medication ledger and the question queue.
 *
 * Run against a seeded database:
 *   DATABASE_URL='...' node --test server/tests/
 *
 * These assert the boundaries that matter clinically — that the assistant
 * refuses rather than guesses, that a refusal always leaves a ticket, and that
 * one patient can never read another's record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, ask, REFUSAL_MESSAGE } from '../src/services/assistant.js';
import { glucoseTrend, windowStats } from '../src/services/glucoseTrend.js';
import { approvedGlucoseRange } from '../src/services/guidance.js';
import { questionsForPatient, answerQuestion, REFUSAL } from '../src/services/patientQuestions.js';
import { assertPatientAccess } from '../src/services/access.js';
import { all, get, run, closePool } from '../src/db/index.js';

const patient = await get(
  `SELECT p.* FROM patients p
     JOIN care_plans c ON c.patient_id = p.id AND c.status = 'active'
    WHERE p.user_id IS NOT NULL
    ORDER BY p.id LIMIT 1`,
);
const nurse = await get(`SELECT * FROM users WHERE role = 'nurse' ORDER BY id LIMIT 1`);
const patientUser = await get('SELECT * FROM users WHERE id = ?', patient.user_id);

test.after(async () => { await closePool(); });

// ---------------------------------------------------------------- 1. trend

test('glucose trend reports objective statistics', async () => {
  const range = await approvedGlucoseRange(patient.id);
  const trend = await glucoseTrend(patient.id, range);

  assert.ok(trend.total_readings > 0, 'seeded patient should have readings');
  assert.equal(typeof trend.last_7_days.all.count, 'number');
  assert.equal(typeof trend.last_30_days.all.count, 'number');
  assert.ok(trend.last_30_days.all.count >= trend.last_7_days.all.count);

  const { all: week } = trend.last_7_days;
  if (week.count > 0) {
    assert.ok(week.min <= week.average && week.average <= week.max);
  }
  assert.ok(Array.isArray(trend.recent));
});

test('in-range percentage is withheld when no approved range exists', async () => {
  const stats = await windowStats(patient.id, 7, null);
  assert.equal(stats.in_range, null, 'no range means no in-range claim');
});

test('in-range percentage carries the provenance of its bounds', async () => {
  const range = await approvedGlucoseRange(patient.id);
  if (!range) return; // patient has no approved plan; nothing to assert
  const stats = await windowStats(patient.id, 7, range);
  if (stats.in_range) {
    assert.ok(stats.in_range.source, 'range must say where it came from');
    assert.equal(stats.in_range.source.kind, 'care_plan');
    assert.ok(stats.in_range.percent >= 0 && stats.in_range.percent <= 100);
  }
});

// ------------------------------------------------------------ 2. classify

test('dose questions are classified as medication changes', () => {
  assert.equal(classify('Insulinni ikki marta qilaymi?'), 'medication_change');
  assert.equal(classify('Dozani oshirsam bo‘ladimi?'), 'medication_change');
  assert.equal(classify('Metforminni to‘xtataymi?'), 'medication_change');
});

// Uzbek suffixes are the failure mode worth pinning: an earlier whole-word
// match let "dozasini oshirsam" through as an ordinary question.
test('dose questions are caught through their suffixes', () => {
  for (const question of [
    'Insulin dozasini oshirsam bo‘ladimi?',
    'Insulin dozamni kamaytirsam?',
    'Dorimni ichmasam bo‘ladimi?',
    'Tabletkani ko‘proq ichsam bo‘ladimi?',
    'Ukolni tashlasam nima bo‘ladi?',
  ]) {
    assert.equal(classify(question), 'medication_change', question);
  }
});

test('ordinary questions are not swept up as dose changes', () => {
  assert.notEqual(classify('Ertaga qabulga kelaymi?'), 'medication_change');
  assert.notEqual(classify('Qandim oxirgi kunlarda qanday?'), 'medication_change');
});

test('emergency wording outranks every other category', () => {
  assert.equal(classify('Nafas ololmayapman va dozani oshirsam?'), 'emergency');
});

test('trend questions are recognised', () => {
  assert.equal(classify('Qandim oxirgi kunlarda qanday bo‘lyapti?'), 'glucose_trend');
});

// -------------------------------------------------------------- 3. refusal

test('a dose question is refused and queued, never answered', async () => {
  const before = (await questionsForPatient(patient.id)).length;
  const result = await ask({ patient, user: patientUser, question: 'Insulinni ikki marta qilaymi?' });

  assert.equal(result.answered, false);
  assert.equal(result.message, REFUSAL_MESSAGE);
  assert.equal(result.refusal_reason, REFUSAL.MEDICATION_CHANGE);
  assert.ok(result.question_id, 'refusal must leave a ticket');

  const after = await questionsForPatient(patient.id);
  assert.equal(after.length, before + 1);
  assert.equal(after[0].status, 'unanswered');
});

test('a diagnosis request is refused', async () => {
  const result = await ask({ patient, user: patientUser, question: 'Menda nima kasallik bor?' });
  assert.equal(result.answered, false);
  assert.equal(result.refusal_reason, REFUSAL.DIAGNOSIS_REQUEST);
});

test('emergency wording routes to emergency care at urgent priority', async () => {
  const result = await ask({ patient, user: patientUser, question: 'Nafas ololmayapman' });
  assert.equal(result.emergency, true);
  assert.equal(result.priority, 'urgent');
  assert.match(result.message, /103/);
});

test('urgent priority is never reached by an ordinary question', async () => {
  const result = await ask({ patient, user: patientUser, question: 'Qandim oxirgi kunlarda qanday?' });
  assert.notEqual(result.priority, 'urgent');
});

// ---------------------------------------------------------------- 4. trend answer

test('a trend question is answered from the record, with a disclaimer', async () => {
  const range = await approvedGlucoseRange(patient.id);
  const result = await ask({ patient, user: patientUser, question: 'Qandim oxirgi haftada qanday bo‘lyapti?' });

  if (!range) {
    assert.equal(result.answered, false, 'no approved range means refusal');
    assert.equal(result.refusal_reason, REFUSAL.NO_SOURCE);
    return;
  }
  assert.equal(result.answered, true);
  assert.match(result.message, /o‘lchov/);
  assert.ok(result.disclaimer.includes('tashxis qo‘ymaydi'));
  assert.ok(result.trend.last_7_days);
});

// ------------------------------------------------------- 5. staff answering

test('staff answer reaches the patient and closes the ticket', async () => {
  const refused = await ask({ patient, user: patientUser, question: 'Dozani kamaytirsam bo‘ladimi?' });
  const answered = await answerQuestion({
    questionId: refused.question_id,
    user: nurse,
    answer: 'Dozani o‘zgartirmang. Ertaga qabulga keling.',
  });

  assert.equal(answered.status, 'answered');
  assert.equal(answered.answered_by, nurse.id);

  const visible = (await questionsForPatient(patient.id)).find((q) => q.id === refused.question_id);
  assert.equal(visible.answer, 'Dozani o‘zgartirmang. Ertaga qabulga keling.');
  assert.equal(visible.answered_by_name, nurse.full_name);
});

// -------------------------------------------------------------- 6. isolation

test('a patient sees only their own questions', async () => {
  const other = await get('SELECT * FROM patients WHERE id <> ? ORDER BY id LIMIT 1', patient.id);
  const mine = await questionsForPatient(patient.id);
  const theirs = await questionsForPatient(other.id);
  const overlap = mine.filter((m) => theirs.some((t) => t.id === m.id));
  assert.equal(overlap.length, 0);
});

test('a patient cannot reach another patient through the access gate', async () => {
  const other = await get('SELECT * FROM patients WHERE id <> ? ORDER BY id LIMIT 1', patient.id);
  await assert.rejects(
    () => assertPatientAccess(patientUser, other.id, 'view_measurements'),
    (err) => err.status === 403 || err.status === 404,
  );
});

test('staff cannot reach a patient at another hospital', async () => {
  const foreign = await get(
    'SELECT * FROM patients WHERE hospital_id <> ? ORDER BY id LIMIT 1',
    nurse.hospital_id,
  );
  if (!foreign) return; // single-hospital demo data
  await assert.rejects(() => assertPatientAccess(nurse, foreign.id, 'view_measurements'));
});

// ------------------------------------------------------------ 7. medications

test('medication rows carry reminder metadata', async () => {
  const meds = await all(
    `SELECT m.id, m.name, m.is_active, m.reminders_enabled, m.prescriber_id
       FROM medications m
       JOIN care_plans p ON p.id = m.care_plan_id
      WHERE p.patient_id = ? AND p.status = 'active'`,
    patient.id,
  );
  assert.ok(meds.length > 0);
  for (const med of meds) {
    assert.ok(med.is_active === 0 || med.is_active === 1);
    assert.ok(med.reminders_enabled === 0 || med.reminders_enabled === 1);
  }
});

test('dose events record taken and missed transitions', async () => {
  const dose = await get(
    `SELECT id, status FROM medication_doses WHERE patient_id = ? ORDER BY scheduled_at DESC LIMIT 1`,
    patient.id,
  );
  assert.ok(dose, 'seeded patient should have scheduled doses');

  const original = dose.status;
  await run(`UPDATE medication_doses SET status = 'taken', taken_at = datetime('now') WHERE id = ?`, dose.id);
  const taken = await get('SELECT status, taken_at FROM medication_doses WHERE id = ?', dose.id);
  assert.equal(taken.status, 'taken');
  assert.ok(taken.taken_at);

  await run(`UPDATE medication_doses SET status = 'missed', taken_at = NULL WHERE id = ?`, dose.id);
  const missed = await get('SELECT status FROM medication_doses WHERE id = ?', dose.id);
  assert.equal(missed.status, 'missed');

  await run('UPDATE medication_doses SET status = ? WHERE id = ?', original, dose.id);
});
