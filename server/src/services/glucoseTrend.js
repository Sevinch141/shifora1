/**
 * Objective glucose statistics.
 *
 * This module deliberately stops at arithmetic. It reports what the readings
 * are — averages, extremes, counts, direction of change, share inside a range —
 * and never says whether any of it is good, bad or dangerous. Interpretation
 * needs a reference range, and reference ranges come from approved guidance or
 * a clinician-approved care plan, never from here (see services/guidance.js).
 *
 * The one range this module applies is one it is handed by the caller, which
 * gets it from the patient's approved alert rules.
 */
import { all, get } from '../db/index.js';
import { nowLocal, addDays, toDateKey } from '../lib/time.js';

/** Contexts the UI and seed use, grouped for reporting. */
export const FASTING_CONTEXTS = ['fasting'];
export const POST_MEAL_CONTEXTS = ['after_meal'];

function round(value, places = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function summarise(rows) {
  if (rows.length === 0) {
    return { count: 0, average: null, min: null, max: null, unit: null };
  }
  const values = rows.map((r) => r.value);
  return {
    count: rows.length,
    average: round(values.reduce((a, b) => a + b, 0) / values.length),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    unit: rows[0].unit,
  };
}

/**
 * Share of readings inside [low, high].
 *
 * Returns null when no range was supplied — an unbounded "in range" figure
 * would be a number with no meaning, and inventing bounds here is exactly what
 * this codebase must not do.
 */
function inRange(rows, range) {
  if (!range || range.low === null || range.high === null || rows.length === 0) return null;
  const inside = rows.filter((r) => r.value >= range.low && r.value <= range.high).length;
  return {
    low: range.low,
    high: range.high,
    unit: range.unit ?? rows[0].unit,
    inside,
    total: rows.length,
    percent: Math.round((inside / rows.length) * 100),
    source: range.source,
  };
}

/** Readings for a patient over a window, newest first. */
export async function readingsSince(patientId, days) {
  const from = `${toDateKey(addDays(new Date(), -days))} 00:00`;
  return all(
    `SELECT id, value, unit, context, measured_at, note
       FROM glucose_readings
      WHERE patient_id = ? AND measured_at >= ?
      ORDER BY measured_at DESC`,
    patientId,
    from,
  );
}

/**
 * A window's statistics, split by measurement context.
 *
 * `range` is optional and, when given, must carry its own provenance so the
 * caller can cite where the boundary came from.
 */
export async function windowStats(patientId, days, range = null) {
  const rows = await readingsSince(patientId, days);
  const fasting = rows.filter((r) => FASTING_CONTEXTS.includes(r.context));
  const postMeal = rows.filter((r) => POST_MEAL_CONTEXTS.includes(r.context));

  // Direction of change: the two halves of the window compared. Reported as a
  // signed delta, with no claim about whether the direction is an improvement.
  let change = null;
  if (rows.length >= 4) {
    const ordered = [...rows].reverse();
    const half = Math.floor(ordered.length / 2);
    const earlier = ordered.slice(0, half);
    const later = ordered.slice(half);
    const mean = (list) => list.reduce((a, b) => a + b.value, 0) / list.length;
    const from = mean(earlier);
    const to = mean(later);
    change = {
      earlier_average: round(from),
      later_average: round(to),
      delta: round(to - from),
      unit: rows[0].unit,
    };
  }

  return {
    days,
    all: summarise(rows),
    fasting: summarise(fasting),
    post_meal: summarise(postMeal),
    change,
    in_range: inRange(rows, range),
    latest: rows[0]
      ? { value: rows[0].value, unit: rows[0].unit, context: rows[0].context, measured_at: rows[0].measured_at }
      : null,
  };
}

/**
 * The full picture the assistant and the staff screens both read from.
 * Pure numbers — any wording about what they mean is added elsewhere.
 */
export async function glucoseTrend(patientId, range = null) {
  const [week, month] = await Promise.all([
    windowStats(patientId, 7, range),
    windowStats(patientId, 30, range),
  ]);

  const recent = await all(
    `SELECT value, unit, context, measured_at
       FROM glucose_readings
      WHERE patient_id = ?
      ORDER BY measured_at DESC
      LIMIT 10`,
    patientId,
  );

  const total = await get(
    'SELECT COUNT(*)::int AS c FROM glucose_readings WHERE patient_id = ?',
    patientId,
  );

  return {
    generated_at: nowLocal(),
    total_readings: total?.c ?? 0,
    last_7_days: week,
    last_30_days: month,
    recent,
  };
}
