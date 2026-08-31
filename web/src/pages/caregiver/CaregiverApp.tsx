import { createContext, useContext, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useApi, useNotifications } from '../../lib/hooks'
import { PatientLayout } from '../../components/Layout'
import { Card, Empty, Loading, Select } from '../../components/ui'
import { CaregiverHomePage } from './CaregiverHomePage'
import { CaregiverCarePage } from './CaregiverCarePage'
import { CaregiverStatusPage } from './CaregiverStatusPage'
import { CaregiverAlertsPage } from './CaregiverAlertsPage'
import { CaregiverProfilePage } from './CaregiverProfilePage'

const BASE = '/yaqin'

export interface CaregiverPatientSummary {
  id: number
  first_name: string
  last_name: string
  relation: string | null
  status: 'stable' | 'attention' | 'urgent'
  phone: string
  permissions: Record<string, boolean>
  today: {
    medications_done: number
    medications_total: number
    complete: boolean
    pending: number
    missed: number
  } | null
  adherence: number | null
  open_alerts: number | null
}

interface CaregiverContextValue {
  patients: CaregiverPatientSummary[]
  patient: CaregiverPatientSummary
  setPatientId: (id: number) => void
}

const CaregiverContext = createContext<CaregiverContextValue | null>(null)

export function useCaregiverPatient() {
  const ctx = useContext(CaregiverContext)
  if (!ctx) throw new Error('useCaregiverPatient must be used inside CaregiverApp')
  return ctx
}

/** Shown above every screen when a caregiver looks after more than one person. */
export function PatientSwitcher() {
  const { patients, patient, setPatientId } = useCaregiverPatient()
  if (patients.length < 2) return null
  return (
    <Select value={patient.id} onChange={(e) => setPatientId(Number(e.target.value))}>
      {patients.map((item) => (
        <option key={item.id} value={item.id}>{item.last_name} {item.first_name}</option>
      ))}
    </Select>
  )
}

export function CaregiverApp() {
  const { unread } = useNotifications(true)
  const { data, loading } = useApi<{ patients: CaregiverPatientSummary[] }>('/caregiver/patients')
  const [patientId, setPatientId] = useState<number | null>(null)

  useEffect(() => {
    if (data && data.patients.length > 0 && patientId === null) setPatientId(data.patients[0].id)
  }, [data, patientId])

  const items = [
    { to: BASE, label: uz.nav.caregiver.home, icon: '🏠' },
    { to: `${BASE}/parvarish`, label: uz.nav.caregiver.care, icon: '📋' },
    { to: `${BASE}/holat`, label: uz.nav.caregiver.status, icon: '📈' },
    { to: `${BASE}/ogohlantirishlar`, label: uz.nav.caregiver.alerts, icon: '🔔', badge: unread },
    { to: `${BASE}/profil`, label: uz.nav.caregiver.profile, icon: '👤' },
  ]

  if (loading) return <PatientLayout items={items}><div className="content"><Loading /></div></PatientLayout>

  const patient = data?.patients.find((p) => p.id === patientId) ?? data?.patients[0]

  if (!patient) {
    return (
      <PatientLayout items={items}>
        {/* Routed even with no patient attached, so signing out stays reachable. */}
        <Routes>
          <Route path="profil" element={<CaregiverProfilePage />} />
          <Route
            path="*"
            element={(
              <div className="content">
                <Card><Empty icon="👨‍👩‍👦" title={uz.caregiver.noPatients} /></Card>
              </div>
            )}
          />
        </Routes>
      </PatientLayout>
    )
  }

  return (
    <CaregiverContext.Provider value={{ patients: data?.patients ?? [], patient, setPatientId }}>
      <PatientLayout items={items}>
        <Routes>
          <Route index element={<CaregiverHomePage />} />
          <Route path="parvarish" element={<CaregiverCarePage />} />
          <Route path="holat" element={<CaregiverStatusPage />} />
          <Route path="ogohlantirishlar" element={<CaregiverAlertsPage />} />
          <Route path="profil" element={<CaregiverProfilePage />} />
          <Route path="*" element={<CaregiverHomePage />} />
        </Routes>
      </PatientLayout>
    </CaregiverContext.Provider>
  )
}
