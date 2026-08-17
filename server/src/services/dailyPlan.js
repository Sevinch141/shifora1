import { all } from '../db/index.js';
import { toDateKey } from '../lib/time.js';

/**
 * The single chronological task list a patient (and, if permitted, a caregiver)
 * sees for a given day. Doses and measurements are merged into one stream so
 * the next thing to do is always the top pending item.
 */
export async function getDailyPlan(patientId, dateKey = toDateKey()) {
  const like = `${dateKey}%`;

  const doseRows = await all(
    `SELECT d.id, d.scheduled_at, d.status, d.taken_at, d.snoozed_until, d.reminder_count,
            m.name, m.dose, m.unit, m.priority, m.notes
       FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id
      WHERE d.patient_id = ? AND d.scheduled_at LIKE ?
      ORDER BY d.scheduled_at`,
    patientId, like,
  );
  const doses = doseRows.map((d) => ({
    kind: 'medication',
    id: d.id,
    time: d.scheduled_at.slice(11),
    scheduled_at: d.scheduled_at,
    status: d.status,
    taken_at: d.taken_at,
    snoozed_until: d.snoozed_until,
    title: `${d.name} ${d.dose} ${d.unit}`,
    priority: d.priority,
    note: d.notes,
  }));

  const taskRows = await all(
    `SELECT id, type, context, scheduled_at, status, completed_at
       FROM monitoring_tasks
      WHERE patient_id = ? AND scheduled_at LIKE ?
      ORDER BY scheduled_at`,
    patientId, like,
  );
  const tasks = taskRows.map((t) => ({
    kind: t.type,
    id: t.id,
    time: t.scheduled_at.slice(11),
    scheduled_at: t.scheduled_at,
    status: t.status,
    completed_at: t.completed_at,
    context: t.context,
  }));

  const items = [...doses, ...tasks].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const done = items.filter((i) => i.status === 'taken' || i.status === 'done').length;
  const medicationItems = doses.length;
  const medicationDone = doses.filter((d) => d.status === 'taken').length;

  return {
    date: dateKey,
    items,
    summary: {
      total: items.length,
      done,
      pending: items.filter((i) => i.status === 'pending' || i.status === 'snoozed').length,
      missed: items.filter((i) => i.status === 'missed').length,
      medications_total: medicationItems,
      medications_done: medicationDone,
      complete: items.length > 0 && done === items.length,
    },
  };
}
