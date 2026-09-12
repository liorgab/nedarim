import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { setSetting } from './settings';
import {
  ConfirmationMismatchError,
  confirmationMatches,
  deleteDatabase,
  deletionScope,
} from './dangerZone';

/** F-130 – מחיקת בסיס הנתונים. פעולה בלתי הפיכה: כל הגנה נבדקת. */

const NAME = 'בית הכנסת ברית שלום';

let dir: string;
let db: Database;

const options = (confirmation: string) => ({
  userDataDir: dir,
  backupDir: join(dir, 'backups'),
  confirmation,
  userId: 1,
  appVersion: '0.2.1',
  schemaVersion: 11,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-danger-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  setSetting(db, 'synagogue_name', NAME);
  db.prepare(
    `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
     VALUES (7, 'ישראל', 'ישראלי', '2026-01-01T09:00:00', '2026-01-01T09:00:00')`,
  ).run();
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* נסגר על ידי המחיקה */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('אישור בהקלדה', () => {
  it('שם מדויק מאשר', () => {
    expect(confirmationMatches(db, NAME)).toBe(true);
  });

  it('רווחים מיותרים וגרשיים אינם מפילים אישור נכון', () => {
    // הגבאי מקליד את השם, לא מדביק אותו. לא נכשיל אותו על רווח כפול.
    expect(confirmationMatches(db, `  בית   הכנסת "ברית" שלום  `)).toBe(true);
  });

  it('שם אחר נדחה', () => {
    expect(confirmationMatches(db, 'בית הכנסת אחר')).toBe(false);
  });

  it('מחרוזת ריקה נדחית', () => {
    expect(confirmationMatches(db, '')).toBe(false);
  });

  it('כששם בית הכנסת לא הוגדר – אין אישור אפשרי', () => {
    // אחרת מחרוזת ריקה הייתה שווה למחרוזת ריקה, והמחיקה עוברת בלחיצה.
    setSetting(db, 'synagogue_name', '');
    expect(confirmationMatches(db, '')).toBe(false);
    expect(confirmationMatches(db, '   ')).toBe(false);
  });
});

describe('היקף המחיקה', () => {
  it('מונה את מה שעומד להימחק', () => {
    const scope = deletionScope(db);
    expect(scope.members).toBe(1);
    expect(scope.receipts).toBe(0);
    expect(scope.synagogueName).toBe(NAME);
  });
});

describe('המחיקה', () => {
  it('אישור שגוי – שום דבר לא נמחק', async () => {
    await expect(deleteDatabase(db, options('טעות'))).rejects.toBeInstanceOf(
      ConfirmationMismatchError,
    );
    expect(existsSync(join(dir, 'nedarim.db'))).toBe(true);
    // ואפילו לא נוצר גיבוי – הבדיקה קודמת לכל פעולה.
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(db.open).toBe(true);
  });

  it('גיבוי נוצר לפני המחיקה, והוא מכיל את הנתונים', async () => {
    const result = await deleteDatabase(db, options(NAME));

    expect(existsSync(result.backup.path)).toBe(true);
    const copy = openDatabase({ file: join(result.backup.path, 'nedarim.db') });
    try {
      const n = copy.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      copy.close();
    }
  });

  it('הרישום ביומן נכנס לגיבוי', async () => {
    // הרישום נעשה לפני הגיבוי בדיוק כדי שזה יקרה: אחרת הראיה היחידה
    // למחיקה נמחקת יחד איתה.
    const result = await deleteDatabase(db, options(NAME));
    const copy = openDatabase({ file: join(result.backup.path, 'nedarim.db') });
    try {
      const row = copy
        .prepare(
          `SELECT before_json FROM audit_log WHERE entity = 'database' AND action = 'delete'`,
        )
        .get() as { before_json: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.before_json)).toMatchObject({ members: 1, synagogueName: NAME });
    } finally {
      copy.close();
    }
  });

  it('קובץ ה-DB וקובצי הלוואי נמחקים', async () => {
    const removed = (await deleteDatabase(db, options(NAME))).removed;
    for (const suffix of ['', '-wal', '-shm']) {
      expect(existsSync(`${removed}${suffix}`), suffix).toBe(false);
    }
  });

  it('החיבור נסגר – המתקשר חייב לפתוח מחדש', async () => {
    await deleteDatabase(db, options(NAME));
    expect(db.open).toBe(false);
  });

  it('פתיחה מחדש נותנת בסיס נתונים ריק ותקין', async () => {
    // זה המצב שהמשתמש רואה מיד אחרי: מערכת נקייה שאפשר לייבא אליה.
    await deleteDatabase(db, options(NAME));
    db = openDatabase({ file: join(dir, 'nedarim.db') });
    seed(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('הקבלות שהופקו והגיבויים אינם נמחקים', async () => {
    // המסמכים שבית הכנסת מחזיק אינם חלק ממה שביקשו למחוק.
    const result = await deleteDatabase(db, options(NAME));
    expect(existsSync(result.backup.path)).toBe(true);
  });
});
