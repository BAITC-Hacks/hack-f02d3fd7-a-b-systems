import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rankWithOpenAI } from './ai.js';
import { initializeDatabase, loadState, pool } from './db.js';
import { effectiveSkills, eligibleRecommendations, skillGaps, trajectory } from './domain.js';
import { importFiles } from './import.js';
import { allowEmployeeRead, allowEmployeeWrite, login, logout, requireAuth, requireRole, sameOrigin, seedDemoUsers } from './auth.js';
import { adminRouter } from './admin.js';
import { employeeAchievements, grantActivityAchievements, learningRecommendation, learningRouter, seedLearningContent } from './learning.js';
import { profileRouter } from './profile.js';
import { chatRouter, seedDemoChats } from './chats.js';
import { auditRouter } from './audit.js';
import type { History } from './types.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 3001);
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'ready' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', sameOrigin);
app.post('/api/auth/login', login);
app.use('/api', requireAuth);
app.get('/api/auth/me', (req, res) => res.json({ user: req.authUser }));
app.post('/api/auth/logout', logout);
app.use('/api/admin', adminRouter);
app.use('/api', learningRouter);
app.use('/api', profileRouter);
app.use('/api', chatRouter);
app.use('/api', auditRouter);

app.get('/api/bootstrap', async (req, res) => {
  const state = await loadState();
  res.json({
    asOf: state.asOf,
    employees: state.employees.filter(item => req.authUser?.role !== 'EMPLOYEE' || item.employee_id === req.authUser.employee_id ||
      (['DEPARTMENT_MANAGER','CONTACT_SUPERVISOR'].includes(req.authUser.business_role) && item.manager_id === req.authUser.employee_id))
      .map(({ employee_id, full_name, role, grade, department }) =>
      ({ employee_id, full_name, role, grade, department })),
    totalEvents: state.events.length,
  });
});

app.get('/api/employees/:id', allowEmployeeRead, async (req, res) => {
  const state = await loadState();
  const employee = state.employees.find(item => item.employee_id === req.params.id);
  if (!employee) { res.status(404).json({ error: 'Сотрудник не найден' }); return; }
  const eventNames = new Map(state.events.map(event => [event.event_id, event.title]));
  const history = state.history.filter(item => item.employee_id === employee.employee_id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.record_id.localeCompare(a.record_id))
    .map(item => ({ ...item, event_title: eventNames.get(item.event_id) ?? item.event_id }));
  res.json({ employee, skills: effectiveSkills(employee, state.history, state.events, state.learningCompletions),
    trajectory: trajectory(employee, state), history, skillCatalog: state.skills,
    achievements: await employeeAchievements(employee.employee_id) });
});

app.get('/api/employees/:id/recommendations', allowEmployeeRead, async (req, res) => {
  const state = await loadState();
  const employee = state.employees.find(item => item.employee_id === req.params.id);
  if (!employee) { res.status(404).json({ error: 'Сотрудник не найден' }); return; }
  const candidates = eligibleRecommendations(employee, state);
  const selectedIds = await rankWithOpenAI(employee, candidates);
  const recommendations = selectedIds
    ? selectedIds.map(id => candidates.find(item => item.event.event_id === id)!).filter(Boolean)
    : candidates.slice(0, 3);
  res.json({ source: selectedIds ? 'openai' : 'rules', recommendations,
    learningRecommendation: await learningRecommendation(employee, state),
    emptyReason: candidates.length ? null : skillGaps(employee, state).some(gap => gap.gap > 0)
      ? 'Нет доступных активностей, которые закрывают текущие разрывы и соответствуют условиям участия.'
      : 'Целевые требования по навыкам уже выполнены.' });
});

app.post('/api/employees/:id/complete', allowEmployeeWrite, async (req, res) => {
  const eventId = req.body?.eventId;
  if (typeof eventId !== 'string') { res.status(400).json({ error: 'Укажите eventId' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT employee_id FROM employees WHERE employee_id = $1 FOR UPDATE', [req.params.id]);
    if (!locked.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Сотрудник не найден' }); return; }
    const state = await loadState();
    const employee = state.employees.find(item => item.employee_id === req.params.id)!;
    const allowed = eligibleRecommendations(employee, state).find(item => item.event.event_id === eventId);
    if (!allowed) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Активность недоступна или уже завершена' }); return; }
    const row: History = {
      record_id: `U_${randomUUID()}`, employee_id: employee.employee_id, event_id: eventId,
      date: state.asOf, due_date: null, status: 'completed', completion_pct: 100,
      score: null, feedback_rating: null, assigned_by: 'self',
    };
    await client.query('INSERT INTO activity_history(record_id, employee_id, event_id, data) VALUES ($1, $2, $3, $4::jsonb)',
      [row.record_id, row.employee_id, row.event_id, JSON.stringify(row)]);
    const newAchievements = await grantActivityAchievements(client, employee, { ...state, history: [...state.history, row] });
    await client.query('COMMIT');
    res.json({ completed: row, newAchievements, message: 'Активность завершена. Навыки и траектория пересчитаны.' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

app.get('/api/hr/dashboard', requireRole('ADMIN', 'HR'), async (_req, res) => {
  const state = await loadState();
  const gapCounts = new Map<string, { skill_id: string; name: string; count: number; criticalCount: number }>();
  const without: { employee_id: string; full_name: string; role: string; grade: string; gapCount: number }[] = [];
  for (const employee of state.employees) {
    const gaps = skillGaps(employee, state).filter(gap => gap.gap > 0);
    for (const gap of gaps) {
      const item = gapCounts.get(gap.skill_id) ?? { skill_id: gap.skill_id, name: gap.name, count: 0, criticalCount: 0 };
      item.count++;
      if (gap.critical) item.criticalCount++;
      gapCounts.set(gap.skill_id, item);
    }
    if (!eligibleRecommendations(employee, state).length) without.push({
      employee_id: employee.employee_id, full_name: employee.full_name,
      role: employee.role, grade: employee.grade, gapCount: gaps.length,
    });
  }
  const stats = state.events.map(event => {
    const rows = state.history.filter(row => row.event_id === event.event_id);
    const byStatus = Object.fromEntries(['completed', 'in_progress', 'no_show', 'declined', 'dropped', 'overdue']
      .map(status => [status, rows.filter(row => row.status === status).length]));
    return { event_id: event.event_id, title: event.title, type: event.type, mandatory: event.mandatory,
      total: rows.length, ...byStatus };
  }).sort((a, b) => b.total - a.total);
  res.json({ totalEmployees: state.employees.length, totalActivities: state.events.length,
    totalParticipation: state.history.length, withoutRecommendation: without,
    topGaps: [...gapCounts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    activityStats: stats });
});

app.post('/api/hr/import', requireRole('ADMIN', 'HR'), upload.fields([{ name: 'employees', maxCount: 1 }, { name: 'history', maxCount: 1 }]), async (req, res, next) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const result = await importFiles(files?.employees?.[0]?.buffer, files?.history?.[0]?.buffer);
    res.json({ ...result, message: 'Данные загружены и доступны в профиле и HR-дашборде.' });
  } catch (error) {
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Некорректный JSON или CSV' }); return; }
    if (error instanceof Error && (!('code' in error) || String(error.code).startsWith('CSV_'))) {
      res.status(400).json({ error: error.message }); return;
    }
    next(error);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint не найден' }));
const clientDir = path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientDir));
app.use((_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Файл превышает допустимый размер' }); return;
  }
  console.error(error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

initializeDatabase().then(seedLearningContent).then(seedDemoUsers).then(seedDemoChats)
  .then(() => app.listen(port, () => console.log(`Career Quest: http://localhost:${port}`)))
  .catch(error => { console.error('Database startup failed:', error); process.exit(1); });
