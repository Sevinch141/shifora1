import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Card, Empty, Loading, Meter, Notice, StatusBadge } from '../../components/ui'
import type { BloodPressureReading, GlucoseReading } from '../../lib/types'
import { formatDateTime, timeAgo } from '../../lib/format'
import { PatientSwitcher, useCaregiverPatient } from './CaregiverApp'

interface Detail {
  patient: { status: 'stable' | 'attention' | 'urgent' }
  permissions: Record<string, boolean>
  adherence: { d7: { rate: number | null; taken: number; total: number }; last_activity: string | null } | null
  measurements: { glucose: GlucoseReading[]; blood_pressure: BloodPressureReading[] } | null
}

export function CaregiverStatusPage() {
  const { patient } = useCaregiverPatient()
  const { data, loading } = useApi<Detail>(`/caregiver/patients/${patient.id}`, [patient.id])

  if (loading || !data) return <div className="content"><Loading /></div>

  return (
    <div className="content stack">
      <PatientSwitcher />
      <h1>{uz.nav.caregiver.status}</h1>

      <Card>
        <div className="row--between">
          <span className="strong">{uz.status.label}</span>
          <StatusBadge status={data.patient.status} size="lg" />
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{uz.status.note}</p>
      </Card>

      {data.adherence ? (
        <Card title={uz.caregiver.adherence7d}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Meter value={data.adherence.d7.rate} />
            <span className="strong" style={{ fontSize: '1.3rem' }}>
              {data.adherence.d7.rate ?? '—'}%
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {uz.reports.taken}: {data.adherence.d7.taken} / {data.adherence.d7.total} ·{' '}
            {uz.patientProfile.lastActivity}: {timeAgo(data.adherence.last_activity)}
          </p>
        </Card>
      ) : (
        <Card><Empty icon="🔒" title={uz.caregiver.noAccess} /></Card>
      )}

      {data.measurements ? (
        <>
          <Card title={`🩸 ${uz.measurements.glucose}`} flush>
            {data.measurements.glucose.length === 0 ? (
              <Empty icon="🩸" title={uz.measurements.noReadings} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {data.measurements.glucose.map((reading) => (
                      <tr key={reading.id} style={{ cursor: 'default' }}>
                        <td className="strong">{reading.value} <span className="muted small">mg/dL</span></td>
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
            {data.measurements.blood_pressure.length === 0 ? (
              <Empty icon="🫀" title={uz.measurements.noReadings} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {data.measurements.blood_pressure.map((reading) => (
                      <tr key={reading.id} style={{ cursor: 'default' }}>
                        <td className="strong">
                          {reading.systolic} / {reading.diastolic} <span className="muted small">mmHg</span>
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
        </>
      ) : (
        <Notice tone="info">{uz.caregiver.accessNote}</Notice>
      )}
    </div>
  )
}
