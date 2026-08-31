import { useNavigate } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useAuth } from '../../lib/auth'
import { Button, Card, Notice } from '../../components/ui'

/**
 * The caregiver's own account screen.
 *
 * It exists mainly so there is somewhere to sign out from: the caregiver tab
 * bar had no profile tab, and the header only renders on the home screen, so
 * the session could not be ended from anywhere in the interface.
 *
 * The watched patients come from the session rather than CaregiverApp's
 * context, so this screen also renders for a caregiver who has no patient
 * attached yet — the one case where the rest of the interface is unavailable
 * and signing out matters most.
 */
export function CaregiverProfilePage() {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const patients = session?.context.patients ?? []

  return (
    <div className="content stack">
      <h1>{uz.caregiver.profileTitle}</h1>

      <Card title={uz.caregiver.account}>
        <dl className="kv">
          <dt>{uz.profile.fullName}</dt>
          <dd>{session?.user.full_name ?? '—'}</dd>
          <dt>{uz.profile.phone}</dt>
          <dd>{session?.user.phone ?? '—'}</dd>
        </dl>
      </Card>

      <Card title={uz.caregiver.watchedPatients}>
        {patients.length === 0 ? (
          <p className="muted">{uz.caregiver.noPatients}</p>
        ) : (
          <dl className="kv">
            {patients.map((patient) => (
              <div key={patient.id} style={{ display: 'contents' }}>
                <dt>{patient.relation ?? uz.roles.caregiverRole}</dt>
                <dd>{patient.last_name} {patient.first_name}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>{uz.caregiver.permissionsNote}</p>
      </Card>

      <Notice tone="info">{uz.login.safetyNote}</Notice>

      <Button size="lg" block onClick={async () => { await logout(); navigate('/') }}>
        {uz.app.logout}
      </Button>
    </div>
  )
}
