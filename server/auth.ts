import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';

const scryptAsync = (password: string, salt: Buffer, options: typeof SCRYPT_OPTIONS): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, result) =>
    error ? reject(error) : resolve(result as Buffer)));
const COOKIE = 'cq_session';
const SESSION_DAYS = 7;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
export type Role = 'ADMIN' | 'HR' | 'EMPLOYEE';
export type AuthUser = { id: string; username: string; email: string; full_name: string; role: Role; employee_id: string | null; is_active: boolean };
type StoredUser = AuthUser & { password_hash: string };

declare global {
  namespace Express { interface Request { authUser?: AuthUser; authSessionId?: string } }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, Buffer.from(salt, 'hex'), SCRYPT_OPTIONS);
  return `scrypt$16384$8$5$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expected] = parts;
  const expectedBytes = Buffer.from(expected, 'hex');
  if (expectedBytes.length !== 64) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'),
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, expectedBytes);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const publicUser = ({ id, username, email, full_name, role, employee_id, is_active }: StoredUser): AuthUser =>
  ({ id, username, email, full_name, role, employee_id, is_active });

function cookieOptions(req: Request) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: req.secure, path: '/', maxAge: SESSION_DAYS * 86400_000 };
}

function cookieToken(req: Request): string | undefined {
  const pair = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return pair?.slice(COOKIE.length + 1);
}

export async function readSession(req: Request): Promise<AuthUser | null> {
  const token = cookieToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await pool.query<StoredUser & { session_id: string }>(
    `SELECT s.id AS session_id, u.* FROM user_sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true`, [hashToken(token)]);
  const row = result.rows[0];
  if (!row) return null;
  req.authSessionId = row.session_id;
  return publicUser(row);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await readSession(req);
    if (!user) { res.status(401).json({ error: 'Требуется вход в систему' }); return; }
    req.authUser = user;
    next();
  } catch (error) { next(error); }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Недостаточно прав' }); return;
    }
    next();
  };
}

export function allowEmployeeRead(req: Request, res: Response, next: NextFunction) {
  if (req.authUser?.role === 'EMPLOYEE' && req.authUser.employee_id !== req.params.id) {
    res.status(403).json({ error: 'Нет доступа к этому сотруднику' }); return;
  }
  next();
}

export function allowEmployeeWrite(req: Request, res: Response, next: NextFunction) {
  if (req.authUser?.role === 'ADMIN' || (req.authUser?.role === 'EMPLOYEE' && req.authUser.employee_id === req.params.id)) {
    next(); return;
  }
  res.status(403).json({ error: 'Нет прав для изменения активности' });
}

const attempts = new Map<string, { count: number; until: number }>();
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const loginValue = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!loginValue || !password || loginValue.length > 254 || password.length > 1024) {
      res.status(400).json({ error: 'Укажите логин и пароль' }); return;
    }
    const key = `${req.ip}:${loginValue}`;
    const now = Date.now();
    const entry = attempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    if (now > entry.until) { entry.count = 0; entry.until = now + 15 * 60_000; }
    if (entry.count >= 10) { res.status(429).json({ error: 'Слишком много попыток. Повторите позже.' }); return; }
    const result = await pool.query<StoredUser>('SELECT * FROM users WHERE lower(username)=$1 OR lower(email)=$1 LIMIT 1', [loginValue]);
    const user = result.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, DUMMY_HASH);
    if (!user || !user.is_active || !valid) {
      entry.count++; attempts.set(key, entry);
      res.status(401).json({ error: 'Неверный логин или пароль' }); return;
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO user_sessions(id,user_id,token_hash,expires_at)
      VALUES($1,$2,$3,now()+interval '7 days')`, [randomUUID(), user.id, hashToken(token)]);
    res.cookie(COOKIE, token, cookieOptions(req));
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
}

// Generated from a public demo string; only used to make unknown-login timing similar.
const DUMMY_HASH = 'scrypt$16384$8$5$00112233445566778899aabbccddeeff$56e4b96adcdfd6aeeb24a3b81ff84c53c0b41ec467dd2faf44e9527a4721c449b6569552410b72f9e1dfee16b353625879e7c048c193d6e29421c57f068b2c89';

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.authSessionId) await pool.query('DELETE FROM user_sessions WHERE id=$1', [req.authSessionId]);
    res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
    res.json({ ok: true });
  } catch (error) { next(error); }
}

export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('origin');
  if (!origin) { next(); return; }
  const allowed = new Set([`${req.protocol}://${req.get('host')}`, process.env.APP_ORIGIN].filter(Boolean));
  if (!allowed.has(origin)) { res.status(403).json({ error: 'Недопустимый источник запроса' }); return; }
  next();
}

export async function seedDemoUsers(): Promise<void> {
  const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  if (Number(count.rows[0].count) > 0) return;
  const examples: Array<{ username: string; email: string; full_name: string; role: Role; employee_id: string | null; password: string }> = [
    { username: 'admin', email: 'admin@careerquest.demo', full_name: 'Демо администратор', role: 'ADMIN', employee_id: null, password: 'DemoAdmin!2026' },
    { username: 'hr', email: 'hr@careerquest.demo', full_name: 'Демо HR', role: 'HR', employee_id: null, password: 'DemoHR!2026' },
    { username: 'employee', email: 'employee@careerquest.demo', full_name: 'Демо сотрудник', role: 'EMPLOYEE', employee_id: 'E0028', password: 'DemoEmployee!2026' },
  ];
  for (const user of examples) {
    await pool.query(`INSERT INTO users(id,username,email,full_name,role,employee_id,password_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [randomUUID(), user.username, user.email, user.full_name, user.role, user.employee_id, await hashPassword(user.password)]);
  }
  console.log('Demo accounts initialized. Change their passwords before exposing this instance.');
}
