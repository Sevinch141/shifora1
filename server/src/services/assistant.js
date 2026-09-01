/**
 * "Hamshira AI" — the patient-facing assistant.
 *
 * The rule the whole module is built around: the assistant may state facts that
 * are already in the patient's record, and may do arithmetic on them, but it
 * may not decide what those facts mean clinically. Meaning requires a reference
 * range, and a range may only come from the patient's approved care plan or the
 * approved guidance corpus. When neither supplies one, the assistant refuses in
 * a fixed sentence and the question is queued for a human.
 *
 * Two consequences worth stating plainly:
 *   - With an empty guidance corpus and no approved plan, every interpretive
 *     question is refused. That is correct, not broken.
 *   - Dose questions are refused before retrieval even runs. There is no
 *     retrieval result that would let this module discuss changing a dose.
 */
import { glucoseTrend } from './glucoseTrend.js';
import { interpretationFor } from './guidance.js';
import { createQuestion, REFUSAL } from './patientQuestions.js';
import { all, get } from '../db/index.js';

export const REFUSAL_MESSAGE =
  "Men bu savolingizga javob bera olmayman. Iltimos, hamshira yoki shifokor javobini kuting.";
export const QUEUED_MESSAGE = 'Savolingiz tibbiyot xodimiga yuborildi.';

/**
 * Explicit, clinician-owned trigger lists.
 *
 * These are lookup tables, not judgement. Editing them is a clinical decision;
 * the assistant never adds to them at runtime and never marks something urgent
 * on its own reading of how serious a question sounds.
 */
const EMERGENCY_TERMS = [
  'hushimdan ketyapman', 'hushidan ketdi', 'behush',
  'nafas ololmayapman', 'nafas qisyapti',
  'ko‘krak og‘riyapti', 'yurak og‘riyapti',
  'qattiq qaltirayapman', 'talvasa', 'tutqanoq',
  'qusyapman va holsizman', 'ko‘zim xiralashdi va holsizman',
];

const MEDICATION_CHANGE_TERMS = [
  'dozani', 'doza oshir', 'doza kamayt', 'ikki marta qil', 'ikki barobar',
  'to‘xtatsam', 'to‘xtataymi', 'ichmasam', 'ichmay qo‘ysam',
  'boshqa dori', 'yangi dori', 'ko‘proq ichsam', 'kamroq ichsam',
  'insulinni ikki', 'qo‘shimcha ukol',
];

const DIAGNOSIS_TERMS = [
  'nima kasallik', 'tashxis', 'menda nima bor', 'kasalmanmi',
  'diabetim bormi', 'saraton', 'nima bo‘ldi menga',
];

const TREND_TERMS = [
  'qandim', 'qand darajam', 'glyukoza', 'shakar', 'ko‘tarilib', 'tushib',
  'yaxshilandi', 'yomonlashdi', 'oxirgi kunlar', 'oxirgi hafta', 'trend',
];

const norm = (text) => String(text ?? '').toLowerCase();
const matches = (text, terms) => terms.some((term) => norm(text).includes(norm(term)));

/**
 * Classifies intent by keyword.
 *
 * Order matters: emergency first so it can never be masked by another match,
 * then the two categories that are refused outright.
 */
export function classify(question) {
  if (matches(question, EMERGENCY_TERMS)) return 'emergency';
  if (matches(question, MEDICATION_CHANGE_TERMS)) return 'medication_change';
  if (matches(question, DIAGNOSIS_TERMS)) return 'diagnosis';
  if (matches(question, TREND_TERMS)) return 'glucose_trend';
  return 'general';
}

/** Facts already in the record. Safe to state; they carry no interpretation. */
async function patientFacts(patientId) {
  const meds = await all(
    `SELECT m.name, m.dose, m.unit, m.doses_per_day,
            STRING_AGG(s.time_of_day, ', ' ORDER BY s.time_of_day) AS times
       FROM medications m
       JOIN care_plans p ON p.id = m.care_plan_id
       LEFT JOIN medication_schedules s ON s.medication_id = m.id
      WHERE p.patient_id = ? AND p.status = 'active' AND m.is_active = 1
      GROUP BY m.id, m.name, m.dose, m.unit, m.doses_per_day
      ORDER BY m.name`,
    patientId,
  );
  return { medications: meds };
}

function sourcesPayload({ range, guidance, staffAnswers }) {
  const out = [];
  if (range?.source) out.push({ kind: 'care_plan', ...range.source, low: range.low, high: range.high });
  for (const match of guidance?.matches ?? []) out.push({ kind: 'guidance', ...match });
  for (const prior of staffAnswers ?? []) out.push(prior);
  return out;
}

/**
 * Answers a patient question, or refuses and files it.
 *
 * Always returns the same shape, so the caller does not branch on success.
 */
export async function ask({ patient, user, question, req = null }) {
  const intent = classify(question);

  const refuse = async (refusalReason, priority = 'normal', retrieved = null, score = null) => {
    const questionId = await createQuestion({
      patient,
      askedBy: user?.id ?? null,
      question,
      aiAttempted: true,
      aiAnswer: null,
      refusalReason,
      retrieved,
      retrievalScore: score,
      priority,
      req,
    });
    return {
      answered: false,
      message: REFUSAL_MESSAGE,
      queued_message: QUEUED_MESSAGE,
      status_label: 'Holat: Javob kutilmoqda',
      question_id: questionId,
      refusal_reason: refusalReason,
      priority,
      intent,
    };
  };

  // Emergency terms are an explicit protocol, so this path both directs the
  // patient to emergency care and raises the ticket at urgent priority. This is
  // the only route to `urgent`, and a keyword list — not a model — opens it.
  if (intent === 'emergency') {
    const result = await refuse(REFUSAL.EMERGENCY, 'urgent');
    return {
      ...result,
      emergency: true,
      message:
        'Bu belgilar shoshilinch yordam talab qilishi mumkin. Darhol 103 raqamiga qo‘ng‘iroq qiling '
        + 'yoki shifoxonaga murojaat qiling.',
    };
  }

  // Refused before retrieval: nothing that could be retrieved would authorise
  // the assistant to discuss changing a dose.
  if (intent === 'medication_change') return refuse(REFUSAL.MEDICATION_CHANGE, 'high');
  if (intent === 'diagnosis') return refuse(REFUSAL.DIAGNOSIS_REQUEST);

  const sources = await interpretationFor(
    patient.id,
    patient.hospital_id,
    intent === 'glucose_trend' ? 'glucose' : null,
    question,
  );
  const retrieved = sourcesPayload(sources);
  const score = Math.max(sources.guidance?.score ?? 0, ...(sources.staffAnswers ?? []).map((s) => s.score), 0);

  if (intent === 'glucose_trend') {
    const trend = await glucoseTrend(patient.id, sources.range);

    if (trend.total_readings === 0) {
      return refuse(REFUSAL.MISSING_PATIENT_DATA, 'normal', retrieved, score);
    }
    // Numbers without an approved range would force the assistant to say
    // whether they are acceptable — exactly the judgement it may not make.
    if (!sources.range) {
      return refuse(REFUSAL.NO_SOURCE, 'normal', retrieved, score);
    }

    const week = trend.last_7_days;
    const lines = [
      `Oxirgi 7 kunda ${week.all.count} ta o‘lchov qayd etilgan.`,
      week.all.average !== null
        ? `O‘rtacha ${week.all.average} ${week.all.unit}, eng past ${week.all.min}, eng yuqori ${week.all.max}.`
        : null,
      week.fasting.count > 0
        ? `Ochlikdagi o‘lchovlar: ${week.fasting.count} ta, o‘rtacha ${week.fasting.average} ${week.fasting.unit}.`
        : null,
      week.post_meal.count > 0
        ? `Ovqatdan keyingi o‘lchovlar: ${week.post_meal.count} ta, o‘rtacha ${week.post_meal.average} ${week.post_meal.unit}.`
        : null,
      week.in_range
        ? `Shifokor belgilagan ${week.in_range.low}–${week.in_range.high} ${week.in_range.unit} oralig‘ida `
          + `${week.in_range.inside} ta o‘lchov (${week.in_range.percent}%).`
        : null,
      week.change
        ? `Hafta boshi bilan oxirini solishtirganda o‘rtacha ${week.change.earlier_average} dan `
          + `${week.change.later_average} ga o‘zgargan (${week.change.delta > 0 ? '+' : ''}${week.change.delta} ${week.change.unit}).`
        : null,
      'Bu raqamlar o‘lchovlaringizdan hisoblandi. Ular nimani anglatishini shifokor yoki hamshira baholaydi.',
    ].filter(Boolean);

    return {
      answered: true,
      intent,
      message: lines.join('\n'),
      trend,
      sources: retrieved,
      retrieval_score: score,
      disclaimer: 'Shifora tashxis qo‘ymaydi va dori tayinlamaydi.',
    };
  }

  // Anything else needs a document to stand on.
  if (retrieved.length === 0) return refuse(REFUSAL.NO_SOURCE, 'normal', retrieved, score);

  const facts = await patientFacts(patient.id);
  const citations = retrieved
    .map((s) => (s.kind === 'hospital_staff_answer'
      ? `Shifoxona xodimining oldingi javobi (${s.answered_at})`
      : `${s.source_org}: ${s.citation}`))
    .join(' · ');

  return {
    answered: true,
    intent,
    message: `${retrieved.map((s) => s.content ?? s.answer).filter(Boolean).join('\n\n')}\n\nManba: ${citations}`,
    sources: retrieved,
    retrieval_score: score,
    facts,
    disclaimer: 'Shifora tashxis qo‘ymaydi va dori tayinlamaydi.',
  };
}
