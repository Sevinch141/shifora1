import { Router } from 'express';
import { all, get } from '../db/index.js';
import { badRequest, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { assertPatientAccess, caregiverPermissions, patientsForCaregiver } from '../services/access.js';
import { getDailyPlan } from '../services/dailyPlan.js';
import { adherenceRate, lastActivity } from '../services/reporting.js';
import { getActivePlan, getPlanDetail } from '../services/carePlan.js';
import { raiseAlert } from '../services/alertEngine.js';
import { notify } from '../services/notifications.js';

const router = Router();

router.use(requireAuth, requireRole('caregiver'));

/**
 * A caregiver only ever sees what was explicitly granted. Every field below is
 * gated on a permission; nothing about the medical record leaks by default.
 */
router.get(
  '/patients',
  wrap(async (req, res) => {
    const linked = await patientsForCaregiver(req.user.id);
    const patients = [];
    for (const patient of linked) {
      const permissions = await caregiverPermissions(patient.caregiver_id);
      const plan = permissions.view_today_plan ? await getDailyPlan(patient.id) : null;
      patients.push({
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        relation: patient.relation,
        status: patient.status,
        // The caregiver was authorised to help this person; being able to call
        // them is the point. Nothing clinical is exposed here.
        phone: patient.phone,
        permissions,
        today: plan
          ? {
              medications_done: plan.summary.medications_done,
              medications_total: plan.summary.medications_total,
              complete: plan.summary.complete,
              pending: plan.summary.pending,
              missed: plan.summary.missed,
            }
          : null,
        adherence: permissions.view_adherence ? (await adherenceRate(patient.id, 7)).rate : null,
        open_alerts: permissions.view_alerts
          ? (await get(
              `SELECT COUNT(*) AS c FROM alerts WHERE patient_id = ? AND status != 'closed'`,
              patient.id,
            )?.c ?? 0)
          : null,
      });
    }
    res.json({ patients });
  }),
);

router.get(
  '/patients/:id',
  wrap(async (req, res) => {
    const { patient, permissions, caregiver } = await assertPatientAccess(req.user, req.params.id);
    await audit(req, 'caregiver.view_patient', 'patient', patient.id);

    const plan = await getActivePlan(patient.id);
    res.json({
      patient: {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        status: patient.status,
        phone: patient.phone,
      },
      relation: caregiver.relation,
      permissions,
      today: permissions.view_today_plan ? await getDailyPlan(patient.id) : null,
      adherence: permissions.view_adherence
        ? { d7: await adherenceRate(patient.id, 7), last_activity: await lastActivity(patient.id) }
        : null,
      alerts: permissions.view_alerts
        ? await all(
            `SELECT id, severity, title, detail, status, created_at FROM alerts
              WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20`,
            patient.id,
          )
        : null,
      measurements: permissions.view_measurements
        ? {
            glucose: await all(
              'SELECT * FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
              patient.id,
            ),
            blood_pressure: await all(
              'SELECT * FROM blood_pressure_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
              patient.id,
            ),
          }
        : null,
      care_plan: permissions.view_care_plan && plan ? await getPlanDetail(plan.id) : null,
      hospital: await get('SELECT name, phone FROM hospitals WHERE id = ?', patient.hospital_id),
    });
  }),
);

/** "Hamshiraga murojaat" — puts the caregiver's concern in the nurse queue. */
router.post(
  '/patients/:id/contact-nurse',
  wrap(async (req, res) => {
    const { patient, caregiver } = await assertPatientAccess(req.user, req.params.id);
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      throw badRequest('Xabar matnini kiriting.', { message: 'Xabar bo‘sh bo‘lmasligi kerak.' });
    }

    const alertId = await raiseAlert({
      patient,
      carePlanId: await getActivePlan(patient.id)?.id ?? null,
      code: 'caregiver_request',
      severity: 'warning',
      title: 'Yaqin kishidan murojaat',
      detail: `${req.user.full_name} (${caregiver.relation ?? 'yaqin kishi'}): ${message}`,
      context: { message, caregiver_user_id: req.user.id },
      dedupKey: `caregiver_request:${patient.id}:${req.user.id}`,
    });

    await notify({
      userId: req.user.id,
      patientId: patient.id,
      type: 'info',
      title: 'Murojaatingiz yuborildi',
      body: 'Hamshira murojaatingizni ko‘rib chiqadi.',
      entityType: 'alert',
      entityId: alertId,
    });
    await audit(req, 'caregiver.contact_nurse', 'alert', alertId, { patient_id: patient.id });

    res.status(201).json({ alert_id: alertId });
  }),
);

export default router;
