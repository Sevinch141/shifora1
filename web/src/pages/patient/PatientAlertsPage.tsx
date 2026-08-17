import { uz } from '../../lib/uz'
import { useNotifications } from '../../lib/hooks'
import { Button, Card, Empty } from '../../components/ui'
import { timeAgo } from '../../lib/format'

const ICONS: Record<string, string> = {
  medication_reminder: '💊',
  monitoring_reminder: '🩸',
  alert: '🟡',
  alert_urgent: '🔴',
  info: 'ℹ️',
}

export function PatientAlertsPage() {
  const { items, unread, markAllRead, markRead } = useNotifications(true)

  return (
    <div className="content stack">
      <div className="row--between">
        <h1>{uz.notifications.title}</h1>
        {unread > 0 ? (
          <Button size="sm" onClick={() => void markAllRead()}>{uz.notifications.markAllRead}</Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card><Empty icon="🔔" title={uz.notifications.empty} /></Card>
      ) : (
        <div className="stack--sm" style={{ gap: 12 }}>
          {items.map((item) => (
            <button
              key={item.id}
              className="task"
              style={{
                background: item.read_at ? 'var(--surface)' : 'var(--teal-50)',
                textAlign: 'start',
                cursor: item.read_at ? 'default' : 'pointer',
                font: 'inherit',
                width: '100%',
              }}
              onClick={() => { if (!item.read_at) void markRead(item.id) }}
            >
              <span className="task__icon" aria-hidden>{ICONS[item.type] ?? '🔔'}</span>
              <div className="task__body">
                <div className="task__title">{item.title}</div>
                <div className="task__meta">{item.body}</div>
                <div className="task__meta muted">{timeAgo(item.created_at)}</div>
              </div>
              {!item.read_at ? <span className="badge badge--teal">{uz.notifications.unread}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
