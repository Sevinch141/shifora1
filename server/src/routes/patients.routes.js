import { Router } from 'express';
import { all, get, insert, run, transaction } from '../db/index.js';
import { ApiError, badRequest, notFound, validate, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { requireAuth, requireHospitalStaff, requireRole } from '../middleware/auth.js';
import {
  assertPatientAccess,
  caregiverPermissions,
  CAREGIVER_PERMISSIONS,
  DEFAULT_CAREGIVER_PERMISSIONS,
} from '../services/access.js';
import { approvePlan, createDraftPlan, getActivePlan, getPlanDetail } from '../services/carePlan.js';
import { adherenceRate, buildReport, lastActivity } from '../services/reporting.js';
import { addDays, nowLocal, toDateKey } from '../lib/time.js';
import { getDailyPlan } from '../services/dailyPlan.js';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Hospital dashboard statistics
// ---------------------------------------------------------------------------

router.get(
  '/stats',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const hospitalId = req.user.hospital_id;
    const counts = await get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'stable' THEN 1 ELSE 0 END) AS stable,
              SUM(CASE WHEN status = 'attention' THEN 1 ELSE 0 END) AS attention,
              SUM(CASE WHEN status = 'urgent' THEN 1 ELSE 0 END) AS urgent
         FROM patients WHERE hospital_id = ?`,
      hospitalId,
    );
    const openAlerts = await get(
      `SELECT COUNT(*) AS c FROM alerts WHERE hospital_id = ? AND status != 'closed'`,
      hospitalId,
    );
    // A counter for one feature must not be able to take the dashboard down.
    // If the questions table has not been migrated yet, report zero and carry
    // on; anything else is a real fault and still propagates.
    let openQuestions = { c: 0 };
    try {
      openQuestions = await get(
        `SELECT COUNT(*) AS c FROM patient_questions
          WHERE hospital_id = ? AND status IN ('unanswered', 'assigned')`,
        hospitalId,
      );
    } catch (err) {
      if (err.code !== '42P01') throw err; // 42P01 = undefined_table
      console.warn('[stats] patient_questions jadvali yo‘q — migratsiya kerak.');
    }
    res.json({
      total: counts?.total ?? 0,
      stable: counts?.stable ?? 0,
      attention: counts?.attention ?? 0,
      urgent: counts?.urgent ?? 0,
      open_alerts: openAlerts?.c ?? 0,
      open_questions: openQuestions?.c ?? 0,
    });
  }),
);

// ---------------------------------------------------------------------------
// Patient list
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const { query = '', status = '' } = req.query;

    // Everything the list needs is gathered in ONE round-trip. Per-patient
    // lookups would mean four queries per row — fine against a local file,
    // far too slow against a network database with a caseload this size.
    const adherenceFrom = toDateKey(addDays(new Date(), -7));
    const params = [adherenceFrom, nowLocal(), req.user.hospital_id];
    let sql = `
      SELECT p.id, p.first_name, p.last_name, p.phone, p.status,
             dp.diabetes_type,
             g.value AS glucose_value, g.measured_at AS glucose_at,
             COALESCE(al.open_count, 0) AS open_alerts,
             COALESCE(al.has_urgent, 0) AS has_urgent,
             ad.total AS dose_total, ad.taken AS dose_taken,
             act.last_activity
        FROM patients p
        LEFT JOIN diabetes_profiles dp ON dp.patient_id = p.id
        LEFT JOIN LATERAL (
          SELECT value, measured_at FROM glucose_readings
           WHERE patient_id = p.id ORDER BY measured_at DESC LIMIT 1
        ) g ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS open_count,
                 MAX(CASE WHEN severity = 'urgent' THEN 1 ELSE 0 END) AS has_urgent
            FROM alerts WHERE patient_id = p.id AND status != 'closed'
        ) al ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS total,
                 SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) AS taken
            FROM medication_doses
           WHERE patient_id = p.id AND scheduled_at >= ? AND scheduled_at <= ?
        ) ad ON TRUE
        LEFT JOIN LATERAL (
          SELECT MAX(ts) AS last_activity FROM (
            SELECT MAX(taken_at) AS ts FROM medication_doses WHERE patient_id = p.id
            UNION ALL SELECT MAX(measured_at) FROM glucose_readings WHERE patient_id = p.id
            UNION ALL SELECT MAX(measured_at) FROM blood_pressure_readings WHERE patient_id = p.id
            UNION ALL SELECT MAX(reported_at) FROM symptom_checks WHERE patient_id = p.id
          ) t
        ) act ON TRUE
       WHERE p.hospital_id = ?`;
    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (query.trim()) {
      sql += " AND (p.first_name || ' ' || p.last_name ILIKE ? OR p.phone LIKE ?)";
      params.push(`%${query.trim()}%`, `%${query.trim()}%`);
    }
    sql += " ORDER BY CASE p.status WHEN 'urgent' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, p.last_name";

    const rows = await all(sql, ...params);
    const patients = rows.map((row) => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      status: row.status,
      diabetes_type: row.diabetes_type,
      adherence: row.dose_total > 0 ? Math.round((row.dose_taken / row.dose_total) * 100) : null,
      last_glucose: row.glucose_value === null || row.glucose_value === undefined
        ? null
        : { value: row.glucose_value, measured_at: row.glucose_at },
      last_activity: row.last_activity,
      open_alerts: row.open_alerts,
      has_urgent_alert: row.has_urgent === 1,
    }));

    res.json({ patients });
  }),
);

// ---------------------------------------------------------------------------
// Registration — patient + diabetes profile + first care plan, in one step
// ---------------------------------------------------------------------------

router.post(
  '/',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const patientInput = validate(body.patient ?? {}, {
      first_name: { required: true, message: 'Ismni kiriting.' },
      last_name: { required: true, message: 'Familiyani kiriting.' },
      birth_date: { required: true, message: "Tug'ilgan sanani kiriting." },
      gender: { required: true, oneOf: ['male', 'female'], message: 'Jinsni tanlang.' },
      phone: { required: true, message: 'Telefon raqamini kiriting.' },
      address: { required: false },
      emergency_contact_name: { required: false },
      emergency_contact_phone: { required: false },
      language: { required: false, default: 'uz' },
    });
    const profileInput = validate(body.profile ?? {}, {
      diabetes_type: { required: true, oneOf: ['type1', 'type2', 'other'], message: 'Diabet turini tanlang.' },
      diagnosis_date: { required: false },
      hba1c: { required: false, type: 'number', min: 2, max: 20 },
      clinical_notes: { required: false },
    });

    const account = body.account ?? {};
    if (account.create && (!account.password || String(account.password).length < 4)) {
      throw badRequest("Kiritilgan ma'lumotlarda xatolik bor.", {
        password: "Parol kamida 4 ta belgidan iborat bo'lishi kerak.",
      });
    }
    if (account.create) {
      const exists = await get('SELECT id FROM users WHERE phone = ?', patientInput.phone);
      if (exists) throw new ApiError(409, "Bu telefon raqami tizimda allaqachon ro'yxatdan o'tgan.");
    }

    const result = await transaction(async () => {
      let userId = null;
      if (account.create) {
        userId = await insert(
          `INSERT INTO users (hospital_id, role, full_name, phone, password_hash, language, created_by)
           VALUES (?, 'patient', ?, ?, ?, ?, ?)`,
          req.user.hospital_id,
          `${patientInput.first_name} ${patientInput.last_name}`,
          patientInput.phone,
          hashPassword(String(account.password)),
          patientInput.language ?? 'uz',
          req.user.id,
        );
      }

      const patientId = await insert(
        `INSERT INTO patients
           (hospital_id, user_id, first_name, last_name, birth_date, gender, phone, address,
            emergency_contact_name, emergency_contact_phone, language, discharge_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user.hospital_id,
        userId,
        patientInput.first_name,
        patientInput.last_name,
        patientInput.birth_date,
        patientInput.gender,
        patientInput.phone,
        patientInput.address,
        patientInput.emergency_contact_name,
        patientInput.emergency_contact_phone,
        patientInput.language ?? 'uz',
        body.discharge_date ?? null,
        req.user.id,
      );

      await insert(
        `INSERT INTO diabetes_profiles
           (patient_id, diabetes_type, diagnosis_date, hba1c, recent_hospitalization,
            prior_hypoglycemia, clinical_notes, cgm_enabled, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        patientId,
        profileInput.diabetes_type,
        profileInput.diagnosis_date,
        profileInput.hba1c,
        body.profile?.recent_hospitalization ? 1 : 0,
        body.profile?.prior_hypoglycemia ? 1 : 0,
        profileInput.clinical_notes,
        body.profile?.cgm_enabled ? 1 : 0,
        req.user.id,
      );

      let caregiverId = null;
      if (body.caregiver?.create) {
        const cg = validate(body.caregiver, {
          full_name: { required: true, message: 'Yaqin kishining ismini kiriting.' },
          phone: { required: true, message: 'Yaqin kishining telefon raqamini kiriting.' },
          relation: { required: false },
        });
        if (!body.caregiver.password || String(body.caregiver.password).length < 4) {
          throw badRequest("Kiritilgan ma'lumotlarda xatolik bor.", {
            caregiver_password: "Parol kamida 4 ta belgidan iborat bo'lishi kerak.",
          });
        }
        let cgUser = await get('SELECT * FROM users WHERE phone = ?', cg.phone);
        if (cgUser && cgUser.role !== 'caregiver') {
          throw new ApiError(409, 'Bu telefon raqami boshqa turdagi hisob uchun ishlatilgan.');
        }
        if (!cgUser) {
          const cgUserId = await insert(
            `INSERT INTO users (hospital_id, role, full_name, phone, password_hash, created_by)
             VALUES (?, 'caregiver', ?, ?, ?, ?)`,
            req.user.hospital_id,
            cg.full_name,
            cg.phone,
            hashPassword(String(body.caregiver.password)),
            req.user.id,
          );
          cgUser = { id: cgUserId };
        }
        caregiverId = await insert(
          `INSERT INTO caregivers
             (patient_id, user_id, relation, status, authorized_by, authorized_at, created_by)
           VALUES (?, ?, ?, 'active', ?, datetime('now'), ?)`,
          patientId,
          cgUser.id,
          cg.relation,
          req.user.id,
          req.user.id,
        );
        const granted = { ...DEFAULT_CAREGIVER_PERMISSIONS, ...(body.caregiver.permissions ?? {}) };
        for (const key of CAREGIVER_PERMISSIONS) {
          await insert(
            `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
             VALUES (?, ?, ?, ?)`,
            caregiverId,
            key,
            granted[key] ? 1 : 0,
            req.user.id,
          );
        }
      }

      const planId = await createDraftPlan(patientId, body.care_plan ?? {}, req.user);
      return { patientId, planId, userId, caregiverId };
    });

    await audit(req, 'patient.register', 'patient', result.patientId, {
      care_plan_id: result.planId,
      account_created: Boolean(result.userId),
    });

    let plan = await getPlanDetail(result.planId);
    if (body.approve) {
      plan = await approvePlan(result.planId, req.user, "Dastlabki reja tasdiqlandi");
      await audit(req, 'care_plan.approve', 'care_plan', result.planId, { version: plan.version });
    }

    res.status(201).json({ patient_id: result.patientId, care_plan: plan });
  }),
);

// ---------------------------------------------------------------------------
// Patient profile
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    await audit(req, 'patient.view', 'patient', patient.id);

    const profile = await get('SELECT * FROM diabetes_profiles WHERE patient_id = ?', patient.id);
    const activePlan = await getActivePlan(patient.id);
    const planDetail = activePlan ? await getPlanDetail(activePlan.id) : null;

    const caregiverRows = await all(
      `SELECT c.id, c.relation, c.status, c.authorized_at, u.full_name, u.phone
         FROM caregivers c JOIN users u ON u.id = c.user_id
        WHERE c.patient_id = ?`,
      patient.id,
    );
    const caregivers = [];
    for (const caregiver of caregiverRows) {
      caregivers.push({ ...caregiver, permissions: await caregiverPermissions(caregiver.id) });
    }

    res.json({
      patient,
      profile,
      care_plan: planDetail,
      adherence: {
        d7: await adherenceRate(patient.id, 7),
        d30: await adherenceRate(patient.id, 30),
      },
      last_activity: await lastActivity(patient.id),
      today: await getDailyPlan(patient.id),
      glucose: await all(
        'SELECT * FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
        patient.id,
      ),
      blood_pressure: await all(
        'SELECT * FROM blood_pressure_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
        patient.id,
      ),
      symptoms: await all(
        'SELECT * FROM symptom_checks WHERE patient_id = ? ORDER BY reported_at DESC LIMIT 10',
        patient.id,
      ),
      alerts: await all(
        'SELECT * FROM alerts WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20',
        patient.id,
      ),
      caregivers,
      plan_history: await all(
        `SELECT cp.id, cp.version, cp.status, cp.approved_at, cp.notes, u.full_name AS approver
           FROM care_plans cp LEFT JOIN users u ON u.id = cp.approved_by
          WHERE cp.patient_id = ? ORDER BY cp.version DESC`,
        patient.id,
      ),
      ai_recommendations: await all(
        `SELECT * FROM ai_recommendations WHERE patient_id = ? ORDER BY created_at DESC LIMIT 5`,
        patient.id,
      ),
    });
  }),
);

router.get(
  '/:id/report',
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id, 'view_measurements');
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    await audit(req, 'patient.report', 'patient', patient.id, { days });
    res.json(await buildReport(patient.id, days));
  }),
);

router.get(
  '/:id/plan-day',
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id, 'view_today_plan');
    res.json(await getDailyPlan(patient.id, req.query.date));
  }),
);

// ---------------------------------------------------------------------------
// Caregiver authorisation (hospital staff only)
// ---------------------------------------------------------------------------

router.post(
  '/:id/caregivers',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    const input = validate(req.body, {
      full_name: { required: true, message: 'Ismni kiriting.' },
      phone: { required: true, message: 'Telefon raqamini kiriting.' },
      relation: { required: false },
      password: { required: true, message: 'Parolni kiriting.' },
    });

    let user = await get('SELECT * FROM users WHERE phone = ?', input.phone);
    if (user && user.role !== 'caregiver') {
      throw new ApiError(409, 'Bu telefon raqami boshqa turdagi hisob uchun ishlatilgan.');
    }
    if (!user) {
      const id = await insert(
        `INSERT INTO users (hospital_id, role, full_name, phone, password_hash, created_by)
         VALUES (?, 'caregiver', ?, ?, ?, ?)`,
        req.user.hospital_id,
        input.full_name,
        input.phone,
        hashPassword(String(input.password)),
        req.user.id,
      );
      user = { id };
    }

    const existing = await get(
      'SELECT id FROM caregivers WHERE patient_id = ? AND user_id = ?',
      patient.id, user.id,
    );
    if (existing) throw new ApiError(409, 'Bu yaqin kishi allaqachon biriktirilgan.');

    const caregiverId = await insert(
      `INSERT INTO caregivers (patient_id, user_id, relation, status, authorized_by, authorized_at, created_by)
       VALUES (?, ?, ?, 'active', ?, datetime('now'), ?)`,
      patient.id, user.id, input.relation, req.user.id, req.user.id,
    );
    const granted = { ...DEFAULT_CAREGIVER_PERMISSIONS, ...(req.body.permissions ?? {}) };
    for (const key of CAREGIVER_PERMISSIONS) {
      await insert(
        `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
         VALUES (?, ?, ?, ?)`,
        caregiverId, key, granted[key] ? 1 : 0, req.user.id,
      );
    }
    await audit(req, 'caregiver.authorize', 'caregiver', caregiverId, { patient_id: patient.id });
    res.status(201).json({ id: caregiverId, permissions: await caregiverPermissions(caregiverId) });
  }),
);

router.patch(
  '/:id/caregivers/:caregiverId',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    const caregiver = await get(
      'SELECT * FROM caregivers WHERE id = ? AND patient_id = ?',
      Number(req.params.caregiverId), patient.id,
    );
    if (!caregiver) throw notFound('Yaqin kishi topilmadi.');

    if (req.body.status && ['active', 'revoked', 'pending'].includes(req.body.status)) {
      await run(
        "UPDATE caregivers SET status = ?, updated_at = datetime('now') WHERE id = ?",
        req.body.status, caregiver.id,
      );
    }
    for (const [key, value] of Object.entries(req.body.permissions ?? {})) {
      if (!CAREGIVER_PERMISSIONS.includes(key)) continue;
      await run(
        `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (caregiver_id, permission_key)
         DO UPDATE SET allowed = excluded.allowed, updated_at = datetime('now')`,
        caregiver.id, key, value ? 1 : 0, req.user.id,
      );
    }
    await audit(req, 'caregiver.update', 'caregiver', caregiver.id, req.body);
    res.json({ id: caregiver.id, permissions: await caregiverPermissions(caregiver.id) });
  }),
);

// ---------------------------------------------------------------------------
// Care plans
// ---------------------------------------------------------------------------

router.get(
  '/:id/care-plans',
  requireRole('nurse', 'doctor', 'hospital_admin'),
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    const plans = await all(
      `SELECT cp.*, u.full_name AS approver_name
         FROM care_plans cp LEFT JOIN users u ON u.id = cp.approved_by
        WHERE cp.patient_id = ? ORDER BY cp.version DESC`,
      patient.id,
    );
    const detailed = [];
    for (const plan of plans) detailed.push(await getPlanDetail(plan.id));
    res.json({ plans: detailed });
  }),
);

router.post(
  '/:id/care-plans',
  requireRole('nurse', 'doctor'),
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    if (!(req.body.medications ?? []).length && !(req.body.monitoring ?? []).length) {
      throw badRequest("Rejada kamida bitta dori yoki kuzatuv turi bo'lishi kerak.");
    }
    const planId = await createDraftPlan(patient.id, req.body, req.user);
    await audit(req, 'care_plan.create_draft', 'care_plan', planId, { patient_id: patient.id });
    res.status(201).json(await getPlanDetail(planId));
  }),
);

export default router;
