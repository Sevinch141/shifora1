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
import { draftReply, geminiAvailable } from './gemini.js';

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

/**
 * Dose questions are matched on stems, not whole words.
 *
 * Uzbek is agglutinative: "doza" appears as dozani, dozasini, dozangizni, and
 * "oshir" as oshirsam, oshirsa bo‘ladimi. Matching whole words let
 * "Insulin dozasini oshirsam bo‘ladimi?" through as an ordinary question — the
 * one class of question that must never be answered. A subject stem beside a
 * change-verb stem catches the family regardless of suffix.
 *
 * The bias is deliberate: refusing a question that was harmless only sends it
 * to a nurse, while answering one about a dose is a clinical failure.
 */
const MEDICATION_SUBJECTS = [
  'doza', 'insulin', 'dori', 'tabletka', 'ukol', 'igna', 'shprits',
  'metformin', 'gliklazid', 'glibenklamid', 'enalapril', 'statin',
];
const CHANGE_VERBS = [
  'oshir', 'kamayt', 'ko‘payt', 'kopayt', 'to‘xtat', 'toxtat', 'tashla',
  'ichmas', 'ichmay', 'almashtir', 'qo‘shimcha', 'qoshimcha',
  'ikki marta', 'ikki barobar', 'ko‘proq ich', 'kamroq ich',
];
/** Unambiguous on their own, whatever they sit next to. */
const MEDICATION_PHRASES = [
  'dozani o‘zgartir', 'dozani ozgartir', 'boshqa dori', 'yangi dori',
  'dori ichmasam', 'dorini tashlasam',
];

const DIAGNOSIS_TERMS = [
  'nima kasallik', 'tashxis', 'menda nima bor', 'kasalmanmi',
  'diabetim bormi', 'saraton', 'nima bo‘ldi menga',
];

const TREND_TERMS = [
  'qandim', 'qand darajam', 'glyukoza', 'shakar', 'ko‘tarilib', 'tushib',
  'yaxshilandi', 'yomonlashdi', 'oxirgi kunlar', 'oxirgi hafta', 'trend',
];

const norm = (text) => String(text ?? '').toLowerCase().replace(/['`\u2019]/g, '\u2018');
const matches = (text, terms) => terms.some((term) => norm(text).includes(norm(term)));

/** A medication subject next to a change verb, or a phrase that needs neither. */
export function isMedicationChange(question) {
  if (matches(question, MEDICATION_PHRASES)) return true;
  return matches(question, MEDICATION_SUBJECTS) && matches(question, CHANGE_VERBS);
}

/**
 * Classifies intent by keyword.
 *
 * Order matters: emergency first so it can never be masked by another match,
 * then the two categories that are refused outright.
 */
export function classify(question) {
  if (matches(question, EMERGENCY_TERMS)) return 'emergency';
  if (isMedicationChange(question)) return 'medication_change';
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

function sourcesPayload({ range, guidance, documents, staffAnswers }) {
  const out = [];
  if (range?.source) out.push({ kind: 'care_plan', ...range.source, low: range.low, high: range.high });
  for (const match of documents?.matches ?? []) out.push(match);
  for (const match of guidance?.matches ?? []) out.push({ kind: 'guidance', ...match });
  for (const prior of staffAnswers ?? []) out.push(prior);
  return out;
}

/**
 * Answers a patient question, or refuses and files it.
 *
 * Always returns the same shape, so the caller does not branch on success.
 */
export async function ask({ patient, user, question, req = null, history = null, language = 'uz' }) {
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
  const score = Math.max(
    sources.guidance?.score ?? 0,
    sources.documents?.score ?? 0,
    ...(sources.staffAnswers ?? []).map((s) => s.score),
    0,
  );

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
  const factText = [
    facts.medications.length > 0
      ? `Joriy dorilar: ${facts.medications.map((m) => `${m.name} ${m.dose}${m.unit} (${m.times ?? '-'})`).join('; ')}`
      : null,
    (sources.notes ?? []).length > 0
      ? `Shifokorning bemorga ko‘rinadigan izohlari: ${sources.notes.map((n) => n.note).join(' | ')}`
      : null,
  ].filter(Boolean).join('\n');

  // Wording is delegated to the model, but only over passages that were
  // retrieved. It is told to answer INSUFFICIENT rather than fill a gap, and
  // that reply is treated as a refusal like any other.
  let message = null;
  if (geminiAvailable()) {
    try {
      const drafted = (await draftReply({
        question, passages: retrieved, facts: factText, language, history,
      }) ?? '').trim();
      if (/^INSUFFICIENT/i.test(drafted)) {
        return refuse(REFUSAL.INSUFFICIENT, 'normal', retrieved, score);
      }
      if (drafted) message = drafted;
    } catch {
      message = null; // fall through to the passages themselves
    }
  }

  if (!message) {
    // Without a model the passages are quoted directly. Less fluent, but every
    // sentence still comes from an approved source.
    message = retrieved.map((s) => s.content ?? s.answer).filter(Boolean).join('\n\n');
  }

  return {
    answered: true,
    intent,
    message,
    sources: retrieved,
    retrieval_score: score,
    facts,
    disclaimer: 'Shifora tashxis qo‘ymaydi va dori tayinlamaydi.',
  };
}
