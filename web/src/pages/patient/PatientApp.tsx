import { Route, Routes } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useNotifications } from '../../lib/hooks'
import { PatientLayout } from '../../components/Layout'
import { PatientHomePage } from './PatientHomePage'
import { PatientMedicationsPage } from './PatientMedicationsPage'
import { PatientMeasurementsPage } from './PatientMeasurementsPage'
import { PatientAlertsPage } from './PatientAlertsPage'
import { HamshiraChat } from '../../components/HamshiraChat'
import { PatientProfilePage } from './PatientProfilePage'

const BASE = '/bemor'

export function PatientApp() {
  const { unread } = useNotifications(true)

  const items = [
    { to: BASE, label: uz.nav.patient.home, icon: '🏠' },
    { to: `${BASE}/dorilarim`, label: uz.nav.patient.medications, icon: '💊' },
    { to: `${BASE}/olchovlarim`, label: uz.nav.patient.measurements, icon: '🩸' },
    { to: `${BASE}/ogohlantirishlar`, label: uz.nav.patient.alerts, icon: '🔔', badge: unread },
    { to: `${BASE}/profil`, label: uz.nav.patient.profile, icon: '👤' },
  ]

  return (
    <PatientLayout items={items}>
      <HamshiraChat />
      <Routes>
        <Route index element={<PatientHomePage />} />
        <Route path="dorilarim" element={<PatientMedicationsPage />} />
        <Route path="olchovlarim" element={<PatientMeasurementsPage />} />
        <Route path="ogohlantirishlar" element={<PatientAlertsPage />} />
        <Route path="profil" element={<PatientProfilePage />} />
        <Route path="*" element={<PatientHomePage />} />
      </Routes>
    </PatientLayout>
  )
}
