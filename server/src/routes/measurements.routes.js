import { Router } from 'express';
import { all, get, insert, run } from '../db/index.js';
import { badRequest, forbidden, validate, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { assertPatientAccess, patientForUser } from '../services/access.js';
import { getActivePlan } from '../services/carePlan.js';
import {
  evaluateBloodPressure,
  evaluateGlucose,
  evaluateSymptomCheck,
  SYMPTOM_LABELS_UZ,
} from '../services/alertEngine.js';
import { minutesBetween, nowLocal, toDateKey } from '../lib/time.js';

const router = Router();

router.use(requireAuth);

/**
 * Measurements can be entered by the patient for themselves, or by hospital
 * staff on the patient's behalf. Either way the same authorisation gate runs.
 */
function resolvePatient(req) {
  if (req.user.role === 'patient') {
    const patient = patientForUser(req.user.id);
    if (!patient) throw forbidden('Hisobingiz bemor kartasiga bog‘lanmagan.');
    return patient;
  }
  const patientId = req.body?.patient_id ?? req.query?.patient_id;
  if (!patientId) throw badRequest('Bemor tanlanmagan.');
  return assertPatientAccess(req.user, patientId).patient;
}

/** Ties a submitted reading to the nearest scheduled measurement of that day. */
function completeNearestTask(patientId, type, measuredAt, recordId) {
  const dateKey = measuredAt.slice(0, 10);
  const candidates = all(
    `SELECT * FROM monitoring_tasks
      WHERE patient_id = ? AND type = ? AND scheduled_at LIKE ?
        AND status IN ('pending', 'missed')`,
    patientId, type, `${dateKey}%`,
  );
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((best, task) => {
    const distance = Math.abs(minutesBetween(task.scheduled_at, measuredAt));
    return !best || distance < best.distance ? { task, distance } : best;
  }, null);
  if (!nearest || nearest.distance > 180) return null;

  run(
    `UPDATE monitoring_tasks
        SET status = 'done', completed_at = ?, record_id = ?, updated_at = datetime('now')
      WHERE id = ?`,
    measuredAt, recordId, nearest.task.id,
  );
  return nearest.task.id;
}

// ---------------------------------------------------------------------------
// Glucose — manual entry. The platform does not measure anything itself.
// ---------------------------------------------------------------------------

router.post(
  '/glucose',
  wrap((req, res) => {
    const patient = resolvePatient(req);
    const input = validate(req.body, {
      value: { required: true, type: 'number', min: 10, max: 900, message: 'Glyukoza qiymatini kiriting.' },
      context: {
        required: true,
        oneOf: ['fasting', 'before_meal', 'after_meal', 'bedtime', 'any'],
        message: "O'lchov holatini tanlang.",
      },
      measured_at: { required: false },
      note: { required: false },
    });
    const measuredAt = (input.measured_at ?? nowLocal()).slice(0, 16).replace('T', ' ');

    const id = insert(
      `INSERT INTO glucose_readings
         (patient_id, value, unit, context, measured_at, note, source, created_by)
       VALUES (?, ?, 'mg/dL', ?, ?, ?, 'manual', ?)`,
      patient.id, input.value, input.context, measuredAt, input.note, req.user.id,
    );
    completeNearestTask(patient.id, 'glucose', measuredAt, id);

    const reading = get('SELECT * FROM glucose_readings WHERE id = ?', id);
    const alertId = evaluateGlucose(patient, reading, getActivePlan(patient.id));
    audit(req, 'glucose.create', 'glucose_reading', id, { patient_id: patient.id, value: input.value });

    res.status(201).json({ reading, alert_id: alertId });
  }),
);

// ---------------------------------------------------------------------------
// Blood pressure — manual entry
// ---------------------------------------------------------------------------

router.post(
  '/blood-pressure',
  wrap((req, res) => {
    const patient = resolvePatient(req);
    const input = validate(req.body, {
      systolic: { required: true, type: 'number', min: 50, max: 300, message: 'Sistolik bosimni kiriting.' },
      diastolic: { required: true, type: 'number', min: 30, max: 200, message: 'Diastolik bosimni kiriting.' },
      pulse: { required: false, type: 'number', min: 20, max: 250 },
      measured_at: { required: false },
      note: { required: false },
    });
    if (input.systolic <= input.diastolic) {
      throw badRequest("Kiritilgan ma'lumotlarda xatolik bor.", {
        systolic: 'Sistolik bosim diastolikdan katta bo‘lishi kerak.',
      });
    }
    const measuredAt = (input.measured_at ?? nowLocal()).slice(0, 16).replace('T', ' ');

    const id = insert(
      `INSERT INTO blood_pressure_readings
         (patient_id, systolic, diastolic, pulse, measured_at, note, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
      patient.id, input.systolic, input.diastolic, input.pulse, measuredAt, input.note, req.user.id,
    );
    completeNearestTask(patient.id, 'blood_pressure', measuredAt, id);

    const reading = get('SELECT * FROM blood_pressure_readings WHERE id = ?', id);
    const alertId = evaluateBloodPressure(patient, reading, getActivePlan(patient.id));
    audit(req, 'bp.create', 'blood_pressure_reading', id, { patient_id: patient.id });

    res.status(201).json({ reading, alert_id: alertId });
  }),
);

// ---------------------------------------------------------------------------
// Symptom check — reported, never interpreted as a diagnosis
// ---------------------------------------------------------------------------

router.post(
  '/symptom-check',
  wrap((req, res) => {
    const patient = resolvePatient(req);
    const input = validate(req.body, {
      feeling: {
        required: true,
        oneOf: ['good', 'not_good', 'bad'],
        message: 'Holatingizni tanlang.',
      },
      note: { required: false },
      reported_at: { required: false },
    });
    const symptoms = (req.body.symptoms ?? []).filter((key) => key in SYMPTOM_LABELS_UZ);
    const reportedAt = (input.reported_at ?? nowLocal()).slice(0, 16).replace('T', ' ');

    const id = insert(
      `INSERT INTO symptom_checks (patient_id, feeling, symptoms, note, reported_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      patient.id, input.feeling, JSON.stringify(symptoms), input.note, reportedAt, req.user.id,
    );
    completeNearestTask(patient.id, 'symptom', reportedAt, id);

    const check = get('SELECT * FROM symptom_checks WHERE id = ?', id);
    const alertId = evaluateSymptomCheck(patient, check, getActivePlan(patient.id));
    audit(req, 'symptom.create', 'symptom_check', id, { patient_id: patient.id, feeling: input.feeling });

    res.status(201).json({ check, alert_id: alertId });
  }),
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

router.get(
  '/',
  wrap((req, res) => {
    const patient = req.user.role === 'patient'
      ? patientForUser(req.user.id)
      : assertPatientAccess(req.user, req.query.patient_id, 'view_measurements').patient;
    const limit = Math.min(Number(req.query.limit) || 30, 200);

    res.json({
      glucose: all(
        'SELECT * FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT ?',
        patient.id, limit,
      ),
      blood_pressure: all(
        'SELECT * FROM blood_pressure_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT ?',
        patient.id, limit,
      ),
      symptoms: all(
        'SELECT * FROM symptom_checks WHERE patient_id = ? ORDER BY reported_at DESC LIMIT ?',
        patient.id, limit,
      ).map((s) => ({ ...s, symptoms: JSON.parse(s.symptoms) })),
      today: toDateKey(),
    });
  }),
);

export default router;
