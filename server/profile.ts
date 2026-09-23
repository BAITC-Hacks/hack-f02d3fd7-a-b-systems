import { Router } from 'express';
import multer from 'multer';
import { pool } from './db.js';
import { auditAction, auditField } from './audit.js';
import { hashPassword, requireRole, verifyPassword } from './auth.js';

export const profileRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const personalFields = new Set(['display_name','phone','about','preferred_language','birth_date']);
const hrFields = new Set(['full_name','role','department','manager_id','grade','hire_date','work_format','birth_date']);
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const respond = (error: unknown, res: import('express').Response, next: import('express').NextFunction) => {
  const err = error as Error & { status?: number; code?: string };
  if (err.status) res.status(err.status).json({ error: err.message });
  else if (err.code === '23505') res.status(409).json({ error: 'Значение уже используется' });
  else next(error);
};
function dateValue(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(new Date(`${value}T12:00:00Z`).getTime()) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value || value > new Date().toISOString().slice(0,10))
    throw fail('Укажите корректную дату рождения');
  return value;
}
function ownValue(field: string, value: unknown): string | null {
  if (field === 'birth_date') return dateValue(value);
  if (value == null || value === '') {
    if (field === 'preferred_language') throw fail('Выберите язык');
    return field === 'about' ? '' : null;
  }
  if (typeof value !== 'string') throw fail('Некорректное значение');
  const text = value.trim();
  if (field === 'display_name' && text.length > 80) throw fail('Отображаемое имя слишком длинное');
  if (field === 'phone' && !/^\+?[0-9 ()-]{6,25}$/.test(text)) throw fail('Некорректный телефон');
  if (field === 'about' && text.length > 1000) throw fail('Поле «О себе» слишком длинное');
  if (field === 'preferred_language' && !['ru','kk','en'].includes(text)) throw fail('Неизвестный язык');
  return text;
}
const profileSelect = `SELECT p.user_id,p.display_name,p.phone,p.about,p.preferred_language,p.birth_date::text,
  p.last_seen_at,(p.avatar_data IS NOT NULL) AS has_avatar FROM user_profiles p WHERE p.user_id=$1`;

profileRouter.get('/me/profile', async (req, res, next) => {
  try {
    const [profile, employee, history] = await Promise.all([
      pool.query(profileSelect, [req.authUser!.id]),
      req.authUser!.employee_id ? pool.query('SELECT data FROM employees WHERE employee_id=$1',[req.authUser!.employee_id]) : Promise.resolve({ rows: [] }),
      pool.query(`SELECT created_at,success,ip_address,user_agent FROM login_history WHERE user_id=$1
        ORDER BY created_at DESC LIMIT 20`,[req.authUser!.id]),
    ]);
    res.json({ user: req.authUser, profile: profile.rows[0] ?? null, employee: employee.rows[0]?.data ?? null,
      loginHistory: history.rows });
  } catch (error) { next(error); }
});

profileRouter.patch('/me/profile', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = req.body ?? {};
    const keys = Object.keys(body);
    if (!keys.length || keys.some(key => !personalFields.has(key) ||
      (key==='display_name' && req.authUser!.role==='EMPLOYEE'))) throw fail('Это поле нельзя изменять самостоятельно', 403);
    await client.query('BEGIN');
    await client.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[req.authUser!.id]);
    const old = (await client.query(`SELECT display_name,phone,about,preferred_language,birth_date::text
      FROM user_profiles WHERE user_id=$1 FOR UPDATE`,[req.authUser!.id])).rows[0];
    const changes: Record<string,string|null> = {};
    for (const key of keys) {
      const value = ownValue(key, body[key]);
      if (key === 'birth_date' && old.birth_date && old.birth_date !== value)
        throw fail('Дату рождения можно самостоятельно заполнить только один раз', 403);
      changes[key] = value;
    }
    for (const [key,value] of Object.entries(changes)) {
      if (key === 'birth_date') {
        const update = await client.query(`UPDATE user_profiles SET birth_date=$2,updated_at=now()
          WHERE user_id=$1 AND (birth_date IS NULL OR birth_date=$2::date)`,[req.authUser!.id,value]);
        if (!update.rowCount) throw fail('Дата рождения уже сохранена',403);
      } else await client.query(`UPDATE user_profiles SET ${key}=$2,updated_at=now() WHERE user_id=$1`,[req.authUser!.id,value]);
      await auditField(client,req,'PROFILE_UPDATED','user_profile',req.authUser!.id,req.authUser!.id,key,old[key],value);
    }
    await client.query('COMMIT');
    res.json({ profile: (await pool.query(profileSelect,[req.authUser!.id])).rows[0] });
  } catch (error) { await client.query('ROLLBACK'); respond(error,res,next); }
  finally { client.release(); }
});

profileRouter.post('/me/avatar', upload.single('avatar'), async (req, res, next) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'Выберите изображение' }); return; }
  const bytes = file.buffer;
  const valid = file.mimetype === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    file.mimetype === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217 :
    file.mimetype === 'image/webp' ? bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' : false;
  if (!valid) { res.status(400).json({ error: 'Разрешены PNG, JPEG или WebP до 2 МБ' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO user_profiles(user_id,avatar_data,avatar_mime,avatar_updated_at)
      VALUES($1,$2,$3,now()) ON CONFLICT(user_id) DO UPDATE SET avatar_data=$2,avatar_mime=$3,
      avatar_updated_at=now(),updated_at=now()`,[req.authUser!.id,bytes,file.mimetype]);
    await auditAction(client,req,'AVATAR_UPDATED','user_profile',req.authUser!.id,req.authUser!.id);
    await client.query('COMMIT');
    res.json({ ok: true, avatarVersion: Date.now() });
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

profileRouter.get('/users/:id/avatar', async (req, res, next) => {
  try {
    const row = (await pool.query<{ avatar_data: Buffer; avatar_mime: string }>(
      `SELECT p.avatar_data,p.avatar_mime FROM user_profiles p JOIN users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND u.is_active=true`,[req.params.id])).rows[0];
    if (!row?.avatar_data) { res.status(404).end(); return; }
    res.setHeader('Content-Type',row.avatar_mime);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','private, max-age=300');
    res.send(row.avatar_data);
  } catch (error) { next(error); }
});

profileRouter.post('/me/password', async (req, res, next) => {
  const { currentPassword,newPassword,confirmation } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword !== confirmation ||
    newPassword.length < 10 || newPassword.length > 200 || newPassword === currentPassword) {
    res.status(400).json({ error: 'Проверьте текущий и новый пароль (10–200 символов) и подтверждение' }); return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id=$1 FOR UPDATE`,[req.authUser!.id])).rows[0];
    if (!row || !await verifyPassword(currentPassword,row.password_hash)) throw fail('Неверный текущий пароль',403);
    await client.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1',[req.authUser!.id,await hashPassword(newPassword)]);
    await client.query('DELETE FROM user_sessions WHERE user_id=$1 AND id<>$2',[req.authUser!.id,req.authSessionId]);
    await auditAction(client,req,'PASSWORD_CHANGED','user',req.authUser!.id,req.authUser!.id);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); respond(error,res,next); }
  finally { client.release(); }
});

profileRouter.patch('/hr/employees/:id', requireRole('ADMIN','HR'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const changes = req.body ?? {};
    const keys = Object.keys(changes);
    if (!keys.length || keys.some(key => !hrFields.has(key))) throw fail('Недопустимое кадровое поле',403);
    await client.query('BEGIN');
    const row = (await client.query<{ data: Record<string,unknown> }>('SELECT data FROM employees WHERE employee_id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if (!row) throw fail('Сотрудник не найден',404);
    const linked = (await client.query<{ id: string; full_name: string }>('SELECT id,full_name FROM users WHERE employee_id=$1',[req.params.id])).rows[0];
    const data = { ...row.data };
    for (const key of keys) {
      if (key === 'birth_date') continue;
      const value = changes[key];
      if (key === 'manager_id') {
        if (value !== null && (typeof value !== 'string' || value === req.params.id ||
          !(await client.query('SELECT 1 FROM employees WHERE employee_id=$1',[value])).rowCount))
          throw fail('Руководитель не найден');
      } else if (key === 'grade') {
        if (!['Junior','Middle','Senior','Lead'].includes(value)) throw fail('Некорректный грейд');
      } else if (key === 'hire_date') {
        dateValue(value);
      } else if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 120)
        throw fail('Некорректное кадровое значение');
      const normalized = typeof value === 'string' ? value.trim() : value;
      await auditField(client,req,'HR_FIELD_UPDATED','employee',String(req.params.id),linked?.id ?? null,key,data[key],normalized);
      data[key] = normalized;
      if (key === 'full_name' && linked) {
        await client.query('UPDATE users SET full_name=$2,updated_at=now() WHERE id=$1',[linked.id,normalized]);
        await auditField(client,req,'USER_UPDATED','user',linked.id,linked.id,'full_name',linked.full_name,normalized);
      }
    }
    if (keys.some(key => key !== 'birth_date'))
      await client.query('UPDATE employees SET data=$2::jsonb WHERE employee_id=$1',[req.params.id,JSON.stringify(data)]);
    if (keys.includes('birth_date')) {
      if (!linked) throw fail('Для даты рождения требуется связанная учетная запись');
      const value = dateValue(changes.birth_date);
      await client.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[linked.id]);
      const old = (await client.query('SELECT birth_date::text FROM user_profiles WHERE user_id=$1 FOR UPDATE',[linked.id])).rows[0].birth_date;
      await client.query('UPDATE user_profiles SET birth_date=$2,updated_at=now() WHERE user_id=$1',[linked.id,value]);
      await auditField(client,req,'BIRTH_DATE_CORRECTED','user_profile',linked.id,linked.id,'birth_date',old,value);
    }
    await client.query('COMMIT');
    res.json({ employee: data });
  } catch (error) { await client.query('ROLLBACK'); respond(error,res,next); }
  finally { client.release(); }
});

profileRouter.patch('/admin/users/:id/birth-date', requireRole('ADMIN'), async (req,res,next) => {
  const client = await pool.connect();
  try {
    const value = dateValue(req.body?.birth_date);
    await client.query('BEGIN');
    const user = (await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if (!user) throw fail('Пользователь не найден',404);
    await client.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
    const old = (await client.query('SELECT birth_date::text FROM user_profiles WHERE user_id=$1 FOR UPDATE',[user.id])).rows[0].birth_date;
    await client.query('UPDATE user_profiles SET birth_date=$2,updated_at=now() WHERE user_id=$1',[user.id,value]);
    await auditField(client,req,'BIRTH_DATE_CORRECTED','user_profile',user.id,user.id,'birth_date',old,value);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(error) { await client.query('ROLLBACK'); respond(error,res,next); }
  finally { client.release(); }
});

profileRouter.get('/team', requireRole('ADMIN','HR','EMPLOYEE'), async (req, res, next) => {
  try {
    const user = req.authUser!;
    if (user.role === 'EMPLOYEE' && !['DEPARTMENT_MANAGER','CONTACT_SUPERVISOR'].includes(user.business_role)) {
      res.status(403).json({ error: 'Нет доступа к команде' }); return;
    }
    const result = await pool.query(`SELECT employee_id,data->>'full_name' AS full_name,
      data->>'department' AS department,data->>'role' AS position,data->>'grade' AS grade,
      data->>'manager_id' AS manager_id FROM employees
      WHERE $1::boolean OR data->>'manager_id'=$2 ORDER BY employee_id LIMIT 300`,
    [user.role !== 'EMPLOYEE',user.employee_id]);
    res.json({ employees: result.rows });
  } catch (error) { next(error); }
});
