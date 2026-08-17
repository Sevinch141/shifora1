import { all, get, insert, run } from '../db/index.js';
import { nowLocal, toDateKey } from '../lib/time.js';
import { notify } from './notifications.js';
import { getCaregiverLink, caregiverPermissions } from './access.js';

/**
 * Deterministic, rules-based alert engine.
 *
 * Every threshold lives in the `alert_rules` table, scoped to a care plan and
 * approved by a healthcare professional. Nothing in this file decides what is
 * clinically dangerous on its own — it only compares a measurement against the
 * values that staff configured, and hands the result to a human to review.
 */

export const SEVERITY_ORDER = { info: 1, warning: 2, urgent: 3 };

/**
 * Starting values offered to the nurse when a care plan is created.
 * They are editable and must be approved before the plan goes active.
 */
export function defaultAlertRules() {
  return [
    {
      code: 'glucose_critical_low',
      comparator: 'lt',
      value_1: 54,
      severity: 'urgent',
      message_uz: 'Glyukoza belgilangan pastki chegaradan sezilarli past.',
    },
    {
      code: 'glucose_low',
      comparator: 'lt',
      value_1: 70,
      severity: 'warning',
      message_uz: 'Glyukoza belgilangan pastki chegaradan past.',
    },
    {
      code: 'glucose_high',
      comparator: 'gt',
      value_1: 180,
      severity: 'warning',
      message_uz: 'Glyukoza belgilangan yuqori chegaradan yuqori.',
    },
    {
      code: 'glucose_critical_high',
      comparator: 'gt',
      value_1: 300,
      severity: 'urgent',
      message_uz: 'Glyukoza belgilangan yuqori chegaradan sezilarli yuqori.',
    },
    {
      code: 'bp_high',
      comparator: 'gt',
      value_1: 140,
      value_2: 90,
      severity: 'warning',
      message_uz: 'Qon bosimi belgilangan chegaradan yuqori.',
    },
    {
      code: 'bp_critical_high',
      comparator: 'gt',
      value_1: 180,
      value_2: 110,
      severity: 'urgent',
      message_uz: 'Qon bosimi belgilangan chegaradan sezilarli yuqori.',
    },
    {
      code: 'symptom_attention',
      comparator: null,
      value_1: null,
      severity: 'warning',
      message_uz: "Bemor o'zini yaxshi his qilmayotganini bildirdi.",
    },
    {
      code: 'symptom_urgent',
      comparator: null,
      value_1: null,
      severity: 'urgent',
      message_uz: "Bemor o'zini yomon his qilayotganini bildirdi.",
    },
    {
      code: 'monitoring_missed',
      comparator: 'gt',
      value_1: 2,
      severity: 'warning',
      message_uz: "Belgilangan o'lchovlar bajarilmadi.",
    },
  ];
}

export function createDefaultRules(carePlanId, createdBy) {
  for (const rule of defaultAlertRules()) {
    insert(
      `INSERT OR IGNORE INTO alert_rules
         (care_plan_id, code, enabled, comparator, value_1, value_2, severity, message_uz, created_by)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      carePlanId,
      rule.code,
      rule.comparator,
      rule.value_1,
      rule.value_2 ?? null,
      rule.severity,
      rule.message_uz,
      createdBy ?? null,
    );
  }
}

function rulesFor(carePlanId) {
  const rows = all('SELECT * FROM alert_rules WHERE care_plan_id = ? AND enabled = 1', carePlanId);
  const map = {};
  for (const row of rows) map[row.code] = row;
  return map;
}

/** Recomputes the patient's monitoring workflow status from open alerts. */
export function recomputePatientStatus(patientId) {
  const open = all(
    `SELECT severity FROM alerts WHERE patient_id = ? AND status != 'closed'`,
    patientId,
  );
  let status = 'stable';
  for (const row of open) {
    if (row.severity === 'urgent') { status = 'urgent'; break; }
    if (row.severity === 'warning') status = 'attention';
  }
  run(
    "UPDATE patients SET status = ?, updated_at = datetime('now') WHERE id = ?",
    status,
    patientId,
  );
  return status;
}

function notifyStaff(patient, alertId, title, detail, severity) {
  const staff = all(
    `SELECT id FROM users
      WHERE hospital_id = ? AND is_active = 1 AND role IN ('nurse', 'doctor')`,
    patient.hospital_id,
  );
  for (const member of staff) {
    notify({
      userId: member.id,
      patientId: patient.id,
      type: severity === 'urgent' ? 'alert_urgent' : 'alert',
      title,
      body: detail,
      entityType: 'alert',
      entityId: alertId,
    });
  }
}

function notifyCaregivers(patient, alertId, title, detail) {
  const links = all(
    `SELECT * FROM caregivers WHERE patient_id = ? AND status = 'active'`,
    patient.id,
  );
  for (const link of links) {
    if (!caregiverPermissions(link.id).view_alerts) continue;
    notify({
      userId: link.user_id,
      patientId: patient.id,
      type: 'alert',
      title,
      body: detail,
      entityType: 'alert',
      entityId: alertId,
    });
  }
}

/**
 * Creates an alert for staff review. While an alert with the same dedup key is
 * open it is updated rather than duplicated, so a nurse sees one live item per
 * problem instead of a flood.
 */
export function raiseAlert({
  patient,
  carePlanId = null,
  code,
  severity,
  title,
  detail,
  context = null,
  dedupKey = null,
  silent = false,
  createdAt = null,
}) {
  if (dedupKey) {
    const existing = get('SELECT * FROM alerts WHERE dedup_key = ?', dedupKey);
    if (existing) {
      const nextSeverity =
        SEVERITY_ORDER[severity] > SEVERITY_ORDER[existing.severity] ? severity : existing.severity;
      run(
        `UPDATE alerts SET detail = ?, severity = ?, context_json = ?, updated_at = datetime('now')
          WHERE id = ?`,
        detail,
        nextSeverity,
        context ? JSON.stringify(context) : existing.context_json,
        existing.id,
      );
      recomputePatientStatus(patient.id);
      return existing.id;
    }
  }

  const alertId = insert(
    `INSERT INTO alerts
       (hospital_id, patient_id, care_plan_id, rule_code, severity, title, detail,
        context_json, status, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, COALESCE(?, datetime('now')))`,
    patient.hospital_id,
    patient.id,
    carePlanId,
    code,
    severity,
    title,
    detail,
    context ? JSON.stringify(context) : null,
    dedupKey,
    createdAt,
  );

  recomputePatientStatus(patient.id);

  if (!silent) {
    const who = `${patient.first_name} ${patient.last_name}`;
    notifyStaff(patient, alertId, title, `${who}: ${detail}`, severity);
    notifyCaregivers(patient, alertId, title, detail);
  }
  return alertId;
}

/** Closing an alert frees its dedup key so a later recurrence can be raised. */
export function closeAlert(alertId, userId) {
  run(
    `UPDATE alerts
        SET status = 'closed', resolved_at = datetime('now'), resolved_by = ?,
            dedup_key = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    userId,
    alertId,
  );
  const alert = get('SELECT patient_id FROM alerts WHERE id = ?', alertId);
  if (alert) recomputePatientStatus(alert.patient_id);
}

// ---------------------------------------------------------------------------
// Measurement evaluation
// ---------------------------------------------------------------------------

const GLUCOSE_CONTEXT_UZ = {
  fasting: 'och qoringa',
  before_meal: 'ovqatdan oldin',
  after_meal: 'ovqatdan keyin',
  bedtime: 'uxlashdan oldin',
  any: 'belgilanmagan',
};

export function evaluateGlucose(patient, reading, carePlan, options = {}) {
  if (!carePlan) return null;
  const rules = rulesFor(carePlan.id);
  const value = reading.value;
  const ordered = ['glucose_critical_low', 'glucose_critical_high', 'glucose_low', 'glucose_high'];

  for (const code of ordered) {
    const rule = rules[code];
    if (!rule) continue;
    const hit = rule.comparator === 'lt' ? value < rule.value_1 : value > rule.value_1;
    if (!hit) continue;
    return raiseAlert({
      patient,
      carePlanId: carePlan.id,
      code,
      severity: rule.severity,
      title: 'Glyukoza chegaradan chiqdi',
      detail: `${rule.message_uz} O'lchov: ${value} mg/dL (${GLUCOSE_CONTEXT_UZ[reading.context] ?? 'belgilanmagan'}), chegara: ${rule.value_1} mg/dL.`,
      context: { value, unit: 'mg/dL', measured_at: reading.measured_at, threshold: rule.value_1 },
      dedupKey: `${code}:${patient.id}`,
      silent: options.silent,
      createdAt: options.createdAt,
    });
  }
  return null;
}

export function evaluateBloodPressure(patient, reading, carePlan, options = {}) {
  if (!carePlan) return null;
  const rules = rulesFor(carePlan.id);
  for (const code of ['bp_critical_high', 'bp_high']) {
    const rule = rules[code];
    if (!rule) continue;
    const hit = reading.systolic > rule.value_1 || reading.diastolic > rule.value_2;
    if (!hit) continue;
    return raiseAlert({
      patient,
      carePlanId: carePlan.id,
      code,
      severity: rule.severity,
      title: 'Qon bosimi chegaradan chiqdi',
      detail: `${rule.message_uz} O'lchov: ${reading.systolic}/${reading.diastolic} mmHg, chegara: ${rule.value_1}/${rule.value_2} mmHg.`,
      context: {
        systolic: reading.systolic,
        diastolic: reading.diastolic,
        measured_at: reading.measured_at,
      },
      dedupKey: `${code}:${patient.id}`,
      silent: options.silent,
      createdAt: options.createdAt,
    });
  }
  return null;
}

export const SYMPTOM_LABELS_UZ = {
  thirst: 'Kuchli chanqash',
  urination: 'Tez-tez siyish',
  dizziness: 'Bosh aylanishi',
  weakness: 'Kuchli holsizlik',
  nausea: "Ko'ngil aynishi yoki qusish",
  tremor: 'Titrash',
  sweating: 'Terlash',
  confusion: 'Chalkashlik',
  other: 'Boshqa',
};

export function evaluateSymptomCheck(patient, check, carePlan, options = {}) {
  if (!carePlan || check.feeling === 'good') return null;
  const rules = rulesFor(carePlan.id);
  const code = check.feeling === 'bad' ? 'symptom_urgent' : 'symptom_attention';
  const rule = rules[code];
  if (!rule) return null;

  const symptoms = Array.isArray(check.symptoms) ? check.symptoms : JSON.parse(check.symptoms ?? '[]');
  const labels = symptoms.map((key) => SYMPTOM_LABELS_UZ[key] ?? key);
  const detail = labels.length
    ? `${rule.message_uz} Belgilar: ${labels.join(', ')}.`
    : rule.message_uz;

  return raiseAlert({
    patient,
    carePlanId: carePlan.id,
    code,
    severity: rule.severity,
    title: 'Bemor belgilar haqida xabar berdi',
    detail,
    context: { feeling: check.feeling, symptoms, reported_at: check.reported_at },
    dedupKey: `${code}:${patient.id}`,
    silent: options.silent,
    createdAt: options.createdAt,
  });
}

/** Raised when the patient repeatedly skips required measurements. */
export function evaluateMissedMonitoring(patient, carePlan, missedCount, type) {
  if (!carePlan) return null;
  const rule = rulesFor(carePlan.id).monitoring_missed;
  if (!rule || missedCount <= rule.value_1) return null;
  const typeUz = { glucose: 'Glyukoza', blood_pressure: 'Qon bosimi', symptom: 'Belgilar' }[type] ?? type;
  return raiseAlert({
    patient,
    carePlanId: carePlan.id,
    code: 'monitoring_missed',
    severity: rule.severity,
    title: "O'lchovlar bajarilmayapti",
    detail: `${typeUz} bo'yicha ${missedCount} ta belgilangan o'lchov bajarilmadi (${toDateKey()}).`,
    context: { type, missedCount },
    dedupKey: `monitoring_missed:${type}:${patient.id}`,
  });
}

const PRIORITY_UZ = { normal: 'Oddiy', important: 'Muhim', critical: 'Juda muhim' };

/**
 * Escalation for an unconfirmed dose. The system never advises the patient to
 * take an extra dose and never changes a dose — it reports the facts to a nurse.
 */
export function escalateMissedDose(patient, dose, medication, carePlan) {
  const severity = medication.priority === 'critical'
    ? 'urgent'
    : medication.priority === 'important'
      ? 'warning'
      : 'info';
  const title = medication.priority === 'critical'
    ? 'Juda muhim dori qabul qilingani tasdiqlanmadi'
    : 'Dori qabul qilingani tasdiqlanmadi';

  const alertId = raiseAlert({
    patient,
    carePlanId: carePlan?.id ?? dose.care_plan_id,
    code: 'medication_missed',
    severity,
    title,
    detail: `${medication.name} ${medication.dose} ${medication.unit} — belgilangan vaqt ${dose.scheduled_at}. Bemor tasdiqlamadi.`,
    context: {
      medication: medication.name,
      dose: `${medication.dose} ${medication.unit}`,
      priority: PRIORITY_UZ[medication.priority],
      scheduled_at: dose.scheduled_at,
      last_reminder_at: dose.last_reminder_at,
      reminder_count: dose.reminder_count,
      dose_id: dose.id,
    },
    dedupKey: `medication_missed:${dose.id}`,
  });

  run(
    "UPDATE medication_doses SET escalated_at = ?, updated_at = datetime('now') WHERE id = ?",
    nowLocal(),
    dose.id,
  );
  return alertId;
}
