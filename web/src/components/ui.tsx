import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { uz } from '../lib/uz'
import type { PatientStatus, Severity } from '../lib/types'

/* -------------------------------------------------------------- buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'secondary', size = 'md', block, icon, children, className = '', ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button className={classes} {...rest}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- fields */

interface FieldProps {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}

export function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label">
        {label} {required ? <span className="field__req" aria-hidden>*</span> : null}
      </label>
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error" role="alert">⚠ {error}</span> : null}
    </div>
  )
}

export function Input({ error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input className={`input ${error ? 'input--error' : ''} ${className}`} {...rest} />
}

export function Select({ error, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select className={`select ${error ? 'select--error' : ''} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />
}

export function Checkbox({ checked, onChange, label, hint }: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className={`checkbox ${checked ? 'checkbox--on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="strong">{label}</span>
        {hint ? <span className="field__hint" style={{ display: 'block' }}>{hint}</span> : null}
      </span>
    </label>
  )
}

/* ----------------------------------------------------------------- cards */

export function Card({ title, action, children, flush, subtitle }: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  return (
    <section className="card">
      {title ? (
        <header className="card__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="small muted">{subtitle}</div> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
    </section>
  )
}

/* --------------------------------------------------------------- badges */

/** Status is always icon + word — never colour alone. */
const STATUS_META: Record<PatientStatus, { icon: string; label: string }> = {
  stable: { icon: '🟢', label: uz.status.stable },
  attention: { icon: '🟡', label: uz.status.attention },
  urgent: { icon: '🔴', label: uz.status.urgentShort },
}

export function StatusBadge({ status, size }: { status: PatientStatus; size?: 'lg' }) {
  const meta = STATUS_META[status] ?? STATUS_META.stable
  return (
    <span className={`badge badge--${status} ${size === 'lg' ? 'badge--lg' : ''}`}>
      <span aria-hidden>{meta.icon}</span> {meta.label}
    </span>
  )
}

const SEVERITY_META: Record<Severity, { icon: string; label: string; cls: string }> = {
  info: { icon: '🟢', label: uz.severity.info, cls: 'stable' },
  warning: { icon: '🟡', label: uz.severity.warning, cls: 'attention' },
  urgent: { icon: '🔴', label: uz.severity.urgent, cls: 'urgent' },
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.info
  return (
    <span className={`badge badge--${meta.cls}`}>
      <span aria-hidden>{meta.icon}</span> {meta.label}
    </span>
  )
}

export function Badge({ children, tone = 'neutral' }: {
  children: ReactNode
  tone?: 'neutral' | 'teal' | 'info' | 'stable' | 'attention' | 'urgent'
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

/* -------------------------------------------------------------- notices */

export function Notice({ tone = 'info', icon, children }: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'ai'
  icon?: ReactNode
  children: ReactNode
}) {
  const defaultIcon = { info: 'ℹ️', warning: '⚠️', danger: '⛔', success: '✅', ai: '🤖' }[tone]
  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__icon" aria-hidden>{icon ?? defaultIcon}</span>
      <div>{children}</div>
    </div>
  )
}

/* ------------------------------------------------------- states & modal */

export function Empty({ icon = '📋', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden>{icon}</span>
      <div className="empty__title">{title}</div>
      {children ? <div className="small">{children}</div> : null}
    </div>
  )
}

export function Loading({ label = uz.app.loading }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function Modal({ title, onClose, children, footer }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal">
        <header className="modal__head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={uz.app.close}>✕</Button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function Meter({ value }: { value: number | null }) {
  const tone = value === null ? 'mid' : value >= 85 ? 'good' : value >= 60 ? 'mid' : 'low'
  return (
    <div className="meter" role="img" aria-label={`${value ?? 0}%`}>
      <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${value ?? 0}%` }} />
    </div>
  )
}
