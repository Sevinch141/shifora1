import { useState } from 'react'
import { uz } from '../lib/uz'
import { api, ApiError } from '../lib/api'
import { nowInputValue } from '../lib/format'
import type { MeasurementContext } from '../lib/types'
import { Button, Field, Input, Modal, Notice, Select, Textarea } from './ui'

interface FormProps {
  onClose: () => void
  onSaved: (raisedAlert: boolean) => void
  /** Set when hospital staff records a measurement on the patient's behalf. */
  patientId?: number
  defaultContext?: MeasurementContext
}

const CONTEXTS: MeasurementContext[] = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'any']

function toApiTime(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}

export function GlucoseForm({ onClose, onSaved, patientId, defaultContext = 'fasting' }: FormProps) {
  const [value, setValue] = useState('')
  const [context, setContext] = useState<MeasurementContext>(defaultContext)
  const [measuredAt, setMeasuredAt] = useState(nowInputValue())
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!value.trim()) {
      setErrors({ value: uz.validation.required })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ alert_id: number | null }>('/measurements/glucose', {
        value: Number(value),
        context,
        measured_at: toApiTime(measuredAt),
        note,
        patient_id: patientId,
      })
      onSaved(Boolean(result.alert_id))
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setErrors(err.details ?? {})
      } else setError(uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={uz.measurements.addGlucose}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{uz.app.cancel}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {uz.app.save}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label={uz.measurements.glucoseValue} required error={errors.value}>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="128"
            value={value}
            error={Boolean(errors.value)}
            onChange={(e) => setValue(e.target.value)}
            style={{ fontSize: '1.4rem', fontWeight: 600 }}
          />
        </Field>
        <Field label={uz.measurements.contextLabel} required>
          <Select value={context} onChange={(e) => setContext(e.target.value as MeasurementContext)}>
            {CONTEXTS.map((key) => (
              <option key={key} value={key}>{uz.measurements.context[key]}</option>
            ))}
          </Select>
        </Field>
        <Field label={uz.measurements.measuredAt}>
          <Input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </Field>
        <Field label={`${uz.app.note} (${uz.app.optional})`}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Notice tone="info">{uz.measurements.manualNote}</Notice>
      </div>
    </Modal>
  )
}

export function BloodPressureForm({ onClose, onSaved, patientId }: FormProps) {
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [pulse, setPulse] = useState('')
  const [measuredAt, setMeasuredAt] = useState(nowInputValue())
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const next: Record<string, string> = {}
    if (!systolic.trim()) next.systolic = uz.validation.required
    if (!diastolic.trim()) next.diastolic = uz.validation.required
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ alert_id: number | null }>('/measurements/blood-pressure', {
        systolic: Number(systolic),
        diastolic: Number(diastolic),
        pulse: pulse ? Number(pulse) : null,
        measured_at: toApiTime(measuredAt),
        note,
        patient_id: patientId,
      })
      onSaved(Boolean(result.alert_id))
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setErrors(err.details ?? {})
      } else setError(uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={uz.measurements.addBp}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{uz.app.cancel}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {uz.app.save}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid2">
          <Field label={uz.measurements.systolic} required error={errors.systolic}>
            <Input
              type="number" inputMode="numeric" placeholder="120"
              value={systolic} error={Boolean(errors.systolic)}
              onChange={(e) => setSystolic(e.target.value)}
              style={{ fontSize: '1.3rem', fontWeight: 600 }}
            />
          </Field>
          <Field label={uz.measurements.diastolic} required error={errors.diastolic}>
            <Input
              type="number" inputMode="numeric" placeholder="80"
              value={diastolic} error={Boolean(errors.diastolic)}
              onChange={(e) => setDiastolic(e.target.value)}
              style={{ fontSize: '1.3rem', fontWeight: 600 }}
            />
          </Field>
        </div>
        <Field label={`${uz.measurements.pulse} (${uz.app.optional})`}>
          <Input type="number" inputMode="numeric" placeholder="72"
            value={pulse} onChange={(e) => setPulse(e.target.value)} />
        </Field>
        <Field label={uz.measurements.measuredAt}>
          <Input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </Field>
        <Field label={`${uz.app.note} (${uz.app.optional})`}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Notice tone="info">{uz.measurements.manualNote}</Notice>
      </div>
    </Modal>
  )
}

const SYMPTOM_KEYS = [
  'thirst', 'urination', 'dizziness', 'weakness', 'nausea', 'tremor', 'sweating', 'confusion', 'other',
] as const

export function SymptomForm({ onClose, onSaved, patientId }: FormProps) {
  const [feeling, setFeeling] = useState<'good' | 'not_good' | 'bad' | ''>('')
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function toggle(key: string) {
    setSymptoms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  async function submit() {
    if (!feeling) {
      setError(uz.validation.required)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ alert_id: number | null }>('/measurements/symptom-check', {
        feeling,
        symptoms: feeling === 'good' ? [] : symptoms,
        note,
        patient_id: patientId,
      })
      onSaved(Boolean(result.alert_id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  const FEELINGS = [
    { key: 'good', icon: '🙂', label: uz.symptoms.good },
    { key: 'not_good', icon: '😐', label: uz.symptoms.not_good },
    { key: 'bad', icon: '🙁', label: uz.symptoms.bad },
  ] as const

  return (
    <Modal
      title={uz.measurements.addSymptom}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{uz.app.cancel}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !feeling}>
            {uz.symptoms.submit}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div>
          <div className="strong" style={{ marginBottom: 10, fontSize: '1.05rem' }}>
            {uz.symptoms.question}
          </div>
          <div className="stack--sm">
            {FEELINGS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`radio ${feeling === option.key ? 'radio--on' : ''}`}
                onClick={() => setFeeling(option.key)}
                style={{ fontSize: '1.05rem', minHeight: 56 }}
              >
                <span aria-hidden style={{ fontSize: '1.5rem' }}>{option.icon}</span>
                <span className="strong">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {feeling === 'not_good' || feeling === 'bad' ? (
          <Field label={uz.symptoms.chooseSymptoms}>
            <div className="chip-group">
              {SYMPTOM_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`chip ${symptoms.includes(key) ? 'chip--on' : ''}`}
                  onClick={() => toggle(key)}
                >
                  {uz.symptoms.list[key]}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <Field label={`${uz.symptoms.noteLabel} (${uz.app.optional})`}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Notice tone="info">{uz.symptoms.safetyNote}</Notice>
      </div>
    </Modal>
  )
}
