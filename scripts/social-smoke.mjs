import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://localhost:3000';
const json = (value, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function api(path, init = {}, cookie = '') {
  const response = await fetch(base + path, { ...init, headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function signIn(login, password) {
  const response = await api('/api/auth/login', json({ login, password }));
  assert.equal(response.status, 200, `${login}: ${JSON.stringify(response.body)}`);
  return response.cookie;
}
const cookies = {
  admin: await signIn('admin', 'DemoAdmin!2026'),
  hr: await signIn('hr', 'DemoHR!2026'),
  employee: await signIn('employee', 'DemoEmployee!2026'),
  manager: await signIn('manager', 'DemoManager!2026'),
  operator: await signIn('operator', 'DemoOperator!2026'),
  supervisor: await signIn('supervisor', 'DemoSupervisor!2026'),
  client: await signIn('client', 'DemoClient!2026'),
};
const { admin, hr, employee, manager, operator, supervisor, client } = cookies;
assert.equal((await api('/api/me/profile')).status, 401);
assert.equal((await api('/api/audit')).status, 401);
assert.equal((await api('/api/chats')).status, 401);
assert.equal((await api('/api/audit', {}, admin)).status, 200);
assert.equal((await api('/api/audit?from=2026-01-01&to=2026-12-31', {}, hr)).status, 200);
assert.equal((await api('/api/audit', {}, employee)).status, 403);
assert.equal((await api('/api/audit/mine', {}, employee)).status, 200);
assert.equal((await api('/api/team', {}, employee)).status, 403);
assert.equal((await api('/api/team', {}, manager)).status, 200);
assert.equal((await api('/api/hr/employees/E0028', json({ grade: 'Lead' }, 'PATCH'), manager)).status, 403);
assert.equal((await api('/api/hr/employees/E0028', json({ grade: 'Lead' }, 'PATCH'), employee)).status, 403);
assert.equal((await api('/api/me/profile', json({ full_name: 'Wrong' }, 'PATCH'), employee)).status, 403);
assert.equal((await api('/api/me/profile', json({ display_name: 'Wrong' }, 'PATCH'), employee)).status, 403);
assert.equal((await api('/api/me/profile', json({ business_role: 'DEPARTMENT_MANAGER' }, 'PATCH'), employee)).status, 403);

const clientUsers = await api('/api/chats/users', {}, client);
assert.equal(clientUsers.status, 200);
assert.ok(clientUsers.body.users.length > 0);
assert.ok(clientUsers.body.users.every(item => item.business_role === 'CONTACT_OPERATOR'));
const hrUsers = await api('/api/chats/users', {}, hr);
assert.ok(hrUsers.body.users.some(item => item.business_role === 'CONTACT_OPERATOR'));
assert.ok(hrUsers.body.users.some(item => item.business_role === 'DEPARTMENT_MANAGER'));
const clientChat = '10000000-0000-4000-8000-000000000003';
const managerChat = '10000000-0000-4000-8000-000000000001';
assert.equal((await api(`/api/chats/${clientChat}/messages`, {}, client)).status, 200);
assert.equal((await api(`/api/chats/${clientChat}/messages`, {}, operator)).status, 200);
assert.equal((await api(`/api/chats/${clientChat}/messages`, {}, supervisor)).status, 200);
assert.equal((await api(`/api/chats/${clientChat}/messages`, {}, employee)).status, 403);
assert.equal((await api(`/api/chats/${clientChat}/messages`, {}, manager)).status, 403);
assert.equal((await api(`/api/chats/${managerChat}/messages`, {}, client)).status, 403);
assert.equal((await api(`/api/chats/${clientChat}/messages`, json({ body: 'Forbidden' }), supervisor)).status, 403);
assert.equal((await api(`/api/chats/${managerChat}/summary`, json({ scope: 'last20' }), employee)).status, 403);
assert.equal((await api('/api/chats/team-summary', json({ scope: 'last20' }), operator)).status, 403);
assert.equal((await api(`/api/chats/${managerChat}/summaries`, {}, manager)).status, 200);
assert.equal((await api('/api/chats/team-summaries', {}, employee)).status, 403);
assert.equal((await api('/api/chats/team-summaries', {}, operator)).status, 403);
assert.ok(Array.isArray((await api('/api/chats/team-summaries', {}, supervisor)).body.summaries));

const adminUsers = await api('/api/admin/users', {}, admin);
const linked = new Set(adminUsers.body.users.map(item => item.employee_id).filter(Boolean));
const options = await api('/api/admin/employees', {}, admin);
const free = options.body.employees.find(item => !linked.has(item.employee_id));
assert.ok(free);
const unique = `social_${Date.now().toString(36)}`;
const created = await api('/api/admin/users', json({ username: unique, email: `${unique}@careerquest.demo`,
  full_name: 'Проверка профиля', role: 'EMPLOYEE', business_role: 'COMPANY_EMPLOYEE',
  employee_id: free.employee_id, password: 'TemporaryDemo!2026' }), admin);
assert.equal(created.status, 201, JSON.stringify(created.body));
let temporary = await signIn(unique, 'TemporaryDemo!2026');
const userId = created.body.user.id;
assert.equal((await api('/api/me/profile', json({ phone: '+7 700 000 00 01', about: 'Тест аудита',
  preferred_language: 'kk' }, 'PATCH'), temporary)).status, 200);
assert.equal((await api('/api/me/profile', json({ birth_date: '1990-05-12' }, 'PATCH'), temporary)).status, 200);
assert.equal((await api('/api/me/profile', json({ birth_date: '1991-05-12' }, 'PATCH'), temporary)).status, 403);
assert.equal((await api('/api/admin/users/' + userId + '/birth-date', json({ birth_date: '1991-05-12' }, 'PATCH'), hr)).status, 403);
assert.equal((await api('/api/admin/users/' + userId + '/birth-date', json({ birth_date: '1991-05-12' }, 'PATCH'), admin)).status, 200);
assert.equal((await api('/api/me/profile', {}, temporary)).body.profile.birth_date, '1991-05-12');
assert.equal((await api('/api/me/profile', json({ birth_date: '1992-05-12' }, 'PATCH'), temporary)).status, 403);

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ0AAAAASUVORK5CYII=', 'base64');
const form = new FormData();
form.append('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png');
assert.equal((await api('/api/me/avatar', { method: 'POST', body: form }, temporary)).status, 200);
assert.equal((await fetch(`${base}/api/users/${userId}/avatar`, { headers: { Cookie: temporary } })).status, 200);
assert.equal((await api('/api/me/profile', {}, temporary)).body.profile.has_avatar, true);

const before = await api(`/api/employees/${free.employee_id}`, {}, hr);
const original = before.body.employee.department;
assert.equal((await api(`/api/hr/employees/${free.employee_id}`, json({ department: 'Smoke QA' }, 'PATCH'), hr)).status, 200);
assert.equal((await api(`/api/hr/employees/${free.employee_id}`, json({ department: original }, 'PATCH'), hr)).status, 200);
const audit = await api(`/api/audit?target=${userId}`, {}, admin);
assert.equal(audit.status, 200);
assert.ok(audit.body.entries.some(item => item.action === 'BIRTH_DATE_CORRECTED'));
assert.ok(audit.body.entries.some(item => item.field_name === 'phone'));
assert.ok(audit.body.entries.every(item => !/password_hash|token|secret/i.test(item.field_name || '')));
const ownAudit = await api('/api/audit/mine', {}, temporary);
assert.ok(ownAudit.body.entries.some(item => item.field_name === 'birth_date'));
assert.ok(ownAudit.body.entries.every(item => !['role','business_role','is_active','email'].includes(item.field_name)));

assert.equal((await api('/api/me/password', json({ currentPassword: 'TemporaryDemo!2026',
  newPassword: 'NewTemporary!2026', confirmation: 'NewTemporary!2026' }), temporary)).status, 200);
assert.equal((await api('/api/auth/login', json({ login: unique, password: 'TemporaryDemo!2026' }))).status, 401);
temporary = await signIn(unique, 'NewTemporary!2026');
const loginHistory = (await api('/api/me/profile', {}, temporary)).body.loginHistory;
assert.ok(loginHistory.some(item => item.success));
assert.ok(loginHistory.some(item => !item.success));
assert.equal((await api('/api/admin/users/' + userId, json({ is_active: false }, 'PATCH'), admin)).status, 200);
assert.equal((await api('/api/me/profile', {}, temporary)).status, 401);

console.log(JSON.stringify({ ok: true, checkedRoles: Object.keys(cookies), temporaryUser: unique,
  auditEntries: audit.body.entries.length, loginHistory: loginHistory.length }, null, 2));
