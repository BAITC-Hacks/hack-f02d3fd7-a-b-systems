import { useEffect, useState } from 'react';
import { Camera, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { api, type AuthUser } from './api';
import { UserAvatar } from './UserAvatar';

type Employee = { employee_id: string; full_name: string; role: string; department: string; manager_id: string | null;
  grade: string; hire_date: string; work_format: string };
type Profile = { display_name: string | null; phone: string | null; about: string;
  preferred_language: string; birth_date: string | null; has_avatar: boolean; last_seen_at: string | null };
type LoginEvent = { created_at: string; success: boolean; ip_address: string | null; user_agent: string | null };
type AuditEntry = { id: string; created_at: string; actor_name: string; field_name: string;
  old_value: string | null; new_value: string | null };
type Response = { user: AuthUser; profile: Profile; employee: Employee | null; loginHistory: LoginEvent[] };
const labels: Record<string,string> = { full_name:'ФИО',role:'должность',department:'подразделение',manager_id:'руководителя',
  grade:'грейд',hire_date:'дату приёма',work_format:'формат работы',birth_date:'дату рождения',phone:'телефон',
  about:'«О себе»',preferred_language:'язык',display_name:'отображаемое имя',avatar:'аватар' };
const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU',{ dateStyle:'medium',timeStyle:'short' });
function device(agent: string | null) {
  if (!agent) return 'Устройство не определено';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' :
    /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Браузер';
  const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' :
    /Windows/.test(agent) ? 'Windows' : /Mac OS/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return [browser,os].filter(Boolean).join(' · ');
}

export function ProfilePage({ user, onUserChange }: { user: AuthUser; onUserChange: (user: AuthUser) => void }) {
  const [data,setData] = useState<Response | null>(null);
  const [audit,setAudit] = useState<AuditEntry[]>([]);
  const [form,setForm] = useState({ display_name:'',phone:'',about:'',preferred_language:'ru',birth_date:'' });
  const [password,setPassword] = useState({ currentPassword:'',newPassword:'',confirmation:'' });
  const [avatarFile,setAvatarFile] = useState<File | null>(null);
  const [preview,setPreview] = useState('');
  const [avatarVersion,setAvatarVersion] = useState(0);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  async function load() {
    const [profile,history] = await Promise.all([
      api<Response>('/api/me/profile'),api<{ entries: AuditEntry[] }>('/api/audit/mine'),
    ]);
    setData(profile); setAudit(history.entries);
    setForm({ display_name:profile.profile?.display_name ?? '',phone:profile.profile?.phone ?? '',
      about:profile.profile?.about ?? '',preferred_language:profile.profile?.preferred_language ?? 'ru',
      birth_date:profile.profile?.birth_date ?? '' });
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  useEffect(() => { if (!avatarFile) { setPreview(''); return; }
    const url = URL.createObjectURL(avatarFile); setPreview(url); return () => URL.revokeObjectURL(url); },[avatarFile]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const payload: Record<string,string> = { phone:form.phone,about:form.about,preferred_language:form.preferred_language };
      if (user.role!=='EMPLOYEE') payload.display_name=form.display_name;
      if (!data?.profile?.birth_date && form.birth_date) payload.birth_date=form.birth_date;
      await api('/api/me/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      await load(); setNotice('Личные данные сохранены');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveAvatar(event: React.FormEvent) {
    event.preventDefault(); if (!avatarFile) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (avatarFile.size>2*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(avatarFile.type))
        throw new Error('Выберите PNG, JPEG или WebP до 2 МБ');
      const body = new FormData(); body.append('avatar',avatarFile);
      await api('/api/me/avatar',{method:'POST',body});
      setAvatarVersion(Date.now()); setAvatarFile(null);
      onUserChange({ ...user, has_avatar:true });
      await load(); setNotice('Аватар обновлён');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function savePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/me/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(password)});
      setPassword({ currentPassword:'',newPassword:'',confirmation:'' });
      await load(); setNotice('Пароль изменён; другие сессии завершены');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!data) return <div className="loading-page">{error || 'Загружаем профиль...'}</div>;
  const employee = data.employee;
  return <div className="profile-page">
    <div className="page-heading"><div><span className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span><h1>Мой профиль<span className="heading-dot">.</span></h1>
      <p>Личные настройки и кадровые данные в одном месте.</p></div></div>
    {notice && <div className="admin-notice">{notice}</div>}{error && <div className="form-error" role="alert">{error}</div>}
    <div className="profile-layout">
      <div className="profile-main-column">
        <section className="panel profile-identity"><UserAvatar id={user.id} name={user.full_name} hasAvatar={data.profile.has_avatar}
          version={avatarVersion} className="profile-avatar" /><div><span className="eyebrow">УЧЁТНАЯ ЗАПИСЬ</span>
          <h2>{data.profile.display_name || user.full_name}</h2><p>{user.email} · @{user.username}</p>
          <small>Системная роль: {user.role} · Бизнес-роль: {user.business_role}</small></div></section>
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">ПЕРСОНАЛЬНЫЕ ДАННЫЕ</span><h2>Настройки профиля</h2></div><UserRound size={21} /></div>
          <form className="profile-form" onSubmit={save}>
            {user.role!=='EMPLOYEE' && <label>Отображаемое имя<input value={form.display_name} maxLength={80} onChange={e=>setForm({ ...form,display_name:e.target.value })} /></label>}
            <label>Телефон<input value={form.phone} placeholder="+7 ..." onChange={e=>setForm({ ...form,phone:e.target.value })} /></label>
            <label>Предпочитаемый язык<select value={form.preferred_language} onChange={e=>setForm({ ...form,preferred_language:e.target.value })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label>
            <label>Дата рождения<input type="date" value={form.birth_date} disabled={!!data.profile.birth_date}
              onChange={e=>setForm({ ...form,birth_date:e.target.value })} />
              <small>{data.profile.birth_date ? 'Дата сохранена. Исправление доступно HR или ADMIN и фиксируется в аудите.' : 'Вы можете заполнить дату самостоятельно один раз.'}</small></label>
            <label className="form-wide">О себе<textarea rows={4} maxLength={1000} value={form.about}
              onChange={e=>setForm({ ...form,about:e.target.value })} placeholder="Расскажите о своих интересах и целях" /></label>
            <button className="button primary" disabled={busy}>Сохранить личные данные</button>
          </form>
        </section>
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">БЕЗОПАСНОСТЬ</span><h2>Смена пароля</h2></div><KeyRound size={21} /></div>
          <form className="profile-form password-form" onSubmit={savePassword}>
            <label>Текущий пароль<input type="password" autoComplete="current-password" required value={password.currentPassword} onChange={e=>setPassword({ ...password,currentPassword:e.target.value })} /></label>
            <label>Новый пароль<input type="password" autoComplete="new-password" required minLength={10} value={password.newPassword} onChange={e=>setPassword({ ...password,newPassword:e.target.value })} /></label>
            <label>Повтор нового пароля<input type="password" autoComplete="new-password" required minLength={10} value={password.confirmation} onChange={e=>setPassword({ ...password,confirmation:e.target.value })} /></label>
            <button className="button primary" disabled={busy}>Изменить пароль</button>
          </form>
        </section>
      </div>
      <div className="profile-side-column">
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">ФОТО ПРОФИЛЯ</span><h2>Аватар</h2></div><Camera size={21} /></div>
          <form className="avatar-form" onSubmit={saveAvatar}>{preview && <img className="avatar-preview" src={preview} alt="Предпросмотр аватара" />}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setAvatarFile(e.target.files?.[0] ?? null)} />
            <small>PNG, JPEG или WebP · до 2 МБ. Файл хранится в PostgreSQL.</small>
            <button className="button primary" disabled={!avatarFile || busy}>Загрузить аватар</button></form></section>
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">КАДРОВЫЕ ДАННЫЕ</span><h2>Для просмотра</h2></div><ShieldCheck size={21} /></div>
          <dl className="profile-facts">{Object.entries({ 'ФИО':employee?.full_name || user.full_name,'Email / логин':`${user.email} / ${user.username}`,
            'Employee ID':employee?.employee_id ?? 'Нет','Должность':employee?.role ?? '—','Подразделение':employee?.department ?? '—',
            'Руководитель':employee?.manager_id ?? '—','Грейд':employee?.grade ?? '—','Дата приёма':employee?.hire_date ?? '—',
            'Формат работы':employee?.work_format ?? '—' }).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <p className="profile-readonly-note">Кадровые и системные поля меняют только уполномоченные HR или ADMIN.</p></section>
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">БЕЗОПАСНОСТЬ</span><h2>История входов</h2></div></div>
          <p className="profile-muted">Последнее посещение: {data.profile.last_seen_at ? dateTime(data.profile.last_seen_at) : 'Не определено'}</p>
          <div className="profile-event-list">{data.loginHistory.map((item,index)=><div key={index}>
            <strong>{item.success ? 'Успешный вход' : 'Неуспешный вход'}</strong><span>{dateTime(item.created_at)}</span>
            <small>{device(item.user_agent)}{item.ip_address ? ` · IP ${item.ip_address}` : ''}</small></div>)}</div></section>
        <section className="panel"><div className="panel-header"><div><span className="eyebrow">ИСТОРИЯ ИЗМЕНЕНИЙ</span><h2>Мои данные</h2></div></div>
          <div className="profile-event-list">{audit.map(item=><div key={item.id}><strong>{item.actor_name} изменил(а) {labels[item.field_name] ?? item.field_name}</strong>
            <span>{dateTime(item.created_at)}</span><small>{item.old_value ?? '—'} → {item.new_value ?? '—'}</small></div>)}
            {!audit.length && <p className="profile-muted">Изменений пока нет.</p>}</div></section>
      </div>
    </div>
  </div>;
}
