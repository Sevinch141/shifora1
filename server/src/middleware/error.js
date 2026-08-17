import { ApiError } from '../lib/http.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "So'ralgan manzil topilmadi." });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Serverda kutilmagan xatolik yuz berdi.' });
}
