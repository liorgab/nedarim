import type { Database } from 'better-sqlite3';
import type { AuditAction } from '@shared/types';
import { nowIso } from '@shared/datetime';

/**
 * יומן ביקורת (B-09, B-10). כל שינוי בנתון כספי נרשם כאן עם המצב לפני ואחרי.
 * הרישום נעשה **בתוך** הטרנזקציה של השינוי, כך שלא ייתכן שינוי בלי רישום.
 */
export function writeAudit(
  db: Database,
  entry: {
    userId: number | null;
    entity: string;
    entityId: number | null;
    action: AuditAction;
    before?: unknown;
    after?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log (ts, user_id, entity, entity_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nowIso(),
    entry.userId,
    entry.entity,
    entry.entityId,
    entry.action,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
}

/** שולף את הרשומה הנוכחית לצורך `before_json` לפני עדכון או מחיקה. */
export function snapshot(db: Database, table: string, id: number): unknown {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) ?? null;
}
