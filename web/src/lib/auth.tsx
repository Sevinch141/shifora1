import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, tokenStore } from './api'
import type { AuthContextPayload, User } from './types'

export type RoleGroup = 'hospital' | 'patient' | 'caregiver'

interface Session {
  user: User
  context: AuthContextPayload
}

interface AuthValue {
  session: Session | null
  loading: boolean
  login: (phone: string, password: string, roleGroup: RoleGroup) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setSession(null)
      setLoading(false)
      return
    }
    try {
      setSession(await api.get<Session>('/auth/me'))
    } catch {
      tokenStore.clear()
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (phone: string, password: string, roleGroup: RoleGroup) => {
    const result = await api.post<Session & { token: string }>('/auth/login', {
      phone,
      password,
      role_group: roleGroup,
    })
    tokenStore.set(result.token)
    setSession({ user: result.user, context: result.context })
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      tokenStore.clear()
      setSession(null)
    }
  }, [])

  const value = useMemo(
    () => ({ session, loading, login, logout, refresh }),
    [session, loading, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export const HOSPITAL_ROLES = ['nurse', 'doctor', 'hospital_admin']
