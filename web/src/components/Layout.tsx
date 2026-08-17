import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { uz } from '../lib/uz'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/hooks'
import { Button, Modal } from './ui'
import { timeAgo } from '../lib/format'

interface NavItem {
  to: string
  label: string
  icon: string
  badge?: number
}


function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { items, unread, markAllRead } = useNotifications(true)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={uz.notifications.title}>
        🔔 {unread > 0 ? <strong>{unread}</strong> : null}
      </Button>
      {open ? (
        <Modal
          title={uz.notifications.title}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => void markAllRead()} disabled={unread === 0}>
                {uz.notifications.markAllRead}
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>{uz.app.close}</Button>
            </>
          }
        >
          {items.length === 0 ? (
            <p className="muted">{uz.notifications.empty}</p>
          ) : (
            <div className="stack--sm">
              {items.slice(0, 20).map((item) => (
                <div
                  key={item.id}
                  className="notice"
                  style={{
                    background: item.read_at ? 'var(--bg)' : 'var(--teal-50)',
                    borderColor: 'var(--line)',
                    color: 'var(--ink)',
                  }}
                >
                  <span className="notice__icon" aria-hidden>
                    {item.type === 'alert_urgent' ? '🔴' : item.type === 'alert' ? '🟡' : '💊'}
                  </span>
                  <div>
                    <div className="strong">{item.title}</div>
                    <div className="small">{item.body}</div>
                    <div className="small muted">{timeAgo(item.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  )
}

/**
 * Sidebar shell used by the hospital interface.
 *
 * The sidebar is permanent from 1025px up. Below that it becomes an off-canvas
 * panel opened by the topbar hamburger: staff on a phone or tablet previously
 * had no navigation at all, because the sidebar was simply hidden.
 *
 * While open it behaves like a dialog — Escape closes it, Tab is trapped inside,
 * focus moves in and returns to the toggle on close, and the page behind cannot
 * scroll. Closing on navigation keeps a tap on a link from leaving it open.
 */
export function SidebarLayout({ items, title, subtitle, actions, children }: {
  items: NavItem[]
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const roleLabel = session ? uz.roles[session.user.role as keyof typeof uz.roles] : ''

  // A tapped link should navigate and leave the panel closed.
  useEffect(() => { setMenuOpen(false) }, [location.pathname])


  useEffect(() => {
    if (!menuOpen) return

    const panel = sidebarRef.current

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab' || !panel) return

      // Keep Tab inside the panel while it covers the page.
      const focusable = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('is-menu-open')
    closeRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('is-menu-open')
    }
  }, [menuOpen])

  const closeMenu = () => {
    setMenuOpen(false)
    toggleRef.current?.focus()
  }

  return (
    <div className="shell">
      <div
        className={`sidebar__scrim ${menuOpen ? 'sidebar__scrim--on' : ''}`}
        onClick={closeMenu}
        aria-hidden
      />

      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}
        aria-label={uz.app.menu}
      >
        <div className="sidebar__brand">
          <div className="sidebar__logo"><span aria-hidden>🩺</span> {uz.app.name}</div>
          <div className="sidebar__tagline">{uz.app.tagline}</div>
          <button
            type="button"
            ref={closeRef}
            className="sidebar__close"
            onClick={closeMenu}
            aria-label={uz.app.closeMenu}
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
        <nav className="sidebar__nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to.split('/').length <= 2}
              className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}
            >
              <span className="navlink__icon" aria-hidden>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge ? <span className="navlink__badge">{item.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__user">
          <div className="sidebar__user-name">{session?.user.full_name}</div>
          <div className="sidebar__user-role">
            {roleLabel}
            {session?.context.hospital ? ` · ${session.context.hospital.name}` : ''}
          </div>
          <Button
            size="sm"
            block
            onClick={async () => { await logout(); navigate('/') }}
          >
            {uz.app.logout}
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            ref={toggleRef}
            className="topbar__menu"
            onClick={() => setMenuOpen(true)}
            aria-label={uz.app.openMenu}
            aria-controls="app-sidebar"
            aria-expanded={menuOpen}
          >
            <span aria-hidden>☰</span>
          </button>
          <div className="topbar__heading">
            <div className="topbar__title">{title}</div>
            {subtitle ? <div className="topbar__sub">{subtitle}</div> : null}
          </div>
          <div className="topbar__actions">
            {actions}
            <NotificationBell />
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}

/**
 * Patient shell: bottom tab bar, larger type, one screen at a time.
 * Pages supply their own `.content` wrapper so a screen can render a
 * full-bleed header above it.
 */
export function PatientLayout({ items, children }: {
  items: NavItem[]
  children: ReactNode
}) {
  return (
    <div className="patient-app">
      {children}
      <nav className="tabbar">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to.split('/').length <= 2}
            className={({ isActive }) => `tabbar__item ${isActive ? 'tabbar__item--active' : ''}`}
          >
            <span className="tabbar__icon" aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
            {item.badge ? <span className="tabbar__dot">{item.badge}</span> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
