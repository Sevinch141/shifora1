/**
 * The unanswered-question queue.
 *
 * A question the assistant declines does not disappear — it becomes a ticket a
 * clinician owns. The row keeps what was asked, what was retrieved, the score,
 * and why the assistant refused, so the decision can be reviewed later. It does
 * not keep reasoning traces.
 */
import { all, get, insert, run, transaction } from '../db/index.js';
import { notify } from './notifications.js';
import { audit } from '../lib/audit.js';

export const STATUSES = ['unanswered', 'assigned', 'answered', 'closed'];
export const PRIORITIES = ['normal', 'high', 'urgent'];

/**
 * Why the assistant handed the question over. Stored verbatim so the queue can
 * be filtered and so staff see the same reason the patient's screen implies.
 */
export const REFUSAL = {
  NO_SOURCE: 'no_approved_source',
  INSUFFICIENT: 'insufficient_information',
  DIAGNOSIS_REQUEST: 'diagnosis_request',
  MEDICATION_CHANGE: 'medication_change_request',
  MISSING_PATIENT_DATA: 'missing_patient_data',
  BELOW_THRESHOLD: 'retrieval_below_threshold',
  CLINICIAN_JUDGEMENT: 'requires_clinician_judgement',
  CONFLICTING: 'conflicting_guidance',
  EMERGENCY: 'emergency_protocol',
};

/**
 * Files a question for staff.
 *
 * Priority is passed in by the caller, which derives it from explicit rules —
 * never from a judgement about how worrying the question sounds.
 */
export async function createQuestion({
  patient, askedBy, question, language = 'uz', aiAttempted = true,
  aiAnswer = null, refusalReason, retrieved = null, retrievalScore = null,
  priority = 'normal', req = null,
}) {
  const id = await transaction(async () => {
    const questionId = await insert(
      `INSERT INTO patient_questions
         (patient_id, hospital_id, asked_by, question, language, status, priority,
          ai_attempted, ai_answer, refusal_reason, retrieved_sources, retrieval_score)
       VALUES (?, ?, ?, ?, ?, 'unanswered', ?, ?, ?, ?, ?, ?)`,
      patient.id,
      patient.hospital_id ?? null,
      askedBy ?? null,
      question,
      language,
      PRIORITIES.includes(priority) ? priority : 'normal',
      aiAttempted ? 1 : 0,
      aiAnswer,
      refusalReason,
      retrieved ? JSON.stringify(retrieved) : null,
      retrievalScore,
    );

    // Every nurse and doctor at the hospital sees the queue, so the ticket is
    // announced to them rather than assigned to one person automatically.
    const staff = await all(
      `SELECT id FROM users
        WHERE hospital_id = ? AND is_active = 1 AND role IN ('nurse', 'doctor')`,
      patient.hospital_id,
    );
    for (const member of staff) {
      await notify({
        userId: member.id,
        patientId: patient.id,
        type: priority === 'urgent' ? 'question_urgent' : 'question_new',
        title: 'Bemordan yangi savol',
        body: question.slice(0, 160),
        entityType: 'patient_question',
        entityId: questionId,
      });
    }
    return questionId;
  });

  if (req) await audit(req, 'question.created', 'patient_question', id, { refusalReason, priority });
  return id;
}

/** The patient's own questions, newest first. Staff notes are never included. */
export async function questionsForPatient(patientId) {
  return all(
    `SELECT q.id, q.question, q.status, q.priority, q.ai_answer, q.answer,
            q.created_at, q.answered_at,
            u.full_name AS answered_by_name, u.role AS answered_by_role
       FROM patient_questions q
       LEFT JOIN users u ON u.id = q.answered_by
      WHERE q.patient_id = ?
      ORDER BY q.created_at DESC`,
    patientId,
  );
}

/** The staff queue for one hospital. */
export async function queueForHospital(hospitalId, { status = null, limit = 100 } = {}) {
  // The status filter is appended rather than passed as a nullable parameter:
  // Postgres cannot infer the type of a bare NULL used in `? IS NULL`.
  const params = [hospitalId];
  let sql = `SELECT q.id, q.patient_id, q.question, q.status, q.priority, q.refusal_reason,
            q.created_at, q.answered_at,
            p.first_name, p.last_name, p.status AS patient_status,
            a.full_name AS assigned_to_name
       FROM patient_questions q
       JOIN patients p ON p.id = q.patient_id
       LEFT JOIN users a ON a.id = q.assigned_to
      WHERE q.hospital_id = ?`;
  if (status) {
    sql += ' AND q.status = ?';
    params.push(status);
  }
  sql += `
      ORDER BY
        CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        q.created_at ASC
      LIMIT ?`;
  params.push(limit);
  return all(sql, ...params);
}

export async function questionById(id) {
  return get(
    `SELECT q.*, p.first_name, p.last_name, p.hospital_id AS patient_hospital_id,
            a.full_name AS assigned_to_name,
            w.full_name AS answered_by_name
       FROM patient_questions q
       JOIN patients p ON p.id = q.patient_id
       LEFT JOIN users a ON a.id = q.assigned_to
       LEFT JOIN users w ON w.id = q.answered_by
      WHERE q.id = ?`,
    id,
  );
}

export async function notesFor(questionId) {
  return all(
    `SELECT n.id, n.note, n.created_at, u.full_name
       FROM question_notes n
       LEFT JOIN users u ON u.id = n.user_id
      WHERE n.question_id = ?
      ORDER BY n.created_at ASC`,
    questionId,
  );
}

export async function addNote(questionId, userId, note) {
  return insert(
    'INSERT INTO question_notes (question_id, user_id, note) VALUES (?, ?, ?)',
    questionId,
    userId,
    note,
  );
}

export async function assignQuestion(questionId, assigneeId) {
  await run(
    `UPDATE patient_questions
        SET assigned_to = ?, status = CASE WHEN status = 'unanswered' THEN 'assigned' ELSE status END,
            updated_at = datetime('now')
      WHERE id = ?`,
    assigneeId,
    questionId,
  );
}

/**
 * Records the clinical answer and tells the patient.
 *
 * The answer becomes reusable context for later conversations, but always
 * tagged `hospital_staff_answer` when it is retrieved — it is this hospital's
 * instruction for this patient, not published guidance.
 */
export async function answerQuestion({ questionId, user, answer }) {
  const question = await questionById(questionId);
  if (!question) return null;

  await run(
    `UPDATE patient_questions
        SET answer = ?, answered_by = ?, answered_at = datetime('now'),
            status = 'answered', updated_at = datetime('now')
      WHERE id = ?`,
    answer,
    user.id,
    questionId,
  );

  const patientUser = await get(
    'SELECT user_id FROM patients WHERE id = ?',
    question.patient_id,
  );
  if (patientUser?.user_id) {
    await notify({
      userId: patientUser.user_id,
      patientId: question.patient_id,
      type: 'question_answered',
      title: 'Savolingizga javob keldi',
      body: answer.slice(0, 160),
      entityType: 'patient_question',
      entityId: questionId,
    });
  }
  return questionById(questionId);
}

export async function closeQuestion(questionId) {
  await run(
    `UPDATE patient_questions SET status = 'closed', updated_at = datetime('now') WHERE id = ?`,
    questionId,
  );
}
