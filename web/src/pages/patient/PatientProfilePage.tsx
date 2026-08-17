import { useNavigate } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/hooks'
import { Button, Card, Loading, Notice } from '../../components/ui'
import type { PatientRecord } from '../../lib/types'
import { formatDate } from '../../lib/format'

interface Response {
  patient: PatientRecord
  profile: {
    diabetes_type: 'type1' | 'type2' | 'other'
    diagnosis_date: string | null
    cgm_enabled: number
  } | null
  hospital: { name: string; phone: string | null; region: string | null } | null
  care_plan: { version: number } | null
  caregivers: { relation: string | null; full_name: string; phone: string }[]
}

export function PatientProfilePage() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { data, loading } = useApi<Response>('/me/profile')

  if (loading || !data) return <div className="content"><Loading /></div>

  const { patient, profile, hospital } = data

  return (
    <div className="content stack">
      <h1>{uz.profile.title}</h1>

      <Card title={uz.profile.personal}>
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
        </dl>
      </Card>

      <Card title={uz.profile.diabetesInfo}>
        <dl className="kv">
          <dt>{uz.register.diabetesTypeLabel}</dt>
          <dd>{profile ? uz.diabetesType[profile.diabetes_type] : '—'}</dd>
          <dt>{uz.profile.diagnosisDate}</dt>
          <dd>{formatDate(profile?.diagnosis_date)}</dd>
          <dt>{uz.register.cgm}</dt>
          <dd>{profile?.cgm_enabled ? uz.register.cgmOn : uz.register.cgmOff}</dd>
          <dt>{uz.profile.carePlanVersion}</dt>
          <dd>{data.care_plan ? `v${data.care_plan.version}` : uz.carePlan.noPlan}</dd>
        </dl>
      </Card>

      <Card title={uz.profile.hospital}>
        <dl className="kv">
          <dt>{uz.profile.hospital}</dt>
          <dd>{hospital?.name ?? '—'}</dd>
          <dt>{uz.profile.phone}</dt>
          <dd>{hospital?.phone ?? '—'}</dd>
        </dl>
      </Card>

      <Card title={uz.profile.caregivers}>
        {data.caregivers.length === 0 ? (
          <p className="muted">{uz.profile.noCaregivers}</p>
        ) : (
          <dl className="kv">
            {data.caregivers.map((caregiver) => (
              <div key={caregiver.phone} style={{ display: 'contents' }}>
                <dt>{caregiver.relation ?? uz.roles.caregiverRole}</dt>
                <dd>{caregiver.full_name} · {caregiver.phone}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Notice tone="info">{uz.login.safetyNote}</Notice>

      <Button size="lg" block onClick={async () => { await logout(); navigate('/') }}>
        {uz.app.logout}
      </Button>
    </div>
  )
}
