import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { NotificationItem } from './types'

/** Fetches a JSON endpoint, with loading / error state and manual reload. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!path) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<T>(path))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Xatolik yuz berdi.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  useEffect(() => { void load() }, [load])

  return { data, loading, error, reload: load, setData }
}

const POLL_MS = 20_000

/**
 * In-app notification feed. Where the user has granted permission, new
 * reminders are mirrored to a browser notification — the same message, not a
 * separate channel.
 */
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const seen = useRef<Set<number>>(new Set())
  const primed = useRef(false)

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const result = await api.get<{ notifications: NotificationItem[]; unread: number }>(
        '/me/notifications',
      )
      setItems(result.notifications)
      setUnread(result.unread)

      if (primed.current && 'Notification' in window && Notification.permission === 'granted') {
        for (const item of result.notifications) {
          if (item.read_at || seen.current.has(item.id)) continue
          new Notification(item.title, { body: item.body, tag: `shifora-${item.id}` })
        }
      }
      for (const item of result.notifications) seen.current.add(item.id)
      primed.current = true
    } catch {
      /* the badge is not worth surfacing an error for */
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [enabled, load])

  const markAllRead = useCallback(async () => {
    await api.post('/me/notifications/read-all')
    await load()
  }, [load])

  const markRead = useCallback(async (id: number) => {
    await api.post(`/me/notifications/${id}/read`)
    await load()
  }, [load])

  return { items, unread, reload: load, markAllRead, markRead }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}
