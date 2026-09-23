import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { allowEmployeeRead, requireRole } from './auth.js';
import { loadState, pool } from './db.js';
import { effectiveSkills, skillGaps, trajectory } from './domain.js';
import type { DataState, Employee, LearningCompletion } from './types.js';

type Module = { module_id: string; title: string; description: string; duration_minutes: number;
  skill_id: string; skill_name: string; gain: number; max_level: number; pass_percent: number; is_active: boolean };
type Lesson = { lesson_id: string; position: number; title: string; lead: string; points: string[]; tip: string };
type Question = { question_id: string; position: number; prompt: string; options: string[]; correct_index: number };
type Achievement = { achievement_id: string; title: string; description: string; icon: string; awarded_at?: string; source?: string };
type Progress = { employee_id: string; module_id: string; status: 'in_progress' | 'completed'; lesson_index: number;
  attempts: number; score_percent: number | null; completed_at: string | null };

const MODULE_ID = 'LM_PERIPHERALS_01';
export const learningRouter = Router();
const moduleQuery = `SELECT m.*, s.data->>'name' AS skill_name FROM learning_modules m
  JOIN skills s ON s.skill_id=m.skill_id WHERE m.module_id=$1 AND m.is_active=true`;

export async function seedLearningContent(): Promise<void> {
  const raw = JSON.parse(await readFile(path.resolve(process.cwd(), 'data/demo_learning.json'), 'utf8')) as {
    module: Omit<Module, 'skill_name' | 'is_active'>; lessons: Lesson[]; questions: Question[]; achievements: Achievement[];
  };
  const { module } = raw;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO learning_modules(module_id,title,description,duration_minutes,skill_id,gain,max_level,pass_percent)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(module_id) DO UPDATE SET
      title=EXCLUDED.title,description=EXCLUDED.description,duration_minutes=EXCLUDED.duration_minutes,
      skill_id=EXCLUDED.skill_id,gain=EXCLUDED.gain,max_level=EXCLUDED.max_level,pass_percent=EXCLUDED.pass_percent`,
    [module.module_id, module.title, module.description, module.duration_minutes, module.skill_id,
      module.gain, module.max_level, module.pass_percent]);
    for (const lesson of raw.lessons) await client.query(`INSERT INTO learning_lessons
      (lesson_id,module_id,position,title,lead,points,tip) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT(lesson_id) DO UPDATE SET position=EXCLUDED.position,title=EXCLUDED.title,
      lead=EXCLUDED.lead,points=EXCLUDED.points,tip=EXCLUDED.tip`,
    [lesson.lesson_id, module.module_id, lesson.position, lesson.title, lesson.lead, JSON.stringify(lesson.points), lesson.tip]);
    for (const question of raw.questions) await client.query(`INSERT INTO quiz_questions
      (question_id,module_id,position,prompt,options,correct_index) VALUES($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT(question_id) DO UPDATE SET position=EXCLUDED.position,prompt=EXCLUDED.prompt,
      options=EXCLUDED.options,correct_index=EXCLUDED.correct_index`,
    [question.question_id, module.module_id, question.position, question.prompt,
      JSON.stringify(question.options), question.correct_index]);
    for (const achievement of raw.achievements) await client.query(`INSERT INTO achievements
      (achievement_id,title,description,icon) VALUES($1,$2,$3,$4)
      ON CONFLICT(achievement_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,icon=EXCLUDED.icon`,
    [achievement.achievement_id, achievement.title, achievement.description, achievement.icon]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function employeeAchievements(employeeId: string): Promise<Achievement[]> {
  const result = await pool.query<Achievement>(`SELECT a.achievement_id,a.title,a.description,a.icon,
    ea.awarded_at::text,ea.source FROM employee_achievements ea JOIN achievements a USING(achievement_id)
    WHERE ea.employee_id=$1 ORDER BY ea.awarded_at DESC,a.achievement_id`, [employeeId]);
  return result.rows;
}

export async function learningRecommendation(employee: Employee, state: DataState) {
  const moduleResult = await pool.query<Module>(moduleQuery, [MODULE_ID]);
  const module = moduleResult.rows[0];
  if (!module) return null;
  const completed = state.learningCompletions?.some(row => row.employee_id === employee.employee_id && row.module_id === module.module_id);
  if (completed) return null;
  const gap = skillGaps(employee, state).find(item => item.skill_id === module.skill_id && item.gap > 0);
  if (!gap) return null;
  const to = Math.max(gap.current, Math.min(5, module.max_level, gap.current + module.gain));
  if (to <= gap.current) return null;
  return { moduleId: module.module_id, title: module.title, description: module.description,
    durationMinutes: module.duration_minutes, skillName: module.skill_name, from: gap.current, to,
    required: gap.required, critical: gap.critical, why: `${employee.grade} → ${trajectory(employee, state).target?.grade ?? employee.grade}: ` +
      `${gap.name} сейчас ${gap.current} из ${gap.required}. Курс тренирует базовую диагностику периферии и может поднять навык до ${to}.` };
}

function ownerOnly(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  if (req.authUser?.role !== 'EMPLOYEE' || req.authUser.employee_id !== req.params.id) {
    res.status(403).json({ error: 'Проходить обучение может только владелец профиля' }); return;
  }
  next();
}

learningRouter.get('/admin/learning/catalog', requireRole('ADMIN'), async (_req, res) => {
  const [modules, achievements] = await Promise.all([
    pool.query(`SELECT m.module_id,m.title,m.description,m.duration_minutes,m.skill_id,
      s.data->>'name' AS skill_name,m.gain,m.max_level,m.pass_percent,
      (SELECT count(*)::int FROM learning_lessons l WHERE l.module_id=m.module_id) AS lessons,
      (SELECT count(*)::int FROM quiz_questions q WHERE q.module_id=m.module_id) AS questions,
      (SELECT count(*)::int FROM learning_progress p WHERE p.module_id=m.module_id AND p.status='completed') AS completions
      FROM learning_modules m JOIN skills s ON s.skill_id=m.skill_id ORDER BY m.module_id`),
    pool.query('SELECT achievement_id,title,description,icon FROM achievements ORDER BY achievement_id'),
  ]);
  res.json({ modules: modules.rows, achievements: achievements.rows });
});

learningRouter.get('/hr/learning', requireRole('ADMIN', 'HR'), async (_req, res) => {
  const [progress, awards] = await Promise.all([
    pool.query(`SELECT p.employee_id,e.data->>'full_name' AS full_name,p.module_id,m.title AS module_title,
      p.status,p.lesson_index,p.attempts,p.score_percent,p.started_at::text,p.completed_at::text,
      (SELECT count(*)::int FROM learning_lessons l WHERE l.module_id=p.module_id) AS lesson_count
      FROM learning_progress p JOIN employees e USING(employee_id) JOIN learning_modules m USING(module_id)
      ORDER BY p.completed_at DESC NULLS LAST,p.started_at DESC`),
    pool.query(`SELECT ea.employee_id,a.title,a.achievement_id FROM employee_achievements ea
      JOIN achievements a USING(achievement_id) ORDER BY ea.awarded_at DESC`),
  ]);
  const byEmployee = new Map<string, { achievement_id: string; title: string }[]>();
  for (const row of awards.rows) byEmployee.set(row.employee_id,
    [...(byEmployee.get(row.employee_id) ?? []), { achievement_id: row.achievement_id, title: row.title }]);
  const rows = progress.rows.map(row => ({ ...row, achievements: byEmployee.get(row.employee_id) ?? [] }));
  const completed = rows.filter(row => row.status === 'completed');
  res.json({ totalStarted: rows.length, totalCompleted: completed.length,
    averageScore: completed.length ? Math.round(completed.reduce((sum, row) => sum + Number(row.score_percent), 0) / completed.length) : 0,
    rows });
});

learningRouter.get('/employees/:id/learning/:moduleId', allowEmployeeRead, async (req, res) => {
  const [moduleResult, lessons, questions, progress, attempts] = await Promise.all([
    pool.query<Module>(moduleQuery, [req.params.moduleId]),
    pool.query<Lesson>('SELECT lesson_id,position,title,lead,points,tip FROM learning_lessons WHERE module_id=$1 ORDER BY position', [req.params.moduleId]),
    pool.query<Omit<Question, 'correct_index'>>('SELECT question_id,position,prompt,options FROM quiz_questions WHERE module_id=$1 ORDER BY position', [req.params.moduleId]),
    pool.query<Progress>('SELECT * FROM learning_progress WHERE employee_id=$1 AND module_id=$2', [req.params.id, req.params.moduleId]),
    pool.query('SELECT score_percent,correct_count,passed,attempted_at::text FROM learning_attempts WHERE employee_id=$1 AND module_id=$2 ORDER BY attempted_at DESC LIMIT 5', [req.params.id, req.params.moduleId]),
  ]);
  if (!moduleResult.rows[0]) { res.status(404).json({ error: 'Курс не найден' }); return; }
  res.json({ module: moduleResult.rows[0], lessons: lessons.rows, questions: questions.rows,
    progress: progress.rows[0] ?? { status: 'not_started', lesson_index: 0, attempts: 0, score_percent: null, completed_at: null },
    attempts: attempts.rows });
});

learningRouter.post('/employees/:id/learning/:moduleId/start', ownerOnly, async (req, res) => {
  const moduleResult = await pool.query(moduleQuery, [req.params.moduleId]);
  if (!moduleResult.rowCount) { res.status(404).json({ error: 'Курс не найден' }); return; }
  const result = await pool.query<Progress>(`INSERT INTO learning_progress(employee_id,module_id,status)
    VALUES($1,$2,'in_progress') ON CONFLICT(employee_id,module_id) DO UPDATE
    SET employee_id=EXCLUDED.employee_id RETURNING *`, [req.params.id, req.params.moduleId]);
  res.json({ progress: result.rows[0] });
});

learningRouter.post('/employees/:id/learning/:moduleId/advance', ownerOnly, async (req, res) => {
  const lessonIndex = req.body?.lessonIndex;
  if (!Number.isInteger(lessonIndex) || lessonIndex < 0) { res.status(400).json({ error: 'Некорректный урок' }); return; }
  const count = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM learning_lessons WHERE module_id=$1', [req.params.moduleId]);
  if (lessonIndex >= count.rows[0].count) { res.status(400).json({ error: 'Урок не найден' }); return; }
  const result = await pool.query<Progress>(`UPDATE learning_progress SET lesson_index=lesson_index+1
    WHERE employee_id=$1 AND module_id=$2 AND lesson_index=$3 AND status='in_progress' RETURNING *`,
  [req.params.id, req.params.moduleId, lessonIndex]);
  if (!result.rowCount) { res.status(409).json({ error: 'Начните курс или пройдите предыдущий урок' }); return; }
  res.json({ progress: result.rows[0] });
});

async function grantAchievements(client: PoolClient, employee: Employee, state: DataState, digital: boolean): Promise<Achievement[]> {
  const effective = effectiveSkills(employee, state.history, state.events, state.learningCompletions);
  const improved = Object.entries(effective).filter(([id, value]) => value > (employee.skills[id] ?? 0)).length;
  const completedEvents = state.history.filter(row => row.employee_id === employee.employee_id && row.status === 'completed').length;
  const completedCourses = state.learningCompletions?.filter(row => row.employee_id === employee.employee_id).length ?? 0;
  const candidates = [
    ...(digital && completedCourses === 1 ? ['DIGITAL_STARTER'] : []),
    ...(completedEvents + completedCourses === 1 ? ['FIRST_STEP'] : []),
    ...(improved >= 3 ? ['SKILL_BUILDER'] : []),
    ...(trajectory(employee, state).readiness >= 80 ? ['CAREER_READY'] : []),
  ];
  const granted: Achievement[] = [];
  for (const id of candidates) {
    const result = await client.query<Achievement>(`WITH inserted AS (
      INSERT INTO employee_achievements(employee_id,achievement_id,source)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING achievement_id
    ) SELECT a.achievement_id,a.title,a.description,a.icon FROM inserted i JOIN achievements a USING(achievement_id)`,
    [employee.employee_id, id, digital ? 'learning' : 'activity']);
    if (result.rows[0]) granted.push(result.rows[0]);
  }
  return granted;
}

export async function grantActivityAchievements(client: PoolClient, employee: Employee, state: DataState) {
  return grantAchievements(client, employee, state, false);
}

learningRouter.post('/employees/:id/learning/:moduleId/quiz', ownerOnly, async (req, res, next) => {
  const answers: unknown = req.body?.answers;
  if (!Array.isArray(answers) || answers.length > 20 || !answers.every(Number.isInteger)) {
    res.status(400).json({ error: 'Ответьте на все вопросы' }); return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT employee_id FROM employees WHERE employee_id=$1 FOR UPDATE', [req.params.id]);
    if (!locked.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Сотрудник не найден' }); return; }
    const state = await loadState();
    const employee = state.employees.find(item => item.employee_id === req.params.id)!;
    const beforeSkill = effectiveSkills(employee, state.history, state.events, state.learningCompletions);
    const beforeReadiness = trajectory(employee, state).readiness;
    const moduleResult = await client.query<Module>(moduleQuery, [req.params.moduleId]);
    const module = moduleResult.rows[0];
    if (!module) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Курс не найден' }); return; }
    const progressResult = await client.query<Progress>('SELECT * FROM learning_progress WHERE employee_id=$1 AND module_id=$2 FOR UPDATE', [req.params.id, module.module_id]);
    const progress = progressResult.rows[0];
    const lessonsCount = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM learning_lessons WHERE module_id=$1', [module.module_id]);
    if (!progress || progress.status !== 'in_progress' || progress.lesson_index < lessonsCount.rows[0].count) {
      await client.query('ROLLBACK'); res.status(409).json({ error: 'Сначала завершите все уроки; пройденный курс повторно не засчитывается' }); return;
    }
    const questions = await client.query<Question>('SELECT * FROM quiz_questions WHERE module_id=$1 ORDER BY position', [module.module_id]);
    if (answers.length !== questions.rows.length || !questions.rows.every((q, index) =>
      Number(answers[index]) >= 0 && Number(answers[index]) < q.options.length)) {
      await client.query('ROLLBACK'); res.status(400).json({ error: 'Ответьте на все вопросы' }); return;
    }
    const correctCount = questions.rows.filter((q, index) => answers[index] === q.correct_index).length;
    const score = Math.round(correctCount / questions.rows.length * 100);
    const passed = score >= module.pass_percent;
    await client.query(`INSERT INTO learning_attempts(attempt_id,employee_id,module_id,answers,correct_count,score_percent,passed)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`, [randomUUID(), employee.employee_id, module.module_id,
      JSON.stringify(answers), correctCount, score, passed]);
    await client.query(`UPDATE learning_progress SET attempts=attempts+1,score_percent=$3,
      status=CASE WHEN $4 THEN 'completed' ELSE status END,
      completed_at=CASE WHEN $4 THEN now() ELSE completed_at END,
      effective_date=CASE WHEN $4 THEN $5::date ELSE effective_date END
      WHERE employee_id=$1 AND module_id=$2`, [employee.employee_id, module.module_id, score, passed, state.asOf]);
    const completion: LearningCompletion = { employee_id: employee.employee_id, module_id: module.module_id,
      effective_date: state.asOf, skill_id: module.skill_id, gain: module.gain, max_level: module.max_level };
    const afterState = passed ? { ...state, learningCompletions: [...(state.learningCompletions ?? []), completion] } : state;
    const newAchievements = passed ? await grantAchievements(client, employee, afterState, true) : [];
    await client.query('COMMIT');
    const afterSkill = effectiveSkills(employee, afterState.history, afterState.events, afterState.learningCompletions);
    res.json({ passed, score, correctCount, totalQuestions: questions.rows.length,
      skill: { id: module.skill_id, name: module.skill_name, before: beforeSkill[module.skill_id] ?? 0,
        after: afterSkill[module.skill_id] ?? 0 },
      readiness: { before: beforeReadiness, after: trajectory(employee, afterState).readiness }, newAchievements });
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});
