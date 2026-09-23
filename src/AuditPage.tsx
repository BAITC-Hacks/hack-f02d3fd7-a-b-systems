import { useEffect, useState } from 'react';
import { api, type AuthUser } from './api';

type Entry = { id:string;created_at:string;actor_name:string;target_name:string;action:string;entity_type:string;
  entity_id:string;field_name:string|null;old_value:string|null;new_value:string|null };
const fieldLabels:Record<string,string>={full_name:'ФИО',username:'логин',email:'email',role:'системная роль',business_role:'бизнес-роль',
  employee_id:'связь с сотрудником',is_active:'статус',birth_date:'дата рождения',department:'подразделение',
  manager_id:'руководитель',grade:'грейд',phone:'телефон',work_format:'формат работы',hire_date:'дата приёма'};
export function AuditPage({ user }: { user:AuthUser }) {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [filters,setFilters]=useState({from:'',to:'',target:'',actor:'',action:'',entity:'',search:''});
  const [error,setError]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>{
    const query=new URLSearchParams(filters);
    api<{entries:Entry[]}>(`/api/audit?${query}`).then(data=>{setEntries(data.entries);setError('')}).catch(e=>setError(e.message));
  },250);return()=>clearTimeout(timer)},[filters]);
  const set=(key:keyof typeof filters,value:string)=>setFilters(previous=>({...previous,[key]:value}));
  return <div className="audit-page"><div className="page-heading"><div><span className="eyebrow">CHANGE HISTORY</span>
    <h1>Журнал аудита<span className="heading-dot">.</span></h1><p>{user.role==='ADMIN'?'Все важные изменения системы.':'Разрешённые кадровые изменения.'}</p></div></div>
    <section className="panel"><div className="audit-filters"><label>С<input type="date" value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
      <label>По<input type="date" value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
      <label>Пользователь / ID<input value={filters.target} onChange={e=>set('target',e.target.value)} placeholder="UUID или employee ID"/></label>
      <label>Инициатор<input value={filters.actor} onChange={e=>set('actor',e.target.value)} placeholder="UUID"/></label>
      <label>Действие<input value={filters.action} onChange={e=>set('action',e.target.value)} placeholder="USER_UPDATED"/></label>
      <label>Entity<select value={filters.entity} onChange={e=>set('entity',e.target.value)}><option value="">Все</option>
        <option value="employee">Employee</option><option value="user">User</option><option value="user_profile">Profile</option></select></label>
      <label>Поиск<input value={filters.search} onChange={e=>set('search',e.target.value)} placeholder="Имя, поле, действие"/></label></div>
      {error && <div className="form-error">{error}</div>}
      <div className="table-wrap"><table><thead><tr><th>Когда</th><th>Инициатор</th><th>Цель</th><th>Действие</th><th>Поле</th><th>Было</th><th>Стало</th></tr></thead>
        <tbody>{entries.map(item=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString('ru-RU')}</td>
          <td>{item.actor_name}</td><td><strong>{item.target_name}</strong><small>{item.entity_type} · {item.entity_id}</small></td>
          <td>{item.action}</td><td>{fieldLabels[item.field_name??'']??item.field_name??'—'}</td>
          <td>{item.old_value??'—'}</td><td>{item.new_value??'—'}</td></tr>)}</tbody></table>
        {!entries.length && <div className="empty-small">Записей по фильтру нет.</div>}</div></section></div>;
}
