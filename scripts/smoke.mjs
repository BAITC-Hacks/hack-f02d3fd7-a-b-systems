import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://localhost:3000';
async function request(route, init = {}, cookie = '') {
  const response = await fetch(base + route, { ...init, headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const json = (data) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
async function signIn(login, password) {
  const result = await request('/api/auth/login', json({ login, password }));
  assert.equal(result.status, 200, `${login}: ${JSON.stringify(result.body)}`);
  assert.ok(result.cookie.startsWith('cq_session='));
  return result.cookie;
}

assert.equal((await request('/api/health')).status, 200);
for (const path of ['/api/bootstrap', '/api/employees/E0028', '/api/hr/dashboard', '/api/admin/users', '/api/auth/me'])
  assert.equal((await request(path)).status, 401, `anonymous ${path}`);
assert.equal((await request('/api/auth/login', json({ login: 'admin', password: 'wrong' }))).status, 401);

const employeeCookie = await signIn('employee', 'DemoEmployee!2026');
const employeeMe = await request('/api/auth/me', {}, employeeCookie);
assert.equal(employeeMe.body.user.role, 'EMPLOYEE');
assert.equal(employeeMe.body.user.employee_id, 'E0028');
assert.deepEqual((await request('/api/bootstrap', {}, employeeCookie)).body.employees.map(item => item.employee_id), ['E0028']);
assert.equal((await request('/api/employees/E0028', {}, employeeCookie)).status, 200);
assert.equal((await request('/api/employees/E0028/recommendations', {}, employeeCookie)).status, 200);
for (const path of ['/api/employees/E0001', '/api/employees/E0001/recommendations', '/api/hr/dashboard', '/api/admin/users'])
  assert.equal((await request(path, {}, employeeCookie)).status, 403, `employee ${path}`);
assert.equal((await request('/api/employees/E0001/complete', json({ eventId: 'EV_001' }), employeeCookie)).status, 403);

const hrCookie = await signIn('hr@careerquest.demo', 'DemoHR!2026');
assert.equal((await request('/api/hr/dashboard', {}, hrCookie)).status, 200);
assert.equal((await request('/api/employees/E0001', {}, hrCookie)).status, 200);
assert.equal((await request('/api/admin/users', {}, hrCookie)).status, 403);
assert.equal((await request('/api/employees/E0001/complete', json({ eventId: 'EV_001' }), hrCookie)).status, 403);

const adminCookie = await signIn('admin', 'DemoAdmin!2026');
const adminList = await request('/api/admin/users', {}, adminCookie);
assert.equal(adminList.status, 200);
assert.ok(adminList.body.users.length >= 3);
assert.ok(adminList.body.users.every(user => !('password_hash' in user)));
const employeeOptions = (await request('/api/admin/employees', {}, adminCookie)).body.employees;
const linked = new Set(adminList.body.users.map(user => user.employee_id).filter(Boolean));
const freeEmployeeId = employeeOptions.find(item => !linked.has(item.employee_id)).employee_id;
const newUsername = `jury_${Date.now().toString(36)}`;
const created = await request('/api/admin/users', json({ username: newUsername, email: `${newUsername}@careerquest.demo`,
  full_name: 'Проверочный пользователь', role: 'HR', employee_id: null, password: 'TemporaryDemo!2026' }), adminCookie);
assert.equal(created.status, 201, JSON.stringify(created.body));
const userId = created.body.user.id;
assert.equal((await request(`/api/admin/users?search=${newUsername}&role=HR`, {}, adminCookie)).body.users.length, 1);
assert.equal((await request(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'EMPLOYEE', employee_id: freeEmployeeId }) }, adminCookie)).status, 200);
let newCookie = await signIn(newUsername, 'TemporaryDemo!2026');
assert.equal((await request('/api/hr/dashboard', {}, newCookie)).status, 403);
assert.equal((await request(`/api/employees/${freeEmployeeId}`, {}, newCookie)).status, 200);
assert.equal((await request(`/api/admin/users/${userId}/password`, json({ password: 'ChangedDemo!2026' }), adminCookie)).status, 200);
assert.equal((await request('/api/auth/me', {}, newCookie)).status, 401);
newCookie = await signIn(newUsername, 'ChangedDemo!2026');
assert.equal((await request(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ is_active: false }) }, adminCookie)).status, 200);
assert.equal((await request('/api/auth/me', {}, newCookie)).status, 401);
assert.equal((await request('/api/auth/login', json({ login: newUsername, password: 'ChangedDemo!2026' }))).status, 401);

const source = JSON.parse(await readFile(new URL('../data/employees.json', import.meta.url), 'utf8')).employees
  .find(employee => employee.employee_id === 'E0028');
const id = `E_JURY_SMOKE_${Date.now().toString(36)}`;
const employee = { ...source, employee_id: id, full_name: 'Jury Smoke Profile', manager_id: null,
  career_goal: { target_role: 'Backend Engineer', target_grade: 'Senior' }, last_review_date: '2026-09-30',
  skills: { ...source.skills, SK_SYSTEM_DESIGN: 2, SK_API_DESIGN: 2, SK_PUBLIC_SPEAKING: 0 } };
const columns = 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by';
const history = [columns, ...[1, 2, 3].map(n => `J_SMOKE_${id}_${n},${id},EV_036,2026-0${n}-01,,no_show,0,,,self`)].join('\n');
const form = new FormData();
form.append('employees', new Blob([JSON.stringify({ employees: [employee] })], { type: 'application/json' }), 'employees.json');
form.append('history', new Blob([history], { type: 'text/csv' }), 'activity_history.csv');
assert.equal((await request('/api/hr/import', { method: 'POST', body: form }, employeeCookie)).status, 403);
const imported = await request('/api/hr/import', { method: 'POST', body: form }, hrCookie);
assert.equal(imported.status, 200, JSON.stringify(imported.body));
assert.equal((await request(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ is_active: true, employee_id: id }) }, adminCookie)).status, 200);
newCookie = await signIn(newUsername, 'ChangedDemo!2026');
assert.deepEqual((await request('/api/bootstrap', {}, newCookie)).body.employees.map(item => item.employee_id), [id]);
const before = await request(`/api/employees/${id}`, {}, adminCookie);
const ranking = await request(`/api/employees/${id}/recommendations`, {}, adminCookie);
assert.equal(ranking.status, 200);
assert.ok(ranking.body.recommendations.length >= 1 && ranking.body.recommendations.length <= 3);
assert.ok(ranking.body.recommendations.every(item => !item.event.mandatory && item.event.type !== 'compliance'));
assert.notEqual(ranking.body.recommendations[0].event.event_id, 'EV_036');
const selected = ranking.body.recommendations[0];
assert.equal((await request(`/api/employees/${id}/complete`, json({ eventId: selected.event.event_id }), hrCookie)).status, 403);
assert.equal((await request(`/api/employees/${id}/complete`, json({ eventId: selected.event.event_id }), newCookie)).status, 200);
const after = await request(`/api/employees/${id}`, {}, adminCookie);
assert.equal(after.body.history.length, before.body.history.length + 1);
assert.ok(after.body.trajectory.readiness >= before.body.trajectory.readiness);
assert.ok(selected.closes.some(skill => after.body.skills[skill.skill_id] > before.body.skills[skill.skill_id]));
assert.equal((await request(`/api/employees/${id}/complete`, json({ eventId: selected.event.event_id }), adminCookie)).status, 400);
assert.equal((await request('/api/auth/logout', { method: 'POST' }, employeeCookie)).status, 200);
assert.equal((await request('/api/auth/me', {}, employeeCookie)).status, 401);
console.log(JSON.stringify({ ok: true, importedEmployee: id, recommended: ranking.body.recommendations.map(item => item.event.event_id),
  completed: selected.event.event_id, readiness: [before.body.trajectory.readiness, after.body.trajectory.readiness] }, null, 2));
