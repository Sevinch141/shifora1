import { Navigate, Route, Routes } from 'react-router-dom'
import { HOSPITAL_ROLES, useAuth } from './lib/auth'
import { Loading } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { HospitalApp } from './pages/hospital/HospitalApp'
import { PatientApp } from './pages/patient/PatientApp'
import { CaregiverApp } from './pages/caregiver/CaregiverApp'

/** Where each role belongs after authentication. */
export function homePathFor(role: string): string {
  if (HOSPITAL_ROLES.includes(role)) return '/shifoxona'
  if (role === 'patient') return '/bemor'
  return '/yaqin'
}

export function App() {
  const { session, loading } = useAuth()

  if (loading) return <Loading />

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  const home = homePathFor(session.user.role)

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      {HOSPITAL_ROLES.includes(session.user.role) ? (
        <Route path="/shifoxona/*" element={<HospitalApp />} />
      ) : null}
      {session.user.role === 'patient' ? <Route path="/bemor/*" element={<PatientApp />} /> : null}
      {session.user.role === 'caregiver' ? <Route path="/yaqin/*" element={<CaregiverApp />} /> : null}
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}
