import { Router } from 'express';
import { all, get, run } from '../db/index.js';
import { forbidden, wrap } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { patientForUser } from '../services/access.js';
import { getActivePlan, getPlanDetail } from '../services/carePlan.js';
import { getDailyPlan } from '../services/dailyPlan.js';
import { adherenceRate } from '../services/reporting.js';
import { toDateKey } from '../lib/time.js';

const router = Router();

router.use(requireAuth);

function selfPatient(req) {
  const patient = patientForUser(req.user.id);
  if (!patient) throw forbidden('Hisobingiz bemor kartasiga bog‘lanmagan.');
  return patient;
}

/** The patient home screen: today's plan, in order. */
router.get(
  '/today',
  wrap((req, res) => {
    const patient = selfPatient(req);
    const dateKey = req.query.date ?? toDateKey();
    res.json({
      patient: { id: patient.id, first_name: patient.first_name, last_name: patient.last_name },
      plan: getDailyPlan(patient.id, dateKey),
      adherence_7d: adherenceRate(patient.id, 7),
      has_active_plan: Boolean(getActivePlan(patient.id)),
    });
  }),
);

router.get(
  '/medications',
  wrap((req, res) => {
    const patient = selfPatient(req);
    const plan = getActivePlan(patient.id);
    if (!plan) return res.json({ medications: [], plan: null });
    const detail = getPlanDetail(plan.id);
    res.json({
      plan: { id: plan.id, version: plan.version, approved_at: plan.approved_at },
      medications: detail.medications,
      history: all(
        `SELECT d.id, d.scheduled_at, d.status, d.taken_at, m.name, m.dose, m.unit
           FROM medication_doses d JOIN medications m ON m.id = d.medication_id
          WHERE d.patient_id = ? ORDER BY d.scheduled_at DESC LIMIT 40`,
        patient.id,
      ),
    });
  }),
);

router.get(
  '/profile',
  wrap((req, res) => {
    const patient = selfPatient(req);
    const plan = getActivePlan(patient.id);
    res.json({
      patient,
      profile: get('SELECT * FROM diabetes_profiles WHERE patient_id = ?', patient.id),
      hospital: get('SELECT id, name, phone, region FROM hospitals WHERE id = ?', patient.hospital_id),
      care_plan: plan ? { id: plan.id, version: plan.version, approved_at: plan.approved_at } : null,
      caregivers: all(
        `SELECT c.relation, u.full_name, u.phone FROM caregivers c
           JOIN users u ON u.id = c.user_id
          WHERE c.patient_id = ? AND c.status = 'active'`,
        patient.id,
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// Notifications (shared by every role)
// ---------------------------------------------------------------------------

router.get(
  '/notifications',
  wrap((req, res) => {
    const items = all(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      req.user.id,
    );
    res.json({
      notifications: items,
      unread: items.filter((n) => !n.read_at).length,
    });
  }),
);

router.post(
  '/notifications/:id/read',
  wrap((req, res) => {
    run(
      `UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`,
      Number(req.params.id), req.user.id,
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/notifications/read-all',
  wrap((req, res) => {
    run(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`,
      req.user.id,
    );
    res.json({ ok: true });
  }),
);

export default router;
