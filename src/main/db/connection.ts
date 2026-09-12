import { createRequire } from 'node:module';
import type DatabaseCtor from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { migrate } from './migrate';

/**
 * better-sqlite3 הוא מודול CJS עם binding נייטיב. ייבוא ESM סטטי שלו נכשל
 * ב-Electron (מנוע ה-ESM מנסה לפרסר את קובץ ה-.node), ולכן טוענים אותו ב-require.
 */
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof DatabaseCtor;

export type Db = BetterSqlite3Database;

export interface OpenDbOptions {
  /** נתיב קובץ ה-DB, או ':memory:' בבדיקות. */
  file: string;
  /** להריץ מיגרציות בפתיחה (ברירת מחדל: כן). */
  migrateOnOpen?: boolean;
  readonly?: boolean;
}

/**
 * פותח את בסיס הנתונים עם ה-PRAGMA-ים המחייבים (DATA-MODEL: WAL + foreign_keys),
 * מריץ מיגרציות ומחזיר את החיבור. זהו נקודת הכניסה היחידה ל-DB בכל התהליך.
 */
export function openDatabase(options: OpenDbOptions): Db {
  const db = new Database(options.file, { readonly: options.readonly ?? false });

  // WAL אינו נתמך על :memory: ואינו רלוונטי במצב קריאה-בלבד.
  if (options.file !== ':memory:' && !options.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (options.migrateOnOpen ?? true) {
    migrate(db);
  }
  return db;
}

/** בדיקת תקינות בסיס הנתונים בהפעלה (דרישה לא-פונקציונלית: אמינות). */
export function integrityCheck(db: Db): { ok: boolean; details: string[] } {
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  const details = rows.map((r) => r.integrity_check);
  return { ok: details.length === 1 && details[0] === 'ok', details };
}
