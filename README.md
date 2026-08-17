# Shifora

**Diabet bemorlarini shifoxonadan keyin kuzatish tizimi** — a hospital-to-home
diabetes monitoring MVP. The entire user interface is in Uzbek; code, tables and
API routes are in English.

The product answers one question:

> After a diabetes patient leaves the hospital, how does the care team know
> whether the patient is following the approved plan, and whether something
> needs attention?

## 📊 Project Presentation

The full project presentation is available here:

**[Shifora — Project Presentation (PDF)](Shifora.pdf)**

It covers the problem, the product, and how the platform works. GitHub renders
the file in the browser; use the download button there to save a copy.

## Medical safety boundaries

These are enforced by the design, not just documented:

- The platform **does not diagnose**, prescribe, or change a dose.
- AI is a **suggestion layer only**. Every AI output is labelled **"AI tavsiyasi"**
  and cannot become active on its own — a nurse or doctor must approve the plan.
- Clinical thresholds, escalation windows and medication priority are **per-patient
  configuration approved by staff**, never universal constants in code.
- Reminders and escalation are handled by a **deterministic rules engine**, not AI.
- The platform never tells a patient to take an extra dose. It reminds, records,
  and escalates to a human.
- Manual entry only. No fake device data: CGM/wearable integration is declared as
  planned, and the code has an empty provider registry ready for a real one.

## Running it

Two processes. From the project root:

```bash
cd server && npm install && npm run seed && npm start
```

```bash
cd web && npm install && npm run dev
```

Then open http://localhost:5173. The API runs on port 4000; the dev server
proxies `/api` to it.

To rebuild the demo hospital from scratch at any time:

```bash
cd server && npm run reset
```

For a single-process deployment, build the client first — the API then serves it:

```bash
cd web && npm run build && cd ../server && npm start
```

## Demo accounts

| Rol | Telefon | Parol |
| --- | --- | --- |
| Hamshira (Dilnoza Rahimova) | `901112233` | `hamshira` |
| Shifokor (Anvar Qodirov) | `901112244` | `shifokor` |
| Administrator (Nodira Yusupova) | `901112255` | `admin` |
| Bemor (Zilola Karimova) | `901234567` | `bemor` |
| Bemor (Bahodir To'xtayev) | `901234570` | `bemor` |
| Yaqin kishi (Sardor Karimov) | `901234568` | `yaqin` |
| Yaqin kishi (Nilufar To'xtayeva) | `901234571` | `yaqin` |

The login screen lists these too — clicking one fills the form.

The seed builds one hospital with 128 patients. Their statuses, adherence figures
and alerts are **not written in by hand**: the seed generates 14 days of history
and runs it through the real care-plan approval and alert-engine code, so the
dashboard shows what the running system would actually produce.

## Architecture

One backend, one database, three role-specific interfaces.

```
server/                     Node 20+ / Express, no build step
  src/db/schema.sql         Full relational schema
  src/db/seed.js            Demo hospital, generated through the real services
  src/lib/                  auth (scrypt + opaque session tokens), time, audit
  src/middleware/           requireAuth / requireRole / requireHospitalStaff
  src/services/
    access.js               Central patient-access gate for every role
    carePlan.js             Versioning, approval, task materialisation
    alertEngine.js          Deterministic rules, thresholds, escalation
    scheduler.js            Reminder + escalation loop (60s tick)
    aiService.js            Suggestion provider interface + local heuristic
    devices.js              Device integration registry (intentionally empty)
    reporting.js            Adherence / report aggregation
  src/routes/               REST API under /api

web/                        React + TypeScript + Vite
  src/lib/uz.ts             Every user-facing string, in one file
  src/components/           Shared UI, measurement forms, inline SVG charts
  src/pages/hospital/       Dashboard, patients, registration wizard, plans,
                            alert centre, reports, patient profile
  src/pages/patient/        Today's plan, medications, measurements, alerts, profile
  src/pages/caregiver/      Home, care, status, alerts
```

Storage is SQLite via Node's built-in `node:sqlite` — no native dependency to
compile. The data model is plain relational SQL and ports to PostgreSQL directly.

### Roles and routing

One authentication system with role-based routing. The landing screen only picks
which roles may sign in there; the user's role decides the destination:

| Rol | Marshrut |
| --- | --- |
| `nurse` / `doctor` / `hospital_admin` | `/shifoxona` |
| `patient` | `/bemor` |
| `caregiver` | `/yaqin` |

### Care plan lifecycle

A patient has at most one **active** plan. Editing never mutates it — a new draft
version is created, approved by a professional, and only then replaces the
previous one, which is archived alongside an immutable JSON snapshot recording
who approved it and when. Superseded future tasks are removed; history is kept.

### Alert engine

Thresholds live in `alert_rules`, scoped to a care plan and approved by staff.
The engine compares measurements against *those* values and hands the result to a
human. While an alert is open it is updated rather than duplicated; closing it
frees the dedup key so a genuine recurrence raises a fresh alert.

Escalation windows come from the care plan, per medication priority
(`Oddiy` / `Muhim` / `Juda muhim`). Nothing is hard-coded.

### Security

- Role-based access checked **server-side on every route** — never by hiding UI.
- Hospital-level isolation: staff cannot read another hospital's patients, plans,
  alerts or AI summaries.
- Caregiver access is explicit and permission-scoped (`caregiver_permissions`).
  Nothing about the medical record is exposed by default; ungranted fields come
  back as `null`, and the underlying endpoints refuse the request outright.
- Passwords hashed with scrypt; sessions are opaque, expiring tokens.
- `audit_logs` records logins, registrations, plan approvals, chart views,
  measurement entries, alert actions and AI usage.

### Extending it

- **Devices** — implement the `DeviceProvider` interface in `services/devices.js`
  and register it. Readings already carry a `source` column (`manual` today) and
  `device_ref`, so nothing in the schema changes.
- **AI** — register a provider with `registerAiProvider(name, provider)` and set
  `SHIFORA_AI_PROVIDER`. The approval workflow stays the same by construction.
- **Notifications** — `registerChannel(name, deliver)` in `services/notifications.js`
  adds SMS / Telegram / push next to the in-app channel.
- **Languages** — every string lives in `web/src/lib/uz.ts`.

## Uzbek terminology

Bemor · Hamshira · Shifokor · Shifoxona · Dori · Dori qabul qilish jadvali ·
Davolash va kuzatuv rejasi · Glyukoza · Qon bosimi · Belgi · Ogohlantirish ·
Eslatma · Davolashga rioya qilish · Gipoglikemiya · Giperglikemiya · Glyukometr

Patient status is a **monitoring workflow state, not a diagnosis**, and is always
shown as icon + word so it never depends on colour alone:

🟢 Barqaror · 🟡 E'tibor kerak · 🔴 Shoshilinch ko'rib chiqish
