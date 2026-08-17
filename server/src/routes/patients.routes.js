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
import { adherenceRate, buildReport, lastActivity, latestGlucose } from '../services/reporting.js';
import { getDailyPlan } from '../services/dailyPlan.js';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Hospital dashboard statistics
// ---------------------------------------------------------------------------

router.get(
  '/stats',
  requireHospitalStaff,
  wrap((req, res) => {
    const hospitalId = req.user.hospital_id;
    const counts = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'stable' THEN 1 ELSE 0 END) AS stable,
              SUM(CASE WHEN status = 'attention' THEN 1 ELSE 0 END) AS attention,
              SUM(CASE WHEN status = 'urgent' THEN 1 ELSE 0 END) AS urgent
         FROM patients WHERE hospital_id = ?`,
      hospitalId,
    );
    const openAlerts = get(
      `SELECT COUNT(*) AS c FROM alerts WHERE hospital_id = ? AND status != 'closed'`,
      hospitalId,
    );
    res.json({
      total: counts?.total ?? 0,
      stable: counts?.stable ?? 0,
      attention: counts?.attention ?? 0,
      urgent: counts?.urgent ?? 0,
      open_alerts: openAlerts?.c ?? 0,
    });
  }),
);

// ---------------------------------------------------------------------------
// Patient list
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireHospitalStaff,
  wrap((req, res) => {
    const { query = '', status = '' } = req.query;
    const params = [req.user.hospital_id];
    let sql = `SELECT p.*, dp.diabetes_type
                 FROM patients p
                 LEFT JOIN diabetes_profiles dp ON dp.patient_id = p.id
                WHERE p.hospital_id = ?`;
    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (query.trim()) {
      sql += " AND (p.first_name || ' ' || p.last_name LIKE ? OR p.phone LIKE ?)";
      params.push(`%${query.trim()}%`, `%${query.trim()}%`);
    }
    sql += " ORDER BY CASE p.status WHEN 'urgent' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, p.last_name";

    const patients = all(sql, ...params).map((patient) => {
      const glucose = latestGlucose(patient.id);
      const openAlerts = get(
        `SELECT COUNT(*) AS c, MAX(CASE WHEN severity = 'urgent' THEN 1 ELSE 0 END) AS urgent
           FROM alerts WHERE patient_id = ? AND status != 'closed'`,
        patient.id,
      );
      return {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        phone: patient.phone,
        status: patient.status,
        diabetes_type: patient.diabetes_type,
        adherence: adherenceRate(patient.id, 7).rate,
        last_glucose: glucose ? { value: glucose.value, measured_at: glucose.measured_at } : null,
        last_activity: lastActivity(patient.id),
        open_alerts: openAlerts?.c ?? 0,
        has_urgent_alert: (openAlerts?.urgent ?? 0) === 1,
      };
    });

    res.json({ patients });
  }),
);

// ---------------------------------------------------------------------------
// Registration — patient + diabetes profile + first care plan, in one step
// ---------------------------------------------------------------------------

router.post(
  '/',
  requireHospitalStaff,
  wrap((req, res) => {
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
      const exists = get('SELECT id FROM users WHERE phone = ?', patientInput.phone);
      if (exists) throw new ApiError(409, "Bu telefon raqami tizimda allaqachon ro'yxatdan o'tgan.");
    }

    const result = transaction(() => {
      let userId = null;
      if (account.create) {
        userId = insert(
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

      const patientId = insert(
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

      insert(
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
        let cgUser = get('SELECT * FROM users WHERE phone = ?', cg.phone);
        if (cgUser && cgUser.role !== 'caregiver') {
          throw new ApiError(409, 'Bu telefon raqami boshqa turdagi hisob uchun ishlatilgan.');
        }
        if (!cgUser) {
          const cgUserId = insert(
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
        caregiverId = insert(
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
          insert(
            `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
             VALUES (?, ?, ?, ?)`,
            caregiverId,
            key,
            granted[key] ? 1 : 0,
            req.user.id,
          );
        }
      }

      const planId = createDraftPlan(patientId, body.care_plan ?? {}, req.user);
      return { patientId, planId, userId, caregiverId };
    });

    audit(req, 'patient.register', 'patient', result.patientId, {
      care_plan_id: result.planId,
      account_created: Boolean(result.userId),
    });

    let plan = getPlanDetail(result.planId);
    if (body.approve) {
      plan = approvePlan(result.planId, req.user, "Dastlabki reja tasdiqlandi");
      audit(req, 'care_plan.approve', 'care_plan', result.planId, { version: plan.version });
    }

    res.status(201).json({ patient_id: result.patientId, care_plan: plan });
  }),
);

// ---------------------------------------------------------------------------
// Patient profile
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id);
    audit(req, 'patient.view', 'patient', patient.id);

    const profile = get('SELECT * FROM diabetes_profiles WHERE patient_id = ?', patient.id);
    const activePlan = getActivePlan(patient.id);
    const planDetail = activePlan ? getPlanDetail(activePlan.id) : null;

    res.json({
      patient,
      profile,
      care_plan: planDetail,
      adherence: {
        d7: adherenceRate(patient.id, 7),
        d30: adherenceRate(patient.id, 30),
      },
      last_activity: lastActivity(patient.id),
      today: getDailyPlan(patient.id),
      glucose: all(
        'SELECT * FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
        patient.id,
      ),
      blood_pressure: all(
        'SELECT * FROM blood_pressure_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
        patient.id,
      ),
      symptoms: all(
        'SELECT * FROM symptom_checks WHERE patient_id = ? ORDER BY reported_at DESC LIMIT 10',
        patient.id,
      ),
      alerts: all(
        'SELECT * FROM alerts WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20',
        patient.id,
      ),
      caregivers: all(
        `SELECT c.id, c.relation, c.status, c.authorized_at, u.full_name, u.phone
           FROM caregivers c JOIN users u ON u.id = c.user_id
          WHERE c.patient_id = ?`,
        patient.id,
      ).map((c) => ({ ...c, permissions: caregiverPermissions(c.id) })),
      plan_history: all(
        `SELECT cp.id, cp.version, cp.status, cp.approved_at, cp.notes, u.full_name AS approver
           FROM care_plans cp LEFT JOIN users u ON u.id = cp.approved_by
          WHERE cp.patient_id = ? ORDER BY cp.version DESC`,
        patient.id,
      ),
      ai_recommendations: all(
        `SELECT * FROM ai_recommendations WHERE patient_id = ? ORDER BY created_at DESC LIMIT 5`,
        patient.id,
      ),
    });
  }),
);

router.get(
  '/:id/report',
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id, 'view_measurements');
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    audit(req, 'patient.report', 'patient', patient.id, { days });
    res.json(buildReport(patient.id, days));
  }),
);

router.get(
  '/:id/plan-day',
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id, 'view_today_plan');
    res.json(getDailyPlan(patient.id, req.query.date));
  }),
);

// ---------------------------------------------------------------------------
// Caregiver authorisation (hospital staff only)
// ---------------------------------------------------------------------------

router.post(
  '/:id/caregivers',
  requireHospitalStaff,
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id);
    const input = validate(req.body, {
      full_name: { required: true, message: 'Ismni kiriting.' },
      phone: { required: true, message: 'Telefon raqamini kiriting.' },
      relation: { required: false },
      password: { required: true, message: 'Parolni kiriting.' },
    });

    let user = get('SELECT * FROM users WHERE phone = ?', input.phone);
    if (user && user.role !== 'caregiver') {
      throw new ApiError(409, 'Bu telefon raqami boshqa turdagi hisob uchun ishlatilgan.');
    }
    if (!user) {
      const id = insert(
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

    const existing = get(
      'SELECT id FROM caregivers WHERE patient_id = ? AND user_id = ?',
      patient.id, user.id,
    );
    if (existing) throw new ApiError(409, 'Bu yaqin kishi allaqachon biriktirilgan.');

    const caregiverId = insert(
      `INSERT INTO caregivers (patient_id, user_id, relation, status, authorized_by, authorized_at, created_by)
       VALUES (?, ?, ?, 'active', ?, datetime('now'), ?)`,
      patient.id, user.id, input.relation, req.user.id, req.user.id,
    );
    const granted = { ...DEFAULT_CAREGIVER_PERMISSIONS, ...(req.body.permissions ?? {}) };
    for (const key of CAREGIVER_PERMISSIONS) {
      insert(
        `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
         VALUES (?, ?, ?, ?)`,
        caregiverId, key, granted[key] ? 1 : 0, req.user.id,
      );
    }
    audit(req, 'caregiver.authorize', 'caregiver', caregiverId, { patient_id: patient.id });
    res.status(201).json({ id: caregiverId, permissions: caregiverPermissions(caregiverId) });
  }),
);

router.patch(
  '/:id/caregivers/:caregiverId',
  requireHospitalStaff,
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id);
    const caregiver = get(
      'SELECT * FROM caregivers WHERE id = ? AND patient_id = ?',
      Number(req.params.caregiverId), patient.id,
    );
    if (!caregiver) throw notFound('Yaqin kishi topilmadi.');

    if (req.body.status && ['active', 'revoked', 'pending'].includes(req.body.status)) {
      run(
        "UPDATE caregivers SET status = ?, updated_at = datetime('now') WHERE id = ?",
        req.body.status, caregiver.id,
      );
    }
    for (const [key, value] of Object.entries(req.body.permissions ?? {})) {
      if (!CAREGIVER_PERMISSIONS.includes(key)) continue;
      run(
        `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (caregiver_id, permission_key)
         DO UPDATE SET allowed = excluded.allowed, updated_at = datetime('now')`,
        caregiver.id, key, value ? 1 : 0, req.user.id,
      );
    }
    audit(req, 'caregiver.update', 'caregiver', caregiver.id, req.body);
    res.json({ id: caregiver.id, permissions: caregiverPermissions(caregiver.id) });
  }),
);

// ---------------------------------------------------------------------------
// Care plans
// ---------------------------------------------------------------------------

router.get(
  '/:id/care-plans',
  requireRole('nurse', 'doctor', 'hospital_admin'),
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id);
    const plans = all(
      `SELECT cp.*, u.full_name AS approver_name
         FROM care_plans cp LEFT JOIN users u ON u.id = cp.approved_by
        WHERE cp.patient_id = ? ORDER BY cp.version DESC`,
      patient.id,
    );
    res.json({ plans: plans.map((p) => getPlanDetail(p.id)) });
  }),
);

router.post(
  '/:id/care-plans',
  requireRole('nurse', 'doctor'),
  wrap((req, res) => {
    const { patient } = assertPatientAccess(req.user, req.params.id);
    if (!(req.body.medications ?? []).length && !(req.body.monitoring ?? []).length) {
      throw badRequest("Rejada kamida bitta dori yoki kuzatuv turi bo'lishi kerak.");
    }
    const planId = createDraftPlan(patient.id, req.body, req.user);
    audit(req, 'care_plan.create_draft', 'care_plan', planId, { patient_id: patient.id });
    res.status(201).json(getPlanDetail(planId));
  }),
);

export default router;
