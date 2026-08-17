import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Badge, Card, Empty, Loading } from '../../components/ui'
import type { Medication } from '../../lib/types'
import { formatDateTime } from '../../lib/format'

interface Response {
  plan: { id: number; version: number; approved_at: string | null } | null
  medications: Medication[]
  history: {
    id: number; scheduled_at: string; status: string; taken_at: string | null
    name: string; dose: string; unit: string
  }[]
}

const STATUS_LABEL: Record<string, { label: string; tone: 'stable' | 'urgent' | 'neutral' | 'attention' }> = {
  taken: { label: uz.medications.doseTaken, tone: 'stable' },
  missed: { label: uz.medications.doseMissed, tone: 'urgent' },
  pending: { label: uz.medications.dosePending, tone: 'neutral' },
  snoozed: { label: uz.medications.doseSnoozed, tone: 'attention' },
}

export function PatientMedicationsPage() {
  const { data, loading } = useApi<Response>('/me/medications')

  if (loading || !data) return <div className="content"><Loading /></div>

  return (
    <div className="content stack">
      <h1>{uz.medications.title}</h1>

      {data.medications.length === 0 ? (
        <Card><Empty icon="💊" title={uz.carePlan.noMedications} /></Card>
      ) : (
        data.medications.map((med) => (
          <Card key={med.id}>
            <div className="row--between">
              <div>
                <h2>{med.name}</h2>
                <div className="muted">{med.dose} {med.unit}</div>
              </div>
              <Badge tone={med.priority === 'critical' ? 'urgent' : med.priority === 'important' ? 'attention' : 'neutral'}>
                {uz.priority[med.priority]}
              </Badge>
            </div>

            <div className="divider" style={{ margin: '14px 0' }} />

            <div className="small muted">{uz.medications.schedule}</div>
            <div className="row" style={{ marginTop: 6 }}>
              {med.schedules.length === 0 ? (
                <span className="muted">{uz.schedule.as_needed}</span>
              ) : (
                med.schedules.map((slot) => (
                  <span key={slot.id} className="badge badge--teal badge--lg">
                    🕐 {slot.time_of_day}
                  </span>
                ))
              )}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {uz.schedule[med.schedule_type as keyof typeof uz.schedule]}
            </div>
            {med.notes ? <p className="small" style={{ marginTop: 8 }}>📝 {med.notes}</p> : null}
          </Card>
        ))
      )}

      <Card title={uz.medications.history} flush>
        {data.history.length === 0 ? (
          <Empty icon="🗓" title={uz.medications.noHistory} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.history.slice(0, 25).map((dose) => {
                  const meta = STATUS_LABEL[dose.status] ?? STATUS_LABEL.pending
                  return (
                    <tr key={dose.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="strong">{dose.name} {dose.dose} {dose.unit}</div>
                        <div className="small muted">{formatDateTime(dose.scheduled_at)}</div>
                      </td>
                      <td style={{ width: 150 }}>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
