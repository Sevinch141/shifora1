import { Router } from 'express';
import { get, run } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { assertPatientAccess } from '../services/access.js';
import { addMinutes, nowLocal } from '../lib/time.js';

const router = Router();

router.use(requireAuth);

function loadDose(req) {
  const dose = get(
    `SELECT d.*, m.name, m.dose AS med_dose, m.unit, m.priority,
            cp.snooze_minutes, cp.reminder_max_count
       FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id
       JOIN care_plans cp ON cp.id = d.care_plan_id
      WHERE d.id = ?`,
    Number(req.params.id),
  );
  if (!dose) throw notFound('Dori qabul qilish yozuvi topilmadi.');
  assertPatientAccess(req.user, dose.patient_id, 'view_today_plan');
  if (req.user.role === 'caregiver') {
    // Caregivers can watch, but confirming a dose is the patient's own action.
    throw badRequest('Dori qabul qilinganini faqat bemor tasdiqlashi mumkin.');
  }
  return dose;
}

router.post(
  '/:id/take',
  wrap((req, res) => {
    const dose = loadDose(req);
    if (dose.status === 'taken') return res.json({ ok: true, status: 'taken' });

    run(
      `UPDATE medication_doses
          SET status = 'taken', taken_at = ?, snoozed_until = NULL, updated_at = datetime('now')
        WHERE id = ?`,
      nowLocal(), dose.id,
    );
    audit(req, 'dose.taken', 'medication_dose', dose.id, { patient_id: dose.patient_id });
    res.json({ ok: true, status: 'taken', taken_at: nowLocal() });
  }),
);

/** "Kechroq" — postpones by the interval configured on the care plan. */
router.post(
  '/:id/snooze',
  wrap((req, res) => {
    const dose = loadDose(req);
    if (dose.status === 'taken') throw badRequest('Bu dori allaqachon qabul qilingan deb belgilangan.');

    const minutes = dose.snooze_minutes ?? 15;
    const until = addMinutes(nowLocal(), minutes);
    run(
      `UPDATE medication_doses
          SET status = 'snoozed', snoozed_until = ?, updated_at = datetime('now')
        WHERE id = ?`,
      until, dose.id,
    );
    audit(req, 'dose.snoozed', 'medication_dose', dose.id, { minutes });
    res.json({ ok: true, status: 'snoozed', snoozed_until: until, minutes });
  }),
);

export default router;
