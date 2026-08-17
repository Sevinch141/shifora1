export type Role = 'nurse' | 'doctor' | 'hospital_admin' | 'patient' | 'caregiver'
export type PatientStatus = 'stable' | 'attention' | 'urgent'
export type Severity = 'info' | 'warning' | 'urgent'
export type AlertState = 'new' | 'in_review' | 'contacted' | 'closed'
export type Priority = 'normal' | 'important' | 'critical'
export type DiabetesType = 'type1' | 'type2' | 'other'
export type MeasurementContext = 'fasting' | 'before_meal' | 'after_meal' | 'bedtime' | 'any'

export interface User {
  id: number
  hospital_id: number | null
  role: Role
  full_name: string
  phone: string
  language: string
}

export interface AuthContextPayload {
  hospital: { id: number; name: string; region: string } | null
  patient: PatientRecord | null
  patients: { id: number; first_name: string; last_name: string; relation: string }[]
}

export interface PatientRecord {
  id: number
  hospital_id: number
  user_id: number | null
  first_name: string
  last_name: string
  birth_date: string
  gender: 'male' | 'female'
  phone: string
  address: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  status: PatientStatus
  discharge_date: string | null
}

export interface PatientListItem {
  id: number
  first_name: string
  last_name: string
  phone: string
  status: PatientStatus
  diabetes_type: DiabetesType | null
  adherence: number | null
  last_glucose: { value: number; measured_at: string } | null
  last_activity: string | null
  open_alerts: number
  has_urgent_alert: boolean
}

export interface MedicationSchedule {
  id: number
  time_of_day: string
  label: string | null
}

export interface Medication {
  id: number
  name: string
  dose: string
  unit: string
  doses_per_day: number
  schedule_type: string
  priority: Priority
  start_date: string | null
  end_date: string | null
  notes: string | null
  schedules: MedicationSchedule[]
}

export interface MonitoringConfig {
  id: number
  type: 'glucose' | 'blood_pressure' | 'symptom'
  enabled: number
  frequency_per_day: number
  notes: string | null
  times: { id: number; time_of_day: string; context: MeasurementContext }[]
}

export interface AlertRule {
  id: number
  code: string
  enabled: number
  comparator: string | null
  value_1: number | null
  value_2: number | null
  severity: Severity
  message_uz: string
}

export interface CarePlan {
  id: number
  patient_id: number
  version: number
  status: 'draft' | 'active' | 'archived'
  source: string
  start_date: string | null
  end_date: string | null
  notes: string | null
  reminder_repeat_minutes: number
  reminder_max_count: number
  snooze_minutes: number
  escalate_normal_minutes: number
  escalate_important_minutes: number
  escalate_critical_minutes: number
  approved_at: string | null
  medications: Medication[]
  monitoring: MonitoringConfig[]
  rules: AlertRule[]
  approver: { id: number; full_name: string; role: Role } | null
}

export interface AlertItem {
  id: number
  patient_id: number
  first_name?: string
  last_name?: string
  rule_code: string
  severity: Severity
  title: string
  detail: string
  status: AlertState
  assigned_user_id: number | null
  assigned_name: string | null
  created_at: string
  elapsed: string
  context: Record<string, unknown> | null
  phone?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  notes?: { id: number; note: string; full_name: string; created_at: string }[]
}

export interface PlanItem {
  kind: 'medication' | 'glucose' | 'blood_pressure' | 'symptom'
  id: number
  time: string
  scheduled_at: string
  status: 'pending' | 'taken' | 'snoozed' | 'missed' | 'done'
  title?: string
  priority?: Priority
  note?: string | null
  context?: MeasurementContext
  taken_at?: string | null
  snoozed_until?: string | null
}

export interface DailyPlan {
  date: string
  items: PlanItem[]
  summary: {
    total: number
    done: number
    pending: number
    missed: number
    medications_total: number
    medications_done: number
    complete: boolean
  }
}

export interface GlucoseReading {
  id: number
  value: number
  unit: string
  context: MeasurementContext
  measured_at: string
  note: string | null
}

export interface BloodPressureReading {
  id: number
  systolic: number
  diastolic: number
  pulse: number | null
  measured_at: string
  note: string | null
}

export interface SymptomCheck {
  id: number
  feeling: 'good' | 'not_good' | 'bad'
  symptoms: string[] | string
  note: string | null
  reported_at: string
}

export interface AiInsight {
  kind: string
  tone: 'positive' | 'neutral' | 'warning'
  text: string
}

export interface AiCarePlanSuggestion {
  provider: string
  summary: string
  disclaimer: string
  reasons: string[]
  monitoring: {
    type: 'glucose' | 'blood_pressure' | 'symptom'
    enabled: boolean
    frequency_per_day: number
    times: { time_of_day: string; context: MeasurementContext }[]
  }[]
  reminders: Record<string, number>
  medications: {
    name: string
    schedule_type: string
    schedule_label: string
    times: string[]
    priority: Priority
    note: string | null
  }[]
}

export interface NotificationItem {
  id: number
  type: string
  title: string
  body: string
  read_at: string | null
  created_at: string
  entity_type: string | null
  entity_id: number | null
}
