import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Db } from './connection';
import { integrityCheck, openDatabase } from './connection';
import { currentSchemaVersion } from './migrate';
import { seed } from './seed';
import { backfillMobileE164 } from '../services/mobileBackfill';
import { reconcileStuckSending } from '../services/sendMessage';

let instance: Db | null = null;
let dbFilePath = '';
let userDataDirPath = '';

/** נתיב קובץ ה-DB. `userDataDir` מגיע מ-`app.getPath('userData')`. */
export function resolveDbPath(userDataDir: string): string {
  return join(userDataDir, 'nedarim.db');
}

/**
 * פותח (פעם אחת) את בסיס הנתונים של היישום: מיגרציות, seed ובדיקת תקינות.
 * זו נקודת הכניסה היחידה של תהליך ה-main ל-DB.
 */
export function initDatabase(userDataDir: string): Db {
  if (instance) return instance;
  mkdirSync(userDataDir, { recursive: true });
  userDataDirPath = userDataDir;
  dbFilePath = resolveDbPath(userDataDir);

  const db = openDatabase({ file: dbFilePath });
  const check = integrityCheck(db);
  if (!check.ok) {
    throw new Error(`בסיס הנתונים פגום: ${check.details.join('; ')}`);
  }
  seed(db);

  // WB-11 – השלמת `mobile_e164`/`mobile_status` לחברים שנוצרו לפני מיגרציה 005.
  // SQL לא יכול להריץ את PhoneNormalizer, ולכן הצעד רץ כאן. הוא אידמפוטנטי:
  // הרצה שנייה לא נוגעת באיש, ולכן אין עלות בהפעלות הבאות.
  backfillMobileE164(db);

  // W-47 – פריט שנשאר `sending` פירושו שהיישום נסגר באמצע שליחה. הוא הופך
  // ל-`unknown` ולא ל-`pending`: ייתכן שההודעה כן יצאה, ושליחה חוזרת
  // אוטומטית הייתה מגיעה פעמיים לאותו אדם.
  reconcileStuckSending(db);

  instance = db;
  return db;
}

export function getDb(): Db {
  if (!instance) throw new Error('בסיס הנתונים טרם אותחל');
  return instance;
}

export function getDbPath(): string {
  return dbFilePath;
}

/** תיקיית הנתונים של היישום – שם נשמרים גם ארכיון הקבלות והגיבויים. */
export function getUserDataDir(): string {
  if (userDataDirPath === '') throw new Error('בסיס הנתונים טרם אותחל');
  return userDataDirPath;
}

export function getSchemaVersion(): number {
  return currentSchemaVersion(getDb());
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}
