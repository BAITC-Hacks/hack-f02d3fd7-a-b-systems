import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://localhost:3000';
const moduleId = 'LM_PERIPHERALS_01';
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function request(route, init = {}, cookie = '') {
  const response = await fetch(base + route, { ...init, headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function login(loginValue, password) {
  const response = await request('/api/auth/login', json({ login: loginValue, password }));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.cookie;
}
const admin = await login('admin', 'DemoAdmin!2026');
const hr = await login('hr', 'DemoHR!2026');
const otherEmployee = await login('employee', 'DemoEmployee!2026');
const source = JSON.parse(await readFile(new URL('../data/employees.json', import.meta.url), 'utf8')).employees
  .find(row => row.employee_id === 'E0021');
const content = JSON.parse(await readFile(new URL('../data/demo_learning.json', import.meta.url), 'utf8'));
const suffix = Date.now().toString(36);
const employeeId = `E_LEARN_SMOKE_${suffix}`;
const username = `learn_${suffix}`;
const employee = { ...source, employee_id: employeeId, full_name: 'Demo Learning Smoke', manager_id: null };
const form = new FormData();
form.append('employees', new Blob([JSON.stringify({ employees: [employee] })], { type: 'application/json' }), 'employees.json');
assert.equal((await request('/api/hr/import', { method: 'POST', body: form }, hr)).status, 200);
const created = await request('/api/admin/users', json({ username, email: `${username}@careerquest.demo`,
  full_name: 'Demo Learning Smoke', role: 'EMPLOYEE', employee_id: employeeId, password: 'TemporaryLearning!2026' }), admin);
assert.equal(created.status, 201, JSON.stringify(created.body));
const learner = await login(username, 'TemporaryLearning!2026');
const route = `/api/employees/${employeeId}/learning/${moduleId}`;

assert.equal((await request(route, {}, otherEmployee)).status, 403);
assert.equal((await request(`${route}/start`, json({}), hr)).status, 403);
assert.equal((await request(`${route}/quiz`, json({ answers: [1, 2, 1, 1, 2] }), learner)).status, 409);
const before = await request(`/api/employees/${employeeId}`, {}, learner);
const beforeSkill = before.body.skills.SK_TROUBLESHOOTING;
const beforeReadiness = before.body.trajectory.readiness;
const recommendation = await request(`/api/employees/${employeeId}/recommendations`, {}, learner);
assert.equal(recommendation.body.learningRecommendation?.moduleId, moduleId);
assert.equal((await request(`${route}/start`, json({}), learner)).status, 200);
for (let index = 0; index < 4; index++) {
  const advanced = await request(`${route}/advance`, json({ lessonIndex: index }), learner);
  assert.equal(advanced.status, 200, JSON.stringify(advanced.body));
  assert.equal(advanced.body.progress.lesson_index, index + 1);
}
const course = await request(route, {}, learner);
assert.equal(course.body.questions.length, 5);
assert.ok(course.body.questions.every(question => !('correct_index' in question)));
const failed = await request(`${route}/quiz`, json({ answers: [0, 0, 0, 0, 0] }), learner);
assert.equal(failed.status, 200);
assert.equal(failed.body.passed, false);
const passed = await request(`${route}/quiz`, json({ answers: content.questions.map(question => question.correct_index) }), learner);
assert.equal(passed.status, 200, JSON.stringify(passed.body));
assert.equal(passed.body.passed, true);
assert.equal(passed.body.score, 100);
assert.ok(passed.body.newAchievements.some(item => item.achievement_id === 'DIGITAL_STARTER'));
assert.equal((await request(`${route}/quiz`, json({ answers: [1, 2, 1, 1, 2] }), learner)).status, 409);

const after = await request(`/api/employees/${employeeId}`, {}, learner);
assert.equal(after.body.skills.SK_TROUBLESHOOTING, beforeSkill + 1);
assert.ok(after.body.trajectory.readiness > beforeReadiness);
assert.ok(after.body.achievements.some(item => item.achievement_id === 'DIGITAL_STARTER'));
assert.equal((await request(`/api/employees/${employeeId}/recommendations`, {}, learner)).body.learningRecommendation, null);
// A fresh GET, equivalent to reloading the page, must read the saved PostgreSQL result.
const reloaded = await request(route, {}, learner);
assert.equal(reloaded.body.progress.status, 'completed');
assert.equal(reloaded.body.progress.score_percent, 100);
assert.equal(reloaded.body.progress.attempts, 2);
const hrReport = await request('/api/hr/learning', {}, hr);
assert.equal(hrReport.status, 200);
const reportRow = hrReport.body.rows.find(row => row.employee_id === employeeId);
assert.equal(reportRow.status, 'completed');
assert.equal(reportRow.score_percent, 100);
assert.ok(reportRow.achievements.some(item => item.achievement_id === 'DIGITAL_STARTER'));
assert.equal((await request('/api/hr/learning', {}, learner)).status, 403);
const catalog = await request('/api/admin/learning/catalog', {}, admin);
assert.equal(catalog.status, 200);
assert.ok(catalog.body.modules.some(item => item.module_id === moduleId));
assert.equal((await request('/api/admin/learning/catalog', {}, hr)).status, 403);
console.log(JSON.stringify({ ok: true, employeeId, username, score: passed.body.score,
  skill: [beforeSkill, after.body.skills.SK_TROUBLESHOOTING],
  readiness: [beforeReadiness, after.body.trajectory.readiness],
  achievements: passed.body.newAchievements.map(item => item.title), persisted: reloaded.body.progress }, null, 2));
