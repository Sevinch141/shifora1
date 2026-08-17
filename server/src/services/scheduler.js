import { all, get, run } from '../db/index.js';
import { addMinutes, minutesBetween, nowLocal, toDateKey } from '../lib/time.js';
import { notify } from './notifications.js';
import { escalateMissedDose, evaluateMissedMonitoring } from './alertEngine.js';
import { generateTasksForAllActivePlans } from './carePlan.js';

/**
 * Reminder and escalation loop.
 *
 * Everything it does is driven by values stored on the care plan — repeat
 * interval, number of reminders, snooze length and per-priority escalation
 * windows. No timing is hard-coded here.
 */

const TICK_MS = 60_000;
const REGENERATE_EVERY_TICKS = 30;

const MONITORING_UZ = {
  glucose: { title: "Glyukozani o'lchash vaqti", body: "Glyukoza o'lchovini kiriting." },
  blood_pressure: { title: "Qon bosimini o'lchash vaqti", body: "Qon bosimi o'lchovini kiriting." },
  symptom: { title: 'Kunlik holat so‘rovi', body: "Bugun o'zingizni qanday his qilyapsiz?" },
};

function escalationWindow(plan, priority) {
  if (priority === 'critical') return plan.escalate_critical_minutes;
  if (priority === 'important') return plan.escalate_important_minutes;
  return plan.escalate_normal_minutes;
}

function sendDoseReminder(dose, medication, patient, attempt) {
  if (!patient.user_id) return;
  notify({
    userId: patient.user_id,
    patientId: patient.id,
    type: 'medication_reminder',
    title: attempt > 1 ? 'Eslatma: dori qabul qilish vaqti' : 'Dori qabul qilish vaqti bo‘ldi.',
    body: `${medication.name} ${medication.dose} ${medication.unit} — ${dose.scheduled_at.slice(11)}`,
    entityType: 'medication_dose',
    entityId: dose.id,
  });
  run(
    `UPDATE medication_doses
        SET reminder_count = ?, last_reminder_at = ?, status = 'pending', snoozed_until = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    attempt,
    nowLocal(),
    dose.id,
  );
}

function processMedicationDoses(now) {
  const doses = all(
    `SELECT d.*, m.name, m.dose, m.unit, m.priority,
            p.id AS p_id, p.user_id, p.first_name, p.last_name, p.hospital_id,
            cp.reminder_repeat_minutes, cp.reminder_max_count,
            cp.escalate_normal_minutes, cp.escalate_important_minutes, cp.escalate_critical_minutes
       FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id
       JOIN patients p ON p.id = d.patient_id
       JOIN care_plans cp ON cp.id = d.care_plan_id
      WHERE d.status IN ('pending', 'snoozed')
        AND d.scheduled_at <= ?
        AND d.scheduled_at >= ?`,
    now,
    addMinutes(now, -60 * 24 * 2),
  );

  for (const row of doses) {
    const patient = {
      id: row.p_id,
      user_id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      hospital_id: row.hospital_id,
    };
    const medication = {
      name: row.name, dose: row.dose, unit: row.unit, priority: row.priority,
    };
    const plan = {
      id: row.care_plan_id,
      reminder_repeat_minutes: row.reminder_repeat_minutes,
      reminder_max_count: row.reminder_max_count,
      escalate_normal_minutes: row.escalate_normal_minutes,
      escalate_important_minutes: row.escalate_important_minutes,
      escalate_critical_minutes: row.escalate_critical_minutes,
    };

    const overdue = minutesBetween(row.scheduled_at, now);

    // 1. Escalate first: an unconfirmed dose past its window becomes a nurse task.
    if (!row.escalated_at && overdue >= escalationWindow(plan, row.priority)) {
      run(
        `UPDATE medication_doses SET status = 'missed', updated_at = datetime('now') WHERE id = ?`,
        row.id,
      );
      escalateMissedDose(patient, row, medication, plan);
      continue;
    }

    // 2. A snooze that has run out becomes the next reminder.
    if (row.status === 'snoozed') {
      if (row.snoozed_until && row.snoozed_until <= now) {
        sendDoseReminder(row, medication, patient, row.reminder_count + 1);
      }
      continue;
    }

    // 3. First reminder at the scheduled time.
    if (row.reminder_count === 0) {
      sendDoseReminder(row, medication, patient, 1);
      continue;
    }

    // 4. Repeat reminders, up to the configured maximum.
    if (
      row.reminder_count < row.reminder_max_count &&
      row.last_reminder_at &&
      minutesBetween(row.last_reminder_at, now) >= row.reminder_repeat_minutes
    ) {
      sendDoseReminder(row, medication, patient, row.reminder_count + 1);
    }
  }
}

function processMonitoringTasks(now) {
  const tasks = all(
    `SELECT t.*, p.user_id, p.first_name, p.last_name, p.hospital_id,
            cp.reminder_repeat_minutes, cp.reminder_max_count, cp.escalate_normal_minutes
       FROM monitoring_tasks t
       JOIN patients p ON p.id = t.patient_id
       JOIN care_plans cp ON cp.id = t.care_plan_id
      WHERE t.status = 'pending' AND t.scheduled_at <= ? AND t.scheduled_at >= ?`,
    now,
    addMinutes(now, -60 * 24 * 2),
  );

  const missedToday = new Map();

  for (const task of tasks) {
    const overdue = minutesBetween(task.scheduled_at, now);

    if (overdue >= task.escalate_normal_minutes) {
      run(
        `UPDATE monitoring_tasks SET status = 'missed', updated_at = datetime('now') WHERE id = ?`,
        task.id,
      );
      if (task.scheduled_at.startsWith(toDateKey())) {
        const key = `${task.patient_id}:${task.type}`;
        missedToday.set(key, (missedToday.get(key) ?? 0) + 1);
      }
      continue;
    }

    const copy = MONITORING_UZ[task.type];
    if (!copy || !task.user_id) continue;

    const shouldRemind =
      task.reminder_count === 0 ||
      (task.reminder_count < task.reminder_max_count &&
        task.last_reminder_at &&
        minutesBetween(task.last_reminder_at, now) >= task.reminder_repeat_minutes);

    if (!shouldRemind) continue;

    notify({
      userId: task.user_id,
      patientId: task.patient_id,
      type: 'monitoring_reminder',
      title: copy.title,
      body: copy.body,
      entityType: 'monitoring_task',
      entityId: task.id,
    });
    run(
      `UPDATE monitoring_tasks
          SET reminder_count = ?, last_reminder_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
      task.reminder_count + 1,
      now,
      task.id,
    );
  }

  for (const [key, count] of missedToday) {
    const [patientId, type] = key.split(':');
    const totalMissedToday = get(
      `SELECT COUNT(*) AS c FROM monitoring_tasks
        WHERE patient_id = ? AND type = ? AND status = 'missed' AND scheduled_at LIKE ?`,
      Number(patientId),
      type,
      `${toDateKey()}%`,
    );
    const patient = get('SELECT * FROM patients WHERE id = ?', Number(patientId));
    const plan = get(
      `SELECT * FROM care_plans WHERE patient_id = ? AND status = 'active'`,
      Number(patientId),
    );
    if (patient && plan) evaluateMissedMonitoring(patient, plan, totalMissedToday?.c ?? count, type);
  }
}

export function tick() {
  const now = nowLocal();
  processMedicationDoses(now);
  processMonitoringTasks(now);
}

let timer = null;
let tickCount = 0;

export function startScheduler() {
  if (timer) return;
  generateTasksForAllActivePlans();
  tick();
  timer = setInterval(() => {
    tickCount += 1;
    try {
      if (tickCount % REGENERATE_EVERY_TICKS === 0) generateTasksForAllActivePlans();
      tick();
    } catch (err) {
      console.error('[scheduler]', err);
    }
  }, TICK_MS);
  timer.unref?.();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
