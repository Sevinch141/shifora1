import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Badge, Card, Empty, Loading, Select, SeverityBadge } from '../../components/ui'
import { AdherenceBarChart, GlucoseLineChart } from '../../components/charts'
import type { AlertItem, BloodPressureReading, GlucoseReading, PatientListItem, SymptomCheck } from '../../lib/types'
import { formatDateTime } from '../../lib/format'

interface Report {
  period_days: number
  from: string
  to: string
  adherence: {
    total: number; taken: number; missed: number; pending: number; rate: number | null
    by_day: { date: string; total: number; taken: number; rate: number | null }[]
  }
  glucose: { count: number; average: number | null; min: number | null; max: number | null; readings: GlucoseReading[] }
  blood_pressure: { count: number; readings: BloodPressureReading[] }
  symptoms: { count: number; not_good: number; checks: SymptomCheck[] }
  alerts: { count: number; urgent: number; items: AlertItem[] }
}

const PERIODS = [
  { days: 7, label: uz.reports.d7 },
  { days: 14, label: uz.reports.d14 },
  { days: 30, label: uz.reports.d30 },
]

export function ReportsPage() {
  const [params] = useSearchParams()
  const [patientId, setPatientId] = useState(params.get('patient') ?? '')
  const [days, setDays] = useState(7)

  const { data: patients } = useApi<{ patients: PatientListItem[] }>('/patients')
  const { data: report, loading } = useApi<Report>(
    patientId ? `/patients/${patientId}/report?days=${days}` : null,
    [patientId, days],
  )

  return (
    <div className="stack">
      <Card>
        <div className="grid2">
          <label className="field">
            <span className="field__label">{uz.reports.choosePatient}</span>
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">— {uz.reports.choosePatient} —</option>
              {patients?.patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.last_name} {patient.first_name}
                </option>
              ))}
            </Select>
          </label>
          <div className="field">
            <span className="field__label">{uz.reports.period}</span>
            <div className="chip-group">
              {PERIODS.map((period) => (
                <button
                  key={period.days}
                  className={`chip ${days === period.days ? 'chip--on' : ''}`}
                  onClick={() => setDays(period.days)}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {!patientId ? (
        <Card><Empty icon="📊" title={uz.reports.choosePatient} /></Card>
      ) : loading || !report ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">💊 {uz.reports.adherence}</div>
              <div className="stat__value">{report.adherence.rate === null ? '—' : `${report.adherence.rate}%`}</div>
              <div className="small muted">
                {uz.reports.taken}: {report.adherence.taken} · {uz.reports.missed}: {report.adherence.missed}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">🩸 {uz.reports.glucoseEntries}</div>
              <div className="stat__value">{report.glucose.count}</div>
              <div className="small muted">
                {report.glucose.average
                  ? `${uz.reports.average}: ${report.glucose.average} · ${report.glucose.min}–${report.glucose.max} mg/dL`
                  : uz.reports.noData}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">🫀 {uz.reports.bpEntries}</div>
              <div className="stat__value">{report.blood_pressure.count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">🔔 {uz.reports.alertsCount}</div>
              <div className="stat__value">{report.alerts.count}</div>
              <div className="small muted">🔴 {report.alerts.urgent}</div>
            </div>
          </div>

          <Card title={uz.reports.adherenceByDay}>
            <AdherenceBarChart data={report.adherence.by_day} />
          </Card>

          <Card title={uz.reports.glucoseEntries}>
            <GlucoseLineChart readings={report.glucose.readings} />
          </Card>

          <div className="grid2">
            <Card title={uz.reports.symptomReports} flush>
              {report.symptoms.checks.length === 0 ? (
                <Empty icon="💬" title={uz.reports.noData} />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {report.symptoms.checks.slice(0, 10).map((check) => (
                        <tr key={check.id} style={{ cursor: 'default' }}>
                          <td>{formatDateTime(check.reported_at)}</td>
                          <td>
                            <Badge tone={check.feeling === 'good' ? 'stable' : check.feeling === 'bad' ? 'urgent' : 'attention'}>
                              {uz.symptoms[check.feeling]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title={uz.reports.alertsCount} flush>
              {report.alerts.items.length === 0 ? (
                <Empty icon="✅" title={uz.reports.noData} />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {report.alerts.items.slice(0, 10).map((alert) => (
                        <tr key={alert.id} style={{ cursor: 'default' }}>
                          <td>
                            <div className="strong small">{alert.title}</div>
                            <div className="small muted">{formatDateTime(alert.created_at)}</div>
                          </td>
                          <td style={{ width: 190 }}><SeverityBadge severity={alert.severity} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
