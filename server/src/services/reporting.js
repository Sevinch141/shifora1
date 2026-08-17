import { all, get } from '../db/index.js';
import { addDays, nowLocal, toDateKey } from '../lib/time.js';
import { getActivePlan } from './carePlan.js';

/** Adherence over a window, as a whole percentage (null when nothing was due). */
export function adherenceRate(patientId, days = 7) {
  const from = toDateKey(addDays(new Date(), -days));
  const row = get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) AS taken
       FROM medication_doses
      WHERE patient_id = ? AND scheduled_at >= ? AND scheduled_at <= ?`,
    patientId,
    from,
    nowLocal(),
  );
  const total = row?.total ?? 0;
  const taken = row?.taken ?? 0;
  return { total, taken, rate: total > 0 ? Math.round((taken / total) * 100) : null };
}

export function latestGlucose(patientId) {
  return get(
    'SELECT * FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 1',
    patientId,
  );
}

export function lastActivity(patientId) {
  const row = get(
    `SELECT MAX(ts) AS ts FROM (
        SELECT MAX(taken_at) AS ts FROM medication_doses WHERE patient_id = ?
        UNION ALL SELECT MAX(measured_at) FROM glucose_readings WHERE patient_id = ?
        UNION ALL SELECT MAX(measured_at) FROM blood_pressure_readings WHERE patient_id = ?
        UNION ALL SELECT MAX(reported_at) FROM symptom_checks WHERE patient_id = ?
     )`,
    patientId, patientId, patientId, patientId,
  );
  return row?.ts ?? null;
}

/** Everything the reports screen needs for one patient over a period. */
export function buildReport(patientId, days = 7) {
  const fromKey = toDateKey(addDays(new Date(), -(days - 1)));
  const from = `${fromKey} 00:00`;
  const to = nowLocal();

  const doses = all(
    `SELECT d.*, m.name, m.priority FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id
      WHERE d.patient_id = ? AND d.scheduled_at >= ? AND d.scheduled_at <= ?
      ORDER BY d.scheduled_at`,
    patientId, from, to,
  );

  const byDay = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    byDay.set(toDateKey(addDays(new Date(), -i)), { date: toDateKey(addDays(new Date(), -i)), total: 0, taken: 0 });
  }
  for (const dose of doses) {
    const key = dose.scheduled_at.slice(0, 10);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (dose.status === 'taken') bucket.taken += 1;
  }
  const adherenceByDay = [...byDay.values()].map((b) => ({
    ...b,
    rate: b.total > 0 ? Math.round((b.taken / b.total) * 100) : null,
  }));

  const glucose = all(
    `SELECT * FROM glucose_readings WHERE patient_id = ? AND measured_at >= ?
      ORDER BY measured_at`,
    patientId, from,
  );
  const bp = all(
    `SELECT * FROM blood_pressure_readings WHERE patient_id = ? AND measured_at >= ?
      ORDER BY measured_at`,
    patientId, from,
  );
  const symptoms = all(
    `SELECT * FROM symptom_checks WHERE patient_id = ? AND reported_at >= ?
      ORDER BY reported_at DESC`,
    patientId, from,
  );
  const alerts = all(
    `SELECT * FROM alerts WHERE patient_id = ? AND created_at >= ?
      ORDER BY created_at DESC`,
    patientId, from,
  );

  const totals = doses.reduce(
    (acc, d) => {
      acc.total += 1;
      if (d.status === 'taken') acc.taken += 1;
      else if (d.status === 'missed') acc.missed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, taken: 0, missed: 0, pending: 0 },
  );

  const glucoseValues = glucose.map((g) => g.value);
  const plan = getActivePlan(patientId);

  return {
    period_days: days,
    from: fromKey,
    to: toDateKey(),
    adherence: {
      ...totals,
      rate: totals.total > 0 ? Math.round((totals.taken / totals.total) * 100) : null,
      by_day: adherenceByDay,
    },
    glucose: {
      count: glucose.length,
      average: glucoseValues.length
        ? Math.round(glucoseValues.reduce((s, v) => s + v, 0) / glucoseValues.length)
        : null,
      min: glucoseValues.length ? Math.min(...glucoseValues) : null,
      max: glucoseValues.length ? Math.max(...glucoseValues) : null,
      readings: glucose,
    },
    blood_pressure: { count: bp.length, readings: bp },
    symptoms: {
      count: symptoms.length,
      not_good: symptoms.filter((s) => s.feeling !== 'good').length,
      checks: symptoms,
    },
    alerts: {
      count: alerts.length,
      urgent: alerts.filter((a) => a.severity === 'urgent').length,
      items: alerts,
    },
    care_plan: plan ? { id: plan.id, version: plan.version, approved_at: plan.approved_at } : null,
  };
}
