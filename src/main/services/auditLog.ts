import type { Database } from 'better-sqlite3';
import type { AuditAction, IsoDate } from '@shared/types';

/** F-93 – צפייה ביומן הביקורת. היומן עצמו נכתב ב-`audit.ts` ואינו ניתן למחיקה מהממשק. */

export interface AuditEntry {
  id: number;
  ts: string;
  userId: number | null;
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  beforeJson: string | null;
  afterJson: string | null;
}

export interface AuditFilter {
  from?: IsoDate;
  to?: IsoDate;
  userId?: number;
  entity?: string;
  action?: AuditAction;
  search?: string;
  limit?: number;
}

export interface AuditKpis {
  count: number;
  byAction: Array<{ action: string; count: number }>;
  users: number;
  firstAt: string | null;
  lastAt: string | null;
}

/** תוויות בעברית לישויות ולפעולות, לתצוגה בטבלה. */
export const ENTITY_LABEL: Record<string, string> = {
  member: 'חבר',
  vow_charge: 'חיוב נדר',
  vow_payment: 'תשלום',
  donation: 'תרומה',
  expense: 'הוצאה',
  receipt: 'קבלה',
  setting: 'הגדרה',
  sequence: 'מונה',
  user: 'משתמש',
  backup: 'גיבוי',
  import: 'ייבוא',
  occasion: 'פרשה / אירוע',
  payment_method: 'אמצעי תשלום',
  donation_type: 'סוג תרומה',
  expense_category: 'קטגוריית הוצאה',
};

export const ACTION_LABEL: Record<string, string> = {
  create: 'יצירה',
  update: 'עדכון',
  delete: 'מחיקה',
  cancel: 'ביטול',
  print: 'הדפסה',
  login: 'התחברות',
  backup: 'גיבוי',
  restore: 'שחזור',
  import: 'ייבוא',
};

export function listAudit(
  db: Database,
  filter: AuditFilter = {},
): { rows: AuditEntry[]; total: number; kpis: AuditKpis } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    where.push('a.ts >= @from');
    params['from'] = `${filter.from}T00:00:00`;
  }
  if (filter.to) {
    where.push('a.ts <= @to');
    params['to'] = `${filter.to}T23:59:59`;
  }
  if (filter.userId !== undefined) {
    where.push('a.user_id = @userId');
    params['userId'] = filter.userId;
  }
  if (filter.entity) {
    where.push('a.entity = @entity');
    params['entity'] = filter.entity;
  }
  if (filter.action) {
    where.push('a.action = @action');
    params['action'] = filter.action;
  }
  if (filter.search && filter.search.trim() !== '') {
    where.push(
      `(COALESCE(a.before_json,'') LIKE @q OR COALESCE(a.after_json,'') LIKE @q
        OR CAST(a.entity_id AS TEXT) LIKE @q)`,
    );
    params['q'] = `%${filter.search.trim()}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filter.limit ?? 1000;

  const rows = (
    db
      .prepare(
        `SELECT a.id, a.ts, a.user_id, u.display_name AS user_name, a.entity, a.entity_id,
                a.action, a.before_json, a.after_json
         FROM audit_log a LEFT JOIN user u ON u.id = a.user_id
         ${clause} ORDER BY a.id DESC LIMIT ${limit}`,
      )
      .all(params) as Array<{
      id: number;
      ts: string;
      user_id: number | null;
      user_name: string | null;
      entity: string;
      entity_id: number | null;
      action: AuditAction;
      before_json: string | null;
      after_json: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    ts: r.ts,
    userId: r.user_id,
    userName: r.user_name,
    entity: r.entity,
    entityId: r.entity_id,
    action: r.action,
    beforeJson: r.before_json,
    afterJson: r.after_json,
  }));

  const total = (db.prepare('SELECT COUNT(*) c FROM audit_log').get() as { c: number }).c;

  const byAction = new Map<string, number>();
  for (const r of rows) byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);

  return {
    rows,
    total,
    kpis: {
      count: rows.length,
      byAction: [...byAction.entries()]
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count),
      users: new Set(rows.map((r) => r.userId)).size,
      firstAt: rows.length === 0 ? null : rows[rows.length - 1]!.ts,
      lastAt: rows[0]?.ts ?? null,
    },
  };
}

/** הישויות שקיימות בפועל ביומן, לסרגל הסינון. */
export function auditEntities(db: Database): string[] {
  return (
    db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').all() as Array<{
      entity: string;
    }>
  ).map((r) => r.entity);
}
