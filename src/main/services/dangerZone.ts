import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { createBackup, type BackupInfo } from './backup';
import { getSetting } from './settings';
import { writeAudit } from './audit';

/**
 * F-130 – מחיקת בסיס הנתונים מהמחשב.
 *
 * הפעולה ההרסנית ביותר במערכת: 90 חברים, 1,268 נדרים ו-452 קבלות
 * נמחקים, ואין ממי לבקש שחזור – הכול מקומי (PRIVACY.md).
 *
 * שלוש הגנות, וכל אחת מהן נדרשת:
 * 1. **גיבוי נוצר תמיד**, לא "מוצע". גבאי שלוחץ מתוך תסכול לא יסמן
 *    תיבה, והגיבוי הוא הדבר היחיד שמאפשר לחזור.
 * 2. **הקלדת שם בית הכנסת** – אישור שדורש קריאה, לא לחיצה שנייה.
 * 3. **רישום ביומן הביקורת לפני המחיקה**, כדי שהוא ייכנס לגיבוי.
 *
 * מה שנמחק הוא בסיס הנתונים **בלבד**. הקבלות שכבר הופקו כ-PDF והגיבויים
 * נשארים: הם המסמכים שבית הכנסת מחזיק, ומחיקתם אינה מה שביקשו.
 */

export interface DeleteDatabaseOptions {
  userDataDir: string;
  backupDir: string;
  /** מה שהגבאי הקליד. חייב להתאים לשם בית הכנסת. */
  confirmation: string;
  userId: number;
  appVersion: string;
  schemaVersion: number;
}

export interface DeleteDatabaseResult {
  backup: BackupInfo;
  /** נתיב ה-DB שנמחק. */
  removed: string;
}

/** נורמליזציה סלחנית: רווחים כפולים וגרשיים לא יפילו אישור נכון. */
const normalize = (v: string): string =>
  v.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();

export class ConfirmationMismatchError extends Error {
  constructor(expected: string) {
    super(`יש להקליד במדויק את שם בית הכנסת: "${expected}"`);
    this.name = 'ConfirmationMismatchError';
  }
}

/**
 * בודק את האישור בלי לבצע דבר – לשימוש הממשק, כדי להשבית את הכפתור
 * לפני הלחיצה ולא להיכשל אחריה.
 */
export function confirmationMatches(db: Database, typed: string): boolean {
  const expected = (getSetting(db, 'synagogue_name') ?? '').trim();
  if (expected === '') return false;
  return normalize(typed) === normalize(expected);
}

/**
 * מה עומד להימחק – מוצג למשתמש **לפני** שהוא מאשר.
 *
 * מספרים אמיתיים ולא "כל הנתונים": הבדל בין אזהרה גנרית לבין "1,268
 * נדרים ו-452 קבלות" הוא ההבדל בין לחיצה אוטומטית לבין עצירה.
 */
export interface DeletionScope {
  members: number;
  charges: number;
  payments: number;
  donations: number;
  expenses: number;
  receipts: number;
  synagogueName: string;
}

export function deletionScope(db: Database): DeletionScope {
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

  return {
    members: count('member'),
    charges: count('vow_charge'),
    payments: count('vow_payment'),
    donations: count('donation'),
    expenses: count('expense'),
    receipts: count('receipt'),
    synagogueName: (getSetting(db, 'synagogue_name') ?? '').trim(),
  };
}

/**
 * מוחק את בסיס הנתונים. **סוגר את החיבור** – המתקשר אחראי לפתוח מחדש
 * או להפעיל את היישום מחדש.
 */
export async function deleteDatabase(
  db: Database,
  options: DeleteDatabaseOptions,
): Promise<DeleteDatabaseResult> {
  const expected = (getSetting(db, 'synagogue_name') ?? '').trim();
  if (!confirmationMatches(db, options.confirmation)) {
    throw new ConfirmationMismatchError(expected);
  }

  const scope = deletionScope(db);

  // הרישום קודם למחיקה כדי שייכנס לגיבוי שנוצר אחריו.
  writeAudit(db, {
    userId: options.userId,
    entity: 'database',
    entityId: 0,
    action: 'delete',
    before: { ...scope, at: nowIso() },
  });

  // גיבוי כפוי – לא "מוצע". זה הדבר היחיד שמאפשר לחזור.
  const backup = await createBackup(db, {
    userDataDir: options.userDataDir,
    targetDir: options.backupDir,
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    external: false,
    userId: options.userId,
  });

  const dbPath = join(options.userDataDir, 'nedarim.db');
  db.close();

  // גם ה-WAL וה-SHM: השארתם מותירה קובץ חלקי שנפתח כ-DB פגום.
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }

  return { backup, removed: dbPath };
}
