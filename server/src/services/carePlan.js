import { all, get, insert, run, transaction } from '../db/index.js';
import { addDays, nowLocal, toDateKey } from '../lib/time.js';
import { createDefaultRules } from './alertEngine.js';

/**
 * Care plan lifecycle.
 *
 * A patient has at most one ACTIVE plan. Editing an active plan never mutates
 * it: a new draft version is created, reviewed, and approved by a healthcare
 * professional, and only then does it replace the previous one — which is kept,
 * archived, together with an immutable snapshot.
 */

/**
 * Uzbek schedule presets. The preset describes *when in the day* a medicine is
 * taken; the concrete reminder clock time is a separate, editable value. These
 * times are only suggested defaults for the nurse, not medical rules.
 */
export const SCHEDULE_PRESETS = {
  morning: { label: 'Ertalab', times: ['08:00'] },
  morning_noon: { label: 'Ertalab va tushda', times: ['08:00', '13:00'] },
  morning_evening: { label: 'Ertalab va kechqurun', times: ['08:00', '20:00'] },
  noon: { label: 'Tushda', times: ['13:00'] },
  noon_evening: { label: 'Tushda va kechqurun', times: ['13:00', '20:00'] },
  evening: { label: 'Kechqurun', times: ['20:00'] },
  bedtime: { label: 'Uxlashdan oldin', times: ['22:00'] },
  every_8h: { label: 'Har 8 soatda', times: ['06:00', '14:00', '22:00'] },
  every_12h: { label: 'Har 12 soatda', times: ['08:00', '20:00'] },
  as_needed: { label: "Zarurat bo'lganda", times: [] },
  custom: { label: 'Aniq vaqtni belgilash', times: [] },
};

export const PLAN_HORIZON_DAYS = 3;

export function getActivePlan(patientId) {
  return get(
    `SELECT * FROM care_plans WHERE patient_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1`,
    patientId,
  );
}

export function getPlanDetail(planId) {
  const plan = get('SELECT * FROM care_plans WHERE id = ?', planId);
  if (!plan) return null;

  const medications = all(
    'SELECT * FROM medications WHERE care_plan_id = ? ORDER BY id',
    planId,
  ).map((med) => ({
    ...med,
    schedules: all(
      'SELECT * FROM medication_schedules WHERE medication_id = ? ORDER BY time_of_day',
      med.id,
    ),
  }));

  const monitoring = all(
    'SELECT * FROM monitoring_configs WHERE care_plan_id = ? ORDER BY id',
    planId,
  ).map((config) => ({
    ...config,
    times: all(
      'SELECT * FROM monitoring_times WHERE monitoring_config_id = ? ORDER BY time_of_day',
      config.id,
    ),
  }));

  const rules = all('SELECT * FROM alert_rules WHERE care_plan_id = ? ORDER BY code', planId);
  const approver = plan.approved_by
    ? get('SELECT id, full_name, role FROM users WHERE id = ?', plan.approved_by)
    : null;

  return { ...plan, medications, monitoring, rules, approver };
}

function nextVersion(patientId) {
  const row = get('SELECT MAX(version) AS v FROM care_plans WHERE patient_id = ?', patientId);
  return (row?.v ?? 0) + 1;
}

/**
 * Creates a new DRAFT plan version. Draft plans generate no reminders — the
 * patient is only ever driven by an approved, active plan.
 */
export function createDraftPlan(patientId, payload, user) {
  return transaction(() => {
    const version = nextVersion(patientId);
    const planId = insert(
      `INSERT INTO care_plans
         (patient_id, version, status, source, start_date, end_date, notes,
          reminder_repeat_minutes, reminder_max_count, snooze_minutes,
          escalate_normal_minutes, escalate_important_minutes, escalate_critical_minutes,
          created_by)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patientId,
      version,
      payload.source ?? 'manual',
      payload.start_date ?? toDateKey(),
      payload.end_date ?? null,
      payload.notes ?? null,
      payload.reminder_repeat_minutes ?? 30,
      payload.reminder_max_count ?? 2,
      payload.snooze_minutes ?? 15,
      payload.escalate_normal_minutes ?? 240,
      payload.escalate_important_minutes ?? 120,
      payload.escalate_critical_minutes ?? 60,
      user?.id ?? null,
    );

    for (const med of payload.medications ?? []) {
      const preset = SCHEDULE_PRESETS[med.schedule_type] ?? SCHEDULE_PRESETS.morning;
      const times = (med.times?.length ? med.times : preset.times).filter(Boolean);
      const medId = insert(
        `INSERT INTO medications
           (care_plan_id, name, dose, unit, doses_per_day, schedule_type, priority,
            start_date, end_date, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        planId,
        med.name,
        String(med.dose),
        med.unit ?? 'mg',
        times.length || med.doses_per_day || 1,
        med.schedule_type ?? 'morning',
        med.priority ?? 'normal',
        med.start_date ?? payload.start_date ?? toDateKey(),
        med.end_date ?? null,
        med.notes ?? null,
        user?.id ?? null,
      );
      for (const time of times) {
        insert(
          `INSERT INTO medication_schedules (medication_id, time_of_day, label, created_by)
           VALUES (?, ?, ?, ?)`,
          medId,
          time,
          med.schedule_label ?? null,
          user?.id ?? null,
        );
      }
    }

    for (const config of payload.monitoring ?? []) {
      const configId = insert(
        `INSERT INTO monitoring_configs
           (care_plan_id, type, enabled, frequency_per_day, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        planId,
        config.type,
        config.enabled ? 1 : 0,
        config.frequency_per_day ?? (config.times?.length || 1),
        config.notes ?? null,
        user?.id ?? null,
      );
      for (const time of config.times ?? []) {
        insert(
          `INSERT INTO monitoring_times (monitoring_config_id, time_of_day, context, created_by)
           VALUES (?, ?, ?, ?)`,
          configId,
          typeof time === 'string' ? time : time.time_of_day,
          typeof time === 'string' ? 'any' : (time.context ?? 'any'),
          user?.id ?? null,
        );
      }
    }

    createDefaultRules(planId, user?.id);

    // Thresholds supplied by staff override the offered defaults.
    for (const rule of payload.rules ?? []) {
      run(
        `UPDATE alert_rules
            SET enabled = ?, value_1 = ?, value_2 = ?, severity = COALESCE(?, severity),
                updated_at = datetime('now')
          WHERE care_plan_id = ? AND code = ?`,
        rule.enabled === false ? 0 : 1,
        rule.value_1 ?? null,
        rule.value_2 ?? null,
        rule.severity ?? null,
        planId,
        rule.code,
      );
    }

    return planId;
  });
}

/**
 * Approves a draft plan: archives the previous active version, records an
 * immutable snapshot with the approving professional, and generates the
 * patient's upcoming tasks.
 */
export function approvePlan(planId, user, changeReason) {
  const plan = get('SELECT * FROM care_plans WHERE id = ?', planId);
  if (!plan) return null;

  transaction(() => {
    const previous = getActivePlan(plan.patient_id);
    if (previous && previous.id !== planId) {
      run(
        `UPDATE care_plans SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
        previous.id,
      );
      // Future, untouched tasks from the superseded plan are removed so the
      // patient is not driven by two plans at once. History stays intact.
      run(
        `DELETE FROM medication_doses
          WHERE care_plan_id = ? AND status = 'pending' AND scheduled_at > ?`,
        previous.id,
        nowLocal(),
      );
      run(
        `DELETE FROM monitoring_tasks
          WHERE care_plan_id = ? AND status = 'pending' AND scheduled_at > ?`,
        previous.id,
        nowLocal(),
      );
    }

    run(
      `UPDATE care_plans
          SET status = 'active', approved_by = ?, approved_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
      user.id,
      planId,
    );

    const snapshot = getPlanDetail(planId);
    insert(
      `INSERT INTO care_plan_versions
         (care_plan_id, patient_id, version, snapshot_json, change_reason,
          approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      planId,
      plan.patient_id,
      plan.version,
      JSON.stringify(snapshot),
      changeReason ?? null,
      user.id,
      user.id,
    );
  });

  generateTasks(planId, PLAN_HORIZON_DAYS);
  return getPlanDetail(planId);
}

function medicationActiveOn(med, dateKey) {
  if (med.start_date && dateKey < med.start_date) return false;
  if (med.end_date && dateKey > med.end_date) return false;
  return true;
}

/**
 * Materialises the concrete dose and measurement instances the patient sees.
 * Idempotent — a unique constraint keeps repeated runs from duplicating rows.
 */
export function generateTasks(planId, days = PLAN_HORIZON_DAYS, fromDate = new Date()) {
  const plan = get('SELECT * FROM care_plans WHERE id = ?', planId);
  if (!plan || plan.status !== 'active') return 0;

  const medications = all(
    `SELECT m.*, s.id AS schedule_id, s.time_of_day
       FROM medications m
       JOIN medication_schedules s ON s.medication_id = m.id
      WHERE m.care_plan_id = ? AND m.schedule_type != 'as_needed'`,
    planId,
  );
  const monitoring = all(
    `SELECT c.type, t.time_of_day, t.context
       FROM monitoring_configs c
       JOIN monitoring_times t ON t.monitoring_config_id = c.id
      WHERE c.care_plan_id = ? AND c.enabled = 1`,
    planId,
  );

  let created = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = toDateKey(addDays(fromDate, offset));
    if (plan.end_date && dateKey > plan.end_date) break;
    if (plan.start_date && dateKey < plan.start_date) continue;

    for (const med of medications) {
      if (!medicationActiveOn(med, dateKey)) continue;
      const result = run(
        `INSERT OR IGNORE INTO medication_doses
           (patient_id, care_plan_id, medication_id, schedule_id, scheduled_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        plan.patient_id,
        planId,
        med.id,
        med.schedule_id,
        `${dateKey} ${med.time_of_day}`,
        plan.approved_by,
      );
      created += result.changes;
    }

    for (const item of monitoring) {
      const result = run(
        `INSERT OR IGNORE INTO monitoring_tasks
           (patient_id, care_plan_id, type, context, scheduled_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        plan.patient_id,
        planId,
        item.type,
        item.context,
        `${dateKey} ${item.time_of_day}`,
        plan.approved_by,
      );
      created += result.changes;
    }
  }
  return created;
}

/** Keeps every active plan stocked with upcoming tasks. */
export function generateTasksForAllActivePlans() {
  const plans = all("SELECT id FROM care_plans WHERE status = 'active'");
  let created = 0;
  for (const plan of plans) created += generateTasks(plan.id, PLAN_HORIZON_DAYS);
  return created;
}
