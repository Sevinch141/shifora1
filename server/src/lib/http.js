// Errors carry an Uzbek message because the API is consumed by an Uzbek UI.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = "Ma'lumotlar to'liq emas.", details) => new ApiError(400, msg, details);
export const unauthorized = (msg = 'Tizimga kirish talab qilinadi.') => new ApiError(401, msg);
export const forbidden = (msg = "Sizda bu ma'lumotni ko'rish huquqi yo'q.") => new ApiError(403, msg);
export const notFound = (msg = "Ma'lumot topilmadi.") => new ApiError(404, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Minimal field validation with Uzbek error messages, keyed by field name. */
export function validate(body, rules) {
  const errors = {};
  const value = {};
  for (const [field, rule] of Object.entries(rules)) {
    const raw = body?.[field];
    const isEmpty = raw === undefined || raw === null || String(raw).trim() === '';
    if (rule.required && isEmpty) {
      errors[field] = rule.message ?? "Bu maydon to'ldirilishi shart.";
      continue;
    }
    if (isEmpty) {
      value[field] = rule.default ?? null;
      continue;
    }
    if (rule.type === 'number') {
      const num = Number(raw);
      if (Number.isNaN(num)) {
        errors[field] = 'Raqam kiriting.';
        continue;
      }
      if (rule.min !== undefined && num < rule.min) {
        errors[field] = `Qiymat ${rule.min} dan kichik bo'lmasligi kerak.`;
        continue;
      }
      if (rule.max !== undefined && num > rule.max) {
        errors[field] = `Qiymat ${rule.max} dan katta bo'lmasligi kerak.`;
        continue;
      }
      value[field] = num;
      continue;
    }
    if (rule.oneOf && !rule.oneOf.includes(raw)) {
      errors[field] = "Noto'g'ri qiymat tanlandi.";
      continue;
    }
    value[field] = typeof raw === 'string' ? raw.trim() : raw;
  }
  if (Object.keys(errors).length > 0) {
    throw badRequest("Kiritilgan ma'lumotlarda xatolik bor.", errors);
  }
  return value;
}
