/**
 * Hamshira AI and the question queue.
 *
 * Every route resolves the patient server-side — a patient from their own
 * session, staff through assertPatientAccess — so a caller cannot reach another
 * patient's record by changing an id in the request.
 */
import { Router } from 'express';
import { all, get } from '../db/index.js';
import { badRequest, forbidden, notFound, validate, wrap } from '../lib/http.js';
import { requireAuth, requireHospitalStaff } from '../middleware/auth.js';
import { assertPatientAccess, patientForUser } from '../services/access.js';
import { ask } from '../services/assistant.js';
import { glucoseTrend } from '../services/glucoseTrend.js';
import { approvedGlucoseRange } from '../services/guidance.js';
import {
  addNote, answerQuestion, assignQuestion, closeQuestion,
  notesFor, questionById, questionsForPatient, queueForHospital,
} from '../services/patientQuestions.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

async function selfPatient(req) {
  const patient = await patientForUser(req.user.id);
  if (!patient) throw forbidden('Hisobingiz bemor kartasiga bog‘lanmagan.');
  return patient;
}

/** The patient asks Hamshira AI. */
router.post(
  '/ask',
  wrap(async (req, res) => {
    const { question } = validate(req.body, {
      question: { required: true, message: 'Savolingizni yozing.' },
    });
    if (String(question).trim().length < 3) throw badRequest('Savol juda qisqa.');

    const patient = await selfPatient(req);
    const result = await ask({ patient, user: req.user, question: String(question).trim(), req });
    await audit(req, 'assistant.ask', 'patient', patient.id, {
      intent: result.intent,
      answered: result.answered,
      refusal_reason: result.refusal_reason ?? null,
    });
    res.json(result);
  }),
);

/** The patient's own glucose trend. */
router.get(
  '/me/glucose-trend',
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    const range = await approvedGlucoseRange(patient.id);
    res.json(await glucoseTrend(patient.id, range));
  }),
);

/** The patient's own questions. */
router.get(
  '/me/questions',
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    res.json({ questions: await questionsForPatient(patient.id) });
  }),
);

/** Staff: glucose trend for a patient they may see. */
router.get(
  '/patients/:id/glucose-trend',
  wrap(async (req, res) => {
    const patientId = Number(req.params.id);
    await assertPatientAccess(req.user, patientId, 'view_measurements');
    const range = await approvedGlucoseRange(patientId);
    await audit(req, 'chart.view', 'patient', patientId, { chart: 'glucose_trend' });
    res.json(await glucoseTrend(patientId, range));
  }),
);

/** Staff: the hospital's queue. */
router.get(
  '/questions',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    res.json({ questions: await queueForHospital(req.user.hospital_id, { status }) });
  }),
);

/**
 * Staff: one question with the context needed to answer it — the trend, the
 * current medications and what the assistant retrieved.
 */
router.get(
  '/questions/:id',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const question = await questionById(Number(req.params.id));
    if (!question) throw notFound('Savol topilmadi.');
    // Hospital isolation is checked here, not by hiding the row in the UI.
    if (question.hospital_id !== req.user.hospital_id) throw forbidden('Bu savol sizning shifoxonangizga tegishli emas.');

    const range = await approvedGlucoseRange(question.patient_id);
    const [trend, medications, notes] = await Promise.all([
      glucoseTrend(question.patient_id, range),
      all(
        `SELECT m.name, m.dose, m.unit, m.doses_per_day, m.is_active,
                STRING_AGG(s.time_of_day, ', ' ORDER BY s.time_of_day) AS times
           FROM medications m
           JOIN care_plans p ON p.id = m.care_plan_id
           LEFT JOIN medication_schedules s ON s.medication_id = m.id
          WHERE p.patient_id = ? AND p.status = 'active'
          GROUP BY m.id, m.name, m.dose, m.unit, m.doses_per_day, m.is_active
          ORDER BY m.name`,
        question.patient_id,
      ),
      notesFor(question.id),
    ]);

    await audit(req, 'question.view', 'patient_question', question.id);
    res.json({
      question: {
        ...question,
        retrieved_sources: question.retrieved_sources ? JSON.parse(question.retrieved_sources) : [],
      },
      trend,
      medications,
      notes,
    });
  }),
);

async function loadOwned(req) {
  const question = await questionById(Number(req.params.id));
  if (!question) throw notFound('Savol topilmadi.');
  if (question.hospital_id !== req.user.hospital_id) throw forbidden('Bu savol sizning shifoxonangizga tegishli emas.');
  return question;
}

router.post(
  '/questions/:id/answer',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const { answer } = validate(req.body, {
      answer: { required: true, message: 'Javob matnini kiriting.' },
    });
    const question = await loadOwned(req);
    const updated = await answerQuestion({ questionId: question.id, user: req.user, answer: String(answer).trim() });
    await audit(req, 'question.answered', 'patient_question', question.id);
    res.json({ question: updated });
  }),
);

router.post(
  '/questions/:id/assign',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const question = await loadOwned(req);
    const assigneeId = Number(req.body?.assigned_to ?? req.user.id);
    const assignee = await get(
      `SELECT id FROM users WHERE id = ? AND hospital_id = ? AND role IN ('nurse','doctor','hospital_admin')`,
      assigneeId,
      req.user.hospital_id,
    );
    if (!assignee) throw badRequest('Xodim topilmadi.');
    await assignQuestion(question.id, assigneeId);
    await audit(req, 'question.assigned', 'patient_question', question.id, { assigned_to: assigneeId });
    res.json({ ok: true });
  }),
);

router.post(
  '/questions/:id/notes',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const { note } = validate(req.body, { note: { required: true, message: 'Izoh matnini kiriting.' } });
    const question = await loadOwned(req);
    await addNote(question.id, req.user.id, String(note).trim());
    res.json({ notes: await notesFor(question.id) });
  }),
);

router.post(
  '/questions/:id/close',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const question = await loadOwned(req);
    await closeQuestion(question.id);
    await audit(req, 'question.closed', 'patient_question', question.id);
    res.json({ ok: true });
  }),
);

export default router;
