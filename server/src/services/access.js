import { all, get } from '../db/index.js';
import { forbidden, notFound } from '../lib/http.js';
import { HOSPITAL_ROLES } from '../middleware/auth.js';

export const CAREGIVER_PERMISSIONS = [
  'view_today_plan',
  'view_adherence',
  'view_alerts',
  'view_measurements',
  'view_care_plan',
  'view_clinical_notes',
];

/** Default caregiver grant: enough to help, not the whole medical record. */
export const DEFAULT_CAREGIVER_PERMISSIONS = {
  view_today_plan: 1,
  view_adherence: 1,
  view_alerts: 1,
  view_measurements: 0,
  view_care_plan: 0,
  view_clinical_notes: 0,
};

export function getCaregiverLink(userId, patientId) {
  return get(
    `SELECT * FROM caregivers WHERE user_id = ? AND patient_id = ? AND status = 'active'`,
    userId,
    patientId,
  );
}

export async function caregiverPermissions(caregiverId) {
  const rows = await all(
    'SELECT permission_key, allowed FROM caregiver_permissions WHERE caregiver_id = ?',
    caregiverId,
  );
  const map = {};
  for (const key of CAREGIVER_PERMISSIONS) map[key] = false;
  for (const row of rows) map[row.permission_key] = row.allowed === 1;
  return map;
}

/**
 * Central server-side authorisation gate for every patient-scoped route.
 * Hospital staff see only their own hospital; patients see only themselves;
 * caregivers see only what they were explicitly granted.
 */
export async function assertPatientAccess(user, patientId, permission) {
  const patient = await get('SELECT * FROM patients WHERE id = ?', Number(patientId));
  if (!patient) throw notFound('Bemor topilmadi.');

  if (HOSPITAL_ROLES.includes(user.role)) {
    if (patient.hospital_id !== user.hospital_id) {
      throw forbidden('Bu bemor boshqa shifoxonaga tegishli.');
    }
    return { patient, permissions: null };
  }

  if (user.role === 'patient') {
    if (patient.user_id !== user.id) throw forbidden();
    return { patient, permissions: null };
  }

  if (user.role === 'caregiver') {
    const link = await getCaregiverLink(user.id, patient.id);
    if (!link) throw forbidden('Siz bu bemorga biriktirilmagansiz.');
    const permissions = await caregiverPermissions(link.id);
    if (permission && !permissions[permission]) {
      throw forbidden("Bemor sizga bu ma'lumotni ko'rish huquqini bermagan.");
    }
    return { patient, permissions, caregiver: link };
  }

  throw forbidden();
}

/** The patient row bound to a patient-role login. */
export function patientForUser(userId) {
  return get('SELECT * FROM patients WHERE user_id = ?', userId);
}

/** Patients a caregiver has an active link to. */
export function patientsForCaregiver(userId) {
  return all(
    `SELECT p.*, c.id AS caregiver_id, c.relation
       FROM caregivers c
       JOIN patients p ON p.id = c.patient_id
      WHERE c.user_id = ? AND c.status = 'active'
      ORDER BY p.first_name`,
    userId,
  );
}
