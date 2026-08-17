import { uz } from '../../lib/uz'
import { useApi, useNotifications } from '../../lib/hooks'
import { Button, Card, Empty, Loading, SeverityBadge } from '../../components/ui'
import type { Severity } from '../../lib/types'
import { formatDateTime, timeAgo } from '../../lib/format'
import { PatientSwitcher, useCaregiverPatient } from './CaregiverApp'

interface Detail {
  permissions: Record<string, boolean>
  alerts: {
    id: number; severity: Severity; title: string; detail: string
    status: 'new' | 'in_review' | 'contacted' | 'closed'; created_at: string
  }[] | null
}

export function CaregiverAlertsPage() {
  const { patient } = useCaregiverPatient()
  const { data, loading } = useApi<Detail>(`/caregiver/patients/${patient.id}`, [patient.id])
  const { items, unread, markAllRead } = useNotifications(true)

  if (loading || !data) return <div className="content"><Loading /></div>

  return (
    <div className="content stack">
      <PatientSwitcher />
      <div className="row--between">
        <h1>{uz.alerts.title}</h1>
        {unread > 0 ? (
          <Button size="sm" onClick={() => void markAllRead()}>{uz.notifications.markAllRead}</Button>
        ) : null}
      </div>

      {!data.permissions.view_alerts || !data.alerts ? (
        <Card><Empty icon="🔒" title={uz.caregiver.noAccess} /></Card>
      ) : data.alerts.length === 0 ? (
        <Card><Empty icon="✅" title={uz.alerts.empty} /></Card>
      ) : (
        <Card flush>
          {data.alerts.map((alert) => (
            <div className="alert-row" key={alert.id}>
              <span className={`alert-row__bar alert-row__bar--${alert.severity}`} aria-hidden />
              <div className="alert-row__body">
                <div className="row--between">
                  <div className="alert-row__title">{alert.title}</div>
                  <SeverityBadge severity={alert.severity} />
                </div>
                <div className="alert-row__detail">{alert.detail}</div>
                <div className="alert-row__meta">
                  <span>🕒 {formatDateTime(alert.created_at)}</span>
                  <span>📌 {uz.alerts.state[alert.status]}</span>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title={uz.notifications.title} flush>
        {items.length === 0 ? (
          <Empty icon="🔔" title={uz.notifications.empty} />
        ) : (
          items.slice(0, 15).map((item) => (
            <div className="alert-row" key={item.id}>
              <span className="alert-row__bar alert-row__bar--info" aria-hidden />
              <div className="alert-row__body">
                <div className="alert-row__title">{item.title}</div>
                <div className="alert-row__detail">{item.body}</div>
                <div className="alert-row__meta"><span>🕒 {timeAgo(item.created_at)}</span></div>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
