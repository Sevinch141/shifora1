import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { api, ApiError } from '../../lib/api'
import { todayKey } from '../../lib/format'
import type { AiCarePlanSuggestion, DiabetesType, MeasurementContext } from '../../lib/types'
import { Button, Card, Checkbox, Field, Input, Notice, Select, Textarea } from '../../components/ui'
import {
  MedicationEditor, emptyMedication, type MedicationDraft,
} from './MedicationEditor'
import {
  MonitoringEditor, defaultMonitoring, type MonitoringDraft,
} from './MonitoringEditor'

const STEPS = [
  uz.register.steps.patient,
  uz.register.steps.diabetes,
  uz.register.steps.medications,
  uz.register.steps.monitoring,
  uz.register.steps.review,
]

const CAREGIVER_PERMISSION_KEYS = [
  'view_today_plan', 'view_adherence', 'view_alerts',
  'view_measurements', 'view_care_plan', 'view_clinical_notes',
] as const

interface FormState {
  first_name: string
  last_name: string
  birth_date: string
  gender: '' | 'male' | 'female'
  phone: string
  address: string
  emergency_contact_name: string
  emergency_contact_phone: string
  language: string
  create_account: boolean
  account_password: string
  add_caregiver: boolean
  caregiver_name: string
  caregiver_phone: string
  caregiver_relation: string
  caregiver_password: string
  caregiver_permissions: Record<string, boolean>
  diabetes_type: '' | DiabetesType
  diagnosis_date: string
  hba1c: string
  recent_hospitalization: boolean
  prior_hypoglycemia: boolean
  clinical_notes: string
  cgm_enabled: boolean
}

const INITIAL: FormState = {
  first_name: '', last_name: '', birth_date: '', gender: '', phone: '', address: '',
  emergency_contact_name: '', emergency_contact_phone: '', language: 'uz',
  create_account: true, account_password: '',
  add_caregiver: false, caregiver_name: '', caregiver_phone: '', caregiver_relation: '',
  caregiver_password: '',
  caregiver_permissions: {
    view_today_plan: true, view_adherence: true, view_alerts: true,
    view_measurements: false, view_care_plan: false, view_clinical_notes: false,
  },
  diabetes_type: '', diagnosis_date: '', hba1c: '',
  recent_hospitalization: true, prior_hypoglycemia: false, clinical_notes: '',
  cgm_enabled: false,
}

const DEFAULT_REMINDERS = {
  reminder_repeat_minutes: 30,
  reminder_max_count: 2,
  snooze_minutes: 15,
  escalate_normal_minutes: 240,
  escalate_important_minutes: 120,
  escalate_critical_minutes: 60,
}

const DEFAULT_THRESHOLDS = {
  glucose_critical_low: 54,
  glucose_low: 70,
  glucose_high: 180,
  glucose_critical_high: 300,
  bp_high_systolic: 140,
  bp_high_diastolic: 90,
}

export function RegisterPatientPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [medications, setMedications] = useState<MedicationDraft[]>([emptyMedication(todayKey())])
  const [monitoring, setMonitoring] = useState<MonitoringDraft>(defaultMonitoring())
  const [reminders, setReminders] = useState(DEFAULT_REMINDERS)
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [suggestion, setSuggestion] = useState<AiCarePlanSuggestion | null>(null)
  const [suggestionState, setSuggestionState] = useState<'none' | 'loading' | 'ready' | 'accepted'>('none')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<number | null>(null)

  const set = (changes: Partial<FormState>) => setForm((prev) => ({ ...prev, ...changes }))

  /* ------------------------------------------------------------ validation */

  function validateStep(index: number): boolean {
    const next: Record<string, string> = {}
    if (index === 0) {
      if (!form.first_name.trim()) next.first_name = uz.validation.required
      if (!form.last_name.trim()) next.last_name = uz.validation.required
      if (!form.birth_date) next.birth_date = uz.validation.required
      if (!form.gender) next.gender = uz.validation.required
      if (!form.phone.trim()) next.phone = uz.validation.required
      if (form.create_account && form.account_password.trim().length < 4) {
        next.account_password = 'Parol kamida 4 ta belgidan iborat bo‘lishi kerak.'
      }
      if (form.add_caregiver) {
        if (!form.caregiver_name.trim()) next.caregiver_name = uz.validation.required
        if (!form.caregiver_phone.trim()) next.caregiver_phone = uz.validation.required
        if (form.caregiver_password.trim().length < 4) {
          next.caregiver_password = 'Parol kamida 4 ta belgidan iborat bo‘lishi kerak.'
        }
        if (form.caregiver_phone.trim() && form.caregiver_phone.trim() === form.phone.trim()) {
          next.caregiver_phone = 'Yaqin kishining raqami bemor raqamidan farq qilishi kerak.'
        }
      }
    }
    if (index === 1 && !form.diabetes_type) next.diabetes_type = uz.validation.required
    if (index === 2) {
      if (medications.length === 0) next.medications = 'Kamida bitta dori qo‘shing.'
      medications.forEach((med, i) => {
        if (!med.name.trim()) next[`med_${i}_name`] = uz.validation.required
        if (!String(med.dose).trim()) next[`med_${i}_dose`] = uz.validation.required
        if (med.schedule_type !== 'as_needed' && med.times.filter(Boolean).length === 0) {
          next[`med_${i}_times`] = 'Kamida bitta eslatma vaqtini belgilang.'
        }
      })
    }
    if (index === 3) {
      const anyEnabled = monitoring.glucose.enabled || monitoring.blood_pressure.enabled || monitoring.symptom.enabled
      if (!anyEnabled) next.monitoring = 'Kamida bitta kuzatuv turini yoqing.'
      if (monitoring.glucose.enabled && monitoring.glucose.times.length === 0) {
        next.monitoring = 'Glyukoza uchun kamida bitta o‘lchov vaqtini belgilang.'
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function goNext() {
    if (!validateStep(step)) return
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1))
  }

  /* -------------------------------------------------------------- AI step */

  async function loadSuggestion() {
    setSuggestionState('loading')
    try {
      const result = await api.post<AiCarePlanSuggestion>('/ai/care-plan-suggestion', {
        patient: { birth_date: form.birth_date, gender: form.gender },
        profile: {
          diabetes_type: form.diabetes_type,
          prior_hypoglycemia: form.prior_hypoglycemia,
          recent_hospitalization: form.recent_hospitalization,
          hba1c: form.hba1c ? Number(form.hba1c) : null,
        },
        medications: medications.map((m) => ({
          name: m.name, schedule_type: m.schedule_type, times: m.times, priority: m.priority,
        })),
      })
      setSuggestion(result)
      setSuggestionState('ready')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
      setSuggestionState('none')
    }
  }

  /** Applying a suggestion is an explicit act by the nurse, never automatic. */
  function acceptSuggestion() {
    if (!suggestion) return
    const find = (type: string) => suggestion.monitoring.find((m) => m.type === type)
    const glucose = find('glucose')
    const bp = find('blood_pressure')
    const symptom = find('symptom')
    setMonitoring({
      glucose: {
        enabled: Boolean(glucose?.enabled),
        times: (glucose?.times ?? []).map((t) => ({ ...t })),
      },
      blood_pressure: {
        enabled: Boolean(bp?.enabled),
        times: (bp?.times ?? []).map((t) => ({ ...t })),
      },
      symptom: {
        enabled: Boolean(symptom?.enabled),
        times: (symptom?.times ?? []).map((t) => ({
          time_of_day: t.time_of_day,
          context: t.context as MeasurementContext,
        })),
      },
    })
    setReminders({ ...DEFAULT_REMINDERS, ...suggestion.reminders })
    setSuggestionState('accepted')
  }

  /* -------------------------------------------------------------- submit */

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = {
        patient: {
          first_name: form.first_name, last_name: form.last_name, birth_date: form.birth_date,
          gender: form.gender, phone: form.phone, address: form.address,
          emergency_contact_name: form.emergency_contact_name,
          emergency_contact_phone: form.emergency_contact_phone,
          language: form.language,
        },
        account: form.create_account
          ? { create: true, password: form.account_password }
          : { create: false },
        caregiver: form.add_caregiver
          ? {
              create: true,
              full_name: form.caregiver_name,
              phone: form.caregiver_phone,
              relation: form.caregiver_relation,
              password: form.caregiver_password,
              permissions: form.caregiver_permissions,
            }
          : undefined,
        profile: {
          diabetes_type: form.diabetes_type,
          diagnosis_date: form.diagnosis_date || null,
          hba1c: form.hba1c ? Number(form.hba1c) : null,
          recent_hospitalization: form.recent_hospitalization,
          prior_hypoglycemia: form.prior_hypoglycemia,
          clinical_notes: form.clinical_notes,
          cgm_enabled: form.cgm_enabled,
        },
        care_plan: {
          source: suggestionState === 'accepted' ? 'ai_assisted' : 'manual',
          start_date: todayKey(),
          notes: 'Shifoxonadan chiqishdan oldin tuzilgan kuzatuv rejasi.',
          ...reminders,
          medications: medications.map((med) => ({
            name: med.name,
            dose: med.dose,
            unit: med.unit,
            schedule_type: med.schedule_type,
            times: med.times.filter(Boolean),
            priority: med.priority,
            start_date: med.start_date || todayKey(),
            end_date: med.end_date || null,
            notes: med.notes || null,
          })),
          monitoring: [
            { type: 'glucose', enabled: monitoring.glucose.enabled, times: monitoring.glucose.times },
            { type: 'blood_pressure', enabled: monitoring.blood_pressure.enabled, times: monitoring.blood_pressure.times },
            { type: 'symptom', enabled: monitoring.symptom.enabled, times: monitoring.symptom.times },
          ],
          rules: [
            { code: 'glucose_critical_low', value_1: thresholds.glucose_critical_low },
            { code: 'glucose_low', value_1: thresholds.glucose_low },
            { code: 'glucose_high', value_1: thresholds.glucose_high },
            { code: 'glucose_critical_high', value_1: thresholds.glucose_critical_high },
            { code: 'bp_high', value_1: thresholds.bp_high_systolic, value_2: thresholds.bp_high_diastolic },
          ],
        },
        approve: true,
      }
      const result = await api.post<{ patient_id: number }>('/patients', payload)
      setCreatedId(result.patient_id)
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message)
        if (err.details) setErrors(err.details)
      } else {
        setSubmitError(uz.app.errorGeneric)
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------------------------------------------------------------- done */

  if (createdId) {
    return (
      <div className="stack">
        <Card>
          <div className="center stack">
            <div style={{ fontSize: '3rem' }} aria-hidden>✅</div>
            <h1>{uz.register.successTitle}</h1>
            <p className="muted">{uz.register.successBody}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => navigate(`/shifoxona/bemorlar/${createdId}`)}>
                {uz.register.goToPatient}
              </Button>
              <Button
                onClick={() => {
                  setCreatedId(null)
                  setForm(INITIAL)
                  setMedications([emptyMedication(todayKey())])
                  setMonitoring(defaultMonitoring())
                  setSuggestion(null)
                  setSuggestionState('none')
                  setStep(0)
                }}
              >
                {uz.register.registerAnother}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="steps">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={`step ${index === step ? 'step--on' : ''} ${index < step ? 'step--done' : ''}`}
          >
            <span className="step__num">{index < step ? '✓' : index + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {submitError ? <Notice tone="danger">{submitError}</Notice> : null}

      {/* ------------------------------------------------ 1. patient data */}
      {step === 0 ? (
        <Card title={uz.register.steps.patient} subtitle={uz.register.requiredHint}>
          <div className="stack">
            <div className="grid2">
              <Field label={uz.register.firstName} required error={errors.first_name}>
                <Input value={form.first_name} error={Boolean(errors.first_name)}
                  onChange={(e) => set({ first_name: e.target.value })} />
              </Field>
              <Field label={uz.register.lastName} required error={errors.last_name}>
                <Input value={form.last_name} error={Boolean(errors.last_name)}
                  onChange={(e) => set({ last_name: e.target.value })} />
              </Field>
              <Field label={uz.register.birthDate} required error={errors.birth_date}>
                <Input type="date" value={form.birth_date} error={Boolean(errors.birth_date)}
                  onChange={(e) => set({ birth_date: e.target.value })} />
              </Field>
              <Field label={uz.register.genderLabel} required error={errors.gender}>
                <Select value={form.gender} error={Boolean(errors.gender)}
                  onChange={(e) => set({ gender: e.target.value as FormState['gender'] })}>
                  <option value="">{uz.app.notSpecified}</option>
                  <option value="male">{uz.gender.male}</option>
                  <option value="female">{uz.gender.female}</option>
                </Select>
              </Field>
              <Field label={uz.register.phone} required error={errors.phone}>
                <Input type="tel" placeholder="901234567" value={form.phone}
                  error={Boolean(errors.phone)}
                  onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              <Field label={`${uz.register.address} (${uz.app.optional})`}>
                <Input value={form.address} onChange={(e) => set({ address: e.target.value })} />
              </Field>
              <Field label={uz.register.emergencyName}>
                <Input value={form.emergency_contact_name}
                  onChange={(e) => set({ emergency_contact_name: e.target.value })} />
              </Field>
              <Field label={uz.register.emergencyPhone}>
                <Input type="tel" value={form.emergency_contact_phone}
                  onChange={(e) => set({ emergency_contact_phone: e.target.value })} />
              </Field>
              <Field label={uz.register.language}>
                <Select value={form.language} onChange={(e) => set({ language: e.target.value })}>
                  <option value="uz">O‘zbek tili</option>
                </Select>
              </Field>
            </div>

            <div className="divider" />

            <Checkbox
              checked={form.create_account}
              onChange={(create_account) => set({ create_account })}
              label={uz.register.createAccount}
              hint={uz.register.accountHint}
            />
            {form.create_account ? (
              <Field label={uz.register.accountPassword} required error={errors.account_password}>
                <Input
                  value={form.account_password}
                  error={Boolean(errors.account_password)}
                  placeholder="Kamida 4 ta belgi"
                  onChange={(e) => set({ account_password: e.target.value })}
                  style={{ maxWidth: 320 }}
                />
              </Field>
            ) : null}

            <div className="divider" />

            <Checkbox
              checked={form.add_caregiver}
              onChange={(add_caregiver) => set({ add_caregiver })}
              label={uz.register.addCaregiver}
              hint={uz.register.caregiverPermissionsHint}
            />
            {form.add_caregiver ? (
              <div className="stack">
                <div className="grid2">
                  <Field label={uz.register.caregiverName} required error={errors.caregiver_name}>
                    <Input value={form.caregiver_name} error={Boolean(errors.caregiver_name)}
                      onChange={(e) => set({ caregiver_name: e.target.value })} />
                  </Field>
                  <Field label={uz.register.caregiverPhone} required error={errors.caregiver_phone}>
                    <Input type="tel" value={form.caregiver_phone} error={Boolean(errors.caregiver_phone)}
                      onChange={(e) => set({ caregiver_phone: e.target.value })} />
                  </Field>
                  <Field label={uz.register.caregiverRelation}>
                    <Input placeholder="O‘g‘li, qizi, turmush o‘rtog‘i..."
                      value={form.caregiver_relation}
                      onChange={(e) => set({ caregiver_relation: e.target.value })} />
                  </Field>
                  <Field label={uz.register.caregiverPassword} required error={errors.caregiver_password}>
                    <Input value={form.caregiver_password} error={Boolean(errors.caregiver_password)}
                      onChange={(e) => set({ caregiver_password: e.target.value })} />
                  </Field>
                </div>
                <Field label={uz.register.caregiverPermissions} hint={uz.register.caregiverPermissionsHint}>
                  <div className="grid2">
                    {CAREGIVER_PERMISSION_KEYS.map((key) => (
                      <Checkbox
                        key={key}
                        checked={form.caregiver_permissions[key]}
                        onChange={(value) =>
                          set({ caregiver_permissions: { ...form.caregiver_permissions, [key]: value } })
                        }
                        label={uz.permissions[key]}
                      />
                    ))}
                  </div>
                </Field>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ---------------------------------------------------- 2. diabetes */}
      {step === 1 ? (
        <Card title={uz.register.steps.diabetes}>
          <div className="stack">
            <Notice tone="info">{uz.register.diagnosisNote}</Notice>
            <div className="grid2">
              <Field label={uz.register.diabetesTypeLabel} required error={errors.diabetes_type}>
                <Select
                  value={form.diabetes_type}
                  error={Boolean(errors.diabetes_type)}
                  onChange={(e) => set({ diabetes_type: e.target.value as DiabetesType })}
                >
                  <option value="">{uz.app.notSpecified}</option>
                  <option value="type1">{uz.diabetesType.type1}</option>
                  <option value="type2">{uz.diabetesType.type2}</option>
                  <option value="other">{uz.diabetesType.other}</option>
                </Select>
              </Field>
              <Field label={`${uz.register.diagnosisDate} (${uz.app.optional})`}>
                <Input type="date" value={form.diagnosis_date}
                  onChange={(e) => set({ diagnosis_date: e.target.value })} />
              </Field>
              <Field label={`${uz.register.hba1c} (${uz.app.optional})`} error={errors.hba1c}>
                <Input type="number" step="0.1" min="2" max="20" placeholder="7.4"
                  value={form.hba1c} onChange={(e) => set({ hba1c: e.target.value })} />
              </Field>
            </div>
            <Checkbox
              checked={form.recent_hospitalization}
              onChange={(recent_hospitalization) => set({ recent_hospitalization })}
              label={uz.register.recentHospitalization}
            />
            <Checkbox
              checked={form.prior_hypoglycemia}
              onChange={(prior_hypoglycemia) => set({ prior_hypoglycemia })}
              label={uz.register.priorHypoglycemia}
            />
            <Field label={`${uz.register.clinicalNotes} (${uz.app.optional})`}>
              <Textarea value={form.clinical_notes}
                onChange={(e) => set({ clinical_notes: e.target.value })} />
            </Field>
          </div>
        </Card>
      ) : null}

      {/* ------------------------------------------------- 3. medications */}
      {step === 2 ? (
        <div className="stack">
          <Notice tone="info">{uz.register.medicationsHint}</Notice>
          {errors.medications ? <Notice tone="danger">{errors.medications}</Notice> : null}
          {medications.map((med, index) => (
            <MedicationEditor
              key={index}
              index={index}
              value={med}
              errors={errors}
              onChange={(next) =>
                setMedications((prev) => prev.map((item, i) => (i === index ? next : item)))
              }
              onRemove={() => setMedications((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          <div>
            <Button onClick={() => setMedications((prev) => [...prev, emptyMedication(todayKey())])}>
              ➕ {uz.register.addMedication}
            </Button>
          </div>
        </div>
      ) : null}

      {/* -------------------------------------------------- 4. monitoring */}
      {step === 3 ? (
        <div className="stack">
          {errors.monitoring ? <Notice tone="danger">{errors.monitoring}</Notice> : null}
          <MonitoringEditor
            value={monitoring}
            onChange={setMonitoring}
            cgmEnabled={form.cgm_enabled}
            onCgmChange={(cgm_enabled) => set({ cgm_enabled })}
          />

          <Card title={uz.register.remindersTitle} subtitle={uz.register.remindersHint}>
            <div className="grid3">
              <Field label={uz.register.repeatMinutes}>
                <Input type="number" min={5} value={reminders.reminder_repeat_minutes}
                  onChange={(e) => setReminders({ ...reminders, reminder_repeat_minutes: Number(e.target.value) })} />
              </Field>
              <Field label={uz.register.maxReminders}>
                <Input type="number" min={1} max={5} value={reminders.reminder_max_count}
                  onChange={(e) => setReminders({ ...reminders, reminder_max_count: Number(e.target.value) })} />
              </Field>
              <Field label={uz.register.snoozeMinutes}>
                <Input type="number" min={5} value={reminders.snooze_minutes}
                  onChange={(e) => setReminders({ ...reminders, snooze_minutes: Number(e.target.value) })} />
              </Field>
              <Field label={uz.register.escalateNormal}>
                <Input type="number" min={15} value={reminders.escalate_normal_minutes}
                  onChange={(e) => setReminders({ ...reminders, escalate_normal_minutes: Number(e.target.value) })} />
              </Field>
              <Field label={uz.register.escalateImportant}>
                <Input type="number" min={15} value={reminders.escalate_important_minutes}
                  onChange={(e) => setReminders({ ...reminders, escalate_important_minutes: Number(e.target.value) })} />
              </Field>
              <Field label={uz.register.escalateCritical}>
                <Input type="number" min={15} value={reminders.escalate_critical_minutes}
                  onChange={(e) => setReminders({ ...reminders, escalate_critical_minutes: Number(e.target.value) })} />
              </Field>
            </div>
          </Card>

          <Card title={uz.register.thresholdsTitle} subtitle={uz.register.thresholdsHint}>
            <div className="grid3">
              <Field label="Gipoglikemiya — shoshilinch (mg/dL)">
                <Input type="number" value={thresholds.glucose_critical_low}
                  onChange={(e) => setThresholds({ ...thresholds, glucose_critical_low: Number(e.target.value) })} />
              </Field>
              <Field label="Past glyukoza (mg/dL)">
                <Input type="number" value={thresholds.glucose_low}
                  onChange={(e) => setThresholds({ ...thresholds, glucose_low: Number(e.target.value) })} />
              </Field>
              <Field label="Yuqori glyukoza (mg/dL)">
                <Input type="number" value={thresholds.glucose_high}
                  onChange={(e) => setThresholds({ ...thresholds, glucose_high: Number(e.target.value) })} />
              </Field>
              <Field label="Giperglikemiya — shoshilinch (mg/dL)">
                <Input type="number" value={thresholds.glucose_critical_high}
                  onChange={(e) => setThresholds({ ...thresholds, glucose_critical_high: Number(e.target.value) })} />
              </Field>
              <Field label="Sistolik chegara (mmHg)">
                <Input type="number" value={thresholds.bp_high_systolic}
                  onChange={(e) => setThresholds({ ...thresholds, bp_high_systolic: Number(e.target.value) })} />
              </Field>
              <Field label="Diastolik chegara (mmHg)">
                <Input type="number" value={thresholds.bp_high_diastolic}
                  onChange={(e) => setThresholds({ ...thresholds, bp_high_diastolic: Number(e.target.value) })} />
              </Field>
            </div>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------- 5. AI review + approve */}
      {step === 4 ? (
        <div className="stack">
          <Card
            title={<span>🤖 {uz.ai.title}</span>}
            subtitle={uz.ai.subtitle}
            action={
              suggestionState === 'none' ? (
                <Button variant="primary" size="sm" onClick={() => void loadSuggestion()}>
                  {uz.ai.generate}
                </Button>
              ) : null
            }
          >
            {suggestionState === 'none' ? (
              <p className="muted">
                AI kuzatuv chastotasi bo‘yicha taklif tayyorlaydi. Taklif o‘zi faollashmaydi —
                uni tibbiyot xodimi tasdiqlashi kerak.
              </p>
            ) : suggestionState === 'loading' ? (
              <p className="muted">{uz.ai.generating}</p>
            ) : suggestion ? (
              <div className="stack">
                <Notice tone="ai">
                  <div className="strong">{uz.ai.label}</div>
                  <div>{suggestion.summary}</div>
                </Notice>

                <div>
                  <div className="strong small" style={{ marginBottom: 6 }}>{uz.ai.reasons}</div>
                  <ul className="small muted" style={{ margin: 0, paddingInlineStart: 20 }}>
                    {suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>

                <Notice tone="warning">{suggestion.disclaimer}</Notice>

                {suggestionState === 'accepted' ? (
                  <Notice tone="success">
                    {uz.ai.accepted} — {uz.ai.approvedPlanHint}
                  </Notice>
                ) : (
                  <div className="row">
                    <Button variant="primary" onClick={acceptSuggestion}>✓ {uz.ai.accept}</Button>
                    <Button onClick={() => setStep(3)}>✎ {uz.ai.modify}</Button>
                  </div>
                )}
              </div>
            ) : null}
          </Card>

          <Card title={uz.ai.approvedPlan} subtitle={uz.ai.approvedPlanHint}>
            <div className="stack">
              <div>
                <div className="strong small">{uz.carePlan.medications}</div>
                <ul className="small" style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                  {medications.map((med, i) => (
                    <li key={i}>
                      {med.name} {med.dose} {med.unit} — {uz.schedule[med.schedule_type as keyof typeof uz.schedule]}
                      {med.times.length ? ` (${med.times.join(', ')})` : ''} · {uz.priority[med.priority]}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="strong small">{uz.carePlan.monitoring}</div>
                <ul className="small" style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                  <li>
                    {uz.register.monitoringGlucose}:{' '}
                    {monitoring.glucose.enabled
                      ? monitoring.glucose.times
                          .map((t) => `${t.time_of_day} — ${uz.measurements.context[t.context]}`)
                          .join(', ')
                      : 'kuzatilmaydi'}
                  </li>
                  <li>
                    {uz.register.monitoringBp}:{' '}
                    {monitoring.blood_pressure.enabled
                      ? monitoring.blood_pressure.times.map((t) => t.time_of_day).join(', ')
                      : 'kuzatilmaydi'}
                  </li>
                  <li>
                    {uz.register.monitoringSymptom}:{' '}
                    {monitoring.symptom.enabled
                      ? monitoring.symptom.times.map((t) => t.time_of_day).join(', ')
                      : 'kuzatilmaydi'}
                  </li>
                  <li>{uz.register.cgm}: {form.cgm_enabled ? uz.register.cgmOn : uz.register.cgmOff}</li>
                </ul>
              </div>
              <Notice tone="info">{uz.carePlan.versionNote}</Notice>
              <Button variant="primary" size="lg" onClick={() => void submit()} disabled={submitting}>
                {submitting ? uz.register.submitting : `✓ ${uz.register.submit}`}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="row--between">
        <Button onClick={() => setStep((prev) => Math.max(prev - 1, 0))} disabled={step === 0}>
          ← {uz.app.back}
        </Button>
        <span className="small muted">{uz.register.stepOf(step + 1, STEPS.length)}</span>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={goNext}>{uz.app.next} →</Button>
        ) : <span />}
      </div>
    </div>
  )
}
