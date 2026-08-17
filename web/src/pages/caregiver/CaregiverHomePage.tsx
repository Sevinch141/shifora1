import { useState } from 'react'
import { uz } from '../../lib/uz'
import { api, ApiError } from '../../lib/api'
import { Button, Card, Modal, Notice, StatusBadge, Textarea } from '../../components/ui'
import { PatientSwitcher, useCaregiverPatient } from './CaregiverApp'

export function CaregiverHomePage() {
  const { patient } = useCaregiverPatient()
  const [contactOpen, setContactOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendToNurse() {
    if (!message.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/caregiver/patients/${patient.id}/contact-nurse`, { message })
      setContactOpen(false)
      setMessage('')
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  const today = patient.today
  const hasProblem = (today?.missed ?? 0) > 0 || patient.status === 'urgent'

  return (
    <>
      <div className="patient-header">
        <div className="patient-header__greeting">{uz.caregiver.title}</div>
        <div className="patient-header__name">{patient.last_name} {patient.first_name}</div>
        <div className="patient-header__label">{patient.relation ?? uz.roles.caregiverRole}</div>
      </div>

      <div className="content stack">
        <PatientSwitcher />

        {sent ? <Notice tone="success">{uz.caregiver.sent}</Notice> : null}

        <Card>
          <div className="row--between">
            <span className="strong">{uz.status.label}</span>
            <StatusBadge status={patient.status} size="lg" />
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>{uz.status.note}</p>
        </Card>

        {hasProblem ? (
          <Notice tone="danger">⚠️ {uz.caregiver.importantProblem}</Notice>
        ) : null}

        {patient.permissions.view_today_plan && today ? (
          <Card title={uz.caregiver.todayPlan}>
            <div className="stack--sm">
              <div className="row--between">
                <span>{uz.caregiver.todayMedications}</span>
                <span className="strong" style={{ fontSize: '1.2rem' }}>
                  {today.medications_done} / {today.medications_total}
                </span>
              </div>
              <div className="row--between">
                <span>{uz.caregiver.todayPlan}</span>
                <span className={`badge badge--${today.complete ? 'stable' : 'attention'} badge--lg`}>
                  <span aria-hidden>{today.complete ? '✅' : '🕒'}</span>
                  {today.complete ? uz.caregiver.planDone : uz.caregiver.planInProgress}
                </span>
              </div>
              {today.missed > 0 ? (
                <div className="row--between">
                  <span>{uz.patientHome.missed}</span>
                  <span className="badge badge--urgent badge--lg">
                    <span aria-hidden>⚠️</span> {today.missed}
                  </span>
                </div>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card><p className="muted">{uz.caregiver.noAccess}</p></Card>
        )}

        {patient.permissions.view_adherence && patient.adherence !== null ? (
          <Card>
            <div className="row--between">
              <span>{uz.caregiver.adherence7d}</span>
              <span className="strong" style={{ fontSize: '1.3rem' }}>{patient.adherence}%</span>
            </div>
          </Card>
        ) : null}

        <div className="stack--sm">
          <a href={`tel:${patient.phone}`} style={{ textDecoration: 'none' }}>
            <Button size="lg" block variant="primary">📞 {uz.caregiver.contactPatient}</Button>
          </a>
          <Button size="lg" block onClick={() => setContactOpen(true)}>
            🏥 {uz.caregiver.contactNurse}
          </Button>
        </div>

        <Notice tone="info">{uz.caregiver.accessNote}</Notice>
      </div>

      {contactOpen ? (
        <Modal
          title={uz.caregiver.contactNurseTitle}
          onClose={() => setContactOpen(false)}
          footer={
            <>
              <Button onClick={() => setContactOpen(false)}>{uz.app.cancel}</Button>
              <Button variant="primary" onClick={() => void sendToNurse()} disabled={busy || !message.trim()}>
                {uz.caregiver.send}
              </Button>
            </>
          }
        >
          <div className="stack">
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <p className="muted">{uz.caregiver.contactNurseBody}</p>
            <label className="field">
              <span className="field__label">{uz.caregiver.messageLabel}</span>
              <Textarea
                placeholder={uz.caregiver.messagePlaceholder}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
