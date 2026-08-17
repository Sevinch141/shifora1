// All scheduling in the MVP uses the server's local clock and the compact
// 'YYYY-MM-DD HH:MM' format. Keeping one representation everywhere avoids
// timezone drift between the reminder engine, the patient plan and reports.

function pad(n) {
  return String(n).padStart(2, '0');
}

export function toLocal(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseLocal(value) {
  if (!value) return null;
  const [datePart, timePart = '00:00'] = String(value).replace('T', ' ').split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

export function addMinutes(value, minutes) {
  const date = value instanceof Date ? new Date(value) : parseLocal(value);
  date.setMinutes(date.getMinutes() + minutes);
  return toLocal(date);
}

export function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : parseLocal(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function minutesBetween(from, to) {
  const a = from instanceof Date ? from : parseLocal(from);
  const b = to instanceof Date ? to : parseLocal(to);
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export function atTime(dateKey, timeOfDay) {
  return `${dateKey} ${timeOfDay}`;
}

export function nowLocal() {
  return toLocal(new Date());
}

/** "2 soat 15 daqiqa" style elapsed label for nurse-facing screens. */
export function humanElapsedUz(fromValue, toValue = nowLocal()) {
  const mins = Math.max(0, minutesBetween(fromValue, toValue));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days > 0) return `${days} kun ${hours} soat`;
  if (hours > 0) return `${hours} soat ${rest} daqiqa`;
  return `${rest} daqiqa`;
}
