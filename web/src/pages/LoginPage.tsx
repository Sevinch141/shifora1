import { useState } from 'react'
import { uz } from '../lib/uz'
import { useAuth } from '../lib/auth'
import type { RoleGroup } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Button, Card, Field, Input, Notice } from '../components/ui'

const ROLE_CARDS: { key: RoleGroup; icon: string; title: string; desc: string }[] = [
  { key: 'hospital', icon: '🏥', title: uz.roles.hospital, desc: uz.login.hospitalDesc },
  { key: 'patient', icon: '🧑', title: uz.roles.patient, desc: uz.login.patientDesc },
  { key: 'caregiver', icon: '👨‍👩‍👦', title: uz.roles.caregiver, desc: uz.login.caregiverDesc },
]

const DEMO_ACCOUNTS: Record<RoleGroup, { label: string; phone: string; password: string }[]> = {
  hospital: [
    { label: uz.roles.nurse, phone: '901112233', password: 'hamshira' },
    { label: uz.roles.doctor, phone: '901112244', password: 'shifokor' },
    { label: uz.roles.hospital_admin, phone: '901112255', password: 'admin' },
  ],
  patient: [
    { label: 'Zilola Karimova', phone: '901234567', password: 'bemor' },
    { label: 'Bahodir To‘xtayev', phone: '901234570', password: 'bemor' },
  ],
  caregiver: [
    { label: 'Sardor Karimov', phone: '901234568', password: 'yaqin' },
    { label: 'Nilufar To‘xtayeva', phone: '901234571', password: 'yaqin' },
  ],
}

export function LoginPage() {
  const { login } = useAuth()
  const [group, setGroup] = useState<RoleGroup | null>(null)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!group) return

    const errors: Record<string, string> = {}
    if (!phone.trim()) errors.phone = uz.validation.required
    if (!password) errors.password = uz.validation.required
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    setError(null)
    try {
      await login(phone.trim(), password, group)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__box stack">
        <div className="auth__brand">
          <div className="auth__logo"><span aria-hidden>🩺</span> {uz.app.name}</div>
          <p className="auth__tagline">{uz.app.tagline}</p>
        </div>

        {!group ? (
          <>
            <Card title={uz.login.chooseRole} subtitle={uz.login.chooseRoleHint}>
              <div className="stack--sm">
                {ROLE_CARDS.map((card) => (
                  <button key={card.key} className="role-card" onClick={() => setGroup(card.key)}>
                    <span className="role-card__icon" aria-hidden>{card.icon}</span>
                    <span>
                      <span className="role-card__title" style={{ display: 'block' }}>{card.title}</span>
                      <span className="role-card__desc">{card.desc}</span>
                    </span>
                    <span className="role-card__arrow" aria-hidden>›</span>
                  </button>
                ))}
              </div>
            </Card>
            <Notice tone="info">{uz.login.safetyNote}</Notice>
          </>
        ) : (
          <Card
            title={uz.login.title}
            subtitle={ROLE_CARDS.find((c) => c.key === group)?.title}
          >
            <form className="stack" onSubmit={submit} noValidate>
              {error ? <Notice tone="danger">{error}</Notice> : null}

              <Field label={uz.login.phone} required error={fieldErrors.phone}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder={uz.login.phonePlaceholder}
                  value={phone}
                  error={Boolean(fieldErrors.phone)}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>

              <Field label={uz.login.password} required error={fieldErrors.password}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder={uz.login.passwordPlaceholder}
                  value={password}
                  error={Boolean(fieldErrors.password)}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? uz.login.submitting : uz.login.submit}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setGroup(null); setError(null) }}>
                ← {uz.login.changeRole}
              </Button>

              <div className="divider" />
              <div>
                <div className="small strong" style={{ marginBottom: 8 }}>{uz.login.demoTitle}</div>
                <div className="demo-list">
                  {DEMO_ACCOUNTS[group].map((account) => (
                    <button
                      type="button"
                      key={account.phone}
                      className="demo-list__row"
                      style={{ border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'start' }}
                      onClick={() => { setPhone(account.phone); setPassword(account.password) }}
                    >
                      <span>{account.label}</span>
                      <code>{account.phone} / {account.password}</code>
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
