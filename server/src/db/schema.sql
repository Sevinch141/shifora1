-- Shifora — post-discharge diabetes monitoring platform
-- Relational schema. All clinical records carry created_at / updated_at / created_by.
-- Records that require clinical sign-off also carry approved_by / approved_at.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Organisations and identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hospitals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  region        TEXT,
  phone         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- role: hospital_admin | doctor | nurse | patient | caregiver
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
  role          TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'uz',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_users_hospital ON users(hospital_id);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------

-- status: stable | attention | urgent  (monitoring workflow status, NOT a diagnosis)
CREATE TABLE IF NOT EXISTS patients (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id             INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  birth_date              TEXT,
  gender                  TEXT,
  phone                   TEXT NOT NULL,
  address                 TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  language                TEXT NOT NULL DEFAULT 'uz',
  status                  TEXT NOT NULL DEFAULT 'stable',
  discharge_date          TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  created_by              INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_patients_hospital ON patients(hospital_id);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(hospital_id, status);

-- diabetes_type: type1 | type2 | other
CREATE TABLE IF NOT EXISTS diabetes_profiles (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id             INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  diabetes_type          TEXT NOT NULL,
  diagnosis_date         TEXT,
  hba1c                  REAL,
  recent_hospitalization INTEGER NOT NULL DEFAULT 0,
  prior_hypoglycemia     INTEGER NOT NULL DEFAULT 0,
  clinical_notes         TEXT,
  cgm_enabled            INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  created_by             INTEGER REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Caregivers — access is explicit and permission-scoped
-- ---------------------------------------------------------------------------

-- status: pending | active | revoked
CREATE TABLE IF NOT EXISTS caregivers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  authorized_by  INTEGER REFERENCES users(id),
  authorized_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  UNIQUE (patient_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_caregivers_user ON caregivers(user_id);

-- permission_key: view_today_plan | view_adherence | view_alerts
--                 | view_measurements | view_care_plan | view_clinical_notes
CREATE TABLE IF NOT EXISTS caregiver_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id   INTEGER NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  UNIQUE (caregiver_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- Care plan — versioned, never overwritten
-- ---------------------------------------------------------------------------

-- status: draft | active | archived
-- source: manual | ai_assisted
CREATE TABLE IF NOT EXISTS care_plans (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id                INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version                   INTEGER NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'draft',
  source                    TEXT NOT NULL DEFAULT 'manual',
  start_date                TEXT,
  end_date                  TEXT,
  notes                     TEXT,
  -- Reminder / escalation configuration. Nothing here is hard-coded in logic.
  reminder_repeat_minutes   INTEGER NOT NULL DEFAULT 30,
  reminder_max_count        INTEGER NOT NULL DEFAULT 2,
  snooze_minutes            INTEGER NOT NULL DEFAULT 15,
  escalate_normal_minutes   INTEGER NOT NULL DEFAULT 240,
  escalate_important_minutes INTEGER NOT NULL DEFAULT 120,
  escalate_critical_minutes INTEGER NOT NULL DEFAULT 60,
  approved_by               INTEGER REFERENCES users(id),
  approved_at               TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  created_by                INTEGER REFERENCES users(id),
  UNIQUE (patient_id, version)
);
CREATE INDEX IF NOT EXISTS idx_care_plans_patient ON care_plans(patient_id, status);

-- Immutable snapshot of the plan at the moment it was approved (audit trail).
CREATE TABLE IF NOT EXISTS care_plan_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  care_plan_id  INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_reason TEXT,
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cpv_patient ON care_plan_versions(patient_id);

-- priority: normal | important | critical  (set by authorised staff, never by AI)
-- schedule_type: morning | morning_noon | morning_evening | noon | noon_evening
--                | evening | bedtime | every_8h | every_12h | as_needed | custom
CREATE TABLE IF NOT EXISTS medications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  care_plan_id  INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  dose          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'mg',
  doses_per_day INTEGER NOT NULL DEFAULT 1,
  schedule_type TEXT NOT NULL DEFAULT 'morning',
  priority      TEXT NOT NULL DEFAULT 'normal',
  start_date    TEXT,
  end_date      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_medications_plan ON medications(care_plan_id);

-- The schedule preset ("Ertalab") and the actual reminder clock time are separate.
CREATE TABLE IF NOT EXISTS medication_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id  INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  time_of_day    TEXT NOT NULL,          -- 'HH:MM' — configured by the nurse
  label          TEXT,                   -- optional note e.g. "ovqatdan keyin"
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_med_sched_med ON medication_schedules(medication_id);

-- type: glucose | blood_pressure | symptom
CREATE TABLE IF NOT EXISTS monitoring_configs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  care_plan_id      INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  frequency_per_day INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        INTEGER REFERENCES users(id),
  UNIQUE (care_plan_id, type)
);

-- context: fasting | before_meal | after_meal | bedtime | any
CREATE TABLE IF NOT EXISTS monitoring_times (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  monitoring_config_id INTEGER NOT NULL REFERENCES monitoring_configs(id) ON DELETE CASCADE,
  time_of_day          TEXT NOT NULL,
  context              TEXT NOT NULL DEFAULT 'any',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by           INTEGER REFERENCES users(id)
);

-- Clinical thresholds are per care plan, editable and approved by staff.
-- code: glucose_low | glucose_high | glucose_critical_low | glucose_critical_high
--       | bp_high | bp_critical_high | symptom_bad | medication_missed
-- severity: info | warning | urgent
CREATE TABLE IF NOT EXISTS alert_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  care_plan_id  INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  comparator    TEXT,                    -- 'lt' | 'gt' | 'eq'
  value_1       REAL,
  value_2       REAL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  message_uz    TEXT NOT NULL,
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id),
  UNIQUE (care_plan_id, code)
);

-- ---------------------------------------------------------------------------
-- Generated task instances (what the patient actually sees each day)
-- ---------------------------------------------------------------------------

-- status: pending | taken | snoozed | missed | skipped
CREATE TABLE IF NOT EXISTS medication_doses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id      INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  medication_id     INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id       INTEGER REFERENCES medication_schedules(id) ON DELETE SET NULL,
  scheduled_at      TEXT NOT NULL,       -- ISO local 'YYYY-MM-DD HH:MM'
  status            TEXT NOT NULL DEFAULT 'pending',
  taken_at          TEXT,
  snoozed_until     TEXT,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  last_reminder_at  TEXT,
  escalated_at      TEXT,
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        INTEGER REFERENCES users(id),
  UNIQUE (medication_id, scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_doses_patient_time ON medication_doses(patient_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_doses_status ON medication_doses(status, scheduled_at);

-- type: glucose | blood_pressure | symptom ; status: pending | done | missed
CREATE TABLE IF NOT EXISTS monitoring_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id     INTEGER NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  context          TEXT NOT NULL DEFAULT 'any',
  scheduled_at     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  completed_at     TEXT,
  record_id        INTEGER,             -- id of the reading/check that fulfilled it
  reminder_count   INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id),
  UNIQUE (care_plan_id, type, scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_mtasks_patient_time ON monitoring_tasks(patient_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Measurements — manual entry today; `source` keeps device import open later
-- ---------------------------------------------------------------------------

-- source: manual | glucometer | cgm | wearable   (only 'manual' is implemented)
CREATE TABLE IF NOT EXISTS glucose_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  value        REAL NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'mg/dL',
  context      TEXT NOT NULL DEFAULT 'any',   -- fasting | before_meal | after_meal | bedtime | any
  measured_at  TEXT NOT NULL,
  note         TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  device_ref   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_glucose_patient ON glucose_readings(patient_id, measured_at);

CREATE TABLE IF NOT EXISTS blood_pressure_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  systolic     INTEGER NOT NULL,
  diastolic    INTEGER NOT NULL,
  pulse        INTEGER,
  measured_at  TEXT NOT NULL,
  note         TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  device_ref   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bp_patient ON blood_pressure_readings(patient_id, measured_at);

-- feeling: good | not_good | bad
CREATE TABLE IF NOT EXISTS symptom_checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  feeling      TEXT NOT NULL,
  symptoms     TEXT NOT NULL DEFAULT '[]',   -- JSON array of symptom keys
  note         TEXT,
  reported_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_symptoms_patient ON symptom_checks(patient_id, reported_at);

-- ---------------------------------------------------------------------------
-- Notifications and alerts
-- ---------------------------------------------------------------------------

-- channel: in_app  (sms / telegram / push providers can register later)
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id   INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL DEFAULT 'in_app',
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  read_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

-- severity: info | warning | urgent  → Ma'lumot | E'tibor kerak | Shoshilinch
-- status:   new | in_review | contacted | closed
CREATE TABLE IF NOT EXISTS alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id      INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id     INTEGER REFERENCES care_plans(id) ON DELETE SET NULL,
  rule_code        TEXT NOT NULL,
  severity         TEXT NOT NULL,
  title            TEXT NOT NULL,
  detail           TEXT,
  context_json     TEXT,
  status           TEXT NOT NULL DEFAULT 'new',
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedup_key        TEXT,
  resolved_at      TEXT,
  resolved_by      INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_alerts_hospital ON alerts(hospital_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup ON alerts(dedup_key) WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id    INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes(alert_id);

-- ---------------------------------------------------------------------------
-- AI decision support — suggestions only, always reviewed before use
-- ---------------------------------------------------------------------------

-- kind: care_plan | adherence_summary | glucose_trend | general_summary
-- status: suggested | accepted | modified | rejected
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id INTEGER REFERENCES care_plans(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'local_heuristic',
  summary      TEXT NOT NULL,
  payload_json TEXT,
  status       TEXT NOT NULL DEFAULT 'suggested',
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ai_patient ON ai_recommendations(patient_id, created_at);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  meta_json   TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
