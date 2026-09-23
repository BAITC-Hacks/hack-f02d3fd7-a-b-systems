import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Award, BookOpen, BriefcaseBusiness, CalendarDays, Check, CheckCircle2,
  ChevronDown, Clock3, Compass, Download, FileUp, Flame, GraduationCap,
  LayoutDashboard, LogOut, Menu, MessageCircle, Search, Settings2, ShieldCheck, Sparkles, Target,
  TrendingUp, UploadCloud, Users, X,
} from 'lucide-react';
import { api, type AuthUser } from './api';
import { LoginPage } from './LoginPage';
import { BrandLockup } from './Brand';
import { AdminPanel } from './AdminPanel';
import { LearningPage, type Achievement } from './LearningPage';
import { HRLearningPanel } from './HRLearningPanel';
import { ProfilePage } from './ProfilePage';
import { ChatsPage } from './ChatsPage';
import { AuditPage } from './AuditPage';
import { TeamPage } from './TeamPage';
import { UserAvatar } from './UserAvatar';

type View = 'overview' | 'journey' | 'history' | 'learning' | 'achievements' | 'chats' |
  'profile' | 'team' | 'contact' | 'audit' | 'hr' | 'admin';
type EmployeeListItem = { employee_id: string; full_name: string; role: string; grade: string; department: string };
type Gap = { skill_id: string; name: string; current: number; required: number; gap: number; critical: boolean };
type History = { record_id: string; event_id: string; event_title: string; date: string; status: string; completion_pct: number };
type Profile = {
  employee: EmployeeListItem & { tenure_months: number; work_format: string; hire_date: string; career_goal: { target_role: string; target_grade: string } | null };
  skills: Record<string, number>;
  trajectory: { target: { role: string; grade: string } | null; readiness: number; remaining: number; criticalRemaining: number; gaps: Gap[] };
  history: History[];
  skillCatalog: { skill_id: string; name: string }[];
  achievements: Achievement[];
};
type Recommendation = {
  event: { event_id: string; title: string; description: string; type: string; format: string; duration_hours: number };
  score: number;
  closes: { skill_id: string; name: string; from: number; to: number; required: number; critical: boolean }[];
  historyNote: string;
  why: string;
  nextSession: string | null;
};
type LearningRecommendation = { moduleId: string; title: string; description: string; durationMinutes: number;
  skillName: string; from: number; to: number; required: number; critical: boolean; why: string };
type RecommendationResponse = { source: 'openai' | 'rules'; recommendations: Recommendation[];
  learningRecommendation: LearningRecommendation | null; emptyReason: string | null };
type HRData = {
  totalEmployees: number; totalActivities: number; totalParticipation: number;
  withoutRecommendation: { employee_id: string; full_name: string; role: string; grade: string; gapCount: number }[];
  topGaps: { skill_id: string; name: string; count: number; criticalCount: number }[];
  activityStats: { event_id: string; title: string; type: string; mandatory: boolean; total: number;
    completed: number; in_progress: number; no_show: number; declined: number; dropped: number; overdue: number }[];
};

const statusLabel: Record<string, string> = {
  completed: 'Завершено', in_progress: 'В процессе', dropped: 'Прервано',
  no_show: 'Неявка', declined: 'Отказ', overdue: 'Просрочено',
};
const formatLabel: Record<string, string> = { online: 'Онлайн', offline: 'Очно', self_paced: 'В своём темпе' };
const month = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dateLabel = (value: string) => month.format(new Date(`${value}T12:00:00`));
const initials = (name: string) => name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();

function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: AuthUser }>('/api/auth/me').then(data => setUser(data.user)).catch(() => setUser(null));
    const expire = () => setUser(null);
    window.addEventListener('careerquest:unauthorized', expire);
    return () => window.removeEventListener('careerquest:unauthorized', expire);
  }, []);
  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { setUser(null); }
  }
  if (user === undefined) return <div className="loading-page auth-loading">Загружаем Career Quest...</div>;
  if (!user) return <LoginPage onLogin={setUser} />;
  return <CareerWorkspace key={user.id} user={user} onLogout={signOut} onUserChange={setUser} />;
}

function CareerWorkspace({ user, onLogout, onUserChange }: { user: AuthUser; onLogout: () => void;
  onUserChange: (next: AuthUser) => void }) {
  const [view, setView] = useState<View>(user.business_role === 'CONTACT_CLIENT' ? 'chats' : 'overview');
  const [avatarVersion,setAvatarVersion] = useState(0);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [asOf, setAsOf] = useState('2026-10-01');
  const [selectedId, setSelectedId] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recs, setRecs] = useState<RecommendationResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hr, setHr] = useState<HRData | null>(null);
  const [hrError, setHrError] = useState('');
  const [toast, setToast] = useState('');
  const [busyEvent, setBusyEvent] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    api<{ employees: EmployeeListItem[]; asOf: string }>('/api/bootstrap')
      .then(data => {
        setEmployees(data.employees);
        setAsOf(data.asOf);
        setSelectedId(user.role === 'EMPLOYEE' ? (user.employee_id || '') :
          (data.employees.find(item => item.employee_id === 'E0028')?.employee_id || data.employees[0]?.employee_id || ''));
      }).catch(error => setToast(error.message));
  }, []);

  function refreshEmployee(id: string) {
    setProfileLoading(true);
    setRecommendationLoading(true);
    setRecs(null);
    api<Profile>(`/api/employees/${id}`).then(setProfile).catch(error => setToast(error.message))
      .finally(() => setProfileLoading(false));
    api<RecommendationResponse>(`/api/employees/${id}/recommendations`).then(setRecs)
      .catch(error => setToast(error.message)).finally(() => setRecommendationLoading(false));
  }

  useEffect(() => { if (selectedId) refreshEmployee(selectedId); }, [selectedId]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (view === 'hr') loadHR();
  }, [view]);

  function loadHR() {
    api<HRData>('/api/hr/dashboard')
      .then(data => { setHr(data); setHrError(''); })
      .catch(error => { setHr(null); setHrError(error.message); });
  }

  async function complete(eventId: string) {
    if (!selectedId) return;
    setBusyEvent(eventId);
    try {
      await api(`/api/employees/${selectedId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId }),
      });
      setToast('Готово! Навыки и карьерная траектория обновлены.');
      refreshEmployee(selectedId);
    } catch (error) { setToast((error as Error).message); }
    finally { setBusyEvent(''); }
  }

  async function importData(event: React.FormEvent) {
    event.preventDefault();
    if (!employeesFile && !historyFile) { setToast('Выберите хотя бы один файл.'); return; }
    setImportBusy(true);
    const form = new FormData();
    if (employeesFile) form.append('employees', employeesFile);
    if (historyFile) form.append('history', historyFile);
    try {
      const result = await api<{ employees: number; history: number }>('/api/hr/import', {
        method: 'POST', body: form,
      });
      setToast(`Загружено: ${result.employees} профилей, ${result.history} записей истории.`);
      setEmployeesFile(null); setHistoryFile(null);
      const bootstrap = await api<{ employees: EmployeeListItem[] }>('/api/bootstrap');
      setEmployees(bootstrap.employees);
      loadHR();
      if (selectedId) refreshEmployee(selectedId);
    } catch (error) { setToast((error as Error).message); }
    finally { setImportBusy(false); }
  }

  const filteredEmployees = useMemo(() => employees.filter(item =>
    `${item.full_name} ${item.employee_id} ${item.role}`.toLowerCase().includes(search.toLowerCase())).slice(0, 24), [employees, search]);
  const current = profile?.employee;
  const openGaps = profile?.trajectory.gaps.filter(gap => gap.gap > 0) ?? [];
  const topGaps = openGaps.slice(0, 4);
  const completed = profile?.history.filter(row => row.status === 'completed').length ?? 0;

  function changeView(next: View) { setView(next); setMobileMenu(false); }

  return <div className="shell">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <BrandLockup inverse />
      {user.business_role !== 'CONTACT_CLIENT' && <><div className="sidebar-label">WORKSPACE</div>
      <nav className="nav-list">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => changeView('overview')}><LayoutDashboard size={19} /> Обзор <span className="nav-indicator" /></button>
        <button className={view === 'journey' ? 'active' : ''} onClick={() => changeView('journey')}><TrendingUp size={19} /> Моя траектория <span className="nav-indicator" /></button>
        <button className={view === 'learning' ? 'active' : ''} onClick={() => changeView('learning')}><GraduationCap size={19} /> Обучение <span className="nav-indicator" /></button>
        <button className={view === 'achievements' ? 'active' : ''} onClick={() => changeView('achievements')}><Award size={19} /> Достижения <span className="nav-indicator" /></button>
        <button className={view === 'chats' ? 'active' : ''} onClick={() => changeView('chats')}><MessageCircle size={19} /> Чаты <span className="nav-indicator" /></button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => changeView('history')}><Clock3 size={19} /> История <span className="nav-indicator" /></button>
        <button className={view === 'profile' ? 'active' : ''} onClick={() => changeView('profile')}><Users size={19} /> Мой профиль <span className="nav-indicator" /></button>
      </nav>
      </>}
      {user.business_role === 'CONTACT_CLIENT' && <><div className="sidebar-label">WORKSPACE</div><nav className="nav-list"><button className={view === 'chats' ? 'active' : ''} onClick={() => changeView('chats')}><MessageCircle size={19} /> Чаты <span className="nav-indicator" /></button><button className={view === 'profile' ? 'active' : ''} onClick={() => changeView('profile')}><Users size={19} /> Мой профиль <span className="nav-indicator" /></button></nav></>}
      {(user.role !== 'EMPLOYEE' || ['DEPARTMENT_MANAGER','CONTACT_SUPERVISOR'].includes(user.business_role)) && <><div className="sidebar-label team-label">КОМАНДА</div><nav className="nav-list">
        {user.role !== 'EMPLOYEE' && <button className={view === 'hr' ? 'active' : ''} onClick={() => changeView('hr')}><Users size={19} /> HR аналитика <span className="nav-indicator" /></button>}
        <button className={view === 'team' ? 'active' : ''} onClick={() => changeView('team')}><Users size={19} /> Команда <span className="nav-indicator" /></button></nav></>}
      {['CONTACT_OPERATOR','CONTACT_SUPERVISOR'].includes(user.business_role) && <><div className="sidebar-label team-label">КОНТАКТ-ЦЕНТР</div><nav className="nav-list"><button className={view === 'contact' ? 'active' : ''} onClick={() => changeView('contact')}><MessageCircle size={19} /> Контакт-центр <span className="nav-indicator" /></button></nav></>}
      {(user.role === 'ADMIN' || user.role === 'HR') && <><div className="sidebar-label team-label">УПРАВЛЕНИЕ</div><nav className="nav-list">
        {user.role === 'ADMIN' && <button className={view === 'admin' ? 'active' : ''} onClick={() => changeView('admin')}><Settings2 size={19} /> Администрирование <span className="nav-indicator" /></button>}
        <button className={view === 'audit' ? 'active' : ''} onClick={() => changeView('audit')}><ShieldCheck size={19} /> Журнал аудита <span className="nav-indicator" /></button></nav></>}
      <div className="sidebar-bottom">
        <div className="mini-orbit"><Sparkles size={20} /><span>Каждый шаг<br />имеет значение.</span></div>
         <div className="sidebar-profile"><UserAvatar id={user.id} name={user.full_name} hasAvatar={user.has_avatar} version={avatarVersion} className="small" /><div><strong>{user.full_name}</strong><small>{user.role}</small></div></div>
         <button className="logout-button" onClick={onLogout}><LogOut size={17} /> Выйти</button>
      </div>
    </aside>
    {mobileMenu && <button className="drawer-backdrop" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)} />}

    <div className="workspace">
      <header className="topbar">
        <button className="menu-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Меню">{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button>
        <div className="mobile-brand"><BrandLockup compact /></div>
         <div className="breadcrumb">Рабочее пространство <span>/</span> <strong>{({admin:'Администрирование',hr:'HR аналитика',learning:'Обучение',journey:'Моя траектория',history:'История активностей',profile:'Мой профиль',chats:'Чаты',team:'Команда',contact:'Контакт-центр',audit:'Журнал аудита',achievements:'Достижения',overview:'Обзор'} as Record<View,string>)[view]}</strong></div>
         <div className="top-actions"><span className="snapshot"><span className="live-dot" /> Срез данных · {dateLabel(asOf)}</span><UserAvatar id={user.id} name={user.full_name} hasAvatar={user.has_avatar} version={avatarVersion} className="top-avatar" /></div>
      </header>

      <main className="main-content">
         {['overview','journey','learning','history','achievements'].includes(view) && <div className="employee-switcher-wrap">
           {user.role === 'EMPLOYEE' ? <div className="employee-switcher employee-fixed"><Users size={17} /> <span>{current ? `${current.full_name} · ${current.employee_id}` : 'Ваш профиль'}</span></div> : <><button className="employee-switcher" onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /><span>{current ? `${current.full_name} · ${current.employee_id}` : 'Выберите сотрудника'}</span><ChevronDown size={17} /></button>
           {searchOpen && <div className="employee-dropdown"><input autoFocus placeholder="Имя, ID или роль..." value={search} onChange={event => setSearch(event.target.value)} /><div className="employee-options">{filteredEmployees.map(item => <button key={item.employee_id} onClick={() => { setSelectedId(item.employee_id); setSearchOpen(false); setSearch(''); }}><span className="avatar option-avatar">{initials(item.full_name)}</span><span><strong>{item.full_name}</strong><small>{item.employee_id} · {item.role} · {item.grade}</small></span></button>)}</div></div>}</>}
         </div>}

         {view === 'profile' ? <ProfilePage user={user} onUserChange={next=>{setAvatarVersion(Date.now());onUserChange(next)}} />
           : (view === 'chats' || view === 'contact') ? <ChatsPage user={user} />
           : view === 'team' ? <TeamPage user={user} onOpenEmployee={id=>{setSelectedId(id);changeView('overview')}} />
           : view === 'audit' ? <AuditPage user={user} />
           : view === 'achievements' ? <><div className="page-heading"><div><span className="eyebrow">CAREER MILESTONES</span><h1>Достижения<span className="heading-dot">.</span></h1><p>Завершённые шаги и признание прогресса.</p></div></div><section className="panel achievements-panel"><div className="achievement-grid">{profile?.achievements?.map(item=><div className="achievement-badge" key={item.achievement_id}><span><Award size={24}/></span><div><strong>{item.title}</strong><p>{item.description}</p><small>{item.awarded_at ? new Date(item.awarded_at).toLocaleDateString('ru-RU') : ''}</small></div></div>)}{!profile?.achievements?.length&&<div className="achievement-empty">Первое достижение появится после обучения.</div>}</div></section></>
           : view === 'admin' && user.role === 'ADMIN' ? <AdminPanel currentUser={user} /> : view === 'hr' ? (hr ? <><div className="page-heading"><div><span className="eyebrow">PEOPLE ANALYTICS</span><h1>Пульс развития команды<span className="heading-dot">.</span></h1><p>Где сейчас больше всего разрывов и кому нужен следующий шаг.</p></div><span className="pill violet"><ShieldCheck size={15} /> Доступ HR</span></div>
            <div className="metric-grid hr-metrics"><Metric icon={<Users size={21} />} label="Сотрудников" value={hr.totalEmployees} tone="blue" /><Metric icon={<Target size={21} />} label="Без следующего шага" value={hr.withoutRecommendation.length} tone="amber" /><Metric icon={<BookOpen size={21} />} label="Активностей" value={hr.totalActivities} tone="violet" /><Metric icon={<CheckCircle2 size={21} />} label="Участий в истории" value={hr.totalParticipation} tone="green" /></div>
            <div className="hr-grid"><section className="panel"><div className="panel-header"><div><span className="eyebrow">SKILL INTELLIGENCE</span><h2>Частые разрывы</h2></div><span className="subtle">Количество сотрудников</span></div><div className="gap-chart">{hr.topGaps.map((item, index) => <div className="chart-row" key={item.skill_id}><span className="chart-rank">{String(index + 1).padStart(2, '0')}</span><div className="chart-main"><div><strong>{item.name}</strong><small>{item.criticalCount} критичных</small></div><div className="chart-track"><span style={{ width: `${Math.max(7, item.count / hr.totalEmployees * 100)}%` }} /></div></div><strong className="chart-number">{item.count}</strong></div>)}</div></section>
              <section className="panel no-step-panel"><div className="panel-header"><div><span className="eyebrow">REQUIRES ATTENTION</span><h2>Без рекомендации</h2></div><span className="count-badge">{hr.withoutRecommendation.length}</span></div><p className="panel-intro">Нет доступной активности, закрывающей разрыв с учётом допуска и истории.</p><div className="no-step-list">{hr.withoutRecommendation.slice(0, 7).map(item => <button key={item.employee_id} onClick={() => { setSelectedId(item.employee_id); changeView('overview'); }}><span className="avatar option-avatar">{initials(item.full_name)}</span><span><strong>{item.full_name}</strong><small>{item.role} · {item.grade}</small></span><span className="gap-count">{item.gapCount} gaps</span></button>)}{!hr.withoutRecommendation.length && <div className="empty-small">У каждого сотрудника есть доступный шаг.</div>}</div></section></div>
            <section className="panel participation-panel"><div className="panel-header"><div><span className="eyebrow">ENGAGEMENT</span><h2>Участие по активностям</h2></div><span className="subtle">Топ по числу записей</span></div><div className="table-wrap"><table><thead><tr><th>Активность</th><th>Всего</th><th>Завершено</th><th>Неявка</th><th>Отказ</th><th>Прервано</th></tr></thead><tbody>{hr.activityStats.slice(0, 12).map(item => <tr key={item.event_id}><td><strong>{item.title}</strong><small>{item.event_id} · {item.type}{item.mandatory ? ' · mandatory' : ''}</small></td><td>{item.total}</td><td><span className="table-completed">{item.completed}</span></td><td>{item.no_show}</td><td>{item.declined}</td><td>{item.dropped}</td></tr>)}</tbody></table></div></section>
            <section className="panel import-panel"><div className="import-icon"><UploadCloud size={24} /></div><div className="import-copy"><span className="eyebrow">JURY DATA READY</span><h2>Загрузить проверочные данные</h2><p>Поддерживаются employees.json и activity_history.csv. Можно выбрать один или оба файла. Существующие ID обновятся.</p></div><form onSubmit={importData}><label className="file-input"><FileUp size={18} /><span>{employeesFile?.name || 'employees.json'}</span><input type="file" accept=".json,application/json" onChange={event => setEmployeesFile(event.target.files?.[0] || null)} /></label><label className="file-input"><FileUp size={18} /><span>{historyFile?.name || 'activity_history.csv'}</span><input type="file" accept=".csv,text/csv" onChange={event => setHistoryFile(event.target.files?.[0] || null)} /></label><button className="button primary" disabled={importBusy}>{importBusy ? 'Загрузка...' : 'Импортировать'} <ArrowRight size={17} /></button></form></section>
            <HRLearningPanel onSelectEmployee={id => { setSelectedId(id); changeView('overview'); }} />
           </> : <div className="loading-page">{hrError || 'Загружаем HR-аналитику...'}</div>)
          : view === 'learning' ? (selectedId ? <LearningPage employeeId={selectedId} canParticipate={user.role === 'EMPLOYEE' && user.employee_id === selectedId} onCompleted={() => refreshEmployee(selectedId)} onJourney={() => changeView('journey')} /> : <div className="loading-page">Загружаем профиль сотрудника...</div>)
          : profileLoading || !profile ? <div className="loading-page">Загружаем профиль сотрудника...</div>
          : <>
            <div className="page-heading"><div><span className="eyebrow">{view === 'overview' ? 'ВАШ КАРЬЕРНЫЙ НАВИГАТОР' : view === 'journey' ? 'ПЕРСОНАЛЬНАЯ ТРАЕКТОРИЯ' : 'ВАШИ АКТИВНОСТИ'}</span><h1>{view === 'overview' ? <>Привет, {current?.full_name.split(' ')[0]}<span className="heading-dot">.</span></> : view === 'journey' ? <>Ваш путь роста<span className="heading-dot">.</span></> : <>История развития<span className="heading-dot">.</span></>}</h1><p>{view === 'overview' ? 'Понимайте, куда ведёт каждый шаг. Развивайтесь в своём темпе.' : view === 'journey' ? 'Навыки, требования следующего грейда и ваш прогресс в одном месте.' : 'Завершённые активности и все этапы участия.'}</p></div><div className="heading-icon">{view === 'overview' ? <Sparkles size={24} /> : view === 'journey' ? <Target size={24} /> : <Clock3 size={24} />}</div></div>
            {view === 'overview' && <><div className="hero-grid"><section className="profile-card"><div className="profile-card-top"><div className="avatar large">{initials(current!.full_name)}</div><span className="pill light"><span className="live-dot" /> Ваш профиль</span></div><h2>{current!.full_name}</h2><p className="profile-role">{current!.role}</p><div className="profile-details"><div><BriefcaseBusiness size={17} /><span>{current!.department}</span></div><div><GraduationCap size={17} /><span>{current!.grade}</span></div><div><CalendarDays size={17} /><span>{current!.tenure_months} мес. в компании</span></div></div><div className="profile-footer"><span>Цель развития</span><strong>{profile.trajectory.target ? `${profile.trajectory.target.role} · ${profile.trajectory.target.grade}` : 'Не указана'}</strong></div></section>
                <section className="progress-card"><div className="progress-copy"><span className="eyebrow">ВАША ТРАЕКТОРИЯ</span><h2>Ближе к следующему уровню</h2><p>Готовность по требованиям целевого грейда</p><div className="progress-stats"><div><strong>{profile.trajectory.remaining}</strong><span>навыков подтянуть</span></div><div><strong>{profile.trajectory.criticalRemaining}</strong><span>критичных разрывов</span></div></div><button className="text-link" onClick={() => changeView('journey')}>Смотреть траекторию <ArrowRight size={17} /></button></div><div className="progress-ring" style={{ background: `conic-gradient(#b9ee6a ${profile.trajectory.readiness}%, rgba(255,255,255,.13) 0)` }}><div><strong>{profile.trajectory.readiness}%</strong><span>готовность</span></div></div><div className="progress-orb orb-one" /><div className="progress-orb orb-two" /></section></div>
              <div className="metric-grid"><Metric icon={<Target size={20} />} label="Целевой грейд" value={profile.trajectory.target?.grade || '—'} tone="blue" /><Metric icon={<CheckCircle2 size={20} />} label="Завершено активностей" value={completed} tone="green" /><Metric icon={<Flame size={20} />} label="Навыков в развитии" value={openGaps.length} tone="amber" /></div>
              <div className="content-grid"><section className="panel recommendations-panel"><div className="panel-header"><div><span className="eyebrow">NEXT BEST STEPS</span><h2>Ваши следующие шаги</h2></div><span className="pill violet"><Sparkles size={15} /> {recs?.source === 'openai' ? 'OpenAI recommendation' : 'Умный подбор'}</span></div><p className="panel-intro">Активности подобраны с учётом цели, критичных навыков, истории участия и условий допуска.</p>{recommendationLoading ? <div className="loading-inline">Подбираем персональные активности...</div> : recs?.recommendations.length ? <div className="recommendation-list">{recs.recommendations.map((item, index) => <RecommendationCard key={item.event.event_id} item={item} index={index} busy={busyEvent === item.event.event_id} canComplete={user.role !== 'HR'} onComplete={() => complete(item.event.event_id)} />)}</div> : <div className="empty-state"><Sparkles size={24} /><strong>Следующий шаг пока не найден</strong><span>{recs?.emptyReason || 'Проверяем доступные активности.'}</span></div>}</section>
                <section className="panel gaps-panel"><div className="panel-header"><div><span className="eyebrow">FOCUS AREAS</span><h2>Навыки для роста</h2></div><button className="icon-link" onClick={() => changeView('journey')} aria-label="Все навыки"><ArrowRight size={18} /></button></div><p className="panel-intro">Наиболее значимые разрывы до целевого уровня.</p><div className="skill-preview-list">{topGaps.map(gap => <SkillBar key={gap.skill_id} gap={gap} />)}{!topGaps.length && <div className="empty-small">Все требования цели выполнены.</div>}</div><div className="gaps-footer"><Target size={18} /><span>Критичные навыки имеют приоритет в рекомендациях.</span></div></section></div>
              {recs?.learningRecommendation && <section className="learning-recommendation"><div className="learning-recommendation-icon"><GraduationCap size={25} /></div><div className="learning-recommendation-copy"><span className="eyebrow">РЕКОМЕНДОВАННОЕ ДЕМО-ОБУЧЕНИЕ</span><h2>{recs.learningRecommendation.title}</h2><p>{recs.learningRecommendation.why}</p><div><span>{recs.learningRecommendation.skillName} {recs.learningRecommendation.from} → {recs.learningRecommendation.to}</span><span>{recs.learningRecommendation.durationMinutes} минут</span></div></div><button className="button primary" onClick={() => changeView('learning')}>{user.role === 'EMPLOYEE' ? 'Открыть обучение' : 'Посмотреть курс'} <ArrowRight size={17} /></button></section>}
              <section className="panel achievements-panel"><div className="panel-header"><div><span className="eyebrow">CAREER MILESTONES</span><h2>Достижения</h2></div><span className="pill light"><Award size={15} /> {profile.achievements?.length ?? 0}</span></div>{profile.achievements?.length ? <div className="achievement-grid">{profile.achievements.map(item => <div className="achievement-badge" key={item.achievement_id}><span><Award size={24} /></span><div><strong>{item.title}</strong><p>{item.description}</p><small>{item.awarded_at ? new Date(item.awarded_at).toLocaleDateString('ru-RU') : 'Получено'}</small></div></div>)}</div> : <div className="achievement-empty"><Award size={23} /><span>Первое достижение появится здесь после успешного обучения.</span></div>}</section></>}
            {view === 'journey' && <><section className="journey-banner"><div><span className="eyebrow">CAREER PATH</span><h2>{current!.grade} <ArrowRight size={25} /> {profile.trajectory.target?.grade || current!.grade}</h2><p>{current!.role} · {profile.trajectory.target?.role || current!.role}</p></div><div className="journey-readiness"><strong>{profile.trajectory.readiness}%</strong><span>готовность к цели</span></div></section><div className="journey-content"><section className="panel"><div className="panel-header"><div><span className="eyebrow">SKILL MAP</span><h2>Требования к следующему грейду</h2></div><span className="pill light">{profile.trajectory.gaps.length} навыков</span></div><div className="full-skill-list">{profile.trajectory.gaps.map(gap => <SkillBar key={gap.skill_id} gap={gap} expanded />)}</div></section><section className="panel journey-side"><span className="eyebrow">КАК ЭТО РАБОТАЕТ</span><h2>Ваш прогресс живой</h2><div className="journey-explain"><div><span>01</span><strong>Сравниваем навыки</strong><p>Берём требования целевой роли и грейда, выделяем критичные разрывы.</p></div><div><span>02</span><strong>Подбираем шаги</strong><p>Учитываем историю, prerequisites и прирост по каждой активности.</p></div><div><span>03</span><strong>Обновляем путь</strong><p>После завершения пересчитываем уровень с учётом gain и max_level.</p></div></div></section></div></>}
            {view === 'history' && <section className="panel history-panel"><div className="panel-header"><div><span className="eyebrow">ACTIVITY LOG</span><h2>История участия</h2></div><span className="pill light">{profile.history.length} записей</span></div><div className="history-list">{profile.history.map(row => <div className="history-item" key={row.record_id}><div className={`history-icon ${row.status}`}><BookOpen size={18} /></div><div><strong>{row.event_title}</strong><small>{row.event_id} · {dateLabel(row.date)}</small></div><span className={`status ${row.status}`}>{statusLabel[row.status] || row.status}</span></div>)}</div></section>}
          </>}
      </main>
    </div>
    {toast && <div className="toast"><Check size={18} /> {toast}<button onClick={() => setToast('')} aria-label="Закрыть"><X size={16} /></button></div>}
  </div>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function SkillBar({ gap, expanded = false }: { gap: Gap; expanded?: boolean }) {
  return <div className={`skill-bar ${expanded ? 'expanded' : ''}`}><div className="skill-bar-head"><div><strong>{gap.name}</strong>{gap.critical && <span className="critical-tag">Критичный</span>}</div><span>{gap.current} <em>/ {gap.required}</em></span></div><div className="skill-track"><span style={{ width: `${Math.min(100, gap.current / gap.required * 100)}%` }} /></div>{expanded && <small>{gap.gap ? `Осталось +${gap.gap} до цели` : 'Цель достигнута'}</small>}</div>;
}

function RecommendationCard({ item, index, onComplete, busy, canComplete }: { item: Recommendation; index: number; onComplete: () => void; busy: boolean; canComplete: boolean }) {
  return <article className={`recommendation-card ${index === 0 ? 'featured' : ''}`}><div className="recommendation-top"><span className="recommendation-number">{String(index + 1).padStart(2, '0')}</span><span className="rec-type">{item.event.type}</span>{item.closes.some(skill => skill.critical) && <span className="priority-badge"><Sparkles size={12} /> Приоритет</span>}</div><h3>{item.event.title}</h3><p className="rec-description">{item.event.description}</p><div className="rec-meta"><span><Clock3 size={15} /> {item.event.duration_hours} ч</span><span><Compass size={15} /> {formatLabel[item.event.format] || item.event.format}</span>{item.nextSession && <span><CalendarDays size={15} /> {dateLabel(item.nextSession)}</span>}</div><div className="rec-impact"><strong>Почему это ваш шаг</strong><p>{item.why}</p><div className="rec-skills">{item.closes.map(skill => <span key={skill.skill_id}>{skill.name} {skill.from} → {skill.to}</span>)}</div></div>{canComplete && <button className="button complete-button" onClick={onComplete} disabled={busy}>{busy ? 'Обновляем...' : 'Отметить выполненной'} <CheckCircle2 size={17} /></button>}</article>;
}

export default App;
