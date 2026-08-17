import { useState } from 'react'
import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Loading, Notice } from '../../components/ui'
import { BloodPressureForm, GlucoseForm, SymptomForm } from '../../components/MeasurementForms'
import { GlucoseLineChart } from '../../components/charts'
import type { BloodPressureReading, GlucoseReading, SymptomCheck } from '../../lib/types'
import { formatDateTime } from '../../lib/format'

interface Response {
  glucose: GlucoseReading[]
  blood_pressure: BloodPressureReading[]
  symptoms: SymptomCheck[]
}

export function PatientMeasurementsPage() {
  const { data, loading, reload } = useApi<Response>('/measurements?limit=30')
  const [openForm, setOpenForm] = useState<null | 'glucose' | 'blood_pressure' | 'symptom'>(null)
  const [toast, setToast] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)

  if (loading || !data) return <div className="content"><Loading /></div>

  const chartData = [...data.glucose]
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .slice(-20)

  return (
    <div className="content stack">
      <h1>{uz.measurements.title}</h1>

      {toast ? <Notice tone={toast.tone === 'success' ? 'success' : 'warning'}>{toast.text}</Notice> : null}

      <div className="stack--sm">
        <Button variant="primary" size="lg" block onClick={() => setOpenForm('glucose')}>
          🩸 {uz.measurements.addGlucose}
        </Button>
        <Button size="lg" block onClick={() => setOpenForm('blood_pressure')}>
          🫀 {uz.measurements.addBp}
        </Button>
        <Button size="lg" block onClick={() => setOpenForm('symptom')}>
          💬 {uz.measurements.addSymptom}
        </Button>
      </div>

      <Notice tone="info">{uz.measurements.manualNote}</Notice>

      {chartData.length >= 2 ? (
        <Card title={`🩸 ${uz.measurements.glucose}`}>
          <GlucoseLineChart readings={chartData} />
        </Card>
      ) : null}

      <Card title={`🩸 ${uz.measurements.glucose}`} flush>
        {data.glucose.length === 0 ? (
          <Empty icon="🩸" title={uz.measurements.noReadings} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.glucose.map((reading) => (
                  <tr key={reading.id} style={{ cursor: 'default' }}>
                    <td>
                      <div className="strong" style={{ fontSize: '1.05rem' }}>
                        {reading.value} <span className="muted small">mg/dL</span>
                      </div>
                      <div className="small muted">{uz.measurements.context[reading.context]}</div>
                    </td>
                    <td className="small muted" style={{ textAlign: 'end' }}>
                      {formatDateTime(reading.measured_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`🫀 ${uz.measurements.bloodPressure}`} flush>
        {data.blood_pressure.length === 0 ? (
          <Empty icon="🫀" title={uz.measurements.noReadings} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.blood_pressure.map((reading) => (
                  <tr key={reading.id} style={{ cursor: 'default' }}>
                    <td>
                      <div className="strong" style={{ fontSize: '1.05rem' }}>
                        {reading.systolic} / {reading.diastolic} <span className="muted small">mmHg</span>
                      </div>
                      {reading.pulse ? (
                        <div className="small muted">{uz.measurements.pulse}: {reading.pulse}</div>
                      ) : null}
                    </td>
                    <td className="small muted" style={{ textAlign: 'end' }}>
                      {formatDateTime(reading.measured_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`💬 ${uz.measurements.symptoms}`} flush>
        {data.symptoms.length === 0 ? (
          <Empty icon="💬" title={uz.measurements.noReadings} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.symptoms.map((check) => {
                  const symptoms: string[] = Array.isArray(check.symptoms)
                    ? check.symptoms
                    : JSON.parse(check.symptoms || '[]')
                  return (
                    <tr key={check.id} style={{ cursor: 'default' }}>
                      <td>
                        <Badge tone={check.feeling === 'good' ? 'stable' : check.feeling === 'bad' ? 'urgent' : 'attention'}>
                          {uz.symptoms[check.feeling]}
                        </Badge>
                        {symptoms.length > 0 ? (
                          <div className="small muted" style={{ marginTop: 4 }}>
                            {symptoms.map((key) => uz.symptoms.list[key as keyof typeof uz.symptoms.list] ?? key).join(', ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="small muted" style={{ textAlign: 'end' }}>
                        {formatDateTime(check.reported_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openForm === 'glucose' ? (
        <GlucoseForm
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({ tone: raised ? 'warning' : 'success', text: raised ? uz.measurements.alertRaised : uz.measurements.savedGlucose })
            void reload()
          }}
        />
      ) : null}
      {openForm === 'blood_pressure' ? (
        <BloodPressureForm
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({ tone: raised ? 'warning' : 'success', text: raised ? uz.measurements.alertRaised : uz.measurements.savedBp })
            void reload()
          }}
        />
      ) : null}
      {openForm === 'symptom' ? (
        <SymptomForm
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({ tone: raised ? 'warning' : 'success', text: raised ? uz.measurements.alertRaised : uz.measurements.savedSymptom })
            void reload()
          }}
        />
      ) : null}
    </div>
  )
}
