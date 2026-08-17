import { resolveSession } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/http.js';

export const HOSPITAL_ROLES = ['nurse', 'doctor', 'hospital_admin'];

/** Attaches req.user from the Bearer token. Rejects anonymous requests. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = resolveSession(token);
  if (!user) return next(unauthorized());
  req.user = user;
  req.token = token;
  next();
}

/** Restricts a route to specific roles. Always applied server-side. */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(forbidden('Bu amalni bajarish uchun huquqingiz yetarli emas.'));
    }
    next();
  };
}

/** Hospital staff only, and the user must belong to a hospital organisation. */
export function requireHospitalStaff(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (!HOSPITAL_ROLES.includes(req.user.role)) {
    return next(forbidden('Bu bo‘lim faqat tibbiyot xodimlari uchun.'));
  }
  if (!req.user.hospital_id) {
    return next(forbidden('Foydalanuvchi shifoxonaga biriktirilmagan.'));
  }
  next();
}
