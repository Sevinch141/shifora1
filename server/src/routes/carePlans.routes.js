import { Router } from 'express';
import { all, get } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireHospitalStaff, requireRole } from '../middleware/auth.js';
import { assertPatientAccess } from '../services/access.js';
import { approvePlan, getPlanDetail, SCHEDULE_PRESETS } from '../services/carePlan.js';

const router = Router();

router.use(requireAuth);

/** The Uzbek schedule presets the registration wizard offers. */
router.get(
  '/schedule-presets',
  wrap((req, res) => {
    res.json({
      presets: Object.entries(SCHEDULE_PRESETS).map(([key, value]) => ({
        key,
        label: value.label,
        default_times: value.times,
      })),
    });
  }),
);

/** Active plans across the hospital, for the care-plan overview screen. */
router.get(
  '/',
  requireHospitalStaff,
  wrap((req, res) => {
    const { status = 'active', query = '' } = req.query;
    const params = [req.user.hospital_id];
    let sql = `SELECT cp.id, cp.version, cp.status, cp.approved_at, cp.start_date,
                      p.id AS patient_id, p.first_name, p.last_name, p.status AS patient_status,
                      dp.diabetes_type, u.full_name AS approver_name,
                      (SELECT COUNT(*) FROM medications m WHERE m.care_plan_id = cp.id) AS medication_count,
                      (SELECT COUNT(*) FROM monitoring_configs mc
                        WHERE mc.care_plan_id = cp.id AND mc.enabled = 1) AS monitoring_count
                 FROM care_plans cp
                 JOIN patients p ON p.id = cp.patient_id
                 LEFT JOIN diabetes_profiles dp ON dp.patient_id = p.id
                 LEFT JOIN users u ON u.id = cp.approved_by
                WHERE p.hospital_id = ?`;
    if (status !== 'all') {
      sql += ' AND cp.status = ?';
      params.push(status);
    }
    if (String(query).trim()) {
      sql += " AND (p.first_name || ' ' || p.last_name LIKE ?)";
      params.push(`%${String(query).trim()}%`);
    }
    sql += ' ORDER BY cp.approved_at DESC, cp.id DESC LIMIT 200';
    res.json({ plans: all(sql, ...params) });
  }),
);

router.get(
  '/:id',
  wrap((req, res) => {
    const plan = get('SELECT * FROM care_plans WHERE id = ?', Number(req.params.id));
    if (!plan) throw notFound('Davolash rejasi topilmadi.');
    assertPatientAccess(req.user, plan.patient_id, 'view_care_plan');
    res.json(getPlanDetail(plan.id));
  }),
);

/**
 * Approval is the moment a plan becomes clinically real. Only a nurse or a
 * doctor may do it, and the approving professional is recorded on the plan and
 * on an immutable version snapshot.
 */
router.post(
  '/:id/approve',
  requireRole('nurse', 'doctor'),
  wrap((req, res) => {
    const plan = get('SELECT * FROM care_plans WHERE id = ?', Number(req.params.id));
    if (!plan) throw notFound('Davolash rejasi topilmadi.');
    assertPatientAccess(req.user, plan.patient_id);
    if (plan.status === 'archived') throw badRequest('Arxivlangan rejani tasdiqlab bo‘lmaydi.');

    const detail = approvePlan(plan.id, req.user, req.body?.change_reason);
    audit(req, 'care_plan.approve', 'care_plan', plan.id, {
      patient_id: plan.patient_id,
      version: plan.version,
      change_reason: req.body?.change_reason ?? null,
    });
    res.json(detail);
  }),
);

router.get(
  '/:id/versions',
  wrap((req, res) => {
    const plan = get('SELECT * FROM care_plans WHERE id = ?', Number(req.params.id));
    if (!plan) throw notFound('Davolash rejasi topilmadi.');
    assertPatientAccess(req.user, plan.patient_id, 'view_care_plan');
    res.json({
      versions: all(
        `SELECT v.id, v.version, v.change_reason, v.approved_at, u.full_name AS approver
           FROM care_plan_versions v LEFT JOIN users u ON u.id = v.approved_by
          WHERE v.patient_id = ? ORDER BY v.version DESC`,
        plan.patient_id,
      ),
    });
  }),
);

export default router;
