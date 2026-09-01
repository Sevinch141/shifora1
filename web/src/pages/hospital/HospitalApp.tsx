import { Route, Routes, useLocation } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/hooks'
import { SidebarLayout } from '../../components/Layout'
import { DashboardPage } from './DashboardPage'
import { PatientListPage } from './PatientListPage'
import { RegisterPatientPage } from './RegisterPatientPage'
import { CarePlansPage } from './CarePlansPage'
import { AlertCenterPage } from './AlertCenterPage'
import { ReportsPage } from './ReportsPage'
import { QuestionsPage } from './QuestionsPage'
import { PatientProfilePage } from './PatientProfilePage'

const BASE = '/shifoxona'

const TITLES: { match: RegExp; title: string }[] = [
  { match: /^\/shifoxona\/bemorlar\/\d+/, title: uz.patientProfile.title },
  { match: /^\/shifoxona\/bemorlar/, title: uz.nav.hospital.patients },
  { match: /^\/shifoxona\/royxat/, title: uz.nav.hospital.register },
  { match: /^\/shifoxona\/rejalar/, title: uz.nav.hospital.carePlans },
  { match: /^\/shifoxona\/ogohlantirishlar/, title: uz.nav.hospital.alerts },
  { match: /^\/shifoxona\/savollar/, title: uz.nav.hospital.questions },
  { match: /^\/shifoxona\/hisobotlar/, title: uz.nav.hospital.reports },
  { match: /^\/shifoxona/, title: uz.nav.hospital.home },
]

export function HospitalApp() {
  const { session } = useAuth()
  const location = useLocation()
  const { data: stats } = useApi<{ urgent: number; open_alerts: number; open_questions: number }>('/patients/stats')

  const title = TITLES.find((entry) => entry.match.test(location.pathname))?.title ?? uz.app.name

  const items = [
    { to: BASE, label: uz.nav.hospital.home, icon: '🏠' },
    { to: `${BASE}/bemorlar`, label: uz.nav.hospital.patients, icon: '👥' },
    { to: `${BASE}/royxat`, label: uz.nav.hospital.register, icon: '➕' },
    { to: `${BASE}/rejalar`, label: uz.nav.hospital.carePlans, icon: '📋' },
    { to: `${BASE}/ogohlantirishlar`, label: uz.nav.hospital.alerts, icon: '🔔', badge: stats?.open_alerts },
    { to: `${BASE}/savollar`, label: uz.nav.hospital.questions, icon: '💬', badge: stats?.open_questions },
    { to: `${BASE}/hisobotlar`, label: uz.nav.hospital.reports, icon: '📊' },
  ]

  return (
    <SidebarLayout
      items={items}
      title={title}
      subtitle={session?.context.hospital?.name}
    >
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="bemorlar" element={<PatientListPage />} />
        <Route path="bemorlar/:id" element={<PatientProfilePage />} />
        <Route path="royxat" element={<RegisterPatientPage />} />
        <Route path="rejalar" element={<CarePlansPage />} />
        <Route path="ogohlantirishlar" element={<AlertCenterPage />} />
        <Route path="savollar" element={<QuestionsPage />} />
        <Route path="hisobotlar" element={<ReportsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </SidebarLayout>
  )
}
