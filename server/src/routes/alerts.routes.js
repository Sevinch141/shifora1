import { Router } from 'express';
import { all, get, insert, run } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireHospitalStaff } from '../middleware/auth.js';
import { closeAlert, recomputePatientStatus } from '../services/alertEngine.js';
import { humanElapsedUz } from '../lib/time.js';

const router = Router();

router.use(requireAuth, requireHospitalStaff);

const ALERT_STATUSES = ['new', 'in_review', 'contacted', 'closed'];

function decorate(row) {
  return {
    ...row,
    context: row.context_json ? JSON.parse(row.context_json) : null,
    elapsed: humanElapsedUz(row.created_at.replace('T', ' ').slice(0, 16)),
  };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const { status = 'open', severity = '', limit = '100' } = req.query;
    const params = [req.user.hospital_id];
    let sql = `SELECT a.*, p.first_name, p.last_name, u.full_name AS assigned_name
                 FROM alerts a
                 JOIN patients p ON p.id = a.patient_id
                 LEFT JOIN users u ON u.id = a.assigned_user_id
                WHERE a.hospital_id = ?`;
    if (status === 'open') {
      sql += " AND a.status != 'closed'";
    } else if (status && status !== 'all' && ALERT_STATUSES.includes(status)) {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    if (severity && ['info', 'warning', 'urgent'].includes(severity)) {
      sql += ' AND a.severity = ?';
      params.push(severity);
    }
    sql += ` ORDER BY CASE a.severity WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             a.created_at DESC LIMIT ?`;
    params.push(Math.min(Number(limit) || 100, 300));

    const rows = await all(sql, ...params);
    res.json({ alerts: rows.map(decorate) });
  }),
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const alert = await get(
      `SELECT a.*, p.first_name, p.last_name, p.phone, p.emergency_contact_name,
              p.emergency_contact_phone, u.full_name AS assigned_name
         FROM alerts a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.assigned_user_id
        WHERE a.id = ? AND a.hospital_id = ?`,
      Number(req.params.id), req.user.hospital_id,
    );
    if (!alert) throw notFound('Ogohlantirish topilmadi.');
    await audit(req, 'alert.view', 'alert', alert.id);
    res.json({
      ...decorate(alert),
      notes: await all(
        `SELECT n.*, u.full_name FROM alert_notes n JOIN users u ON u.id = n.created_by
          WHERE n.alert_id = ? ORDER BY n.created_at DESC`,
        alert.id,
      ),
    });
  }),
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const alert = await get(
      'SELECT * FROM alerts WHERE id = ? AND hospital_id = ?',
      Number(req.params.id), req.user.hospital_id,
    );
    if (!alert) throw notFound('Ogohlantirish topilmadi.');

    const { status, assigned_user_id: assignee } = req.body ?? {};
    if (status && !ALERT_STATUSES.includes(status)) throw badRequest("Noto'g'ri holat tanlandi.");

    if (status === 'closed') {
      await closeAlert(alert.id, req.user.id);
    } else if (status) {
      await run(
        `UPDATE alerts SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        status, alert.id,
      );
    }
    if (assignee !== undefined) {
      await run(
        `UPDATE alerts SET assigned_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
        assignee || null, alert.id,
      );
    }
    await recomputePatientStatus(alert.patient_id);
    await audit(req, 'alert.update', 'alert', alert.id, { status, assigned_user_id: assignee });
    res.json(decorate(await get('SELECT * FROM alerts WHERE id = ?', alert.id)));
  }),
);

router.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const alert = await get(
      'SELECT * FROM alerts WHERE id = ? AND hospital_id = ?',
      Number(req.params.id), req.user.hospital_id,
    );
    if (!alert) throw notFound('Ogohlantirish topilmadi.');
    const note = String(req.body?.note ?? '').trim();
    if (!note) throw badRequest('Izoh matnini kiriting.', { note: 'Izoh bo‘sh bo‘lmasligi kerak.' });

    const id = await insert(
      'INSERT INTO alert_notes (alert_id, note, created_by) VALUES (?, ?, ?)',
      alert.id, note, req.user.id,
    );
    await audit(req, 'alert.note', 'alert', alert.id, { note_id: id });
    res.status(201).json({ id });
  }),
);

export default router;
