import { Router } from 'express';
import { all, get, insert, run } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireHospitalStaff } from '../middleware/auth.js';
import { assertPatientAccess } from '../services/access.js';
import { getActivePlan } from '../services/carePlan.js';
import { AI_DISCLAIMER, generateCarePlanSuggestion, generatePatientSummary } from '../services/aiService.js';

const router = Router();

// AI output is decision support for clinicians only — never patient-facing.
router.use(requireAuth, requireHospitalStaff);

/**
 * Suggestion for the registration wizard. Deliberately stateless: it returns a
 * proposal, nothing is stored and nothing becomes active until a nurse or a
 * doctor approves the resulting plan.
 */
router.post(
  '/care-plan-suggestion',
  wrap(async (req, res) => {
    const { patient = {}, profile = {}, medications = [] } = req.body ?? {};
    if (!profile.diabetes_type) throw badRequest('Diabet turi tanlanmagan.');
    const suggestion = generateCarePlanSuggestion({ patient, profile, medications });
    await audit(req, 'ai.care_plan_suggestion', 'patient', patient.id ?? null, {
      provider: suggestion.provider,
    });
    res.json(suggestion);
  }),
);

/** Pattern / adherence / trend summaries for a nurse to review. */
router.post(
  '/patients/:id/summary',
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    const summary = await generatePatientSummary(patient.id);
    const plan = await getActivePlan(patient.id);

    const id = await insert(
      `INSERT INTO ai_recommendations
         (patient_id, care_plan_id, kind, provider, summary, payload_json, status, created_by)
       VALUES (?, ?, 'general_summary', ?, ?, ?, 'suggested', ?)`,
      patient.id,
      plan?.id ?? null,
      summary.provider,
      summary.insights.map((i) => i.text).join(' '),
      JSON.stringify(summary),
      req.user.id,
    );
    await audit(req, 'ai.summary', 'patient', patient.id, { recommendation_id: id });
    res.status(201).json({ id, ...summary });
  }),
);

router.get(
  '/patients/:id',
  wrap(async (req, res) => {
    const { patient } = await assertPatientAccess(req.user, req.params.id);
    res.json({
      disclaimer: AI_DISCLAIMER,
      recommendations: await all(
        `SELECT r.*, u.full_name AS reviewer
           FROM ai_recommendations r LEFT JOIN users u ON u.id = r.reviewed_by
          WHERE r.patient_id = ? ORDER BY r.created_at DESC LIMIT 20`,
        patient.id,
      ).map((r) => ({ ...r, payload: r.payload_json ? JSON.parse(r.payload_json) : null })),
    });
  }),
);

/** A clinician's verdict on a suggestion is itself part of the audit trail. */
router.patch(
  '/recommendations/:id',
  wrap(async (req, res) => {
    const rec = await get('SELECT * FROM ai_recommendations WHERE id = ?', Number(req.params.id));
    if (!rec) throw notFound('AI tavsiyasi topilmadi.');
    await assertPatientAccess(req.user, rec.patient_id);

    const status = req.body?.status;
    if (!['accepted', 'modified', 'rejected'].includes(status)) {
      throw badRequest("Noto'g'ri holat tanlandi.");
    }
    await run(
      `UPDATE ai_recommendations
          SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      status, req.user.id, rec.id,
    );
    await audit(req, 'ai.review', 'ai_recommendation', rec.id, { status });
    res.json(await get('SELECT * FROM ai_recommendations WHERE id = ?', rec.id));
  }),
);

export default router;
