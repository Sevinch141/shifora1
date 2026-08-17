import { uz } from '../../lib/uz'
import type { Priority } from '../../lib/types'
import { Button, Field, Input, Select } from '../../components/ui'

export interface MedicationDraft {
  name: string
  dose: string
  unit: string
  schedule_type: string
  times: string[]
  priority: Priority
  start_date: string
  end_date: string
  notes: string
}

/** Preset defaults mirror the server's SCHEDULE_PRESETS; both are editable. */
export const SCHEDULE_DEFAULTS: Record<string, string[]> = {
  morning: ['08:00'],
  morning_noon: ['08:00', '13:00'],
  morning_evening: ['08:00', '20:00'],
  noon: ['13:00'],
  noon_evening: ['13:00', '20:00'],
  evening: ['20:00'],
  bedtime: ['22:00'],
  every_8h: ['06:00', '14:00', '22:00'],
  every_12h: ['08:00', '20:00'],
  as_needed: [],
  custom: [],
}

const PRESET_ORDER = [
  'morning', 'morning_noon', 'morning_evening', 'noon', 'noon_evening',
  'evening', 'bedtime', 'every_8h', 'every_12h', 'as_needed',
]

export const UNITS = ['mg', 'ml', 'birlik', 'tabletka', 'tomchi']

export function emptyMedication(startDate: string): MedicationDraft {
  return {
    name: '', dose: '', unit: 'mg', schedule_type: 'morning',
    times: [...SCHEDULE_DEFAULTS.morning], priority: 'normal',
    start_date: startDate, end_date: '', notes: '',
  }
}

interface Props {
  value: MedicationDraft
  index: number
  errors: Record<string, string>
  onChange: (next: MedicationDraft) => void
  onRemove: () => void
}

export function MedicationEditor({ value, index, errors, onChange, onRemove }: Props) {
  const patch = (changes: Partial<MedicationDraft>) => onChange({ ...value, ...changes })

  const choosePreset = (key: string) =>
    patch({ schedule_type: key, times: [...(SCHEDULE_DEFAULTS[key] ?? [])] })

  const setTime = (position: number, time: string) => {
    const times = [...value.times]
    times[position] = time
    patch({ times })
  }

  return (
    <div className="card" style={{ boxShadow: 'none' }}>
      <div className="card__head">
        <h3>{index + 1}-dori</h3>
        <Button size="sm" variant="ghost" onClick={onRemove}>🗑 {uz.app.remove}</Button>
      </div>
      <div className="card__body stack">
        <div className="grid2">
          <Field label={uz.register.medicationName} required error={errors[`med_${index}_name`]}>
            <Input
              value={value.name}
              error={Boolean(errors[`med_${index}_name`])}
              placeholder="Masalan: Metformin"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label={uz.register.dose} required error={errors[`med_${index}_dose`]}>
                <Input
                  value={value.dose}
                  error={Boolean(errors[`med_${index}_dose`])}
                  placeholder="500"
                  onChange={(e) => patch({ dose: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ width: 130 }}>
              <Field label={uz.register.unit}>
                <Select value={value.unit} onChange={(e) => patch({ unit: e.target.value })}>
                  {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        </div>

        <Field label={uz.register.scheduleType} hint={uz.register.exactTimesHint}>
          <div className="chip-group">
            {PRESET_ORDER.map((key) => (
              <button
                type="button"
                key={key}
                className={`chip ${value.schedule_type === key ? 'chip--on' : ''}`}
                onClick={() => choosePreset(key)}
              >
                {uz.schedule[key as keyof typeof uz.schedule]}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${value.schedule_type === 'custom' ? 'chip--on' : ''}`}
              onClick={() => choosePreset('custom')}
            >
              🕐 {uz.register.customTimes}
            </button>
          </div>
        </Field>

        {value.schedule_type !== 'as_needed' ? (
          <Field
            label={uz.register.exactTimes}
            required
            error={errors[`med_${index}_times`]}
          >
            <div className="row">
              {value.times.map((time, position) => (
                <div className="row" key={position} style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <Input
                    type="time"
                    value={time}
                    style={{ width: 130 }}
                    onChange={(e) => setTime(position, e.target.value)}
                  />
                  {value.times.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={uz.app.remove}
                      onClick={() => patch({ times: value.times.filter((_, i) => i !== position) })}
                    >
                      ✕
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => patch({ times: [...value.times, '12:00'] })}
              >
                ➕ {uz.register.addTime}
              </Button>
            </div>
          </Field>
        ) : (
          <p className="small muted">
            “{uz.schedule.as_needed}” tanlanganda eslatma yuborilmaydi — dori zarurat bo‘yicha qabul qilinadi.
          </p>
        )}

        <div className="grid3">
          <Field label={uz.register.priority} hint={uz.register.medicationsHint}>
            <Select
              value={value.priority}
              onChange={(e) => patch({ priority: e.target.value as Priority })}
            >
              <option value="normal">{uz.priority.normal}</option>
              <option value="important">{uz.priority.important}</option>
              <option value="critical">{uz.priority.critical}</option>
            </Select>
          </Field>
          <Field label={uz.register.startDate}>
            <Input
              type="date"
              value={value.start_date}
              onChange={(e) => patch({ start_date: e.target.value })}
            />
          </Field>
          <Field label={`${uz.register.endDate} (${uz.app.optional})`}>
            <Input
              type="date"
              value={value.end_date}
              onChange={(e) => patch({ end_date: e.target.value })}
            />
          </Field>
        </div>

        <Field label={`${uz.register.medicationNote} (${uz.app.optional})`}>
          <Input
            value={value.notes}
            placeholder="Masalan: ovqatdan keyin qabul qilinsin"
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}
