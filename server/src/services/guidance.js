/**
 * Approved medical guidance — the only place clinical meaning may come from.
 *
 * Two kinds of source count as approved:
 *
 *   1. `alert_rules` on the patient's active care plan. These are per-patient
 *      thresholds a clinician entered and signed off, so they outrank anything
 *      general and are used first.
 *   2. Rows in `medical_guidance` — published guidance (WHO, ADA, IDF, NHS,
 *      Uzbekistan MoH) or a hospital protocol, entered and approved by staff.
 *
 * There is no third kind. Nothing in this file contains a reference range, and
 * the assistant may not supply one: with an empty corpus and no care-plan rule,
 * `interpretationFor` returns null, the assistant refuses, and the question is
 * queued for a human. That silence is the designed behaviour, not a gap.
 */
import { all, get } from '../db/index.js';
import { searchDocuments } from './documentLibrary.js';

/** Below this, retrieval is treated as having found nothing usable. */
export const RETRIEVAL_THRESHOLD = Number(process.env.SHIFORA_RETRIEVAL_THRESHOLD ?? 0.35);

/**
 * Glucose bounds from the patient's own approved care plan.
 *
 * `alert_rules` stores them as comparator + value pairs per code; the two codes
 * below are the ones the alert engine uses for glucose.
 *
 * The clinical sign-off in this system is the plan, not the individual rule:
 * approvePlan() sets care_plans.approved_by and snapshots the rules alongside
 * the approver. So an active, approved plan is what makes its rules usable
 * here. alert_rules.approved_by is honoured too, for a rule signed off on its
 * own, but is not required — demanding it would reject every rule the normal
 * approval flow produces.
 */
export async function approvedGlucoseRange(patientId) {
  const rows = await all(
    `SELECT r.code, r.comparator, r.value_1, r.value_2, r.severity,
            COALESCE(r.approved_by, p.approved_by) AS approved_by,
            COALESCE(r.approved_at, p.approved_at) AS approved_at
       FROM alert_rules r
       JOIN care_plans p ON p.id = r.care_plan_id
      WHERE p.patient_id = ? AND p.status = 'active' AND r.enabled = 1
        AND p.approved_by IS NOT NULL
        AND r.code IN ('glucose_low', 'glucose_high')`,
    patientId,
  );
  if (rows.length === 0) return null;

  const low = rows.find((r) => r.code === 'glucose_low');
  const high = rows.find((r) => r.code === 'glucose_high');
  if (!low?.value_1 && !high?.value_1) return null;

  return {
    low: low?.value_1 ?? null,
    high: high?.value_1 ?? null,
    unit: null,
    source: {
      kind: 'care_plan',
      label: 'Shifokor tasdiqlagan individual chegara',
      approved_by: low?.approved_by ?? high?.approved_by ?? null,
      approved_at: low?.approved_at ?? high?.approved_at ?? null,
    },
  };
}

/**
 * Keyword retrieval over the approved corpus.
 *
 * Deliberately simple and transparent: the score is the share of the question's
 * words that appear in a document. It is auditable and it cannot hallucinate. A
 * real deployment can swap in embeddings behind this same signature.
 */
export async function retrieveGuidance(topic, question, hospitalId) {
  // The topic filter is appended rather than passed as a nullable parameter:
  // Postgres cannot infer the type of a bare NULL used in `? IS NULL`.
  const params = [hospitalId ?? null];
  let sql = `SELECT id, source_org, topic, title, content, citation, url, approved_at
       FROM medical_guidance
      WHERE is_active = 1
        AND approved_by IS NOT NULL
        AND (hospital_id IS NULL OR hospital_id = ?)`;
  if (topic) {
    sql += ' AND topic = ?';
    params.push(topic);
  }
  const docs = await all(sql, ...params);
  if (docs.length === 0) return { matches: [], score: 0 };

  const words = String(question ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3);
  if (words.length === 0) return { matches: [], score: 0 };

  const scored = docs
    .map((doc) => {
      const haystack = `${doc.title} ${doc.content}`.toLowerCase();
      const hits = words.filter((w) => haystack.includes(w)).length;
      return { doc, score: hits / words.length };
    })
    .filter((entry) => entry.score >= RETRIEVAL_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return {
    matches: scored.slice(0, 3).map((entry) => ({
      id: entry.doc.id,
      source_org: entry.doc.source_org,
      title: entry.doc.title,
      content: entry.doc.content,
      citation: entry.doc.citation,
      url: entry.doc.url,
      score: Math.round(entry.score * 100) / 100,
    })),
    score: scored.length > 0 ? Math.round(scored[0].score * 100) / 100 : 0,
  };
}

/**
 * An earlier answer a clinician gave this patient.
 *
 * Reusable context, but tagged `hospital_staff_answer` so it can never be
 * presented as, or confused with, published guidance.
 */
export async function priorStaffAnswers(patientId, question) {
  const rows = await all(
    `SELECT id, question, answer, answered_at
       FROM patient_questions
      WHERE patient_id = ? AND status IN ('answered', 'closed') AND answer IS NOT NULL
      ORDER BY answered_at DESC
      LIMIT 20`,
    patientId,
  );
  const words = String(question ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3);
  if (words.length === 0) return [];

  return rows
    .map((row) => {
      const haystack = String(row.question).toLowerCase();
      const hits = words.filter((w) => haystack.includes(w)).length;
      return { row, score: hits / words.length };
    })
    .filter((entry) => entry.score >= RETRIEVAL_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((entry) => ({
      kind: 'hospital_staff_answer',
      id: entry.row.id,
      question: entry.row.question,
      answer: entry.row.answer,
      answered_at: entry.row.answered_at,
      score: Math.round(entry.score * 100) / 100,
    }));
}

/**
 * Clinician notes the patient is allowed to see.
 *
 * The visibility filter is in the SQL, not in the caller: an internal note must
 * never reach the assistant's context in the first place.
 */
export async function patientVisibleNotes(patientId) {
  return all(
    `SELECT n.id, n.note, n.created_at, u.full_name AS author_name
       FROM patient_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.patient_id = ? AND n.visibility = 'patient_visible'
      ORDER BY n.created_at DESC
      LIMIT 5`,
    patientId,
  );
}

/**
 * Everything approved that bears on this patient and question, in one call.
 * `range` being null is the signal that no interpretation may be offered.
 */
export async function interpretationFor(patientId, hospitalId, topic, question) {
  const [range, guidance, documents, staffAnswers, notes] = await Promise.all([
    approvedGlucoseRange(patientId),
    retrieveGuidance(topic, question, hospitalId),
    searchDocuments(question, hospitalId, { threshold: RETRIEVAL_THRESHOLD }),
    priorStaffAnswers(patientId, question),
    patientVisibleNotes(patientId),
  ]);
  return { range, guidance, documents, staffAnswers, notes };
}
