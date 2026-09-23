import { useEffect, useState } from 'react';
import { Check, KeyRound, Plus, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { api, type AuthUser, type Role } from './api';

type ManagedUser = AuthUser & { created_at: string; updated_at: string };
type EmployeeOption = { employee_id: string; full_name: string };
type Form = { username: string; email: string; full_name: string; role: Role; employee_id: string; is_active: boolean; password: string };
const empty: Form = { username: '', email: '', full_name: '', role: 'EMPLOYEE', employee_id: '', is_active: true, password: '' };
const roleLabel: Record<Role, string> = { ADMIN: 'Администратор', HR: 'HR', EMPLOYEE: 'Сотрудник' };

export function AdminPanel({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [dialog, setDialog] = useState<'form' | 'password' | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const params = new URLSearchParams({ search, role: roleFilter, active: statusFilter });
    try {
      const result = await api<{ users: ManagedUser[] }>(`/api/admin/users?${params}`);
      setUsers(result.users);
    } catch (failure) { setError((failure as Error).message); }
  }
  useEffect(() => { void load(); }, [search, roleFilter, statusFilter]);
  useEffect(() => { api<{ employees: EmployeeOption[] }>('/api/admin/employees').then(data => setEmployees(data.employees)).catch(error => setError(error.message)); }, []);

  function openCreate() { setEditing(null); setForm(empty); setError(''); setDialog('form'); }
  function openEdit(user: ManagedUser) {
    setEditing(user); setForm({ username: user.username, email: user.email, full_name: user.full_name,
      role: user.role, employee_id: user.employee_id ?? '', is_active: user.is_active, password: '' });
    setError(''); setDialog('form');
  }
  function openPassword(user: ManagedUser) { setEditing(user); setNewPassword(''); setError(''); setDialog('password'); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...form, employee_id: form.employee_id || null };
      if (editing) await api(`/api/admin/users/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      else await api('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      setDialog(null); setNotice(editing ? 'Пользователь обновлён' : 'Пользователь создан'); await load();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function resetPassword(event: React.FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setError('');
    try {
      await api(`/api/admin/users/${editing.id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPassword }) });
      setDialog(null); setNotice('Пароль изменён. Старые сессии пользователя закрыты.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function toggle(user: ManagedUser) {
    setError('');
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !user.is_active }) });
      setNotice(user.is_active ? 'Учетная запись отключена' : 'Учетная запись активирована'); await load();
    } catch (failure) { setError((failure as Error).message); }
  }

  return <><div className="page-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h1>Администрирование<span className="heading-dot">.</span></h1><p>Учетные записи, роли и связь с профилями сотрудников.</p></div><span className="pill violet"><ShieldCheck size={15} /> ADMIN</span></div>
    <section className="panel admin-panel"><div className="panel-header"><div><span className="eyebrow">USERS & ROLES</span><h2>Пользователи</h2></div><button className="button primary" onClick={openCreate}><Plus size={17} /> Добавить</button></div>
      <div className="admin-filters"><label className="admin-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя, email, логин или ID" /></label><select aria-label="Фильтр роли" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">Все роли</option><option value="ADMIN">ADMIN</option><option value="HR">HR</option><option value="EMPLOYEE">EMPLOYEE</option></select><select aria-label="Фильтр статуса" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Все статусы</option><option value="true">Активны</option><option value="false">Отключены</option></select></div>
      {notice && <div className="admin-notice"><Check size={16} /> {notice}<button aria-label="Закрыть" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && !dialog && <div className="form-error" role="alert">{error}</div>}
      <div className="table-wrap"><table className="admin-table"><thead><tr><th>Пользователь</th><th>Роль</th><th>Сотрудник</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.full_name}</strong><small>@{user.username} · {user.email}</small></td><td><span className="admin-role">{roleLabel[user.role]}</span></td><td>{user.employee_id ? <span>{user.employee_id}<small>{employees.find(item => item.employee_id === user.employee_id)?.full_name}</small></span> : '—'}</td><td><span className={`admin-status ${user.is_active ? 'enabled' : ''}`}>{user.is_active ? 'Активен' : 'Отключен'}</span></td><td><div className="admin-actions"><button onClick={() => openEdit(user)}>Изменить</button><button onClick={() => openPassword(user)}><KeyRound size={14} /> Пароль</button><button disabled={user.id === currentUser.id} onClick={() => toggle(user)}>{user.is_active ? 'Отключить' : 'Активировать'}</button></div></td></tr>)}</tbody></table>{users.length === 0 && <div className="empty-small">Пользователи не найдены.</div>}</div></section>
    {dialog && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section className="admin-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'form' ? 'Пользователь' : 'Смена пароля'}><div className="dialog-head"><div className="login-lock"><UserRound size={22} /></div><button aria-label="Закрыть" onClick={() => setDialog(null)}><X size={21} /></button></div>{dialog === 'form' ? <form onSubmit={save}><h2>{editing ? 'Редактировать пользователя' : 'Новый пользователь'}</h2><p>Учетная запись для входа и HR-профиль хранятся отдельно.</p><div className="admin-form-grid"><label>Имя<input required minLength={2} value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} /></label><label>Логин<input required minLength={3} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label><label>Email<input type="email" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>Роль<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })}><option value="EMPLOYEE">EMPLOYEE</option><option value="HR">HR</option><option value="ADMIN">ADMIN</option></select></label><label className="form-wide">Профиль сотрудника<select required={form.role === 'EMPLOYEE'} value={form.employee_id} onChange={event => setForm({ ...form, employee_id: event.target.value })}><option value="">Без профиля</option>{employees.map(item => <option key={item.employee_id} value={item.employee_id}>{item.employee_id} · {item.full_name}</option>)}</select></label>{!editing && <label className="form-wide">Первоначальный пароль<input type="password" autoComplete="new-password" minLength={10} required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>}</div><label className="admin-check"><input type="checkbox" checked={form.is_active} onChange={event => setForm({ ...form, is_active: event.target.checked })} /> Учетная запись активна</label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy}>{busy ? 'Сохраняем...' : editing ? 'Сохранить изменения' : 'Создать пользователя'}</button></form> : <form onSubmit={resetPassword}><h2>Смена пароля</h2><p>{editing?.full_name} · @{editing?.username}</p><label>Новый пароль<input type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><small>После смены пароля все сессии пользователя будут завершены.</small>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy}>{busy ? 'Сохраняем...' : 'Сменить пароль'}</button></form>}</section></div>}
  </>;
}
