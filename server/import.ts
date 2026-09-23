import { parseHistory, pool, loadState } from './db.js';
import type { Employee, History } from './types.js';

const grades = new Set(['Junior', 'Middle', 'Senior', 'Lead']);
const statuses = new Set(['completed', 'in_progress', 'dropped', 'no_show', 'declined', 'overdue']);
const assignments = new Set(['self', 'manager', 'hr']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEmployee(value: unknown, roles: Set<string>, skills: Set<string>): asserts value is Employee {
  if (!isObject(value) || typeof value.employee_id !== 'string' || !value.employee_id ||
    typeof value.full_name !== 'string' || typeof value.role !== 'string' || !roles.has(`${value.role}|${value.grade}`) ||
    !grades.has(String(value.grade)) || typeof value.department !== 'string' ||
    typeof value.hire_date !== 'string' || !datePattern.test(value.hire_date) ||
    typeof value.last_review_date !== 'string' || !datePattern.test(value.last_review_date) ||
    typeof value.tenure_months !== 'number' || !Number.isInteger(value.tenure_months) || value.tenure_months < 0 ||
    !isObject(value.skills) ||
    Object.entries(value.skills).some(([id, level]) => !skills.has(id) || typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 5) ||
    (value.career_goal !== null && (!isObject(value.career_goal) ||
      !roles.has(`${value.career_goal.target_role}|${value.career_goal.target_grade}`)))) {
    throw new Error(`Некорректный профиль сотрудника ${isObject(value) ? String(value.employee_id ?? '') : ''}`);
  }
}

function validateHistory(row: History, employeeIds: Set<string>, eventIds: Set<string>): void {
  if (!row.record_id || !employeeIds.has(row.employee_id) || !eventIds.has(row.event_id) ||
    !datePattern.test(row.date) || (row.due_date !== null && !datePattern.test(row.due_date)) ||
    !statuses.has(row.status) || !assignments.has(row.assigned_by) ||
    !Number.isInteger(row.completion_pct) || row.completion_pct < 0 || row.completion_pct > 100 ||
    (row.score !== null && (!Number.isInteger(row.score) || row.score < 0 || row.score > 100)) ||
    (row.feedback_rating !== null && (!Number.isInteger(row.feedback_rating) || row.feedback_rating < 1 || row.feedback_rating > 5))) {
    throw new Error(`Некорректная запись истории ${row.record_id || '(без ID)'}`);
  }
}

export async function importFiles(employeesBuffer?: Buffer, historyBuffer?: Buffer): Promise<{ employees: number; history: number }> {
  if (!employeesBuffer && !historyBuffer) throw new Error('Выберите employees.json и/или activity_history.csv');
  const state = await loadState();
  const roles = new Set(state.profiles.map(profile => `${profile.role}|${profile.grade}`));
  const skills = new Set(state.skills.map(skill => skill.skill_id));
  let employees: Employee[] = [];
  if (employeesBuffer) {
    const parsed: unknown = JSON.parse(employeesBuffer.toString('utf8'));
    const entries = Array.isArray(parsed) ? parsed : isObject(parsed) ? parsed.employees : null;
    if (!Array.isArray(entries)) throw new Error('employees.json должен содержать массив employees');
    entries.forEach(entry => validateEmployee(entry, roles, skills));
    employees = entries;
    if (new Set(employees.map(item => item.employee_id)).size !== employees.length) throw new Error('Повторяющиеся employee_id');
  }
  const history = historyBuffer ? parseHistory(historyBuffer.toString('utf8')) : [];
  const employeeIds = new Set([...state.employees.map(item => item.employee_id), ...employees.map(item => item.employee_id)]);
  const eventIds = new Set(state.events.map(item => item.event_id));
  history.forEach(row => validateHistory(row, employeeIds, eventIds));
  if (new Set(history.map(row => row.record_id)).size !== history.length) throw new Error('Повторяющиеся record_id');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (employees.length) await client.query(
      "INSERT INTO employees(employee_id, data) SELECT item->>'employee_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT (employee_id) DO UPDATE SET data = EXCLUDED.data",
      [JSON.stringify(employees)],
    );
    if (history.length) await client.query(
      "INSERT INTO activity_history(record_id, employee_id, event_id, data) SELECT item->>'record_id', item->>'employee_id', item->>'event_id', item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT (record_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, event_id = EXCLUDED.event_id, data = EXCLUDED.data",
      [JSON.stringify(history)],
    );
    await client.query('COMMIT');
    return { employees: employees.length, history: history.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
