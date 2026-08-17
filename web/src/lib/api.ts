import { uz } from './uz'

const TOKEN_KEY = 'shifora.token'

export class ApiError extends Error {
  status: number
  details: Record<string, string> | null

  constructor(status: number, message: string, details: Record<string, string> | null = null) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get()
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(0, uz.app.networkError)
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    // An expired or revoked session drops the user back to the login screen.
    if (response.status === 401) tokenStore.clear()
    throw new ApiError(
      response.status,
      payload?.error ?? uz.app.errorGeneric,
      payload?.details ?? null,
    )
  }
  return payload as T
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
}
