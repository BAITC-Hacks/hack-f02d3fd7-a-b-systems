import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { businessRoles, hashPassword, requireRole, type AuthUser, type BusinessRole, type Role } from './auth.js';
import { auditAction, auditField } from './audit.js';

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

const fields = `id,username,email,full_name,role,business_role,employee_id,is_active,created_at,updated_at`;
const validRoles = new Set<Role>(['ADMIN', 'HR', 'EMPLOYEE']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9._-]{3,40}$/;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

function validate(data: Record<string, unknown>, creation: boolean) {
  const username = String(data.username ?? '').trim();
  const email = String(data.email ?? '').trim().toLowerCase();
  const fullName = String(data.full_name ?? '').trim();
  const role = data.role as Role;
  const businessRole = (data.business_role ?? 'COMPANY_EMPLOYEE') as BusinessRole;
  const employeeId = data.employee_id ? String(data.employee_id).trim() : null;
  if (!usernamePattern.test(username)) throw fail('Логин: 3–40 символов, латиница, цифры, точка, дефис или подчёркивание');
  if (!emailPattern.test(email) || email.length > 254) throw fail('Укажите корректный email');
  if (fullName.length < 2 || fullName.length > 120) throw fail('Имя должно содержать 2–120 символов');
  if (!validRoles.has(role)) throw fail('Неизвестная роль');
  if (!businessRoles.includes(businessRole)) throw fail('Неизвестная бизнес-роль');
  if (businessRole === 'CONTACT_CLIENT' && (role !== 'EMPLOYEE' || employeeId))
    throw fail('Внешний клиент не может иметь кадровый профиль или привилегированную роль');
  if (role === 'EMPLOYEE' && !employeeId && businessRole !== 'CONTACT_CLIENT') throw fail('Для EMPLOYEE укажите профиль сотрудника');
  if (employeeId && employeeId.length > 80) throw fail('Некорректный ID сотрудника');
  if (creation && (typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 200))
    throw fail('Пароль должен содержать 10–200 символов');
  return { username, email, fullName, role, businessRole, employeeId };
}

function respondError(error: unknown, res: import('express').Response, next: import('express').NextFunction) {
  const err = error as Error & { code?: string; constraint?: string; status?: number };
  if (err.code === '23505') { res.status(409).json({ error: 'Логин, email или профиль сотрудника уже используется' }); return; }
  if (err.code === '23503') { res.status(400).json({ error: 'Профиль сотрудника не найден' }); return; }
  if (err.status) { res.status(err.status).json({ error: err.message }); return; }
  next(error);
}

adminRouter.get('/users', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const role = typeof req.query.role === 'string' ? req.query.role : '';
    const active = typeof req.query.active === 'string' ? req.query.active : '';
    if (role && !validRoles.has(role as Role)) throw fail('Неизвестная роль');
    if (active && !['true', 'false'].includes(active)) throw fail('Неизвестный фильтр статуса');
    const result = await pool.query(`SELECT ${fields} FROM users WHERE
      ($1='' OR username ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR full_name ILIKE '%'||$1||'%' OR employee_id ILIKE '%'||$1||'%')
      AND ($2='' OR role=$2) AND ($3='' OR is_active=$3::boolean)
      ORDER BY created_at,id`, [search, role, active]);
    res.json({ users: result.rows });
  } catch (error) { respondError(error, res, next); }
});

adminRouter.get('/employees', async (_req, res, next) => {
  try {
    const result = await pool.query<{ employee_id: string; full_name: string }>(
      `SELECT employee_id,data->>'full_name' AS full_name FROM employees ORDER BY employee_id`);
    res.json({ employees: result.rows });
  } catch (error) { next(error); }
});

adminRouter.post('/users', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const data = validate(req.body ?? {}, true);
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO users(id,username,email,full_name,role,business_role,employee_id,password_hash,is_active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
    [randomUUID(), data.username, data.email, data.fullName, data.role, data.businessRole, data.employeeId,
      await hashPassword(req.body.password), req.body.is_active !== false]);
    await client.query('INSERT INTO user_profiles(user_id) VALUES($1)',[result.rows[0].id]);
    await auditAction(client,req,'USER_CREATED','user',result.rows[0].id,result.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json({ user: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); respondError(error, res, next); }
  finally { client.release(); }
});

adminRouter.patch('/users/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const oldResult = await client.query<AuthUser>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
    const old = oldResult.rows[0];
    if (!old) throw fail('Пользователь не найден', 404);
    const merged = { ...old, ...req.body };
    const data = validate(merged, false);
    const isActive = req.body.is_active === undefined ? old.is_active : req.body.is_active;
    if (typeof isActive !== 'boolean') throw fail('Некорректный статус');
    if (old.role === 'ADMIN' && (data.role !== 'ADMIN' || !isActive)) {
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role='ADMIN' AND is_active=true");
      if (Number(count.rows[0].count) <= 1) throw fail('Нельзя отключить или изменить роль последнего активного администратора');
    }
    const result = await client.query(`UPDATE users SET username=$2,email=$3,full_name=$4,role=$5,business_role=$6,employee_id=$7,
      is_active=$8,updated_at=now() WHERE id=$1 RETURNING ${fields}`,
    [old.id, data.username, data.email, data.fullName, data.role, data.businessRole, data.employeeId, isActive]);
    for (const [field,before,after] of [
      ['username',old.username,data.username],['email',old.email,data.email],['full_name',old.full_name,data.fullName],
      ['role',old.role,data.role],['business_role',old.business_role,data.businessRole],
      ['employee_id',old.employee_id,data.employeeId],['is_active',old.is_active,isActive],
    ] as [string,unknown,unknown][]) await auditField(client,req,'USER_UPDATED','user',old.id,old.id,field,before,after);
    if (old.role !== data.role || old.business_role !== data.businessRole || old.employee_id !== data.employeeId || old.is_active !== isActive)
      await client.query('DELETE FROM user_sessions WHERE user_id=$1', [old.id]);
    await client.query('COMMIT');
    res.json({ user: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); respondError(error, res, next); }
  finally { client.release(); }
});

adminRouter.post('/users/:id/password', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 10 || password.length > 200)
      throw fail('Пароль должен содержать 10–200 символов');
    await client.query('BEGIN');
    const result = await client.query(`UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1 RETURNING id`,
      [req.params.id, await hashPassword(password)]);
    if (!result.rowCount) throw fail('Пользователь не найден', 404);
    await client.query('DELETE FROM user_sessions WHERE user_id=$1', [req.params.id]);
    await auditAction(client,req,'PASSWORD_RESET','user',req.params.id,String(req.params.id));
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); respondError(error, res, next); }
  finally { client.release(); }
});
