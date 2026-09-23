import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import type { AuthUser, BusinessRole } from './auth.js';
import { summarizeChat, type SummaryMessage } from './aiChat.js';

export const chatRouter = Router();
type Person = { id: string; full_name: string; role: AuthUser['role']; business_role: BusinessRole;
  employee_id: string | null; is_active: boolean; has_avatar: boolean; department: string | null; manager_id: string | null };
type Chat = { id: string; kind: 'direct'|'group'|'work'; title: string|null; work_kind: string|null;
  created_by: string|null; created_at: string; members: Person[] };
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
function respond(error: unknown, res: import('express').Response, next: import('express').NextFunction) {
  const err = error as Error & { status?: number };
  if (err.status) res.status(err.status).json({ error: err.message }); else next(error);
}
const peopleSql = `SELECT u.id,u.full_name,u.role,u.business_role,u.employee_id,u.is_active,
  (p.avatar_data IS NOT NULL) AS has_avatar,e.data->>'department' AS department,
  e.data->>'manager_id' AS manager_id FROM users u
  LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN employees e ON e.employee_id=u.employee_id`;
async function person(id: string): Promise<Person | undefined> {
  return (await pool.query<Person>(`${peopleSql} WHERE u.id=$1`,[id])).rows[0];
}
function canDirect(a: Person, b: Person) {
  if (!a.is_active || !b.is_active || a.id===b.id) return false;
  const pair = new Set([a.business_role,b.business_role]);
  if (pair.has('CONTACT_CLIENT')) return pair.has('CONTACT_OPERATOR');
  if (a.role==='ADMIN' || b.role==='ADMIN') return true;
  if (pair.has('HR_SPECIALIST')) return true;
  if (pair.has('CONTACT_OPERATOR') || pair.has('CONTACT_SUPERVISOR')) {
    if (pair.has('CONTACT_OPERATOR') && pair.has('CONTACT_SUPERVISOR')) {
      const op = a.business_role==='CONTACT_OPERATOR' ? a : b;
      const sup = a.business_role==='CONTACT_SUPERVISOR' ? a : b;
      return op.manager_id===sup.employee_id;
    }
    return false;
  }
  if (pair.has('DEPARTMENT_MANAGER')) {
    const manager = a.business_role==='DEPARTMENT_MANAGER' ? a : b;
    const employee = manager.id===a.id ? b : a;
    return employee.manager_id===manager.employee_id;
  }
  return a.business_role==='COMPANY_EMPLOYEE' && b.business_role==='COMPANY_EMPLOYEE';
}
async function loadChats(): Promise<Chat[]> {
  const [chats,members] = await Promise.all([
    pool.query<Omit<Chat,'members'>>('SELECT * FROM chats ORDER BY created_at DESC LIMIT 500'),
    pool.query<Person & { chat_id: string }>(`${peopleSql.replace('SELECT u.id','SELECT cm.chat_id,u.id')}
      JOIN chat_members cm ON cm.user_id=u.id`),
  ]);
  return chats.rows.map(chat => ({ ...chat, members: members.rows.filter(item => item.chat_id===chat.id) }));
}
function canRead(user: AuthUser, chat: Chat) {
  if (user.role==='ADMIN' || chat.members.some(item => item.id===user.id)) return true;
  return user.business_role==='CONTACT_SUPERVISOR' && chat.work_kind==='contact' &&
    chat.members.some(item => item.business_role==='CONTACT_OPERATOR' && item.manager_id===user.employee_id);
}
function isMember(user: AuthUser, chat: Chat) { return chat.members.some(item => item.id===user.id); }
async function authorizedChat(user: AuthUser, id: string) {
  const chat = (await loadChats()).find(item => item.id===id);
  if (!chat) throw fail('Чат не найден',404);
  if (!canRead(user,chat)) throw fail('Нет доступа к сообщениям',403);
  return chat;
}
async function messagesFor(chatId: string, limit = 200): Promise<SummaryMessage[]> {
  const result = await pool.query<SummaryMessage>(`SELECT m.id,m.body,m.created_at::text AS created_at,
    COALESCE(p.display_name,u.full_name) AS sender FROM messages m
    JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=u.id
    WHERE m.chat_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2`,[chatId,limit]);
  return result.rows.reverse();
}

chatRouter.get('/chats/users', async (req,res,next) => {
  try {
    const query = typeof req.query.q==='string' ? req.query.q.trim().slice(0,80) : '';
    const users = (await pool.query<Person>(`${peopleSql} WHERE u.is_active=true AND u.id<>$1
      AND ($2='' OR u.full_name ILIKE '%'||$2||'%' OR u.username ILIKE '%'||$2||'%')
      ORDER BY u.full_name LIMIT 150`,[req.authUser!.id,query])).rows;
    const self = await person(req.authUser!.id);
    res.json({ users: users.filter(item => self && canDirect(self,item)).slice(0,50) });
  } catch (error) { next(error); }
});

chatRouter.get('/chats', async (req,res,next) => {
  try {
    const chats = (await loadChats()).filter(item => canRead(req.authUser!,item));
    const result = await Promise.all(chats.map(async chat => {
      const [last,unread] = await Promise.all([
        pool.query('SELECT body,created_at,sender_id FROM messages WHERE chat_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[chat.id]),
        pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM messages m
          JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=$2
          WHERE m.chat_id=$1 AND m.sender_id<>$2 AND m.created_at>cm.last_read_at`,[chat.id,req.authUser!.id]),
      ]);
      return { ...chat, lastMessage: last.rows[0] ?? null, unread: Number(unread.rows[0]?.count ?? 0),
        readOnly: !isMember(req.authUser!,chat) };
    }));
    result.sort((a,b) => String(b.lastMessage?.created_at ?? b.created_at).localeCompare(String(a.lastMessage?.created_at ?? a.created_at)));
    res.json({ chats: result });
  } catch (error) { next(error); }
});

chatRouter.post('/chats', async (req,res,next) => {
  const client = await pool.connect();
  try {
    const self = await person(req.authUser!.id);
    const kind = req.body?.kind;
    const ids = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds)] : [];
    if (!self || !['direct','group'].includes(kind) || ids.length < 1 || ids.length > 19 ||
      ids.some(id => typeof id!=='string' || id===self.id)) throw fail('Некорректные участники');
    if (kind==='direct' && ids.length!==1) throw fail('Для личного чата выберите одного пользователя');
    const memberIds = ids as string[];
    const members = await Promise.all(memberIds.map(id => person(id)));
    if (members.some(member => !member || !canDirect(self,member))) throw fail('Нельзя создать чат с выбранным участником',403);
    const title = kind==='group' ? String(req.body?.title ?? '').trim() : null;
    if (kind==='group' && (!title || title.length>100)) throw fail('Название группы: 1–100 символов');
    await client.query('BEGIN');
    if (kind==='direct') {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[[self.id,memberIds[0]].sort().join(':')]);
      const existing = await client.query<{ id: string }>(`SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id=c.id
        WHERE c.kind='direct' GROUP BY c.id HAVING count(*)=2 AND bool_or(m.user_id=$1)
        AND bool_or(m.user_id=$2) LIMIT 1`,[self.id,memberIds[0]]);
      if (existing.rows[0]) { await client.query('COMMIT'); res.json({ chatId: existing.rows[0].id }); return; }
    }
    const chatId = randomUUID();
    const workKind = kind==='group' && self.business_role==='DEPARTMENT_MANAGER' ? 'department' :
      kind==='group' && self.business_role==='CONTACT_SUPERVISOR' ? 'contact' :
      kind==='direct' && (self.business_role==='CONTACT_CLIENT' || self.business_role==='CONTACT_OPERATOR' ||
        self.business_role==='CONTACT_SUPERVISOR') ? 'contact' : null;
    await client.query('INSERT INTO chats(id,kind,title,work_kind,created_by) VALUES($1,$2,$3,$4,$5)',
      [chatId,kind==='group' && workKind ? 'work' : kind,title,workKind,self.id]);
    for (const id of [self.id,...memberIds]) await client.query('INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)',[chatId,id]);
    await client.query('COMMIT');
    res.status(201).json({ chatId });
  } catch (error) { await client.query('ROLLBACK'); respond(error,res,next); }
  finally { client.release(); }
});

chatRouter.get('/chats/:id/messages', async (req,res,next) => {
  try {
    const chat = await authorizedChat(req.authUser!,String(req.params.id));
    const result = await pool.query(`SELECT m.id,m.chat_id,m.sender_id,m.body,m.created_at,
      COALESCE(p.display_name,u.full_name) AS sender_name,(p.avatar_data IS NOT NULL) AS sender_has_avatar,
      (SELECT count(*)::integer FROM chat_members cm WHERE cm.chat_id=m.chat_id
        AND cm.user_id<>m.sender_id AND cm.last_read_at>=m.created_at) AS read_by
      FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE m.chat_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 200`,[chat.id]);
    res.json({ chat, messages: result.rows.reverse() });
  } catch (error) { respond(error,res,next); }
});

chatRouter.post('/chats/:id/messages', async (req,res,next) => {
  try {
    const chat = await authorizedChat(req.authUser!,String(req.params.id));
    if (!isMember(req.authUser!,chat)) throw fail('Только участник может писать в чат',403);
    const body = typeof req.body?.body==='string' ? req.body.body.trim() : '';
    if (!body || body.length>4000) throw fail('Сообщение: 1–4000 символов');
    const result = await pool.query(`INSERT INTO messages(id,chat_id,sender_id,body) VALUES($1,$2,$3,$4)
      RETURNING id,chat_id,sender_id,body,created_at`,[randomUUID(),chat.id,req.authUser!.id,body]);
    res.status(201).json({ message: result.rows[0] });
  } catch (error) { respond(error,res,next); }
});

chatRouter.post('/chats/:id/read', async (req,res,next) => {
  try {
    const chat = await authorizedChat(req.authUser!,String(req.params.id));
    if (!isMember(req.authUser!,chat)) throw fail('Нет доступа к статусу чтения',403);
    await pool.query('UPDATE chat_members SET last_read_at=now() WHERE chat_id=$1 AND user_id=$2',[chat.id,req.authUser!.id]);
    res.json({ ok: true });
  } catch (error) { respond(error,res,next); }
});

function canSummarize(user: AuthUser) {
  return user.role==='ADMIN' || user.role==='HR' ||
    ['DEPARTMENT_MANAGER','CONTACT_SUPERVISOR'].includes(user.business_role);
}
function selectWindow(messages: SummaryMessage[], scope: string, readAt?: string) {
  if (scope==='last20') return messages.slice(-20);
  if (scope==='last50') return messages.slice(-50);
  if (scope==='today') {
    const today = new Date().toISOString().slice(0,10);
    return messages.filter(item => item.created_at.slice(0,10)===today).slice(-50);
  }
  if (scope==='unread') return messages.filter(item => readAt && item.created_at>readAt).slice(-50);
  throw fail('Неизвестный период');
}
chatRouter.post('/chats/:id/summary', async (req,res,next) => {
  try {
    const user = req.authUser!;
    const chat = await authorizedChat(user,String(req.params.id));
    if (!canSummarize(user) || (chat.kind==='direct' && chat.work_kind!=='contact'))
      throw fail('AI-сводка доступна руководителю, HR или супервизору в групповом/рабочем чате',403);
    const scope = String(req.body?.scope ?? 'last20');
    const member = (await pool.query<{ last_read_at: string }>('SELECT last_read_at::text FROM chat_members WHERE chat_id=$1 AND user_id=$2',[chat.id,user.id])).rows[0];
    if (scope==='unread' && !member) throw fail('Непрочитанные сообщения доступны только участнику чата',403);
    const all = await messagesFor(chat.id,500);
    const selected = selectWindow(all,scope,member?.last_read_at);
    if (!selected.length) throw fail('За выбранный период нет сообщений');
    const summary = await summarizeChat(selected,chat.work_kind==='contact');
    const row = (await pool.query(`INSERT INTO ai_chat_summaries(id,chat_id,created_by,scope,covered_from,covered_to,covered_count,summary)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
    [randomUUID(),chat.id,user.id,scope,selected[0].created_at,selected.at(-1)!.created_at,selected.length,JSON.stringify(summary)])).rows[0];
    res.json({ summary: row, source: 'openai' });
  } catch (error) { respond(error,res,next); }
});

chatRouter.get('/chats/:id/summaries', async (req,res,next) => {
  try {
    const chat = await authorizedChat(req.authUser!,String(req.params.id));
    if (!canSummarize(req.authUser!)) throw fail('Нет доступа к AI-сводкам',403);
    const rows = (await pool.query(`SELECT s.*,u.full_name AS created_by_name FROM ai_chat_summaries s
      JOIN users u ON u.id=s.created_by WHERE s.chat_id=$1 ORDER BY s.created_at DESC LIMIT 20`,[chat.id])).rows;
    res.json({ summaries: rows });
  } catch (error) { respond(error,res,next); }
});

chatRouter.get('/chats/team-summaries', async (req,res,next) => {
  try {
    const user = req.authUser!;
    if (user.business_role!=='CONTACT_SUPERVISOR') throw fail('Нет доступа к сводкам команды',403);
    const rows = (await pool.query(`SELECT * FROM ai_chat_summaries WHERE chat_id IS NULL
      AND created_by=$1 AND scope LIKE 'team:%' ORDER BY created_at DESC LIMIT 20`,[user.id])).rows;
    res.json({ summaries: rows });
  } catch (error) { respond(error,res,next); }
});

chatRouter.post('/chats/team-summary', async (req,res,next) => {
  try {
    const user = req.authUser!;
    if (user.business_role!=='CONTACT_SUPERVISOR') throw fail('Только супервизор может получить сводку команды',403);
    const scope = String(req.body?.scope ?? 'last50');
    if (!['last20','last50','today','unread'].includes(scope)) throw fail('Неизвестный период');
    const chats = (await loadChats()).filter(chat => chat.work_kind==='contact' && canRead(user,chat));
    const all = (await Promise.all(chats.slice(0,8).map(async chat => (await messagesFor(chat.id,30))
      .map(message => ({ ...message, chat: chat.title ?? chat.members.map(item => item.full_name).join(' / ') }))))).flat()
      .sort((a,b) => a.created_at.localeCompare(b.created_at));
    const lastTeamSummary = scope==='unread' ? (await pool.query<{ covered_to: string }>(
      `SELECT covered_to::text FROM ai_chat_summaries WHERE chat_id IS NULL AND created_by=$1
       ORDER BY created_at DESC LIMIT 1`,[user.id])).rows[0]?.covered_to : undefined;
    const selected = scope==='unread' ? all.filter(item => !lastTeamSummary || item.created_at>lastTeamSummary).slice(-50) :
      selectWindow(all,scope).slice(-50);
    if (!selected.length) throw fail('За выбранный период нет сообщений');
    const summary = await summarizeChat(selected,true);
    const row = (await pool.query(`INSERT INTO ai_chat_summaries(id,chat_id,created_by,scope,covered_from,covered_to,covered_count,summary)
      VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
    [randomUUID(),user.id,`team:${scope}`,selected[0].created_at,selected.at(-1)!.created_at,selected.length,JSON.stringify(summary)])).rows[0];
    res.json({ summary: row, source: 'openai', chatsCovered: chats.length });
  } catch (error) { respond(error,res,next); }
});

export async function seedDemoChats() {
  const names = ['manager','employee','hr','operator','supervisor','client'];
  const result = await pool.query<{ id: string; username: string }>('SELECT id,username FROM users WHERE username=ANY($1)',[names]);
  const ids = Object.fromEntries(result.rows.map(row => [row.username,row.id]));
  if (names.some(name => !ids[name])) return;
  const examples = [
    { id:'10000000-0000-4000-8000-000000000001',kind:'work',title:'Команда Backend Development',work:'department',members:['manager','employee','hr'],
      lines:[['manager','Коллеги, подготовим отчёт по развитию команды до пятницы.'],['employee','Я соберу данные по пройденному обучению.'],['manager','Акмарал, пожалуйста, подготовь раздел по навыкам к четвергу.'],['employee','Сделаю раздел по навыкам к четвергу.'],['hr','Я проверю список обучения и добавлю новые рекомендации.'],['employee','Есть проблема с доступом к отчёту в общей папке.'],['manager','Доступ проверит IT, я отправлю заявку сегодня.'],['hr','Дата встречи по итогам пока не определена.']] },
    { id:'10000000-0000-4000-8000-000000000002',kind:'group',title:'HR и руководители',work:null,members:['hr','manager'],
      lines:[['hr','Обсудим план обучения сотрудников в этом месяце.'],['manager','Нужна подборка по критичным навыкам команды.'],['hr','Подготовлю подборку к пятнице.']] },
    { id:'10000000-0000-4000-8000-000000000003',kind:'direct',title:null,work:'contact',members:['client','operator'],
      lines:[['client','Здравствуйте, не удаётся войти в личный кабинет.'],['operator','Проверю доступ. Уточните, видите ли вы сообщение об ошибке?'],['client','Да, вижу ошибку при входе после обновления приложения.'],['operator','Передам обращение технической команде. Срок решения пока не определён.']] },
    { id:'10000000-0000-4000-8000-000000000004',kind:'direct',title:null,work:'contact',members:['operator','supervisor'],
      lines:[['operator','Поступило обращение о входе после обновления приложения.'],['supervisor','Передай описание ошибки IT и отметь обращение для контроля.'],['operator','Передам описание сегодня.']] },
    { id:'10000000-0000-4000-8000-000000000005',kind:'work',title:'Команда контакт-центра',work:'contact',members:['supervisor','operator'],
      lines:[['supervisor','Сегодня проверяем повторяющиеся проблемы со входом.'],['operator','У меня два обращения после обновления приложения.'],['supervisor','Соберём примеры и передадим IT.']] },
  ] as const;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const chat of examples) {
      await client.query(`INSERT INTO chats(id,kind,title,work_kind,created_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO NOTHING`,[chat.id,chat.kind,chat.title,chat.work,ids[chat.members[0]]]);
      for (const name of chat.members) await client.query(`INSERT INTO chat_members(chat_id,user_id,last_read_at)
        VALUES($1,$2,now()-interval '1 day') ON CONFLICT DO NOTHING`,[chat.id,ids[name]]);
      const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM messages WHERE chat_id=$1',[chat.id]);
      if (Number(count.rows[0].count)===0) for (const [name,body] of chat.lines)
        await client.query(`INSERT INTO messages(id,chat_id,sender_id,body,created_at)
          VALUES($1,$2,$3,$4,now()-interval '2 hours'+($5*interval '3 minutes'))`,
        [randomUUID(),chat.id,ids[name],body,chat.lines.findIndex(item=>item[1]===body)]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
