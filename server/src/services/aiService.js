import { all, get } from '../db/index.js';
import { addDays, toDateKey } from '../lib/time.js';
import { SCHEDULE_PRESETS } from './carePlan.js';

/**
 * AI decision-support layer.
 *
 * Hard boundaries, enforced by construction:
 *   - it never diagnoses, never prescribes, never changes a dose;
 *   - it never activates anything — output is a suggestion that a nurse or
 *     doctor must review and approve;
 *   - suggestions are always labelled "AI tavsiyasi" in the interface.
 *
 * The MVP ships a transparent local heuristic provider. A model-backed provider
 * can be registered under the same interface later without touching callers.
 */

export const AI_DISCLAIMER =
  "Bu AI tavsiyasi. U tashxis qo'ymaydi va dori dozasini o'zgartirmaydi. Yakuniy qaror tibbiyot xodimiga tegishli.";

const providers = new Map();

export function registerAiProvider(name, provider) {
  providers.set(name, provider);
}

export function activeProvider() {
  const name = process.env.SHIFORA_AI_PROVIDER ?? 'local_heuristic';
  return { name, provider: providers.get(name) ?? providers.get('local_heuristic') };
}

// ---------------------------------------------------------------------------
// Local heuristic provider
// ---------------------------------------------------------------------------

function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  const diff = Date.now() - born.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function usesInsulin(medications = []) {
  return medications.some((m) => /insulin|inzulin/i.test(m.name ?? ''));
}

function suggestCarePlan(context) {
  const { profile = {}, medications = [], patient = {} } = context;
  const age = ageFromBirthDate(patient.birth_date);
  const insulin = usesInsulin(medications);
  const type1 = profile.diabetes_type === 'type1';
  const priorHypo = Boolean(profile.prior_hypoglycemia);
  const recentAdmission = Boolean(profile.recent_hospitalization);
  const reasons = [];

  // --- glucose monitoring ---------------------------------------------------
  let glucoseTimes;
  if (type1 || insulin) {
    glucoseTimes = [
      { time_of_day: '07:30', context: 'fasting' },
      { time_of_day: '13:00', context: 'before_meal' },
      { time_of_day: '19:00', context: 'before_meal' },
      { time_of_day: '22:00', context: 'bedtime' },
    ];
    reasons.push(
      type1
        ? "1-tur diabet qayd etilgani uchun kuniga 4 marta glyukoza o'lchash taklif qilinadi."
        : "Davolash rejasida insulin borligi uchun kuniga 4 marta glyukoza o'lchash taklif qilinadi.",
    );
  } else if (priorHypo || recentAdmission) {
    glucoseTimes = [
      { time_of_day: '08:00', context: 'fasting' },
      { time_of_day: '20:00', context: 'before_meal' },
    ];
    reasons.push(
      priorHypo
        ? "Oldingi gipoglikemiya holatlari qayd etilgani uchun kuniga 2 marta o'lchash taklif qilinadi."
        : "Yaqinda shifoxonaga yotqizilgani uchun kuniga 2 marta o'lchash taklif qilinadi.",
    );
  } else {
    glucoseTimes = [{ time_of_day: '08:00', context: 'fasting' }];
    reasons.push("Kuniga 1 marta och qoringa o'lchash taklif qilinadi.");
  }

  // --- blood pressure -------------------------------------------------------
  const bpEnabled = recentAdmission || (age !== null && age >= 50);
  if (bpEnabled) {
    reasons.push(
      recentAdmission
        ? "Yaqinda shifoxonaga yotqizilgani uchun kunlik qon bosimi o'lchovi taklif qilinadi."
        : `Bemor yoshi (${age}) hisobga olinib, kunlik qon bosimi o'lchovi taklif qilinadi.`,
    );
  } else {
    reasons.push("Qon bosimi kuzatuvi shart deb belgilanmadi — hamshira zarur bo'lsa yoqishi mumkin.");
  }

  // --- symptom check --------------------------------------------------------
  const symptomTimes = priorHypo
    ? [{ time_of_day: '09:00', context: 'any' }, { time_of_day: '21:00', context: 'any' }]
    : [{ time_of_day: '19:00', context: 'any' }];
  reasons.push(
    priorHypo
      ? 'Gipoglikemiya tarixi borligi uchun kuniga 2 marta holat so‘rovi taklif qilinadi.'
      : 'Kuniga 1 marta holat so‘rovi taklif qilinadi.',
  );

  // --- medication reminder structure ---------------------------------------
  const medicationSuggestions = medications.map((med) => {
    const preset = SCHEDULE_PRESETS[med.schedule_type] ?? SCHEDULE_PRESETS.morning;
    const times = med.times?.length ? med.times : preset.times;
    return {
      name: med.name,
      schedule_type: med.schedule_type,
      schedule_label: preset.label,
      times,
      priority: med.priority,
      note:
        med.priority === 'critical'
          ? "Juda muhim deb belgilangan — tasdiqlanmasa hamshiraga tezroq xabar berilishi taklif qilinadi."
          : null,
    };
  });

  const criticalCount = medications.filter((m) => m.priority === 'critical').length;
  if (criticalCount > 0) {
    reasons.push(
      `${criticalCount} ta dori "Juda muhim" deb belgilangan — ular uchun eskalatsiya muddati 60 daqiqa taklif qilinadi.`,
    );
  }
  if (medications.length >= 3) {
    reasons.push(
      `Rejada ${medications.length} ta dori bor — eslatmalarni bir vaqtga to'plamaslik tavsiya etiladi.`,
    );
  }

  const summaryParts = [
    `Glyukoza: kuniga ${glucoseTimes.length} marta`,
    `Qon bosimi: ${bpEnabled ? 'kuniga 1 marta' : 'kuzatilmaydi'}`,
    `Belgilar so‘rovi: kuniga ${symptomTimes.length} marta`,
  ];

  return {
    summary: summaryParts.join(' · '),
    disclaimer: AI_DISCLAIMER,
    reasons,
    monitoring: [
      {
        type: 'glucose',
        enabled: true,
        frequency_per_day: glucoseTimes.length,
        times: glucoseTimes,
      },
      {
        type: 'blood_pressure',
        enabled: bpEnabled,
        frequency_per_day: bpEnabled ? 1 : 0,
        times: bpEnabled ? [{ time_of_day: '09:00', context: 'any' }] : [],
      },
      {
        type: 'symptom',
        enabled: true,
        frequency_per_day: symptomTimes.length,
        times: symptomTimes,
      },
    ],
    reminders: {
      reminder_repeat_minutes: 30,
      reminder_max_count: 2,
      snooze_minutes: 15,
      escalate_normal_minutes: 240,
      escalate_important_minutes: 120,
      escalate_critical_minutes: 60,
    },
    medications: medicationSuggestions,
  };
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

function adherenceBetween(patientId, fromKey, toKey) {
  const row = get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) AS taken
       FROM medication_doses
      WHERE patient_id = ? AND scheduled_at >= ? AND scheduled_at < ?`,
    patientId,
    fromKey,
    toKey,
  );
  return { total: row?.total ?? 0, taken: row?.taken ?? 0, rate: pct(row?.taken ?? 0, row?.total ?? 0) };
}

/** Pattern summaries for the nurse. Descriptive only — never instructions. */
function summarizePatient(patientId) {
  const today = toDateKey();
  const d7 = toDateKey(addDays(new Date(), -7));
  const d14 = toDateKey(addDays(new Date(), -14));
  const insights = [];

  const recent = adherenceBetween(patientId, d7, `${today} 23:59`);
  const previous = adherenceBetween(patientId, d14, d7);

  if (recent.total > 0) {
    if (previous.rate !== null && recent.rate !== null && recent.rate < previous.rate - 10) {
      insights.push({
        kind: 'adherence_summary',
        tone: 'warning',
        text: `Oxirgi 7 kun davomida dori qabul qilishga rioya qilish darajasi ${recent.rate}% — oldingi 7 kunda ${previous.rate}% edi.`,
      });
    } else if (recent.rate !== null && recent.rate >= 90) {
      insights.push({
        kind: 'adherence_summary',
        tone: 'positive',
        text: `Oxirgi 7 kunda dori qabul qilishga rioya qilish darajasi ${recent.rate}% — reja barqaror bajarilmoqda.`,
      });
    } else if (recent.rate !== null) {
      insights.push({
        kind: 'adherence_summary',
        tone: 'neutral',
        text: `Oxirgi 7 kunda dori qabul qilishga rioya qilish darajasi ${recent.rate}%.`,
      });
    }
  }

  const missedByHour = all(
    `SELECT substr(scheduled_at, 12, 2) AS hour, COUNT(*) AS c
       FROM medication_doses
      WHERE patient_id = ? AND status = 'missed' AND scheduled_at >= ?
      GROUP BY hour ORDER BY c DESC LIMIT 1`,
    patientId,
    d14,
  );
  if (missedByHour.length > 0 && missedByHour[0].c >= 2) {
    insights.push({
      kind: 'adherence_summary',
      tone: 'warning',
      text: `O'tkazib yuborilgan dorilar ko'proq soat ${missedByHour[0].hour}:00 atrofida qayd etilgan (${missedByHour[0].c} marta).`,
    });
  }

  const glucose = all(
    'SELECT value, measured_at FROM glucose_readings WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 10',
    patientId,
  );
  if (glucose.length >= 6) {
    const last3 = glucose.slice(0, 3);
    const rest = glucose.slice(3);
    const avg = (arr) => arr.reduce((s, r) => s + r.value, 0) / arr.length;
    const a = avg(last3);
    const b = avg(rest);
    const diff = Math.round(a - b);
    if (diff >= 20) {
      insights.push({
        kind: 'glucose_trend',
        tone: 'warning',
        text: `So'nggi 3 ta glyukoza o'lchovi (o'rtacha ${Math.round(a)} mg/dL) oldingi ko'rsatkichlarga nisbatan ${diff} mg/dL yuqoriroq.`,
      });
    } else if (diff <= -20) {
      insights.push({
        kind: 'glucose_trend',
        tone: 'warning',
        text: `So'nggi 3 ta glyukoza o'lchovi (o'rtacha ${Math.round(a)} mg/dL) oldingi ko'rsatkichlarga nisbatan ${Math.abs(diff)} mg/dL pastroq.`,
      });
    } else {
      insights.push({
        kind: 'glucose_trend',
        tone: 'neutral',
        text: `So'nggi glyukoza o'lchovlari oldingi ko'rsatkichlarga yaqin (o'rtacha ${Math.round(a)} mg/dL).`,
      });
    }
  } else if (glucose.length === 0) {
    insights.push({
      kind: 'glucose_trend',
      tone: 'neutral',
      text: "Tanlangan davrda glyukoza o'lchovlari kiritilmagan.",
    });
  }

  const missedMeasurements = get(
    `SELECT COUNT(*) AS c FROM monitoring_tasks
      WHERE patient_id = ? AND status = 'missed' AND scheduled_at >= ?`,
    patientId,
    d7,
  );
  if ((missedMeasurements?.c ?? 0) >= 3) {
    insights.push({
      kind: 'general_summary',
      tone: 'warning',
      text: `Oxirgi 7 kunda ${missedMeasurements.c} ta belgilangan o'lchov bajarilmagan.`,
    });
  }

  const symptomCount = get(
    `SELECT COUNT(*) AS c FROM symptom_checks
      WHERE patient_id = ? AND feeling != 'good' AND reported_at >= ?`,
    patientId,
    d7,
  );
  if ((symptomCount?.c ?? 0) > 0) {
    insights.push({
      kind: 'general_summary',
      tone: 'warning',
      text: `Oxirgi 7 kunda bemor ${symptomCount.c} marta o'zini yaxshi his qilmayotganini bildirgan.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      kind: 'general_summary',
      tone: 'neutral',
      text: "Ko'rsatkichlarda sezilarli o'zgarish aniqlanmadi.",
    });
  }

  return { disclaimer: AI_DISCLAIMER, insights };
}

registerAiProvider('local_heuristic', { suggestCarePlan, summarizePatient });

export function generateCarePlanSuggestion(context) {
  const { name, provider } = activeProvider();
  return { provider: name, ...provider.suggestCarePlan(context) };
}

export function generatePatientSummary(patientId) {
  const { name, provider } = activeProvider();
  return { provider: name, ...provider.summarizePatient(patientId) };
}
