import { uz } from './uz'

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']

function parse(value?: string | null): Date | null {
  if (!value) return null
  const normalised = value.replace('T', ' ')
  const [datePart, timePart = '00:00'] = normalised.split(' ')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, hh || 0, mm || 0)
}

export function formatDate(value?: string | null): string {
  const date = parse(value)
  if (!date) return '—'
  return `${date.getDate()}-${MONTHS_UZ[date.getMonth()]} ${date.getFullYear()}`
}

export function formatTime(value?: string | null): string {
  const date = parse(value)
  if (!date) return '—'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatDateTime(value?: string | null): string {
  const date = parse(value)
  if (!date) return '—'
  return `${formatDate(value)}, ${formatTime(value)}`
}

/** "12 daqiqa oldin" / "3 soat oldin" / "2 kun oldin" */
export function timeAgo(value?: string | null): string {
  const date = parse(value)
  if (!date) return uz.patients.noData
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'hozir'
  if (minutes < 60) return `${minutes} daqiqa oldin`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} soat oldin`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'kecha'
  if (days < 30) return `${days} kun oldin`
  return formatDate(value)
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase()
}

export function fullName(person: { first_name: string; last_name: string }): string {
  return `${person.last_name} ${person.first_name}`
}

/** Local date as 'YYYY-MM-DD', matching the format the API stores. */
export function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Local 'YYYY-MM-DDTHH:MM' for datetime-local inputs. */
export function nowInputValue(): string {
  const now = new Date()
  return `${todayKey()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function adherenceTone(rate: number | null): 'good' | 'mid' | 'low' {
  if (rate === null) return 'mid'
  if (rate >= 85) return 'good'
  if (rate >= 60) return 'mid'
  return 'low'
}
