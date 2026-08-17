import { useState } from 'react'
import { uz } from '../../lib/uz'
import { api } from '../../lib/api'
import { useApi, requestNotificationPermission } from '../../lib/hooks'
import { Button, Card, Empty, Loading, Notice } from '../../components/ui'
import { BloodPressureForm, GlucoseForm, SymptomForm } from '../../components/MeasurementForms'
import type { DailyPlan, PlanItem } from '../../lib/types'
import { formatTime } from '../../lib/format'

interface TodayResponse {
  patient: { id: number; first_name: string; last_name: string }
  plan: DailyPlan
  adherence_7d: { rate: number | null }
  has_active_plan: boolean
}

const ICONS: Record<PlanItem['kind'], string> = {
  medication: '💊',
  glucose: '🩸',
  blood_pressure: '🫀',
  symptom: '💬',
}

export function PatientHomePage() {
  const { data, loading, reload } = useApi<TodayResponse>('/me/today')
  const [openForm, setOpenForm] = useState<null | 'glucose' | 'blood_pressure' | 'symptom'>(null)
  const [formContext, setFormContext] = useState<PlanItem['context']>('any')
  const [toast, setToast] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notificationsOn, setNotificationsOn] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  )

  if (loading || !data) return <Loading />

  async function act(item: PlanItem, action: 'take' | 'snooze') {
    setBusyId(item.id)
    try {
      const result = await api.post<{ snoozed_until?: string; minutes?: number }>(
        `/doses/${item.id}/${action}`,
      )
      await reload()
      setToast(
        action === 'take'
          ? { tone: 'success', text: `✅ ${uz.patientHome.taken}` }
          : {
              tone: 'warning',
              text: `🕒 ${uz.patientHome.snoozed(formatTime(result.snoozed_until))}`,
            },
      )
    } finally {
      setBusyId(null)
    }
  }

  const { plan, patient } = data
  const nextPending = plan.items.find((i) => i.status === 'pending' || i.status === 'snoozed')
  const progress = plan.summary.total > 0 ? (plan.summary.done / plan.summary.total) * 100 : 0

  return (
    <>
      <div className="patient-header">
        <div className="patient-header__greeting">{uz.patientHome.greeting},</div>
        <div className="patient-header__name">{patient.first_name}!</div>
        <div className="patient-header__progress">
          <div className="patient-header__bar">
            <div className="patient-header__fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="patient-header__label">
            {uz.patientHome.progress(plan.summary.done, plan.summary.total)}
          </div>
        </div>
      </div>

      <div className="content stack">
        {toast ? <Notice tone={toast.tone === 'success' ? 'success' : 'warning'}>{toast.text}</Notice> : null}

        {!data.has_active_plan ? (
          <Card>
            <Empty icon="📋" title={uz.patientHome.noPlanTitle}>{uz.patientHome.noPlanBody}</Empty>
          </Card>
        ) : plan.items.length === 0 ? (
          <Card><Empty icon="📅" title={uz.patientHome.nothingToday} /></Card>
        ) : (
          <>
            <h1>{uz.patientHome.title}</h1>

            {plan.summary.complete ? (
              <Notice tone="success">{uz.patientHome.allDone}</Notice>
            ) : null}

            <div className="stack--sm" style={{ gap: 12 }}>
              {plan.items.map((item) => {
                const done = item.status === 'taken' || item.status === 'done'
                const isNext = nextPending?.id === item.id && nextPending?.kind === item.kind
                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className={`task ${done ? 'task--done' : ''} ${item.status === 'missed' ? 'task--missed' : ''} ${isNext ? 'task--next' : ''}`}
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
                      {item.kind === 'glucose' && item.context && item.context !== 'any' ? (
                        <div className="task__meta">{uz.measurements.context[item.context]}</div>
                      ) : null}
                      {item.note ? <div className="task__meta">{item.note}</div> : null}

                      {done ? (
                        <div className="task__meta strong" style={{ color: 'var(--green-700)' }}>
                          ✅ {item.kind === 'medication' ? uz.patientHome.taken : uz.patientHome.done}
                          {item.taken_at ? ` · ${formatTime(item.taken_at)}` : ''}
                        </div>
                      ) : item.status === 'missed' ? (
                        <div className="task__meta strong" style={{ color: 'var(--red-700)' }}>
                          ⚠️ {uz.patientHome.missed}
                        </div>
                      ) : item.status === 'snoozed' ? (
                        <div className="task__meta">🕒 {uz.patientHome.snoozed(formatTime(item.snoozed_until))}</div>
                      ) : null}

                      {!done ? (
                        <div className="task__actions">
                          {item.kind === 'medication' ? (
                            <>
                              <Button
                                variant="primary"
                                size="lg"
                                disabled={busyId === item.id}
                                onClick={() => void act(item, 'take')}
                              >
                                ✓ {uz.patientHome.take}
                              </Button>
                              {item.status !== 'missed' ? (
                                <Button
                                  size="lg"
                                  disabled={busyId === item.id}
                                  onClick={() => void act(item, 'snooze')}
                                >
                                  🕒 {uz.patientHome.later}
                                </Button>
                              ) : null}
                            </>
                          ) : (
                            <Button
                              variant="primary"
                              size="lg"
                              onClick={() => {
                                setFormContext(item.context ?? 'any')
                                setOpenForm(item.kind as 'glucose' | 'blood_pressure' | 'symptom')
                              }}
                            >
                              {item.kind === 'symptom' ? uz.symptoms.submit : uz.patientHome.enterMeasurement}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!notificationsOn ? (
          <Card>
            <div className="row--between">
              <div>
                <div className="strong">{uz.patientHome.remindersTitle}</div>
                <div className="small muted">Eslatmalarni brauzer orqali olishingiz mumkin.</div>
              </div>
              <Button
                onClick={async () => setNotificationsOn(await requestNotificationPermission())}
              >
                🔔 {uz.patientHome.enableNotifications}
              </Button>
            </div>
          </Card>
        ) : (
          <p className="small muted center">🔔 {uz.patientHome.notificationsOn}</p>
        )}
      </div>

      {openForm === 'glucose' ? (
        <GlucoseForm
          defaultContext={formContext}
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({
              tone: raised ? 'warning' : 'success',
              text: raised ? uz.measurements.alertRaised : uz.measurements.savedGlucose,
            })
            void reload()
          }}
        />
      ) : null}
      {openForm === 'blood_pressure' ? (
        <BloodPressureForm
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({
              tone: raised ? 'warning' : 'success',
              text: raised ? uz.measurements.alertRaised : uz.measurements.savedBp,
            })
            void reload()
          }}
        />
      ) : null}
      {openForm === 'symptom' ? (
        <SymptomForm
          onClose={() => setOpenForm(null)}
          onSaved={(raised) => {
            setOpenForm(null)
            setToast({
              tone: raised ? 'warning' : 'success',
              text: raised ? uz.measurements.alertRaised : uz.measurements.savedSymptom,
            })
            void reload()
          }}
        />
      ) : null}
    </>
  )
}
