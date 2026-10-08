import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import L from './logica.js';

const { Pool } = pg;
const require = createRequire(import.meta.url);
const XLSX = require('./libs/xlsx.full.min.js');
const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
const port = Number(process.env.PORT || 8080);

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('En producción define SESSION_SECRET con al menos 32 caracteres aleatorios.');
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_change_required boolean NOT NULL DEFAULT false,
  role text NOT NULL CHECK (role IN ('admin', 'liquidador')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  hourly_rate numeric(14,2) NOT NULL CHECK (hourly_rate >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  national_id text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role_id uuid NOT NULL REFERENCES job_roles(id),
  children integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  created_by uuid NOT NULL REFERENCES users(id),
  period text NOT NULL,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid NOT NULL REFERENCES payrolls(id),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status text NOT NULL CHECK (status IN ('sent', 'confirmed', 'replied', 'failed')),
  confirmation_token_hash text,
  destination text NOT NULL,
  confirmation_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS employees_role_idx ON employees(role_id);
CREATE INDEX IF NOT EXISTS payrolls_employee_idx ON payrolls(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_payroll_idx ON delivery_events(payroll_id, created_at DESC);
`;

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  if (req.session.user.passwordChangeRequired && req.path !== '/api/auth/password') {
    return res.status(428).json({ error: 'Debes cambiar la contraseña temporal para continuar.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(req.session.user ? 403 : 401).json({ error: 'No tienes permiso para esta acción.' });
    }
    if (req.session.user.passwordChangeRequired && req.path !== '/api/auth/password') {
      return res.status(428).json({ error: 'Debes cambiar la contraseña temporal para continuar.' });
    }
    next();
  };
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function employeeView(row) {
  return {
    id: row.id, name: row.name, nationalId: row.national_id, phone: row.phone,
    email: row.email, roleId: row.role_id, roleName: row.role_name, hourlyRate: Number(row.hourly_rate),
    children: row.children, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

const employeeSelect = `SELECT e.*, r.name AS role_name, r.hourly_rate FROM employees e JOIN job_roles r ON r.id = e.role_id`;

async function bootstrap() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(schema);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT false');
  await pool.query(`CREATE TABLE IF NOT EXISTS session (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);`);

  const roles = [
    ['Gerente', 100000], ['Admin', 80000], ['Operario', 60000]
  ];
  for (const [name, rate] of roles) {
    await pool.query('INSERT INTO job_roles(name, hourly_rate) VALUES($1, $2) ON CONFLICT(name) DO NOTHING', [name, rate]);
  }
  await pool.query('INSERT INTO payroll_settings(id, settings) VALUES(1, $1) ON CONFLICT(id) DO NOTHING', [L.REGLAS_POR_DEFECTO]);
  await pool.query('ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz');

  const adminEmail = text(process.env.ADMIN_EMAIL, 254).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = text(process.env.ADMIN_NAME || 'Administrador', 120);
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(`INSERT INTO users(name, email, password_hash, role, password_change_required) VALUES($1, $2, $3, 'admin', true)
      ON CONFLICT(email) DO NOTHING`, [adminName, adminEmail, hash]);
    const existingAdmin = await pool.query('SELECT id,password_hash,password_change_required FROM users WHERE email=$1', [adminEmail]);
    if (existingAdmin.rows[0] && !existingAdmin.rows[0].password_change_required &&
        await bcrypt.compare(adminPassword, existingAdmin.rows[0].password_hash)) {
      await pool.query('UPDATE users SET password_change_required=true WHERE id=$1', [existingAdmin.rows[0].id]);
    }
  }
  const { rows: userCount } = await pool.query('SELECT count(*)::int AS total FROM users');
  if (userCount[0].total === 0) throw new Error('Configura ADMIN_EMAIL y ADMIN_PASSWORD para crear la cuenta administradora inicial.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  name: 'nomina.sid', secret: process.env.SESSION_SECRET || 'development-secret-change-this',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), asyncRoute(async (req, res) => {
  const email = text(req.body.email, 254).toLowerCase();
  const result = await pool.query('SELECT id, name, email, password_hash, role, active, password_change_required FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, passwordChangeRequired: user.password_change_required };
  res.json({ user: req.session.user });
}));
app.post('/api/auth/logout', requireAuth, (req, res, next) => req.session.destroy(err => {
  if (err) return next(err);
  res.clearCookie('nomina.sid');
  res.status(204).end();
}));
app.post('/api/auth/password', requireAuth, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 12) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 12 caracteres.' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [req.session.user.id]);
  if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash=$1,password_change_required=false WHERE id=$2', [hash, req.session.user.id]);
  req.session.user.passwordChangeRequired = false;
  res.json({ ok: true });
}));

app.get('/api/roles', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, hourly_rate, active FROM job_roles WHERE active = true ORDER BY name');
  res.json({ roles: rows.map(r => ({ id: r.id, name: r.name, hourlyRate: Number(r.hourly_rate) })) });
}));
app.post('/api/roles', requireRole('admin'), asyncRoute(async (req, res) => {
  const name = text(req.body.name, 80);
  const hourlyRate = Number(req.body.hourlyRate);
  if (!name || !Number.isFinite(hourlyRate) || hourlyRate < 0) return res.status(400).json({ error: 'Nombre y tarifa válida son obligatorios.' });
  const { rows } = await pool.query('INSERT INTO job_roles(name, hourly_rate) VALUES($1, $2) RETURNING id, name, hourly_rate', [name, hourlyRate]);
  res.status(201).json({ role: { id: rows[0].id, name: rows[0].name, hourlyRate: Number(rows[0].hourly_rate) } });
}));
app.delete('/api/roles/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  const usage = await pool.query('SELECT 1 FROM employees WHERE role_id = $1 LIMIT 1', [req.params.id]);
  if (usage.rowCount) return res.status(409).json({ error: 'No se puede eliminar un rol asignado a empleados.' });
  const result = await pool.query('UPDATE job_roles SET active = false WHERE id = $1 AND active = true', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Rol no encontrado.' });
  res.status(204).end();
}));

app.get('/api/settings', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT settings FROM payroll_settings WHERE id=1');
  res.json({ settings: rows[0].settings });
}));
app.put('/api/settings', requireRole('admin'), asyncRoute(async (req, res) => {
  const settings = L.clonarReglas(req.body || {});
  if (Object.values(settings.tarifas).some(rate => !Number.isFinite(Number(rate)) || Number(rate) < 0)) {
    return res.status(400).json({ error: 'Todas las tarifas deben ser números no negativos.' });
  }
  await pool.query('UPDATE payroll_settings SET settings=$1, updated_at=now() WHERE id=1', [settings]);
  res.json({ settings });
}));

app.get('/api/employees', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  const filters = ['r.active = true'];
  const search = text(req.query.q, 120);
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(e.name ILIKE $${params.length} OR e.national_id ILIKE $${params.length} OR e.email ILIKE $${params.length})`);
  }
  if (req.query.roleId) {
    params.push(text(req.query.roleId, 40));
    filters.push(`e.role_id = $${params.length}`);
  }
  const { rows } = await pool.query(`${employeeSelect} WHERE ${filters.join(' AND ')} ORDER BY r.name, e.name`, params);
  res.json({ employees: rows.map(employeeView) });
}));
app.post('/api/employees', requireRole('admin'), asyncRoute(async (req, res) => {
  const data = {
    name: text(req.body.name, 120), nationalId: text(req.body.nationalId, 40),
    phone: text(req.body.phone, 40), email: text(req.body.email, 254).toLowerCase(),
    roleId: text(req.body.roleId, 40), children: Number(req.body.children || 0)
  };
  if (!data.name || !data.nationalId || !data.roleId || !Number.isInteger(data.children) || data.children < 0) {
    return res.status(400).json({ error: 'Nombre, cédula, rol y número válido de hijos son obligatorios.' });
  }
  const { rows } = await pool.query(`INSERT INTO employees(name, national_id, phone, email, role_id, children)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [data.name, data.nationalId, data.phone, data.email, data.roleId, data.children]);
  const employee = await pool.query(`${employeeSelect} WHERE e.id = $1`, [rows[0].id]);
  res.status(201).json({ employee: employeeView(employee.rows[0]) });
}));
app.put('/api/employees/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  const data = {
    name: text(req.body.name, 120), nationalId: text(req.body.nationalId, 40),
    phone: text(req.body.phone, 40), email: text(req.body.email, 254).toLowerCase(),
    roleId: text(req.body.roleId, 40), children: Number(req.body.children || 0)
  };
  if (!data.name || !data.nationalId || !data.roleId || !Number.isInteger(data.children) || data.children < 0) {
    return res.status(400).json({ error: 'Nombre, cédula, rol y número válido de hijos son obligatorios.' });
  }
  const updated = await pool.query(`UPDATE employees SET name=$1, national_id=$2, phone=$3, email=$4,
    role_id=$5, children=$6, updated_at=now() WHERE id=$7 RETURNING id`,
  [data.name, data.nationalId, data.phone, data.email, data.roleId, data.children, req.params.id]);
  if (!updated.rowCount) return res.status(404).json({ error: 'Empleado no encontrado.' });
  const employee = await pool.query(`${employeeSelect} WHERE e.id = $1`, [req.params.id]);
  res.json({ employee: employeeView(employee.rows[0]) });
}));
app.delete('/api/employees/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  const history = await pool.query('SELECT 1 FROM payrolls WHERE employee_id=$1 LIMIT 1', [req.params.id]);
  if (history.rowCount) return res.status(409).json({ error: 'No se puede eliminar un empleado con liquidaciones históricas.' });
  const result = await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Empleado no encontrado.' });
  res.status(204).end();
}));

app.post('/api/employees/import', requireRole('admin'), upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo Excel o CSV.' });
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false, defval: null });
  if (!rows.length) return res.status(400).json({ error: 'El archivo no tiene filas.' });
  const headers = rows[0].map(value => L.normalizar(value));
  const findColumn = (...names) => headers.findIndex(h => names.some(name => h === name || h.includes(name)));
  const columns = {
    name: findColumn('nombre completo', 'nombre', 'empleado', 'trabajador'),
    nationalId: findColumn('cedula', 'identificacion', 'documento'),
    phone: findColumn('telefono', 'celular', 'movil'),
    email: findColumn('correo', 'email', 'e mail'),
    role: findColumn('rol', 'cargo', 'categoria'),
    children: findColumn('hijos', 'numero de hijos', 'hijos a cargo')
  };
  if (columns.name < 0 || columns.nationalId < 0 || columns.role < 0) {
    return res.status(400).json({ error: 'La plantilla requiere columnas de nombre, cédula y rol.' });
  }
  const roles = await pool.query('SELECT id, name FROM job_roles WHERE active = true');
  const byName = new Map(roles.rows.map(role => [L.normalizar(role.name), role.id]));
  let imported = 0;
  const skipped = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [index, row] of rows.slice(1).entries()) {
      const name = text(row[columns.name], 120);
      if (!name || /^ejemplo/i.test(name)) continue;
      const nationalId = text(row[columns.nationalId], 40);
      const roleName = L.normalizar(row[columns.role]);
      const roleId = byName.get(roleName);
      if (!nationalId || !roleId) { skipped.push(index + 2); continue; }
      await client.query('SAVEPOINT import_employee');
      try {
        await client.query(`INSERT INTO employees(name,national_id,phone,email,role_id,children)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(national_id) DO UPDATE SET name=EXCLUDED.name,
          phone=EXCLUDED.phone,email=EXCLUDED.email,role_id=EXCLUDED.role_id,children=EXCLUDED.children,updated_at=now()`,
        [name, nationalId, columns.phone < 0 ? '' : text(row[columns.phone], 40),
          columns.email < 0 ? '' : text(row[columns.email], 254).toLowerCase(), roleId,
          columns.children < 0 ? 0 : Math.max(0, Math.floor(L.aNumero(row[columns.children])))]);
        imported++;
        await client.query('RELEASE SAVEPOINT import_employee');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT import_employee');
        await client.query('RELEASE SAVEPOINT import_employee');
        skipped.push(index + 2);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  res.json({ imported, skipped });
}));

app.get('/api/users', requireRole('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows });
}));
app.post('/api/users', requireRole('admin'), asyncRoute(async (req, res) => {
  const name = text(req.body.name, 120);
  const email = text(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role;
  if (!name || !email.includes('@') || password.length < 12 || !['admin', 'liquidador'].includes(role)) {
    return res.status(400).json({ error: 'Indica nombre, correo, rol y contraseña de al menos 12 caracteres.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query('INSERT INTO users(name,email,password_hash,role,password_change_required) VALUES($1,$2,$3,$4,true) RETURNING id,name,email,role,active', [name,email,hash,role]);
  res.status(201).json({ user: rows[0] });
}));
app.patch('/api/users/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
  const { rows } = await pool.query('UPDATE users SET active=$1 WHERE id=$2 RETURNING id,name,email,role,active', [Boolean(req.body.active), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ user: rows[0] });
}));

app.post('/api/payrolls', requireRole('admin', 'liquidador'), asyncRoute(async (req, res) => {
  const { rows: found } = await pool.query(`${employeeSelect} WHERE e.id = $1 AND r.active = true`, [req.body.employeeId]);
  if (!found.length) return res.status(404).json({ error: 'Empleado no encontrado.' });
  const employee = employeeView(found[0]);
  const roleKey = `job_${employee.roleId.replaceAll('-', '')}`;
  const inputs = req.body.inputs || {};
  const { rows: savedSettings } = await pool.query('SELECT settings FROM payroll_settings WHERE id=1');
  const reglas = L.clonarReglas(savedSettings[0]?.settings || L.REGLAS_POR_DEFECTO);
  reglas.tarifas[roleKey] = employee.hourlyRate;
  const result = L.liquidarEmpleado({
    nombre: employee.name, cc: employee.nationalId, rol: roleKey, hijos: employee.children,
    horas: inputs.horas, extras: inputs.extras, domingos: inputs.domingos,
    feriados: inputs.feriados, nocturnas: inputs.nocturnas, prima: inputs.prima,
    vivienda: inputs.vivienda, libranza: inputs.libranza, otros: inputs.otros
  }, reglas);
  result.rol = employee.roleName.toLowerCase();
  result.rolTexto = employee.roleName;
  const period = text(req.body.period, 7) || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'El periodo debe tener formato AAAA-MM.' });
  const saved = await pool.query(`INSERT INTO payrolls(employee_id,created_by,period,inputs,result)
    VALUES($1,$2,$3,$4,$5) RETURNING id,employee_id,period,result,created_at`,
  [employee.id, req.session.user.id, period, inputs, result]);
  res.status(201).json({ payroll: saved.rows[0] });
}));
app.get('/api/payrolls', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT p.id,p.employee_id,p.created_by,p.period,p.inputs,p.result,p.created_at,
    e.name AS employee_name,e.national_id,e.email,e.phone,r.name AS role_name,u.name AS created_by_name,
    (SELECT json_agg(json_build_object('channel',d.channel,'status',d.status,'destination',d.destination,'createdAt',d.created_at,'confirmedAt',d.confirmed_at) ORDER BY d.created_at DESC)
     FROM delivery_events d WHERE d.payroll_id=p.id) AS deliveries
    FROM payrolls p JOIN employees e ON e.id=p.employee_id JOIN job_roles r ON r.id=e.role_id
    JOIN users u ON u.id=p.created_by ORDER BY p.created_at DESC LIMIT 300`);
  res.json({ payrolls: rows });
}));

function mailer() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Configura GMAIL_USER y GMAIL_APP_PASSWORD en el servidor.');
  return nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
}
app.post('/api/payrolls/:id/email', requireRole('admin', 'liquidador'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT p.*,e.name,e.email,e.national_id FROM payrolls p JOIN employees e ON e.id=p.employee_id WHERE p.id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Liquidación no encontrada.' });
  const payroll = rows[0];
  const destination = text(req.body.email || payroll.email, 254).toLowerCase();
  if (!destination.includes('@')) return res.status(400).json({ error: 'El empleado no tiene un correo válido.' });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows: eventRows } = await pool.query(`INSERT INTO delivery_events(payroll_id,channel,status,confirmation_token_hash,destination,confirmation_expires_at)
    VALUES($1,'email','sent',$2,$3,now()+interval '30 days') RETURNING id`, [payroll.id, tokenHash, destination]);
  const confirmUrl = `${process.env.APP_BASE_URL || `http://localhost:${port}`}/confirmar/${token}`;
  const result = payroll.result;
  const sheet = XLSX.utils.aoa_to_sheet(L.hojaSalida([result], { origen: payroll.name, fecha: payroll.period }));
  sheet['!cols'] = L.anchosColumnas();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Nómina');
  const attachment = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  try {
    await mailer().sendMail({
      from: process.env.GMAIL_FROM || process.env.GMAIL_USER, to: destination,
      subject: `Comprobante de nómina ${payroll.period}`,
      text: `Hola ${payroll.name}. Tu comprobante de nómina para ${payroll.period}:\nNeto a pagar: $${Number(result.neto).toLocaleString('es-CO')}\n\nConfirma la recepción: ${confirmUrl}`,
      html: `<p>Hola ${escapeHtml(payroll.name)},</p><p>Tu comprobante de nómina para <strong>${escapeHtml(payroll.period)}</strong> está disponible en el archivo adjunto.</p><p>Neto a pagar: <strong>$${Number(result.neto).toLocaleString('es-CO')}</strong></p><p><a href="${confirmUrl}">Confirmar recepción del comprobante</a></p>`,
      attachments: [{ filename: `Nomina_${payroll.national_id}_${payroll.period}.xlsx`, content: attachment }]
    });
  } catch (error) {
    await pool.query("UPDATE delivery_events SET status='failed' WHERE id=$1", [eventRows[0].id]);
    throw error;
  }
  res.status(202).json({ status: 'sent' });
}));
app.get('/confirmar/:token', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Confirmar recepción</title><main><h1>Confirmación de comprobante</h1><p>Al continuar, confirmas que recibiste el comprobante de nómina.</p><form method="post" action="/confirmar/${encodeURIComponent(req.params.token)}"><button type="submit">Confirmar recepción</button></form></main></html>`);
});
app.post('/confirmar/:token', asyncRoute(async (req, res) => {
  const hash = crypto.createHash('sha256').update(String(req.params.token)).digest('hex');
  const { rowCount } = await pool.query(`UPDATE delivery_events SET status='confirmed',confirmed_at=now()
    WHERE confirmation_token_hash=$1 AND status='sent' AND confirmation_expires_at > now()`, [hash]);
  res.type('html').send(rowCount
    ? '<!doctype html><html lang="es"><meta charset="utf-8"><title>Recepción confirmada</title><main><h1>Recepción confirmada</h1><p>Gracias. El administrador de nómina registró tu confirmación.</p></main></html>'
    : '<!doctype html><html lang="es"><meta charset="utf-8"><title>Enlace no disponible</title><main><h1>Enlace no disponible</h1><p>Este enlace ya fue utilizado o no es válido.</p></main></html>');
}));

app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
for (const asset of ['styles.css', 'app.js', 'portal.js', 'logica.js']) {
  app.get(`/${asset}`, (req, res) => res.sendFile(path.join(root, asset)));
}
for (const asset of ['xlsx.full.min.js', 'jszip.min.js']) {
  app.get(`/libs/${asset}`, (req, res) => res.sendFile(path.join(root, 'libs', asset)));
}
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = error.code === '23505' ? 409 : error instanceof multer.MulterError ? 400 : 500;
  const message = status === 409 ? 'Ya existe un registro con ese correo o cédula.'
    : status === 400 ? error.message : process.env.NODE_ENV === 'production' ? 'Error interno del servidor.' : error.message;
  res.status(status).json({ error: message });
});

bootstrap().then(() => {
  app.listen(port, () => console.log(`Liquidador disponible en http://localhost:${port}`));
}).catch(error => {
  console.error('No se pudo iniciar el servidor. Comprueba DATABASE_URL y la conexión a PostgreSQL.', error);
  process.exit(1);
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
