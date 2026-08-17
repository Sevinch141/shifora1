import { Link, useNavigate } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/hooks'
import { Button, Card, Loading, Notice, SeverityBadge } from '../../components/ui'
import type { AlertItem } from '../../lib/types'
import { timeAgo } from '../../lib/format'

interface Stats {
  total: number
  stable: number
  attention: number
  urgent: number
  open_alerts: number
}

const STAT_CARDS = [
  { key: 'total', label: uz.dashboard.totalPatients, icon: '👥', tone: '' },
  { key: 'stable', label: uz.dashboard.stable, icon: '🟢', tone: 'stable' },
  { key: 'attention', label: uz.dashboard.attention, icon: '🟡', tone: 'attention' },
  { key: 'urgent', label: uz.dashboard.urgent, icon: '🔴', tone: 'urgent' },
] as const

export function DashboardPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const { data: stats, loading } = useApi<Stats>('/patients/stats')
  const { data: alerts } = useApi<{ alerts: AlertItem[] }>('/alerts?status=open&limit=8')

  if (loading || !stats) return <Loading />

  return (
    <div className="stack">
      <div>
        <h1>{uz.dashboard.greeting}, {session?.user.full_name}</h1>
        <p className="muted small">{uz.status.note}</p>
      </div>

      <div className="stats">
        {STAT_CARDS.map((card) => (
          <div key={card.key} className={`stat ${card.tone ? `stat--${card.tone}` : ''}`}>
            <div className="stat__label">
              <span aria-hidden>{card.icon}</span> {card.label}
            </div>
            <div className="stat__value">{stats[card.key]}</div>
          </div>
        ))}
      </div>

      <Card
        title={uz.dashboard.importantAlerts}
        subtitle={`${uz.dashboard.openAlerts}: ${stats.open_alerts}`}
        action={
          <Link to="/shifoxona/ogohlantirishlar">
            <Button size="sm">{uz.dashboard.viewAll}</Button>
          </Link>
        }
        flush
      >
        {!alerts || alerts.alerts.length === 0 ? (
          <div className="empty">
            <span className="empty__icon" aria-hidden>✅</span>
            <div className="empty__title">{uz.dashboard.noAlerts}</div>
          </div>
        ) : (
          alerts.alerts.map((alert) => (
            <div className="alert-row" key={alert.id}>
              <span className={`alert-row__bar alert-row__bar--${alert.severity}`} aria-hidden />
              <div className="alert-row__body">
                <div className="row--between">
                  <div>
                    <div className="alert-row__title">
                      {alert.last_name} {alert.first_name}
                    </div>
                    <div className="alert-row__detail">{alert.title} — {alert.detail}</div>
                  </div>
                  <SeverityBadge severity={alert.severity} />
                </div>
                <div className="alert-row__meta">
                  <span>🕒 {timeAgo(alert.created_at)}</span>
                  <span>📌 {uz.alerts.state[alert.status]}</span>
                  {alert.assigned_name ? <span>👤 {alert.assigned_name}</span> : null}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate(`/shifoxona/ogohlantirishlar?alert=${alert.id}`)}
              >
                {uz.alerts.review}
              </Button>
            </div>
          ))
        )}
      </Card>

      <Notice tone="info">{uz.alerts.safetyNote}</Notice>
    </div>
  )
}
