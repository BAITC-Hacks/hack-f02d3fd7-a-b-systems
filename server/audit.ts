import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { requireRole } from './auth.js';

export const HR_FIELDS = new Set(['full_name','role','department','manager_id','grade','hire_date','work_format','birth_date']);
const OWN_FIELDS = new Set(['display_name','phone','about','preferred_language','birth_date','full_name','role','department','manager_id','grade','hire_date','work_format','avatar']);
const SENSITIVE = /password|hash|token|cookie|secret|credential|api.key/i;

export async function auditField(client: PoolClient, req: Request, action: string, entityType: string,
  entityId: string, targetUserId: string | null, field: string, before: unknown, after: unknown) {
  if (SENSITIVE.test(field)) throw new Error('Secret cannot be audited as a value');
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await client.query(`INSERT INTO audit_logs(id,actor_user_id,target_user_id,action,entity_type,entity_id,
    field_name,old_value,new_value,metadata,ip_address,user_agent)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
  [randomUUID(), req.authUser?.id ?? null, targetUserId, action, entityType, entityId, field,
    before == null ? null : String(before).slice(0, 500), after == null ? null : String(after).slice(0, 500),
    JSON.stringify({ source: req.originalUrl.split('?')[0] }), req.ip || null, req.get('user-agent')?.slice(0, 500) ?? null]);
}

export async function auditAction(client: PoolClient, req: Request, action: string, entityType: string,
  entityId: string, targetUserId: string | null) {
  await client.query(`INSERT INTO audit_logs(id,actor_user_id,target_user_id,action,entity_type,entity_id,
    metadata,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
  [randomUUID(), req.authUser?.id ?? null, targetUserId, action, entityType, entityId,
    JSON.stringify({ source: req.originalUrl.split('?')[0] }), req.ip || null, req.get('user-agent')?.slice(0, 500) ?? null]);
}

const select = `SELECT a.id,a.created_at,a.actor_user_id,a.target_user_id,a.action,a.entity_type,a.entity_id,
  a.field_name,a.old_value,a.new_value,a.metadata,
  COALESCE(actor.full_name,'Система') AS actor_name,
  COALESCE(target.full_name,a.entity_id) AS target_name
  FROM audit_logs a LEFT JOIN users actor ON actor.id=a.actor_user_id
  LEFT JOIN users target ON target.id=a.target_user_id`;
export const auditRouter = Router();
auditRouter.get('/audit', requireRole('ADMIN','HR'), async (req, res, next) => {
  try {
    const q = req.query;
    const isHr = req.authUser?.role === 'HR';
    const [from,to,target,actor,action,entity,search] = ['from','to','target','actor','action','entity','search']
      .map(key => typeof q[key] === 'string' ? (q[key] as string).trim().slice(0,100) : '');
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
      res.status(400).json({ error: 'Некорректный период' }); return;
    }
    const result = await pool.query(`${select} WHERE ($1::date IS NULL OR a.created_at >= $1::date)
      AND ($2::date IS NULL OR a.created_at < ($2::date + interval '1 day'))
      AND ($3='' OR a.target_user_id::text=$3 OR a.entity_id=$3)
      AND ($4='' OR a.actor_user_id::text=$4)
      AND ($5='' OR a.action=$5) AND ($6='' OR a.entity_type=$6)
      AND ($7='' OR a.entity_id ILIKE '%'||$7||'%' OR a.action ILIKE '%'||$7||'%'
        OR a.field_name ILIKE '%'||$7||'%' OR actor.full_name ILIKE '%'||$7||'%'
        OR target.full_name ILIKE '%'||$7||'%')
      AND ($8::boolean=false OR (a.field_name = ANY($9::text[]) AND a.entity_type IN ('employee','user_profile')))
      ORDER BY a.created_at DESC,a.id DESC LIMIT 300`,
    [from || null,to || null,target,actor,action,entity,search,isHr,[...HR_FIELDS]]);
    res.json({ entries: result.rows });
  } catch (error) { next(error); }
});
auditRouter.get('/audit/mine', async (req, res, next) => {
  try {
    const result = await pool.query(`${select} WHERE a.target_user_id=$1 AND a.field_name = ANY($2::text[])
      ORDER BY a.created_at DESC,a.id DESC LIMIT 50`, [req.authUser!.id,[...OWN_FIELDS]]);
    res.json({ entries: result.rows });
  } catch (error) { next(error); }
});
