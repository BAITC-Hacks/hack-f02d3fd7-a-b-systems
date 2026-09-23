import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, CheckCheck, MessageCircle, Plus, Search, Send, Users, X } from 'lucide-react';
import { api, type AuthUser, type BusinessRole, type Role } from './api';
import { UserAvatar } from './UserAvatar';

type Person = { id:string; full_name:string; role:Role; business_role:BusinessRole; has_avatar:boolean };
type Chat = { id:string; kind:'direct'|'group'|'work'; title:string|null; work_kind:string|null;
  members:Person[]; unread:number; readOnly:boolean; lastMessage:{body:string;created_at:string}|null };
type Message = { id:string; sender_id:string; sender_name:string; sender_has_avatar:boolean; body:string;
  created_at:string; read_by:number };
type Summary = { id:string; created_at:string; covered_from:string; covered_to:string; covered_count:number;
  summary:{topics:string[];decisions:string[];tasks:string[];open_questions:string[]} };
const time = (value:string) => new Date(value).toLocaleString('ru-RU',{ day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' });
const canSummarize = (user:AuthUser) => user.role==='ADMIN' || user.role==='HR' ||
  ['DEPARTMENT_MANAGER','CONTACT_SUPERVISOR'].includes(user.business_role);
function title(chat:Chat,user:AuthUser) { return chat.title || chat.members.filter(member=>member.id!==user.id).map(member=>member.full_name).join(', ') || 'Диалог'; }
function SummaryCard({ item, team=false }: { item:Summary; team?:boolean }) {
  return <section className="chat-summary"><div><Bot size={19} /><strong>{team ? 'Сводка диалогов команды' : 'AI-сводка обсуждения'}</strong></div>
    <small>{time(item.covered_from)} — {time(item.covered_to)} · {item.covered_count} сообщений</small>
    {([['Основные темы','topics'],['Решения','decisions'],['Задачи','tasks'],['Открытые вопросы','open_questions']] as const)
      .map(([label,key])=><div className="summary-section" key={key}><strong>{label}</strong><ul>{item.summary[key].map((line,index)=><li key={index}>{line}</li>)}</ul></div>)}</section>;
}

export function ChatsPage({ user }: { user:AuthUser }) {
  const [chats,setChats] = useState<Chat[]>([]);
  const [selected,setSelected] = useState('');
  const [messages,setMessages] = useState<Message[]>([]);
  const [draft,setDraft] = useState('');
  const [search,setSearch] = useState('');
  const [picker,setPicker] = useState<'direct'|'group'|null>(null);
  const [candidates,setCandidates] = useState<Person[]>([]);
  const [chosen,setChosen] = useState<string[]>([]);
  const [groupTitle,setGroupTitle] = useState('');
  const [scope,setScope] = useState('last20');
  const [summary,setSummary] = useState<Summary|null>(null);
  const [teamSummary,setTeamSummary] = useState<Summary|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [mobileThread,setMobileThread] = useState(false);
  const active = chats.find(chat=>chat.id===selected);
  async function loadChats() {
    const result = await api<{chats:Chat[]}>('/api/chats');
    setChats(result.chats);
  }
  async function loadMessages(id:string) {
    const result = await api<{messages:Message[]}>(`/api/chats/${id}/messages`);
    setMessages(result.messages);
  }
  useEffect(() => { loadChats().catch(e=>setError(e.message));
    const timer=setInterval(()=>loadChats().catch(()=>{}),5000); return ()=>clearInterval(timer); },[]);
  useEffect(() => { if (!selected) return;
    let current=true;
    setSummary(null); loadMessages(selected).catch(e=>setError(e.message));
    if (canSummarize(user)) api<{summaries:Summary[]}>(`/api/chats/${selected}/summaries`)
      .then(data=>{if(current)setSummary(data.summaries[0] ?? null)}).catch(()=>{});
    const timer=setInterval(()=>loadMessages(selected).catch(()=>{}),5000); return ()=>{current=false;clearInterval(timer)}; },[selected]);
  useEffect(() => { if (user.business_role==='CONTACT_SUPERVISOR')
    api<{summaries:Summary[]}>('/api/chats/team-summaries')
      .then(data=>setTeamSummary(data.summaries[0] ?? null)).catch(()=>{}); },[user.business_role]);
  useEffect(() => { if (!picker) return;
    api<{users:Person[]}>(`/api/chats/users?q=${encodeURIComponent(search)}`).then(data=>setCandidates(data.users)).catch(e=>setError(e.message));
  },[picker,search]);
  async function startChat() {
    setBusy(true);setError('');
    try {
      const result=await api<{chatId:string}>('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:picker,memberIds:chosen,title:groupTitle})});
      setPicker(null);setChosen([]);setGroupTitle('');setSearch(''); await loadChats();setSelected(result.chatId);setMobileThread(true);
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function send(event:React.FormEvent) {
    event.preventDefault();if(!selected || !draft.trim())return;setBusy(true);setError('');
    try {await api(`/api/chats/${selected}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({body:draft})});setDraft('');await Promise.all([loadMessages(selected),loadChats()]);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function markRead() {
    if(!selected)return;try{await api(`/api/chats/${selected}/read`,{method:'POST'});await Promise.all([loadChats(),loadMessages(selected)]);}
    catch(e){setError((e as Error).message);}
  }
  async function makeSummary(team=false) {
    setBusy(true);setError('');
    try {const result=await api<{summary:Summary}>(team?'/api/chats/team-summary':`/api/chats/${selected}/summary`,
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope})});
      if(team)setTeamSummary(result.summary);else setSummary(result.summary);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="chats-page">
    <div className="page-heading"><div><span className="eyebrow">КОРПОРАТИВНАЯ СВЯЗЬ</span><h1>Чаты<span className="heading-dot">.</span></h1>
      <p>Обсуждения команды, HR и контакт-центра с историей в PostgreSQL.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {user.business_role==='CONTACT_SUPERVISOR' && <div className="team-summary-bar"><div><Bot size={21}/><span><strong>Поток обращений команды</strong><small>Без оценок и рейтингов сотрудников</small></span></div>
      <select value={scope} onChange={e=>setScope(e.target.value)} aria-label="Период сводки команды"><option value="last20">Последние 20</option><option value="last50">Последние 50</option><option value="today">Сегодня</option><option value="unread">Непрочитанные</option></select>
      <button className="button primary" disabled={busy} onClick={()=>makeSummary(true)}>Сводка диалогов команды</button></div>}
    {teamSummary && <SummaryCard item={teamSummary} team />}
    <div className={`chat-shell ${mobileThread?'chat-thread-open':''}`}>
      <aside className="chat-list panel"><div className="chat-list-head"><h2>Диалоги</h2><div><button aria-label="Новый диалог" title="Новый диалог" onClick={()=>{setPicker('direct');setChosen([])}}><MessageCircle size={18}/></button>
        <button aria-label="Создать группу" title="Создать группу" onClick={()=>{setPicker('group');setChosen([])}}><Plus size={19}/></button></div></div>
        <div className="chat-list-items">{chats.map(chat=><button key={chat.id} className={`chat-list-item ${selected===chat.id?'selected':''}`}
          onClick={()=>{setSelected(chat.id);setMobileThread(true)}}><UserAvatar id={chat.members.find(member=>member.id!==user.id)?.id ?? user.id}
          name={title(chat,user)} hasAvatar={chat.kind==='direct' && !!chat.members.find(member=>member.id!==user.id)?.has_avatar} className="chat-avatar" />
          <span><strong>{title(chat,user)}</strong><small>{chat.lastMessage?.body ?? 'Сообщений пока нет'}</small></span>
          <span className="chat-list-meta"><small>{chat.lastMessage ? time(chat.lastMessage.created_at) : ''}</small>{chat.unread>0 && <b>{chat.unread}</b>}</span></button>)}
          {!chats.length && <div className="empty-small">Диалогов пока нет. Начните беседу.</div>}</div></aside>
      <section className="chat-thread panel">{active ? <><div className="chat-thread-head"><button className="chat-back" aria-label="К списку чатов" onClick={()=>setMobileThread(false)}><ArrowLeft size={20}/></button>
        <UserAvatar id={active.members.find(member=>member.id!==user.id)?.id ?? user.id} name={title(active,user)}
          hasAvatar={active.kind==='direct' && !!active.members.find(member=>member.id!==user.id)?.has_avatar} className="chat-avatar" />
        <div><strong>{title(active,user)}</strong><small>{active.kind==='direct'?'Личный диалог':`${active.members.length} участников`}{active.readOnly?' · просмотр':''}</small></div>
        {active.unread>0 && !active.readOnly && <button className="chat-read" onClick={markRead}><CheckCheck size={16}/> Прочитано</button>}</div>
        <div className="chat-message-list">{messages.map(message=><div className={`chat-message ${message.sender_id===user.id?'mine':''}`} key={message.id}>
          <UserAvatar id={message.sender_id} name={message.sender_name} hasAvatar={message.sender_has_avatar} className="chat-message-avatar" />
          <div><span>{message.sender_name}</span><p>{message.body}</p><small>{time(message.created_at)}{message.sender_id===user.id ? ` · прочитали ${message.read_by}` : ''}</small></div></div>)}
          {!messages.length && <div className="empty-small">Начните обсуждение.</div>}</div>
        {!active.readOnly && <form className="chat-compose" onSubmit={send}><input value={draft} maxLength={4000} onChange={e=>setDraft(e.target.value)} placeholder="Написать сообщение..." aria-label="Сообщение" />
          <button className="button primary" disabled={busy||!draft.trim()} aria-label="Отправить"><Send size={17}/><span>Отправить</span></button></form>}
        {canSummarize(user) && (active.kind!=='direct'||active.work_kind==='contact') && <div className="chat-ai-tools"><select value={scope} onChange={e=>setScope(e.target.value)} aria-label="Период AI-сводки">
          <option value="last20">Последние 20 сообщений</option><option value="last50">Последние 50</option><option value="today">Сообщения за сегодня</option><option value="unread">Непрочитанные</option></select>
          <button className="button primary" disabled={busy} onClick={()=>makeSummary()}><Bot size={17}/> Сделать AI-сводку</button></div>}
        {summary && <SummaryCard item={summary}/>}</> : <div className="chat-placeholder"><Users size={33}/><h2>Выберите диалог</h2><p>Сообщения и сводки появятся здесь.</p></div>}</section>
    </div>
    {picker && <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPicker(null)}}><section className="admin-dialog chat-picker" role="dialog" aria-modal="true" aria-label="Новый чат">
      <div className="dialog-head"><div><span className="eyebrow">НОВЫЙ ЧАТ</span><h2>{picker==='group'?'Создать группу':'Личный диалог'}</h2></div><button aria-label="Закрыть" onClick={()=>setPicker(null)}><X size={20}/></button></div>
      {picker==='group' && <label>Название группы<input value={groupTitle} maxLength={100} onChange={e=>setGroupTitle(e.target.value)} placeholder="Например, команда проекта" /></label>}
      <label className="chat-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск пользователей" /></label>
      <div className="chat-candidates">{candidates.map(person=><button key={person.id} className={chosen.includes(person.id)?'chosen':''} onClick={()=>setChosen(picker==='direct'?[person.id]:chosen.includes(person.id)?chosen.filter(id=>id!==person.id):[...chosen,person.id])}>
        <UserAvatar id={person.id} name={person.full_name} hasAvatar={person.has_avatar} className="chat-avatar"/><span><strong>{person.full_name}</strong><small>{person.business_role}</small></span>{chosen.includes(person.id)&&<CheckCheck size={17}/>}</button>)}</div>
      <button className="button primary" disabled={busy || !chosen.length || (picker==='group'&&!groupTitle.trim())} onClick={startChat}>
        {picker==='group'?'Создать группу':'Открыть диалог'}</button></section></div>}
  </div>;
}
