import { Router } from 'express';
import { get } from '../db/index.js';
import { createSession, destroySession, verifyPassword } from '../lib/auth.js';
import { ApiError, validate, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAuth, HOSPITAL_ROLES } from '../middleware/auth.js';
import { patientForUser, patientsForCaregiver } from '../services/access.js';

const router = Router();

// One authentication system; the chosen entry point only narrows which roles
// may sign in there, and the role decides where the client is routed next.
const ROLE_GROUPS = {
  hospital: HOSPITAL_ROLES,
  patient: ['patient'],
  caregiver: ['caregiver'],
};

async function buildContext(user) {
  const context = { hospital: null, patient: null, patients: [] };
  if (user.hospital_id) {
    context.hospital = await get('SELECT id, name, region FROM hospitals WHERE id = ?', user.hospital_id);
  }
  if (user.role === 'patient') {
    context.patient = await patientForUser(user.id);
  }
  if (user.role === 'caregiver') {
    context.patients = (await patientsForCaregiver(user.id)).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      relation: p.relation,
    }));
  }
  return context;
}

router.post(
  '/login',
  wrap(async (req, res) => {
    const { phone, password, role_group: roleGroup } = validate(req.body, {
      phone: { required: true, message: 'Telefon raqamini kiriting.' },
      password: { required: true, message: 'Parolni kiriting.' },
      role_group: { required: false },
    });

    const user = await get('SELECT * FROM users WHERE phone = ? AND is_active = 1', phone);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, "Telefon raqami yoki parol noto'g'ri.");
    }

    const allowed = ROLE_GROUPS[roleGroup];
    if (allowed && !allowed.includes(user.role)) {
      throw new ApiError(403, 'Bu hisob tanlangan bo‘lim uchun mos emas. Boshqa bo‘limni tanlang.');
    }

    const { token, expiresAt } = await createSession(user.id);
    const { password_hash: _drop, ...safeUser } = user;
    await audit({ user, ip: req.ip }, 'auth.login', 'user', user.id, { role: user.role });

    res.json({
      token,
      expires_at: expiresAt,
      user: safeUser,
      context: await buildContext(user),
    });
  }),
);

router.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    await audit(req, 'auth.logout', 'user', req.user.id);
    await destroySession(req.token);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ user: req.user, context: await buildContext(req.user) });
  }),
);

export default router;
