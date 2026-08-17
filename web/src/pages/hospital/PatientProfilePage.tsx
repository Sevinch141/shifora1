import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { api } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import {
  Badge, Button, Card, Empty, Loading, Meter, Notice, SeverityBadge, StatusBadge,
} from '../../components/ui'
import type {
  AlertItem, BloodPressureReading, CarePlan, DailyPlan, GlucoseReading,
  PatientRecord, SymptomCheck,
} from '../../lib/types'
import { formatDate, formatDateTime, timeAgo } from '../../lib/format'

interface ProfileResponse {
  patient: PatientRecord
  profile: {
    diabetes_type: 'type1' | 'type2' | 'other'
    diagnosis_date: string | null
    hba1c: number | null
    recent_hospitalization: number
    prior_hypoglycemia: number
    clinical_notes: string | null
    cgm_enabled: number
  } | null
  care_plan: CarePlan | null
  adherence: { d7: { rate: number | null }; d30: { rate: number | null } }
  last_activity: string | null
  today: DailyPlan
  glucose: GlucoseReading[]
  blood_pressure: BloodPressureReading[]
  symptoms: SymptomCheck[]
  alerts: AlertItem[]
  caregivers: {
    id: number; relation: string; status: string; full_name: string; phone: string
    permissions: Record<string, boolean>
  }[]
  plan_history: {
    id: number; version: number; status: string; approved_at: string | null; approver: string | null
  }[]
}

interface AiSummary {
  disclaimer: string
  insights: { kind: string; tone: string; text: string }[]
}

const TABS = [
  { key: 'overview', label: 'Umumiy' },
  { key: 'plan', label: uz.carePlan.title },
  { key: 'measurements', label: uz.patientProfile.recentMeasurements },
  { key: 'alerts', label: uz.patientProfile.alerts },
  { key: 'people', label: uz.patientProfile.caregivers },
]

export function PatientProfilePage() {
  const { id } = useParams()
  const { data, loading } = useApi<ProfileResponse>(`/patients/${id}`, [id])
  const [tab, setTab] = useState('overview')
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)

  if (loading || !data) return <Loading />

  const { patient, profile, care_plan: plan } = data

  async function loadSummary() {
    setSummaryBusy(true)
    try {
      setSummary(await api.post<AiSummary>(`/ai/patients/${id}/summary`))
    } finally {
      setSummaryBusy(false)
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="row--between">
          <div className="row">
            <div>
              <h1>{patient.last_name} {patient.first_name}</h1>
              <div className="muted small">
                {patient.phone} · {formatDate(patient.birth_date)} ·{' '}
                {patient.gender === 'male' ? uz.gender.male : uz.gender.female}
              </div>
            </div>
          </div>
          <div className="row">
            <StatusBadge status={patient.status} size="lg" />
            <Link to={`/shifoxona/hisobotlar?patient=${patient.id}`}>
              <Button size="sm">📊 {uz.patientProfile.openReport}</Button>
            </Link>
          </div>
        </div>

        <div className="divider" style={{ margin: '16px 0' }} />

        <div className="grid3">
          <div>
            <div className="small muted">{uz.patientProfile.adherence7}</div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Meter value={data.adherence.d7.rate} />
              <span className="strong">{data.adherence.d7.rate ?? '—'}%</span>
            </div>
          </div>
          <div>
            <div className="small muted">{uz.patientProfile.adherence30}</div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Meter value={data.adherence.d30.rate} />
              <span className="strong">{data.adherence.d30.rate ?? '—'}%</span>
            </div>
          </div>
          <div>
            <div className="small muted">{uz.patientProfile.lastActivity}</div>
            <div className="strong">{timeAgo(data.last_activity)}</div>
          </div>
        </div>
      </Card>

      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={`tab ${tab === item.key ? 'tab--on' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="stack">
          <Card title={`🤖 ${uz.ai.summaryTitle}`} action={
            <Button size="sm" onClick={() => void loadSummary()} disabled={summaryBusy}>
              {summaryBusy ? uz.ai.generating : uz.ai.summaryGenerate}
            </Button>
          }>
            {!summary ? (
              <p className="muted">{uz.ai.noSummary}</p>
            ) : (
              <div className="stack--sm">
                {summary.insights.map((insight, index) => (
                  <Notice
                    key={index}
                    tone={insight.tone === 'warning' ? 'warning' : insight.tone === 'positive' ? 'success' : 'info'}
                  >
                    <span className="badge badge--teal" style={{ marginInlineEnd: 8 }}>{uz.ai.label}</span>
                    {insight.text}
                  </Notice>
                ))}
                <p className="small muted">{summary.disclaimer}</p>
              </div>
            )}
          </Card>

          <div className="grid2">
            <Card title={uz.patientProfile.personal}>
              <dl className="kv">
                <dt>{uz.profile.fullName}</dt>
                <dd>{patient.last_name} {patient.first_name}</dd>
                <dt>{uz.profile.birthDate}</dt>
                <dd>{formatDate(patient.birth_date)}</dd>
                <dt>{uz.profile.phone}</dt>
                <dd>{patient.phone}</dd>
                <dt>{uz.profile.address}</dt>
                <dd>{patient.address ?? '—'}</dd>
                <dt>{uz.profile.emergencyContact}</dt>
                <dd>{patient.emergency_contact_name ?? '—'} · {patient.emergency_contact_phone ?? '—'}</dd>
                <dt>Chiqarilgan sana</dt>
                <dd>{formatDate(patient.discharge_date)}</dd>
              </dl>
            </Card>

            <Card title={uz.patientProfile.diabetes}>
              {profile ? (
                <dl className="kv">
                  <dt>{uz.register.diabetesTypeLabel}</dt>
                  <dd>{uz.diabetesType[profile.diabetes_type]}</dd>
                  <dt>{uz.profile.diagnosisDate}</dt>
                  <dd>{formatDate(profile.diagnosis_date)}</dd>
                  <dt>{uz.patientProfile.hba1c}</dt>
                  <dd>{profile.hba1c ? `${profile.hba1c}%` : '—'}</dd>
                  <dt>{uz.register.recentHospitalization}</dt>
                  <dd>{profile.recent_hospitalization ? uz.app.yes : uz.app.no}</dd>
                  <dt>{uz.register.priorHypoglycemia}</dt>
                  <dd>{profile.prior_hypoglycemia ? uz.app.yes : uz.app.no}</dd>
                  <dt>{uz.register.cgm}</dt>
                  <dd>{profile.cgm_enabled ? uz.register.cgmOn : uz.register.cgmOff}</dd>
                  <dt>{uz.patientProfile.clinicalNotes}</dt>
                  <dd>{profile.clinical_notes ?? '—'}</dd>
                </dl>
              ) : (
                <p className="muted">{uz.app.notSpecified}</p>
              )}
            </Card>
          </div>

          <Card title={uz.patientProfile.todayPlan} flush>
            {data.today.items.length === 0 ? (
              <Empty icon="📅" title={uz.patientHome.nothingToday} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {data.today.items.map((item) => (
                      <tr key={`${item.kind}-${item.id}`} style={{ cursor: 'default' }}>
                        <td style={{ width: 80 }} className="strong">{item.time}</td>
                        <td>
                          {item.kind === 'medication'
                            ? `💊 ${item.title}`
                            : item.kind === 'glucose'
                              ? `🩸 ${uz.measurements.glucose} (${uz.measurements.context[item.context ?? 'any']})`
                              : item.kind === 'blood_pressure'
                                ? `🫀 ${uz.measurements.bloodPressure}`
                                : `💬 ${uz.measurements.symptoms}`}
                        </td>
                        <td style={{ width: 160 }}>
                          {item.status === 'taken' || item.status === 'done' ? (
                            <Badge tone="stable">✅ {uz.patientHome.done}</Badge>
                          ) : item.status === 'missed' ? (
                            <Badge tone="urgent">⚠️ {uz.patientHome.missed}</Badge>
                          ) : (
                            <Badge tone="neutral">🕒 {uz.patientHome.waiting}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div className="stack">
          {!plan ? (
            <Card><Empty icon="📋" title={uz.carePlan.noPlan} /></Card>
          ) : (
            <>
              <Card
                title={`${uz.carePlan.title} — ${uz.carePlan.version} ${plan.version}`}
                action={<Badge tone="teal">{uz.carePlan[plan.status]}</Badge>}
              >
                <dl className="kv">
                  <dt>{uz.carePlan.approvedBy}</dt>
                  <dd>
                    {plan.approver
                      ? `${plan.approver.full_name} (${uz.roles[plan.approver.role as keyof typeof uz.roles]})`
                      : uz.carePlan.notApproved}
                  </dd>
                  <dt>{uz.carePlan.approvedAt}</dt>
                  <dd>{formatDateTime(plan.approved_at)}</dd>
                  <dt>{uz.carePlan.startDate}</dt>
                  <dd>{formatDate(plan.start_date)}</dd>
                  <dt>{uz.carePlan.reminders}</dt>
                  <dd>
                    Takror: {plan.reminder_repeat_minutes} daq · Eslatmalar: {plan.reminder_max_count} ·
                    Kechroq: {plan.snooze_minutes} daq
                  </dd>
                  <dt>Eskalatsiya</dt>
                  <dd>
                    {uz.priority.normal}: {plan.escalate_normal_minutes} daq ·{' '}
                    {uz.priority.important}: {plan.escalate_important_minutes} daq ·{' '}
                    {uz.priority.critical}: {plan.escalate_critical_minutes} daq
                  </dd>
                </dl>
              </Card>

              <Card title={uz.carePlan.medications} flush>
                {plan.medications.length === 0 ? (
                  <Empty icon="💊" title={uz.carePlan.noMedications} />
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{uz.register.medicationName}</th>
                          <th>{uz.register.scheduleType}</th>
                          <th>{uz.register.exactTimes}</th>
                          <th>{uz.register.priority}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.medications.map((med) => (
                          <tr key={med.id} style={{ cursor: 'default' }}>
                            <td className="strong">{med.name} {med.dose} {med.unit}</td>
                            <td>{uz.schedule[med.schedule_type as keyof typeof uz.schedule]}</td>
                            <td>{med.schedules.map((s) => s.time_of_day).join(', ') || '—'}</td>
                            <td>
                              <Badge tone={med.priority === 'critical' ? 'urgent' : med.priority === 'important' ? 'attention' : 'neutral'}>
                                {uz.priority[med.priority]}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title={uz.patientProfile.monitoringSchedule}>
                <div className="stack--sm">
                  {plan.monitoring.map((config) => (
                    <div key={config.id} className="row--between">
                      <span className="strong">
                        {config.type === 'glucose' ? `🩸 ${uz.measurements.glucose}`
                          : config.type === 'blood_pressure' ? `🫀 ${uz.measurements.bloodPressure}`
                            : `💬 ${uz.measurements.symptoms}`}
                      </span>
                      <span className="small">
                        {config.enabled
                          ? config.times.map((t) => `${t.time_of_day} (${uz.measurements.context[t.context]})`).join(', ')
                          : <span className="muted">kuzatilmaydi</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title={uz.carePlan.thresholds} subtitle={uz.register.thresholdsHint} flush>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {plan.rules.map((rule) => (
                        <tr key={rule.id} style={{ cursor: 'default' }}>
                          <td>{rule.message_uz}</td>
                          <td style={{ width: 150 }} className="strong">
                            {rule.value_1 !== null
                              ? `${rule.comparator === 'lt' ? '<' : '>'} ${rule.value_1}${rule.value_2 ? ` / ${rule.value_2}` : ''}`
                              : '—'}
                          </td>
                          <td style={{ width: 190 }}><SeverityBadge severity={rule.severity} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <Card title={uz.carePlan.history} subtitle={uz.carePlan.versionNote} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{uz.carePlan.version}</th>
                    <th>{uz.carePlan.status}</th>
                    <th>{uz.carePlan.approvedBy}</th>
                    <th>{uz.carePlan.approvedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plan_history.map((item) => (
                    <tr key={item.id} style={{ cursor: 'default' }}>
                      <td className="strong">v{item.version}</td>
                      <td>{uz.carePlan[item.status as 'draft' | 'active' | 'archived']}</td>
                      <td>{item.approver ?? '—'}</td>
                      <td>{formatDateTime(item.approved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'measurements' ? (
        <div className="stack">
          <Card title={`🩸 ${uz.measurements.glucose}`} flush>
            {data.glucose.length === 0 ? <Empty icon="🩸" title={uz.measurements.noReadings} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>{uz.app.date}</th><th>Qiymat</th><th>{uz.measurements.contextLabel}</th><th>{uz.app.note}</th></tr>
                  </thead>
                  <tbody>
                    {data.glucose.map((reading) => (
                      <tr key={reading.id} style={{ cursor: 'default' }}>
                        <td>{formatDateTime(reading.measured_at)}</td>
                        <td className="strong">{reading.value} mg/dL</td>
                        <td>{uz.measurements.context[reading.context]}</td>
                        <td className="small muted">{reading.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`🫀 ${uz.measurements.bloodPressure}`} flush>
            {data.blood_pressure.length === 0 ? <Empty icon="🫀" title={uz.measurements.noReadings} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>{uz.app.date}</th><th>Qiymat</th><th>{uz.measurements.pulse}</th></tr>
                  </thead>
                  <tbody>
                    {data.blood_pressure.map((reading) => (
                      <tr key={reading.id} style={{ cursor: 'default' }}>
                        <td>{formatDateTime(reading.measured_at)}</td>
                        <td className="strong">{reading.systolic} / {reading.diastolic} mmHg</td>
                        <td>{reading.pulse ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`💬 ${uz.measurements.symptoms}`} flush>
            {data.symptoms.length === 0 ? <Empty icon="💬" title={uz.measurements.noReadings} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{uz.app.date}</th><th>Holat</th><th>Belgilar</th></tr></thead>
                  <tbody>
                    {data.symptoms.map((check) => {
                      const symptoms: string[] = Array.isArray(check.symptoms)
                        ? check.symptoms
                        : JSON.parse(check.symptoms || '[]')
                      return (
                        <tr key={check.id} style={{ cursor: 'default' }}>
                          <td>{formatDateTime(check.reported_at)}</td>
                          <td>
                            <Badge tone={check.feeling === 'good' ? 'stable' : check.feeling === 'bad' ? 'urgent' : 'attention'}>
                              {uz.symptoms[check.feeling]}
                            </Badge>
                          </td>
                          <td className="small">
                            {symptoms.length
                              ? symptoms.map((key) => uz.symptoms.list[key as keyof typeof uz.symptoms.list] ?? key).join(', ')
                              : '—'}
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
      ) : null}

      {tab === 'alerts' ? (
        <Card title={uz.patientProfile.alerts} flush>
          {data.alerts.length === 0 ? (
            <Empty icon="✅" title={uz.patientProfile.noAlerts} />
          ) : (
            data.alerts.map((alert) => (
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
            ))
          )}
        </Card>
      ) : null}

      {tab === 'people' ? (
        <Card title={uz.patientProfile.caregivers} subtitle={uz.caregiver.accessNote} flush>
          {data.caregivers.length === 0 ? (
            <Empty icon="👨‍👩‍👦" title={uz.profile.noCaregivers} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{uz.profile.fullName}</th>
                    <th>{uz.register.caregiverRelation}</th>
                    <th>{uz.profile.phone}</th>
                    <th>{uz.patientProfile.permissions}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.caregivers.map((caregiver) => (
                    <tr key={caregiver.id} style={{ cursor: 'default' }}>
                      <td className="strong">{caregiver.full_name}</td>
                      <td>{caregiver.relation ?? '—'}</td>
                      <td>{caregiver.phone}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {Object.entries(caregiver.permissions)
                            .filter(([, allowed]) => allowed)
                            .map(([key]) => (
                              <Badge key={key} tone="teal">
                                {uz.permissions[key as keyof typeof uz.permissions]}
                              </Badge>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}
