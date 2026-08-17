import { uz } from '../../lib/uz'
import type { MeasurementContext } from '../../lib/types'
import { Button, Card, Checkbox, Field, Input, Notice, Select } from '../../components/ui'

export interface MonitoringSlot {
  time_of_day: string
  context: MeasurementContext
}

export interface MonitoringDraft {
  glucose: { enabled: boolean; times: MonitoringSlot[] }
  blood_pressure: { enabled: boolean; times: MonitoringSlot[] }
  symptom: { enabled: boolean; times: MonitoringSlot[] }
}

export const CONTEXT_OPTIONS: MeasurementContext[] = [
  'fasting', 'before_meal', 'after_meal', 'bedtime', 'any',
]

export function defaultMonitoring(): MonitoringDraft {
  return {
    glucose: { enabled: true, times: [{ time_of_day: '08:00', context: 'fasting' }] },
    blood_pressure: { enabled: false, times: [] },
    symptom: { enabled: true, times: [{ time_of_day: '19:00', context: 'any' }] },
  }
}

function SlotEditor({ times, withContext, onChange }: {
  times: MonitoringSlot[]
  withContext: boolean
  onChange: (next: MonitoringSlot[]) => void
}) {
  return (
    <div className="stack--sm">
      {times.map((slot, index) => (
        <div className="row" key={index} style={{ flexWrap: 'nowrap' }}>
          <Input
            type="time"
            value={slot.time_of_day}
            style={{ width: 130 }}
            onChange={(e) => {
              const next = [...times]
              next[index] = { ...slot, time_of_day: e.target.value }
              onChange(next)
            }}
          />
          {withContext ? (
            <Select
              value={slot.context}
              style={{ maxWidth: 200 }}
              onChange={(e) => {
                const next = [...times]
                next[index] = { ...slot, context: e.target.value as MeasurementContext }
                onChange(next)
              }}
            >
              {CONTEXT_OPTIONS.map((key) => (
                <option key={key} value={key}>{uz.measurements.context[key]}</option>
              ))}
            </Select>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={uz.app.remove}
            onClick={() => onChange(times.filter((_, i) => i !== index))}
          >
            ✕
          </Button>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          onClick={() => onChange([...times, { time_of_day: '12:00', context: 'any' }])}
        >
          ➕ {uz.register.addTime}
        </Button>
      </div>
    </div>
  )
}

export function MonitoringEditor({ value, onChange, cgmEnabled, onCgmChange }: {
  value: MonitoringDraft
  onChange: (next: MonitoringDraft) => void
  cgmEnabled: boolean
  onCgmChange: (next: boolean) => void
}) {
  const patch = (changes: Partial<MonitoringDraft>) => onChange({ ...value, ...changes })

  return (
    <div className="stack">
      <Notice tone="info">{uz.register.monitoringHint}</Notice>

      <Card title={`🩸 ${uz.register.monitoringGlucose}`}>
        <div className="stack">
          <Checkbox
            checked={value.glucose.enabled}
            onChange={(enabled) =>
              patch({
                glucose: {
                  enabled,
                  times: enabled && value.glucose.times.length === 0
                    ? [{ time_of_day: '08:00', context: 'fasting' }]
                    : value.glucose.times,
                },
              })
            }
            label="Glyukoza o‘lchovi kuzatilsin"
          />
          {value.glucose.enabled ? (
            <Field
              label={uz.register.measurementTimes}
              hint={`${uz.register.frequency}: ${value.glucose.times.length}`}
            >
              <SlotEditor
                times={value.glucose.times}
                withContext
                onChange={(times) => patch({ glucose: { ...value.glucose, times } })}
              />
            </Field>
          ) : null}

          <div className="divider" />
          <Field label={uz.register.cgm} hint={uz.register.cgmPlanned}>
            <Select
              value={cgmEnabled ? 'on' : 'off'}
              onChange={(e) => onCgmChange(e.target.value === 'on')}
              style={{ maxWidth: 260 }}
            >
              <option value="off">{uz.register.cgmOff}</option>
              <option value="on">{uz.register.cgmOn}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={`🫀 ${uz.register.monitoringBp}`}>
        <div className="stack">
          <Checkbox
            checked={value.blood_pressure.enabled}
            onChange={(enabled) =>
              patch({
                blood_pressure: {
                  enabled,
                  times: enabled && value.blood_pressure.times.length === 0
                    ? [{ time_of_day: '09:00', context: 'any' }]
                    : value.blood_pressure.times,
                },
              })
            }
            label="Qon bosimi kuzatilsin"
          />
          {value.blood_pressure.enabled ? (
            <Field label={uz.register.measurementTimes}>
              <SlotEditor
                times={value.blood_pressure.times}
                withContext={false}
                onChange={(times) => patch({ blood_pressure: { ...value.blood_pressure, times } })}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title={`💬 ${uz.register.monitoringSymptom}`}>
        <div className="stack">
          <Checkbox
            checked={value.symptom.enabled}
            onChange={(enabled) =>
              patch({
                symptom: {
                  enabled,
                  times: enabled && value.symptom.times.length === 0
                    ? [{ time_of_day: '19:00', context: 'any' }]
                    : value.symptom.times,
                },
              })
            }
            label="Kunlik holat so‘rovi yuborilsin"
          />
          {value.symptom.enabled ? (
            <Field label={uz.register.measurementTimes}>
              <SlotEditor
                times={value.symptom.times}
                withContext={false}
                onChange={(times) => patch({ symptom: { ...value.symptom, times } })}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title={`💊 ${uz.register.monitoringMedication}`}>
        <p className="muted small">{uz.register.monitoringMedicationNote}</p>
      </Card>
    </div>
  )
}
