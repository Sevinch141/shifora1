/**
 * Restores the demo staff logins without touching any existing data.
 *
 * `seed.js` rebuilds the whole demo hospital and starts with TRUNCATE, which
 * is the wrong tool once a database holds records worth keeping. This script
 * only applies the schema (CREATE TABLE IF NOT EXISTS) and upserts the staff
 * accounts, so it is safe to run against a live database and safe to re-run.
 *
 * Patient and caregiver logins are not created here: those accounts are only
 * meaningful attached to patient records, care plans and tasks, which is what
 * the full seed builds.
 *
 *   DATABASE_URL='<connection-string>' npm run seed:staff
 */
import { get, insert, run, closePool, migrate } from './index.js';
import { hashPassword } from '../lib/auth.js';

const STAFF = [
  { role: 'nurse', fullName: 'Dilnoza Rahimova', phone: '901112233', password: 'hamshira' },
  { role: 'nurse', fullName: 'Kamola Ergasheva', phone: '901112266', password: 'hamshira' },
  { role: 'doctor', fullName: 'Anvar Qodirov', phone: '901112244', password: 'shifokor' },
  { role: 'hospital_admin', fullName: 'Nodira Yusupova', phone: '901112255', password: 'admin' },
];

await migrate();

// Reuse whichever hospital is already there; only create one if the table is
// empty, so an existing hospital never gets duplicated.
let hospital = await get('SELECT id, name FROM hospitals ORDER BY id LIMIT 1');
if (!hospital) {
  const id = await insert(
    'INSERT INTO hospitals (name, region, phone) VALUES (?, ?, ?)',
    'Toshkent shahar 1-son ko‘p tarmoqli klinikasi', 'Toshkent shahri', '+998 71 200 30 40',
  );
  hospital = { id, name: 'Toshkent shahar 1-son ko‘p tarmoqli klinikasi' };
  console.log(`Shifoxona yaratildi: ${hospital.name}`);
} else {
  console.log(`Mavjud shifoxona ishlatildi: ${hospital.name}`);
}

// phone is UNIQUE, so an existing account has its password and active flag
// reset rather than being duplicated. Nothing else about the row is touched.
for (const person of STAFF) {
  await run(
    `INSERT INTO users (hospital_id, role, full_name, phone, password_hash)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (phone) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           is_active = 1`,
    hospital.id, person.role, person.fullName, person.phone, hashPassword(person.password),
  );
  console.log(`  ${person.phone} / ${person.password}  — ${person.fullName}`);
}

const { c: total } = await get('SELECT COUNT(*) AS c FROM users');
console.log(`\nTayyor. Bazadagi jami foydalanuvchilar: ${total}`);
await closePool();
