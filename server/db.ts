import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import type { DataState, Employee, Event, History, LearningCompletion, RoleProfile, Skill } from './types.js';

if (!process.env.DATABASE_URL && !(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE)) {
  throw new Error('Set DATABASE_URL or PGHOST, PGUSER, PGPASSWORD and PGDATABASE. See .env.example.');
}
export const pool = new pg.Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});
const dataDir = path.resolve(process.cwd(), 'data');

export function parseHistory(csv: string): History[] {
  return (parse(csv, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[]).map(row => ({
    record_id: row.record_id,
    employee_id: row.employee_id,
    event_id: row.event_id,
    date: row.date,
    due_date: row.due_date || null,
    status: row.status as History['status'],
    completion_pct: Number(row.completion_pct),
    score: row.score === '' ? null : Number(row.score),
    feedback_rating: row.feedback_rating === '' ? null : Number(row.feedback_rating),
    assigned_by: row.assigned_by as History['assigned_by'],
  }));
}

export async function initializeDatabase(): Promise<void> {
  const schema = await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  await pool.query(schema);
  const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM employees');
  if (Number(count.rows[0].count) > 0) return;
  const [employeesFile, eventsFile, skillsFile, historyFile] = await Promise.all([
    readFile(path.join(dataDir, 'employees.json'), 'utf8'),
    readFile(path.join(dataDir, 'events.json'), 'utf8'),
    readFile(path.join(dataDir, 'skills.json'), 'utf8'),
    readFile(path.join(dataDir, 'activity_history.csv'), 'utf8'),
  ]);
  const employees = JSON.parse(employeesFile) as { meta: { as_of_date: string }; employees: Employee[] };
  const events = JSON.parse(eventsFile) as { events: Event[] };
  const skills = JSON.parse(skillsFile) as { skills: Skill[]; role_profiles: RoleProfile[] };
  const history = parseHistory(historyFile);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO app_meta(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', ['as_of_date', employees.meta.as_of_date]);
    await client.query("INSERT INTO skills(skill_id, data) SELECT item->>'skill_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING", [JSON.stringify(skills.skills)]);
    await client.query("INSERT INTO role_profiles(role, grade, data) SELECT item->>'role', item->>'grade', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING", [JSON.stringify(skills.role_profiles)]);
    await client.query("INSERT INTO events(event_id, data) SELECT item->>'event_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING", [JSON.stringify(events.events)]);
    await client.query("INSERT INTO employees(employee_id, data) SELECT item->>'employee_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING", [JSON.stringify(employees.employees)]);
    await client.query("INSERT INTO activity_history(record_id, employee_id, event_id, data) SELECT item->>'record_id', item->>'employee_id', item->>'event_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING", [JSON.stringify(history)]);
    await client.query('COMMIT');
    console.log(`Seeded ${employees.employees.length} employees, ${events.events.length} events and ${history.length} history rows`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadState(): Promise<DataState> {
  const [meta, employees, events, skills, profiles, history, learning] = await Promise.all([
    pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'as_of_date'"),
    pool.query<{ data: Employee }>('SELECT data FROM employees ORDER BY employee_id'),
    pool.query<{ data: Event }>('SELECT data FROM events ORDER BY event_id'),
    pool.query<{ data: Skill }>('SELECT data FROM skills ORDER BY skill_id'),
    pool.query<{ data: RoleProfile }>('SELECT data FROM role_profiles ORDER BY role, grade'),
    pool.query<{ data: History }>('SELECT data FROM activity_history ORDER BY record_id'),
    pool.query<LearningCompletion>(`SELECT p.employee_id,p.module_id,p.effective_date::text,
      m.skill_id,m.gain,m.max_level FROM learning_progress p JOIN learning_modules m USING(module_id)
      WHERE p.status='completed' AND p.effective_date IS NOT NULL ORDER BY p.effective_date,p.module_id`),
  ]);
  return {
    asOf: meta.rows[0]?.value ?? '2026-10-01',
    employees: employees.rows.map(row => row.data),
    events: events.rows.map(row => row.data),
    skills: skills.rows.map(row => row.data),
    profiles: profiles.rows.map(row => row.data),
    history: history.rows.map(row => row.data),
    learningCompletions: learning.rows,
  };
}
