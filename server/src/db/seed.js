/**
 * Seeds a realistic demo hospital.
 *
 * The data is generated through the real services (care plan approval, task
 * materialisation, the alert engine), so every status, adherence figure and
 * alert on screen is produced by the same code paths the running system uses.
 */
import { all, get, insert, run, transaction, closePool, migrate } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { addDays, toDateKey } from '../lib/time.js';
import { approvePlan, createDraftPlan } from '../services/carePlan.js';
import {
  evaluateBloodPressure,
  evaluateGlucose,
  evaluateSymptomCheck,
  escalateMissedDose,
  recomputePatientStatus,
} from '../services/alertEngine.js';

// Deterministic PRNG so repeated seeds produce the same demo hospital.
let seedState = 20260817;
function rnd() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (min, max) => Math.round(min + rnd() * (max - min));
const chance = (p) => rnd() < p;

const MALE_NAMES = ['Sardor', 'Bekzod', 'Jasur', 'Anvar', 'Otabek', 'Rustam', 'Shuhrat', 'Bahodir',
  'Aziz', 'Ulug‘bek', 'Farrux', 'Doniyor', 'Sanjar', 'Alisher', 'Islom', 'Temur', 'Javohir',
  'Nodir', 'Akmal', 'Dilshod', 'Sherzod', 'Bobur', 'Xurshid', 'Qahramon', 'Elyor'];
const FEMALE_NAMES = ['Zilola', 'Nilufar', 'Gulnora', 'Dilnoza', 'Malika', 'Shahnoza', 'Kamola',
  'Sevara', 'Nargiza', 'Feruza', 'Zulfiya', 'Munira', 'Ozoda', 'Lola', 'Aziza', 'Madina',
  'Nafisa', 'Rayhona', 'Guzal', 'Sabina', 'Mohira', 'Dildora', 'Zebo', 'Nodira', 'Umida'];
const SURNAMES = ['Karimov', 'Rahimov', 'Yusupov', 'Qodirov', 'Tursunov', 'Ismoilov', 'Xolmatov',
  'Abdullayev', 'Nazarov', 'Sultonov', 'Ergashev', 'Sobirov', 'Mirzayev', 'Yo‘ldoshev', 'Hakimov',
  'Jo‘rayev', 'Umarov', 'Salimov', 'Rasulov', 'Aliyev'];

const DISTRICTS = ['Chilonzor tumani', 'Yunusobod tumani', 'Mirzo Ulug‘bek tumani', 'Sergeli tumani',
  'Yakkasaroy tumani', 'Shayxontohur tumani', 'Olmazor tumani', 'Bektemir tumani'];

const ORAL_MEDS = [
  { name: 'Metformin', dose: '500', unit: 'mg', schedule_type: 'morning_evening', priority: 'important' },
  { name: 'Metformin', dose: '1000', unit: 'mg', schedule_type: 'morning_evening', priority: 'important' },
  { name: 'Gliklazid', dose: '30', unit: 'mg', schedule_type: 'morning', priority: 'important' },
  { name: 'Glibenklamid', dose: '5', unit: 'mg', schedule_type: 'morning', priority: 'normal' },
];
const SUPPORT_MEDS = [
  { name: 'Enalapril', dose: '10', unit: 'mg', schedule_type: 'morning', priority: 'normal' },
  { name: 'Amlodipin', dose: '5', unit: 'mg', schedule_type: 'evening', priority: 'normal' },
  { name: 'Atorvastatin', dose: '20', unit: 'mg', schedule_type: 'bedtime', priority: 'normal' },
];
const INSULIN_MEDS = [
  { name: 'Insulin glargin', dose: '16', unit: 'birlik', schedule_type: 'bedtime', priority: 'critical' },
  { name: 'Insulin aspart', dose: '8', unit: 'birlik', schedule_type: 'morning_noon', priority: 'critical' },
];

async function clearDatabase() {
  const tables = [
    'audit_logs', 'ai_recommendations', 'alert_notes', 'alerts', 'notifications',
    'symptom_checks', 'blood_pressure_readings', 'glucose_readings',
    'monitoring_tasks', 'medication_doses', 'alert_rules', 'monitoring_times',
    'monitoring_configs', 'medication_schedules', 'medications',
    'care_plan_versions', 'care_plans', 'caregiver_permissions', 'caregivers',
    'diabetes_profiles', 'patients', 'sessions', 'users', 'hospitals',
  ];
  // TRUNCATE ... CASCADE resets identities too, so ids start from 1 again.
  await run(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

async function createStaff(hospitalId) {
  const make = (role, fullName, phone, password) =>
    insert(
      `INSERT INTO users (hospital_id, role, full_name, phone, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      hospitalId, role, fullName, phone, hashPassword(password),
    );
  return {
    nurse: await make('nurse', 'Dilnoza Rahimova', '901112233', 'hamshira'),
    nurse2: await make('nurse', 'Kamola Ergasheva', '901112266', 'hamshira'),
    doctor: await make('doctor', 'Anvar Qodirov', '901112244', 'shifokor'),
    admin: await make('hospital_admin', 'Nodira Yusupova', '901112255', 'admin'),
  };
}

function buildMedications(diabetesType, insulin) {
  const meds = [];
  if (insulin) {
    meds.push({ ...pick(INSULIN_MEDS) });
    if (diabetesType === 'type1' || chance(0.5)) meds.push({ ...INSULIN_MEDS[1] });
  }
  if (diabetesType !== 'type1') meds.push({ ...pick(ORAL_MEDS) });
  if (chance(0.55)) meds.push({ ...pick(SUPPORT_MEDS) });

  // De-duplicate by name so a plan never lists the same medicine twice.
  const seen = new Set();
  return meds.filter((m) => (seen.has(m.name) ? false : seen.add(m.name)));
}

function buildMonitoring(diabetesType, insulin, withBp) {
  const glucoseTimes = insulin || diabetesType === 'type1'
    ? [
        { time_of_day: '07:30', context: 'fasting' },
        { time_of_day: '13:00', context: 'before_meal' },
        { time_of_day: '19:00', context: 'before_meal' },
        { time_of_day: '22:00', context: 'bedtime' },
      ]
    : chance(0.5)
      ? [{ time_of_day: '08:00', context: 'fasting' }, { time_of_day: '20:00', context: 'before_meal' }]
      : [{ time_of_day: '08:00', context: 'fasting' }];

  return [
    { type: 'glucose', enabled: true, times: glucoseTimes },
    {
      type: 'blood_pressure',
      enabled: withBp,
      times: withBp ? [{ time_of_day: '09:00', context: 'any' }] : [],
    },
    { type: 'symptom', enabled: true, times: [{ time_of_day: '19:00', context: 'any' }] },
  ];
}

/**
 * Recreates the previous `days` of dose history for an already-approved plan.
 * `adherence` is the probability the patient confirmed a given dose.
 */
async function backfillDoses(patientId, planId, days, adherence, nurseId) {
  const meds = await all(
    `SELECT m.id, m.priority, s.id AS schedule_id, s.time_of_day
       FROM medications m JOIN medication_schedules s ON s.medication_id = m.id
      WHERE m.care_plan_id = ?`,
    planId,
  );
  for (let offset = days; offset >= 1; offset -= 1) {
    const dateKey = toDateKey(addDays(new Date(), -offset));
    for (const med of meds) {
      const taken = chance(adherence);
      await run(
        `INSERT INTO medication_doses
           (patient_id, care_plan_id, medication_id, schedule_id, scheduled_at, status,
            taken_at, reminder_count, last_reminder_at, escalated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        patientId, planId, med.id, med.schedule_id,
        `${dateKey} ${med.time_of_day}`,
        taken ? 'taken' : 'missed',
        taken ? `${dateKey} ${med.time_of_day}` : null,
        taken ? 1 : 2,
        `${dateKey} ${med.time_of_day}`,
        taken ? null : `${dateKey} ${med.time_of_day}`,
        nurseId,
      );
    }
  }
}

/**
 * Values are kept inside the seeded thresholds for the stable cohort and pushed
 * outside them for the others, so the statuses on the dashboard are produced by
 * the real alert engine rather than written in by hand.
 */
function glucoseValueFor(profileKind, context) {
  const ranges = { stable: [96, 148], attention: [132, 186], urgent: [148, 232] };
  const [min, max] = ranges[profileKind];
  const shift = context === 'after_meal' ? 18 : context === 'fasting' ? -10 : 0;
  return Math.max(60, Math.round(between(min, max) + shift));
}

function bpValuesFor(profileKind) {
  if (profileKind === 'stable') return { systolic: between(110, 134), diastolic: between(68, 84) };
  if (profileKind === 'attention') return { systolic: between(126, 152), diastolic: between(76, 92) };
  return { systolic: between(138, 172), diastolic: between(82, 98) };
}

async function backfillMeasurements(patient, planId, days, profileKind, nurseId) {
  const times = await all(
    `SELECT c.type, t.time_of_day, t.context
       FROM monitoring_configs c JOIN monitoring_times t ON t.monitoring_config_id = c.id
      WHERE c.care_plan_id = ? AND c.enabled = 1`,
    planId,
  );

  for (let offset = days; offset >= 0; offset -= 1) {
    const dateKey = toDateKey(addDays(new Date(), -offset));
    const skipDay = chance(profileKind === 'stable' ? 0.08 : 0.25);
    for (const slot of times) {
      if (offset === 0 && slot.time_of_day > new Date().toTimeString().slice(0, 5)) continue;
      if (skipDay && chance(0.6)) continue;
      const measuredAt = `${dateKey} ${slot.time_of_day}`;

      if (slot.type === 'glucose') {
        await insert(
          `INSERT INTO glucose_readings
             (patient_id, value, unit, context, measured_at, source, created_by, created_at)
           VALUES (?, ?, 'mg/dL', ?, ?, 'manual', ?, ?)`,
          patient.id, glucoseValueFor(profileKind, slot.context), slot.context,
          measuredAt, patient.user_id ?? nurseId, measuredAt,
        );
      } else if (slot.type === 'blood_pressure') {
        const { systolic, diastolic } = bpValuesFor(profileKind);
        await insert(
          `INSERT INTO blood_pressure_readings
             (patient_id, systolic, diastolic, pulse, measured_at, source, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
          patient.id, systolic, diastolic, between(62, 92),
          measuredAt, patient.user_id ?? nurseId, measuredAt,
        );
      } else if (slot.type === 'symptom' && chance(0.7)) {
        const feeling = profileKind === 'stable'
          ? 'good'
          : chance(profileKind === 'urgent' ? 0.5 : 0.25) ? 'not_good' : 'good';
        const symptoms = feeling === 'good' ? [] : [pick(['thirst', 'weakness', 'dizziness', 'urination'])];
        await insert(
          `INSERT INTO symptom_checks
             (patient_id, feeling, symptoms, reported_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          patient.id, feeling, JSON.stringify(symptoms),
          measuredAt, patient.user_id ?? nurseId, measuredAt,
        );
      }
    }
  }

  // Mark the measurement tasks that history says were completed.
  await run(
    `UPDATE monitoring_tasks SET status = 'done', completed_at = scheduled_at
      WHERE patient_id = ? AND scheduled_at < datetime('now')
        AND EXISTS (
          SELECT 1 FROM glucose_readings g
           WHERE g.patient_id = monitoring_tasks.patient_id
             AND monitoring_tasks.type = 'glucose'
             AND g.measured_at = monitoring_tasks.scheduled_at)`,
    patient.id,
  );
}

/** Records a reading that is deliberately outside the patient's thresholds. */
async function insertOutOfRangeGlucose(patient, nurseId, kind) {
  const measuredAt = new Date();
  measuredAt.setHours(measuredAt.getHours() - 1);
  const stamp = `${toDateKey(measuredAt)} ${String(measuredAt.getHours()).padStart(2, '0')}:${String(measuredAt.getMinutes()).padStart(2, '0')}`;
  const value = kind === 'critical_low'
    ? between(42, 52)
    : kind === 'critical_high'
      ? between(312, 386)
      : between(188, 244);
  const id = await insert(
    `INSERT INTO glucose_readings
       (patient_id, value, unit, context, measured_at, source, created_by, created_at)
     VALUES (?, ?, 'mg/dL', ?, ?, 'manual', ?, ?)`,
    patient.id, value, kind === 'critical_low' ? 'before_meal' : 'after_meal',
    stamp, patient.user_id ?? nurseId, stamp,
  );
  return await get('SELECT * FROM glucose_readings WHERE id = ?', id);
}

/**
 * Feeds the most recent readings through the real alert engine. Stable patients
 * are left alone — their values never crossed a threshold, so no alert exists.
 */
async function raiseCurrentAlerts(patient, plan, profileKind, nurseId) {
  if (profileKind === 'stable') return;

  if (profileKind === 'attention') {
    const reading = await insertOutOfRangeGlucose(patient, nurseId, 'high');
    await evaluateGlucose(patient, reading, plan, { silent: true, createdAt: reading.measured_at });

    const recentSymptom = await get(
      `SELECT * FROM symptom_checks WHERE patient_id = ? AND feeling != 'good'
        ORDER BY reported_at DESC LIMIT 1`,
      patient.id,
    );
    if (recentSymptom && chance(0.4)) {
      await evaluateSymptomCheck(patient, recentSymptom, plan, {
        silent: true, createdAt: recentSymptom.reported_at,
      });
    }
    return;
  }

  // Urgent: a critical reading. The unconfirmed high-priority dose that turns
  // into a red medication alert is handled by settleTodayDoses.
  const reading = await insertOutOfRangeGlucose(patient, nurseId, chance(0.35) ? 'critical_low' : 'critical_high');
  await evaluateGlucose(patient, reading, plan, { silent: true, createdAt: reading.measured_at });
}

/**
 * Settles the doses that were already due today.
 *
 * A dose the patient did not confirm goes through the same escalation path the
 * running scheduler uses, so the resulting nurse alert is a genuine one rather
 * than a fabricated row.
 */
async function settleTodayDoses(patient, plan, adherence, profileKind) {
  const nowTime = new Date().toTimeString().slice(0, 5);
  const doses = await all(
    `SELECT d.*, m.name, m.dose AS med_dose, m.unit, m.priority
       FROM medication_doses d JOIN medications m ON m.id = d.medication_id
      WHERE d.patient_id = ? AND d.scheduled_at LIKE ? AND d.status = 'pending'
      ORDER BY d.scheduled_at`,
    patient.id, `${toDateKey()}%`,
  );

  const dueNow = doses.filter((d) => d.scheduled_at.slice(11) < nowTime);
  const missable = dueNow.filter(
    // Attention-level patients keep up with their critical medicines; skipping
    // one of those is what makes a patient urgent.
    (d) => (profileKind === 'urgent' ? true : d.priority !== 'critical'),
  );

  const takeDose = (dose) => run(
    `UPDATE medication_doses SET status = 'taken', taken_at = ?, reminder_count = 1 WHERE id = ?`,
    dose.scheduled_at, dose.id,
  );
  const missDose = async (dose) => {
    await run(
      `UPDATE medication_doses SET status = 'missed', reminder_count = 2, last_reminder_at = ?
        WHERE id = ?`,
      dose.scheduled_at, dose.id,
    );
    await escalateMissedDose(
      patient,
      { ...dose, status: 'missed', reminder_count: 2, last_reminder_at: dose.scheduled_at },
      { name: dose.name, dose: dose.med_dose, unit: dose.unit, priority: dose.priority },
      plan,
    );
  };

  let missedAny = false;
  for (const dose of dueNow) {
    const canMiss = profileKind !== 'stable' && missable.includes(dose);
    if (canMiss && !chance(adherence)) {
      await missDose(dose);
      missedAny = true;
    } else {
      await takeDose(dose);
    }
  }

  // An urgent patient must actually have an unconfirmed high-priority dose.
  if (profileKind === 'urgent' && !missedAny) {
    const candidate = [...dueNow].reverse().find((d) => d.priority !== 'normal');
    if (candidate) await missDose({ ...candidate, status: 'pending' });
  }
}

async function createPatient({ hospitalId, staff, index, profileKind, demo }) {
  const gender = demo?.gender ?? (chance(0.5) ? 'male' : 'female');
  const firstName = demo?.first_name ?? (gender === 'male' ? pick(MALE_NAMES) : pick(FEMALE_NAMES));
  const surnameRoot = demo?.surname_root ?? pick(SURNAMES);
  const lastName = demo?.last_name ?? (gender === 'female' ? `${surnameRoot}a` : surnameRoot);
  const age = demo?.age ?? between(34, 78);
  const birthDate = `${new Date().getFullYear() - age}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
  const phone = demo?.phone ?? `9${String(10000000 + index * 137 + 1000).slice(0, 8)}`;

  const diabetesType = demo?.diabetes_type ?? (chance(0.18) ? 'type1' : chance(0.94) ? 'type2' : 'other');
  const insulin = demo?.insulin ?? (diabetesType === 'type1' || profileKind === 'urgent' || chance(0.35));
  const withBp = demo?.with_bp ?? (age >= 50 || chance(0.3));

  let userId = null;
  if (demo?.account) {
    userId = await insert(
      `INSERT INTO users (hospital_id, role, full_name, phone, password_hash, created_by)
       VALUES (?, 'patient', ?, ?, ?, ?)`,
      hospitalId, `${firstName} ${lastName}`, phone,
      hashPassword(demo.account.password), staff.nurse,
    );
  }

  const patientId = await insert(
    `INSERT INTO patients
       (hospital_id, user_id, first_name, last_name, birth_date, gender, phone, address,
        emergency_contact_name, emergency_contact_phone, discharge_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    hospitalId, userId, firstName, lastName, birthDate, gender, phone,
    `Toshkent shahri, ${pick(DISTRICTS)}`,
    demo?.emergency_contact_name ?? `${pick(MALE_NAMES)} ${surnameRoot}`,
    demo?.emergency_contact_phone ?? `9${between(10000000, 99999999)}`,
    toDateKey(addDays(new Date(), -between(2, 20))),
    staff.nurse,
  );

  const priorHypo = chance(profileKind === 'stable' ? 0.1 : 0.4);
  await insert(
    `INSERT INTO diabetes_profiles
       (patient_id, diabetes_type, diagnosis_date, hba1c, recent_hospitalization,
        prior_hypoglycemia, clinical_notes, cgm_enabled, created_by)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    patientId, diabetesType,
    `${new Date().getFullYear() - between(1, 14)}-0${between(1, 9)}-1${between(0, 8)}`,
    Number((6.4 + rnd() * 3.4).toFixed(1)),
    priorHypo ? 1 : 0,
    demo?.clinical_notes ?? (chance(0.35) ? 'Ambulator kuzatuv tavsiya etilgan.' : null),
    demo?.cgm_enabled ? 1 : 0,
    staff.nurse,
  );

  const planId = await createDraftPlan(
    patientId,
    {
      source: 'ai_assisted',
      start_date: toDateKey(addDays(new Date(), -14)),
      notes: 'Shifoxonadan chiqishdan oldin tuzilgan kuzatuv rejasi.',
      medications: buildMedications(diabetesType, insulin),
      monitoring: buildMonitoring(diabetesType, insulin, withBp),
    },
    { id: staff.nurse },
  );
  await approvePlan(planId, { id: staff.nurse }, 'Dastlabki reja tasdiqlandi');

  const patient = await get('SELECT * FROM patients WHERE id = ?', patientId);
  const plan = await get('SELECT * FROM care_plans WHERE id = ?', planId);
  const adherence = profileKind === 'stable'
    ? 0.9 + rnd() * 0.09
    : profileKind === 'attention'
      ? 0.62 + rnd() * 0.2
      : 0.38 + rnd() * 0.24;

  await backfillDoses(patientId, planId, 14, adherence, staff.nurse);
  await backfillMeasurements(patient, planId, 14, profileKind, staff.nurse);
  await settleTodayDoses(patient, plan, adherence, profileKind);
  await raiseCurrentAlerts(patient, plan, profileKind, staff.nurse);
  await recomputePatientStatus(patientId);

  return { patientId, userId, planId };
}

async function createCaregiver({ hospitalId, patientId, staff, fullName, phone, password, relation, permissions }) {
  let user = await get('SELECT * FROM users WHERE phone = ?', phone);
  if (!user) {
    const id = await insert(
      `INSERT INTO users (hospital_id, role, full_name, phone, password_hash, created_by)
       VALUES (?, 'caregiver', ?, ?, ?, ?)`,
      hospitalId, fullName, phone, hashPassword(password), staff.nurse,
    );
    user = { id };
  }
  const caregiverId = await insert(
    `INSERT INTO caregivers (patient_id, user_id, relation, status, authorized_by, authorized_at, created_by)
     VALUES (?, ?, ?, 'active', ?, datetime('now'), ?)`,
    patientId, user.id, relation, staff.nurse, staff.nurse,
  );
  for (const [key, value] of Object.entries(permissions)) {
    await insert(
      `INSERT INTO caregiver_permissions (caregiver_id, permission_key, allowed, created_by)
       VALUES (?, ?, ?, ?)`,
      caregiverId, key, value ? 1 : 0, staff.nurse,
    );
  }
  return caregiverId;
}

async function seed() {
  console.log('Shifora: demo ma’lumotlari tayyorlanmoqda...');
  await clearDatabase();

  const hospitalId = await insert(
    `INSERT INTO hospitals (name, region, phone) VALUES (?, ?, ?)`,
    'Toshkent shahar 1-son ko‘p tarmoqli klinikasi', 'Toshkent shahri', '+998 71 200 30 40',
  );
  const staff = await createStaff(hospitalId);

  // 128 patients, split so the dashboard shows a plausible caseload.
  //
  // Seeding writes roughly 17k rows one statement at a time, which is a minute
  // locally but far longer against a managed database an ocean away — and it
  // all runs in one transaction. SHIFORA_SEED_PATIENTS scales the caseload down
  // for that case, keeping the same proportions so the dashboard still looks
  // like a real one.
  const requested = Number(process.env.SHIFORA_SEED_PATIENTS ?? 128);
  const total = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 128;
  const attention = Math.max(1, Math.round(total * (27 / 128)));
  const urgent = Math.max(1, Math.round(total * (7 / 128)));
  const stable = Math.max(1, total - attention - urgent);
  const cohort = [
    ...Array(stable).fill('stable'),
    ...Array(attention).fill('attention'),
    ...Array(urgent).fill('urgent'),
  ];
  console.log(`Bemorlar soni: ${cohort.length} (barqaror ${stable}, e'tibor ${attention}, shoshilinch ${urgent})`);

  // Two demo patients with real logins, at the front of the caseload.
  const demoPatient = await createPatient({
    hospitalId, staff, index: 1, profileKind: 'attention',
    demo: {
      first_name: 'Zilola', last_name: 'Karimova', surname_root: 'Karimov', gender: 'female',
      age: 61, phone: '901234567', diabetes_type: 'type2', insulin: true, with_bp: true,
      account: { password: 'bemor' },
      emergency_contact_name: 'Sardor Karimov', emergency_contact_phone: '901234568',
      clinical_notes: 'Uydagi kuzatuv o‘g‘li nazorati ostida olib boriladi.',
    },
  });
  await createCaregiver({
    hospitalId, staff, patientId: demoPatient.patientId,
    fullName: 'Sardor Karimov', phone: '901234568', password: 'yaqin', relation: 'O‘g‘li',
    permissions: {
      view_today_plan: 1, view_adherence: 1, view_alerts: 1,
      view_measurements: 1, view_care_plan: 0, view_clinical_notes: 0,
    },
  });

  const urgentDemo = await createPatient({
    hospitalId, staff, index: 2, profileKind: 'urgent',
    demo: {
      first_name: 'Bahodir', last_name: 'To‘xtayev', surname_root: 'To‘xtayev', gender: 'male',
      age: 68, phone: '901234570', diabetes_type: 'type1', insulin: true, with_bp: true,
      account: { password: 'bemor' }, cgm_enabled: true,
    },
  });
  await createCaregiver({
    hospitalId, staff, patientId: urgentDemo.patientId,
    fullName: 'Nilufar To‘xtayeva', phone: '901234571', password: 'yaqin', relation: 'Qizi',
    permissions: {
      view_today_plan: 1, view_adherence: 1, view_alerts: 1,
      view_measurements: 0, view_care_plan: 0, view_clinical_notes: 0,
    },
  });

  cohort.splice(cohort.indexOf('attention'), 1);
  cohort.splice(cohort.indexOf('urgent'), 1);

  let index = 3;
  for (const profileKind of cohort) {
    await createPatient({ hospitalId, staff, index, profileKind });
    index += 1;
    if (index % 25 === 0) console.log(`  ${index} ta bemor yaratildi...`);
  }

  // Alerts already worked through, so the alert centre has closed history too.
  // They belong to stable patients, whose live status is unaffected.
  const settled = await all(
    `SELECT id, hospital_id, first_name, last_name FROM patients
      WHERE status = 'stable' ORDER BY id LIMIT 5`,
  );
  for (const patient of settled) {
    const alertId = await insert(
      `INSERT INTO alerts
         (hospital_id, patient_id, rule_code, severity, title, detail, status,
          assigned_user_id, resolved_at, resolved_by, created_at)
       VALUES (?, ?, 'glucose_high', 'warning', ?, ?, 'closed', ?, datetime('now'), ?, ?)`,
      patient.hospital_id, patient.id,
      'Glyukoza chegaradan chiqdi',
      'Glyukoza belgilangan yuqori chegaradan yuqori edi. Bemor bilan bog‘lanildi.',
      staff.nurse, staff.nurse,
      `${toDateKey(addDays(new Date(), -between(2, 9)))} 09:20`,
    );
    await insert(
      `INSERT INTO alert_notes (alert_id, note, created_by) VALUES (?, ?, ?)`,
      alertId, 'Bemor bilan bog‘lanildi, holati barqaror. Kuzatuv davom etmoqda.', staff.nurse,
    );
  }

  const stats = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='stable' THEN 1 ELSE 0 END) AS stable,
            SUM(CASE WHEN status='attention' THEN 1 ELSE 0 END) AS attention,
            SUM(CASE WHEN status='urgent' THEN 1 ELSE 0 END) AS urgent
       FROM patients`,
  );

  console.log('\nTayyor.');
  console.log(`  Jami bemorlar: ${stats.total}`);
  console.log(`  Barqaror: ${stats.stable} | E'tibor kerak: ${stats.attention} | Shoshilinch: ${stats.urgent}`);
  const alertCount = await get('SELECT COUNT(*) AS c FROM alerts');
  console.log(`  Ogohlantirishlar: ${alertCount.c}`);
  console.log('\nDemo hisoblar (telefon / parol):');
  console.log('  Hamshira ............ 901112233 / hamshira');
  console.log('  Shifokor ............ 901112244 / shifokor');
  console.log('  Administrator ....... 901112255 / admin');
  console.log('  Bemor (Zilola) ...... 901234567 / bemor');
  console.log('  Bemor (Bahodir) ..... 901234570 / bemor');
  console.log('  Yaqin kishi (Sardor)  901234568 / yaqin');
  console.log('  Yaqin kishi (Nilufar) 901234571 / yaqin');
}

await await migrate();
await transaction(seed);
await closePool();
