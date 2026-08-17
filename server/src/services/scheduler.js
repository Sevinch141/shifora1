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
 *
 * On a serverless platform nothing stays running between requests, so `tick()`
 * is invoked by a scheduled HTTP call (see routes/cron.routes.js) instead of a
 * timer. The logic is identical either way, and the tick is idempotent: it can
 * safely run late, twice, or after a long gap.
 */

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

async function sendDoseReminder(dose, medication, patient, attempt) {
  if (!patient.user_id) return;
  await notify({
    userId: patient.user_id,
    patientId: patient.id,
    type: 'medication_reminder',
    title: attempt > 1 ? 'Eslatma: dori qabul qilish vaqti' : 'Dori qabul qilish vaqti bo‘ldi.',
    body: `${medication.name} ${medication.dose} ${medication.unit} — ${dose.scheduled_at.slice(11)}`,
    entityType: 'medication_dose',
    entityId: dose.id,
  });
  await run(
    `UPDATE medication_doses
        SET reminder_count = ?, last_reminder_at = ?, status = 'pending', snoozed_until = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    attempt,
    nowLocal(),
    dose.id,
  );
}

async function processMedicationDoses(now) {
  const doses = await all(
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

  let reminders = 0;
  let escalations = 0;

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
      await run(
        `UPDATE medication_doses SET status = 'missed', updated_at = datetime('now') WHERE id = ?`,
        row.id,
      );
      await escalateMissedDose(patient, row, medication, plan);
      escalations += 1;
      continue;
    }

    // 2. A snooze that has run out becomes the next reminder.
    if (row.status === 'snoozed') {
      if (row.snoozed_until && row.snoozed_until <= now) {
        await sendDoseReminder(row, medication, patient, row.reminder_count + 1);
        reminders += 1;
      }
      continue;
    }

    // 3. First reminder at the scheduled time.
    if (row.reminder_count === 0) {
      await sendDoseReminder(row, medication, patient, 1);
      reminders += 1;
      continue;
    }

    // 4. Repeat reminders, up to the configured maximum.
    if (
      row.reminder_count < row.reminder_max_count &&
      row.last_reminder_at &&
      minutesBetween(row.last_reminder_at, now) >= row.reminder_repeat_minutes
    ) {
      await sendDoseReminder(row, medication, patient, row.reminder_count + 1);
      reminders += 1;
    }
  }

  return { reminders, escalations };
}

async function processMonitoringTasks(now) {
  const tasks = await all(
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
  let reminders = 0;

  for (const task of tasks) {
    const overdue = minutesBetween(task.scheduled_at, now);

    if (overdue >= task.escalate_normal_minutes) {
      await run(
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

    await notify({
      userId: task.user_id,
      patientId: task.patient_id,
      type: 'monitoring_reminder',
      title: copy.title,
      body: copy.body,
      entityType: 'monitoring_task',
      entityId: task.id,
    });
    await run(
      `UPDATE monitoring_tasks
          SET reminder_count = ?, last_reminder_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
      task.reminder_count + 1,
      now,
      task.id,
    );
    reminders += 1;
  }

  for (const [key, count] of missedToday) {
    const [patientId, type] = key.split(':');
    const totalMissedToday = await get(
      `SELECT COUNT(*) AS c FROM monitoring_tasks
        WHERE patient_id = ? AND type = ? AND status = 'missed' AND scheduled_at LIKE ?`,
      Number(patientId),
      type,
      `${toDateKey()}%`,
    );
    const patient = await get('SELECT * FROM patients WHERE id = ?', Number(patientId));
    const plan = await get(
      `SELECT * FROM care_plans WHERE patient_id = ? AND status = 'active'`,
      Number(patientId),
    );
    if (patient && plan) {
      await evaluateMissedMonitoring(patient, plan, totalMissedToday?.c ?? count, type);
    }
  }

  return { reminders };
}

/**
 * One pass of the reminder engine. Idempotent and safe to call at any cadence.
 * `generateTasks` tops up the horizon so a gap between runs cannot leave the
 * patient without a plan for today.
 */
export async function tick({ generate = true } = {}) {
  const now = nowLocal();
  const generated = generate ? await generateTasksForAllActivePlans() : 0;
  const medication = await processMedicationDoses(now);
  const monitoring = await processMonitoringTasks(now);

  return {
    ran_at: now,
    tasks_generated: generated,
    reminders_sent: medication.reminders + monitoring.reminders,
    escalations: medication.escalations,
  };
}
