import { useEffect, useState } from 'react';
import { Check, Pencil, Users, X } from 'lucide-react';
import { api, type AuthUser } from './api';

type Member={employee_id:string;full_name:string;department:string;position:string;grade:string;manager_id:string|null};
type Form={full_name:string;role:string;department:string;manager_id:string;grade:string;birth_date:string};
export function TeamPage({user,onOpenEmployee}:{user:AuthUser;onOpenEmployee:(id:string)=>void}) {
  const [people,setPeople]=useState<Member[]>([]);
  const [search,setSearch]=useState('');
  const [editing,setEditing]=useState<Member|null>(null);
  const [form,setForm]=useState<Form>({full_name:'',role:'',department:'',manager_id:'',grade:'',birth_date:''});
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const editable=user.role==='ADMIN'||user.role==='HR';
  async function load(){const result=await api<{employees:Member[]}>('/api/team');setPeople(result.employees)}
  useEffect(()=>{load().catch(e=>setError(e.message))},[]);
  function edit(member:Member){setEditing(member);setForm({full_name:member.full_name,role:member.position,
    department:member.department,manager_id:member.manager_id??'',grade:member.grade,birth_date:''});setError('')}
  async function save(event:React.FormEvent){event.preventDefault();if(!editing)return;setBusy(true);setError('');
    try{const payload:Record<string,string|null>={full_name:form.full_name,role:form.role,department:form.department,
      manager_id:form.manager_id||null,grade:form.grade};if(form.birth_date)payload.birth_date=form.birth_date;
      await api(`/api/hr/employees/${editing.employee_id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      setEditing(null);setNotice('Кадровые данные сохранены и записаны в аудит');await load();}
    catch(e){setError((e as Error).message)}finally{setBusy(false)} }
  const filtered=people.filter(person=>`${person.full_name} ${person.employee_id} ${person.department}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="team-page"><div className="page-heading"><div><span className="eyebrow">PEOPLE DIRECTORY</span>
    <h1>Команда<span className="heading-dot">.</span></h1><p>{editable?'Кадровые данные и подотчётные сотрудники.':'Сотрудники вашего подразделения.'}</p></div></div>
    {notice&&<div className="admin-notice"><Check size={16}/>{notice}</div>}{error&&!editing&&<div className="form-error">{error}</div>}
    <section className="panel"><div className="panel-header"><div><span className="eyebrow">EMPLOYEES</span><h2>Сотрудники</h2></div><span className="pill light"><Users size={15}/>{filtered.length}</span></div>
      <input className="team-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по имени, ID, подразделению"/>
      <div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Должность</th><th>Подразделение</th><th>Грейд</th><th>Руководитель</th><th>Действия</th></tr></thead>
        <tbody>{filtered.map(person=><tr key={person.employee_id}><td><strong>{person.full_name}</strong><small>{person.employee_id}</small></td>
          <td>{person.position}</td><td>{person.department}</td><td>{person.grade}</td><td>{person.manager_id??'—'}</td>
          <td><div className="admin-actions"><button onClick={()=>onOpenEmployee(person.employee_id)}>Профиль</button>{editable&&<button onClick={()=>edit(person)}><Pencil size={13}/>Изменить</button>}</div></td></tr>)}</tbody></table></div></section>
    {editing&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null)}}><section className="admin-dialog" role="dialog" aria-modal="true" aria-label="Кадровые данные">
      <div className="dialog-head"><h2>Кадровые данные · {editing.employee_id}</h2><button aria-label="Закрыть" onClick={()=>setEditing(null)}><X size={20}/></button></div>
      <form onSubmit={save}><div className="admin-form-grid"><label>ФИО<input required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label>
        <label>Должность<input required value={form.role} onChange={e=>setForm({...form,role:e.target.value})}/></label>
        <label>Подразделение<input required value={form.department} onChange={e=>setForm({...form,department:e.target.value})}/></label>
        <label>Грейд<select value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}>{['Junior','Middle','Senior','Lead'].map(grade=><option key={grade}>{grade}</option>)}</select></label>
        <label>Руководитель<select value={form.manager_id} onChange={e=>setForm({...form,manager_id:e.target.value})}><option value="">Нет</option>
          {people.filter(person=>person.employee_id!==editing.employee_id).map(person=><option key={person.employee_id} value={person.employee_id}>{person.employee_id} · {person.full_name}</option>)}</select></label>
        <label>Исправить дату рождения<input type="date" value={form.birth_date} onChange={e=>setForm({...form,birth_date:e.target.value})}/><small>Пустое поле оставит дату без изменений.</small></label></div>
        {error&&<div className="form-error">{error}</div>}<button className="button primary" disabled={busy}>Сохранить и записать аудит</button></form></section></div>}
  </div>;
}
