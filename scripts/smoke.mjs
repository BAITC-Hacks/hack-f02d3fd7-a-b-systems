import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://localhost:3000';
const hrCode = process.env.HR_ACCESS_CODE;
if (!hrCode) throw new Error('Set HR_ACCESS_CODE from your local .env before running smoke test');

async function request(route, init) {
  const response = await fetch(base + route, init);
  return { status: response.status, body: await response.json() };
}

const health = await request('/api/health');
assert.equal(health.status, 200);
const bootstrap = await request('/api/bootstrap');
assert.equal(bootstrap.body.employees.length >= 200, true);

const source = JSON.parse(await readFile(new URL('../data/employees.json', import.meta.url), 'utf8')).employees
  .find(employee => employee.employee_id === 'E0028');
const id = `E_JURY_SMOKE_${Date.now().toString(36)}`;
const employee = { ...source, employee_id: id, full_name: 'Jury Smoke Profile', manager_id: null,
  career_goal: { target_role: 'Backend Engineer', target_grade: 'Senior' },
  last_review_date: '2026-09-30',
  skills: { ...source.skills, SK_SYSTEM_DESIGN: 2, SK_API_DESIGN: 2, SK_PUBLIC_SPEAKING: 0 } };
const columns = 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by';
const history = [columns, ...[1, 2, 3].map(n => `J_SMOKE_${id}_${n},${id},EV_036,2026-0${n}-01,,no_show,0,,,self`)].join('\n');
const form = new FormData();
form.append('employees', new Blob([JSON.stringify({ employees: [employee] })], { type: 'application/json' }), 'employees.json');
form.append('history', new Blob([history], { type: 'text/csv' }), 'activity_history.csv');
const imported = await request('/api/hr/import', { method: 'POST', headers: { 'x-hr-code': hrCode }, body: form });
assert.equal(imported.status, 200, JSON.stringify(imported.body));
assert.equal(imported.body.employees, 1);
assert.equal(imported.body.history, 3);

const before = await request(`/api/employees/${id}`);
assert.equal(before.status, 200);
assert.equal(before.body.history.length, 3);
const ranking = await request(`/api/employees/${id}/recommendations`);
assert.equal(ranking.status, 200);
assert.ok(ranking.body.recommendations.length >= 1 && ranking.body.recommendations.length <= 3);
assert.ok(ranking.body.recommendations.every(item => !item.event.mandatory && item.event.type !== 'compliance'));
assert.notEqual(ranking.body.recommendations[0].event.event_id, 'EV_036');
const selected = ranking.body.recommendations[0];
const completed = await request(`/api/employees/${id}/complete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: selected.event.event_id }),
});
assert.equal(completed.status, 200, JSON.stringify(completed.body));
const after = await request(`/api/employees/${id}`);
assert.equal(after.body.history.length, 4);
assert.ok(after.body.trajectory.readiness >= before.body.trajectory.readiness);
assert.ok(selected.closes.some(skill => after.body.skills[skill.skill_id] > before.body.skills[skill.skill_id]));
const duplicate = await request(`/api/employees/${id}/complete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: selected.event.event_id }),
});
assert.equal(duplicate.status, 400);
const forbidden = await request('/api/hr/dashboard');
assert.equal(forbidden.status, 401);
const dashboard = await request('/api/hr/dashboard', { headers: { 'x-hr-code': hrCode } });
assert.equal(dashboard.status, 200);
assert.ok(dashboard.body.topGaps.length && dashboard.body.activityStats.length);
console.log(JSON.stringify({ employeeId: id, imported: imported.body, recommended: ranking.body.recommendations.map(item => item.event.event_id),
  completed: selected.event.event_id, readiness: [before.body.trajectory.readiness, after.body.trajectory.readiness],
  hrEmployees: dashboard.body.totalEmployees }, null, 2));
