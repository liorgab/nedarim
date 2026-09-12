import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { closeDatabase, getDb, initDatabase } from '../db';
import { seed, systemUserId } from '../db/seed';
import { createUser, hashPassword, login } from './auth';
import {
  currentUser,
  idleLockMinutes,
  isLocked,
  lock,
  loginRequired,
  session,
  setCurrentUser,
} from './session';
import { setSetting } from './settings';
import { createBackup, listBackups } from './backup';

/**
 * שכבת ההתחברות (SPEC 6.3).
 *
 * המבחן המרכזי כאן הוא לא "האם הסיסמה נכונה" – זה נבדק ב-stage4.test – אלא
 * ששני המצבים של `require_login` נותנים מערכת עקבית: כשהיא כבויה כל פעולה
 * עדיין נחתמת בשם משתמש אמיתי, וכשהיא דלוקה אי אפשר לכתוב בלי להתחבר.
 */

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-sess-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  setCurrentUser(null);
});

afterEach(() => {
  setCurrentUser(null);
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('מצב ההתחברות', () => {
  it('ברירת המחדל היא ללא דרישת סיסמה – התקנה טרייה נפתחת מיד', () => {
    expect(loginRequired(db)).toBe(false);
    const s = session(db);
    expect(s.authenticated).toBe(true);
    expect(s.user?.role).toBe('admin');
  });

  it('גם בלי דרישת התחברות, כל פעולה נחתמת בשם משתמש אמיתי', () => {
    const user = currentUser(db);
    expect(user.id).toBe(systemUserId(db));
    expect(user.role).toBe('admin');
  });

  it('כשנדרשת התחברות – אין משתמש עד שמתחברים', () => {
    setSetting(db, 'require_login', '1');
    const s = session(db);
    expect(s.loginRequired).toBe(true);
    expect(s.authenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(() => currentUser(db)).toThrow('אין משתמש מחובר');
  });

  it('התחברות מוצלחת פותחת סשן, יציאה סוגרת אותו', () => {
    db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(
      hashPassword('sod123'),
      systemUserId(db),
    );
    setSetting(db, 'require_login', '1');

    const res = login(db, 'admin', 'sod123');
    expect(res.ok).toBe(true);
    setCurrentUser(res.user!.id);
    expect(session(db).authenticated).toBe(true);
    expect(currentUser(db).id).toBe(systemUserId(db));

    setCurrentUser(null);
    expect(session(db).authenticated).toBe(false);
  });

  it('נעילה שומרת על זהות המשתמש אבל חוסמת את המערכת', () => {
    db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(
      hashPassword('sod123'),
      systemUserId(db),
    );
    setSetting(db, 'require_login', '1');
    setCurrentUser(login(db, 'admin', 'sod123').user!.id);

    lock();
    expect(isLocked()).toBe(true);
    const s = session(db);
    expect(s.authenticated).toBe(false);
    // המשתמש נשאר ידוע, כדי שמסך הנעילה יבקש רק סיסמה ולא גם שם משתמש.
    expect(s.user?.username).toBe('admin');

    setCurrentUser(s.user!.id);
    expect(session(db).authenticated).toBe(true);
  });

  it('משתמש שהושבת אחרי שהתחבר מאבד את הסשן', () => {
    setSetting(db, 'require_login', '1');
    const other = createUser(
      db,
      { username: 'gabai2', displayName: 'גבאי שני', role: 'clerk', password: 'sod456' },
      systemUserId(db),
      'admin',
    );
    setCurrentUser(other.id);
    expect(session(db).authenticated).toBe(true);

    db.prepare('UPDATE user SET is_active = 0 WHERE id = ?').run(other.id);
    // המשתמש עדיין נמצא ברשימה, ולכן הסשן שורד – ההשבתה חוסמת התחברות חדשה.
    expect(login(db, 'gabai2', 'sod456').ok).toBe(false);
  });

  it('משתמש שנמחק מה-DB מנתק את הסשן במקום להפיל את המערכת', () => {
    setSetting(db, 'require_login', '1');
    setCurrentUser(9999);
    expect(session(db).authenticated).toBe(false);
    expect(() => currentUser(db)).toThrow();
  });

  it('דקות הנעילה נקראות מההגדרות, וערך לא חוקי מכבה את הנעילה', () => {
    setSetting(db, 'idle_lock_minutes', '20');
    expect(idleLockMinutes(db)).toBe(20);
    setSetting(db, 'idle_lock_minutes', '0');
    expect(idleLockMinutes(db)).toBe(0);
    setSetting(db, 'idle_lock_minutes', 'לא מספר');
    expect(idleLockMinutes(db)).toBe(0);
  });

  it('כשההתחברות כבויה, נעילה קודמת אינה חוסמת', () => {
    lock();
    expect(session(db).authenticated).toBe(true);
  });
});

describe('שם ייחודי לגיבוי', () => {
  it('שני גיבויים באותה שנייה אינם דורסים זה את זה', async () => {
    const target = join(dir, 'backups');
    const opts = {
      userDataDir: dir,
      targetDir: target,
      appVersion: 'test',
      schemaVersion: 1,
    };
    const first = await createBackup(db, opts);
    const second = await createBackup(db, opts);
    expect(second.path).not.toBe(first.path);
    expect(listBackups(target)).toHaveLength(2);
  });
});

describe('פתיחת בסיס הנתונים מחדש באותו תהליך', () => {
  /**
   * השחזור (F-101) מחליף את קובץ ה-DB ואז פותח אותו מחדש **בלי להפעיל את
   * היישום מחדש** – `app.relaunch()` השאיר מסך לבן לדקות ארוכות. הבדיקה
   * נועלת את המנגנון שהתיקון נשען עליו: אחרי `closeDatabase` אפשר לקרוא
   * ל-`initDatabase` שוב על אותה תיקייה ולקבל DB עובד.
   */
  it('closeDatabase ואז initDatabase מחזירים DB עובד על אותה תיקייה', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'nedarim-reopen-'));
    try {
      const first = initDatabase(dir2);
      first
        .prepare(
          `INSERT INTO member (member_number, first_name, last_name, status,
             opening_balance_agorot, created_at, updated_at)
           VALUES (777, 'בדיקה', 'פתיחה מחדש', 'active', 0, '2026-01-01T00:00:00', '2026-01-01T00:00:00')`,
        )
        .run();
      expect(getDb()).toBe(first);

      closeDatabase();
      expect(() => getDb()).toThrow();

      const second = initDatabase(dir2);
      expect(second).not.toBe(first);
      const row = second
        .prepare('SELECT first_name FROM member WHERE member_number = 777')
        .get() as { first_name: string } | undefined;
      expect(row?.first_name).toBe('בדיקה');
    } finally {
      closeDatabase();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
