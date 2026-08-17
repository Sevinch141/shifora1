import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Badge, Card, Empty, Loading, Notice } from '../../components/ui'
import type { DailyPlan } from '../../lib/types'
import { PatientSwitcher, useCaregiverPatient } from './CaregiverApp'

interface Detail {
  permissions: Record<string, boolean>
  today: DailyPlan | null
}

const ICONS: Record<string, string> = {
  medication: '💊',
  glucose: '🩸',
  blood_pressure: '🫀',
  symptom: '💬',
}

export function CaregiverCarePage() {
  const { patient } = useCaregiverPatient()
  const { data, loading } = useApi<Detail>(`/caregiver/patients/${patient.id}`, [patient.id])

  if (loading || !data) return <div className="content"><Loading /></div>

  return (
    <div className="content stack">
      <PatientSwitcher />
      <h1>{uz.caregiver.care}</h1>
      <p className="muted">{uz.caregiver.careHint}</p>

      {!data.permissions.view_today_plan || !data.today ? (
        <Card><Empty icon="🔒" title={uz.caregiver.noAccess} /></Card>
      ) : data.today.items.length === 0 ? (
        <Card><Empty icon="📅" title={uz.patientHome.nothingToday} /></Card>
      ) : (
        <div className="stack--sm" style={{ gap: 12 }}>
          {data.today.items.map((item) => {
            const done = item.status === 'taken' || item.status === 'done'
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className={`task ${done ? 'task--done' : ''} ${item.status === 'missed' ? 'task--missed' : ''}`}
              >
                <div className="task__time">{item.time}</div>
                <div className="task__icon" aria-hidden>{ICONS[item.kind]}</div>
                <div className="task__body">
                  <div className="task__title">
                    {item.kind === 'medication'
                      ? item.title
                      : item.kind === 'glucose'
                        ? uz.patientHome.measureGlucose
                        : item.kind === 'blood_pressure'
                          ? uz.patientHome.measureBp
                          : uz.patientHome.symptomCheck}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {done ? (
                      <Badge tone="stable">✅ {uz.patientHome.done}</Badge>
                    ) : item.status === 'missed' ? (
                      <Badge tone="urgent">⚠️ {uz.patientHome.missed}</Badge>
                    ) : (
                      <Badge tone="neutral">🕒 {uz.patientHome.waiting}</Badge>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Notice tone="info">
        Dori qabul qilinganini faqat bemorning o‘zi tasdiqlaydi. Siz rejani kuzatib borasiz.
      </Notice>
    </div>
  )
}
