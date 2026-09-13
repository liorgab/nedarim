import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { SETTING_SPECS } from './configuration';
import { setSetting } from './settings';
import { MIGRATIONS } from '../db/migrations';
import { WIZARD_STEPS, completeSetup, reopenSetup, wizardKeys, wizardState } from './setupWizard';

/** ה-SQL של מיגרציה 011, כפי שהוא רץ אצל משתמש שמשדרג. */
const migration011 = (): string =>
  MIGRATIONS.find((m) => m.name === '011_setup_completed_backfill')!.sql;

/** F-110..F-114 – אשף ההתקנה הראשונה. */

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-wizard-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('הגדרת הצעדים', () => {
  it('כל מפתח באשף קיים ב-SETTING_SPECS', () => {
    // אחרת האשף מציג צעד ריק, בלי שאיש ישים לב.
    const known = new Set(SETTING_SPECS.map((s) => s.key));
    for (const key of wizardKeys()) expect(known.has(key), key).toBe(true);
  });

  it('אין מפתח שמופיע בשני צעדים', () => {
    const keys = wizardKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('כל שדות החובה במערכת מופיעים באשף', () => {
    // ההבטחה המרכזית: אי אפשר לסיים התקנה בלי שנשאלת על שדה חובה.
    const required = SETTING_SPECS.filter((s) => s.required === true).map((s) => s.key);
    for (const key of required) expect(wizardKeys(), key).toContain(key);
  });

  it('לכל צעד יש כותרת, הסבר ולפחות שדה אחד', () => {
    for (const step of WIZARD_STEPS) {
      expect(step.title, step.id).not.toBe('');
      expect(step.intro.length, step.id).toBeGreaterThan(30);
      expect(step.keys.length, step.id).toBeGreaterThan(0);
    }
  });

  it('אין באשף בחירת תיקיית גיבוי', () => {
    // מיד אחרי האשף נפתח אשף הייבוא, ולכן "בחרו תיקיית גיבוי" נקרא
    // כ"מאיפה לייבא". שחזור מגיבוי הוא ייבוא, ומקומו שם.
    expect(wizardKeys()).not.toContain('backup_dir');
  });
});

describe('מצב האשף', () => {
  it('התקנה חדשה – האשף לא הושלם ושם בית הכנסת חסר', () => {
    const state = wizardState(db);
    expect(state.completed).toBe(false);
    expect(state.completedAt).toBeNull();
    expect(state.missingRequired).toContain('synagogue_name');
  });

  it('אי אפשר לסיים בלי שדה חובה', () => {
    expect(() => completeSetup(db)).toThrow(/שם בית הכנסת/);
    expect(wizardState(db).completed).toBe(false);
  });

  it('אחרי מילוי שדה חובה אפשר לסיים', () => {
    setSetting(db, 'synagogue_name', 'בית הכנסת דוגמה');
    const state = completeSetup(db);
    expect(state.completed).toBe(true);
    expect(state.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.missingRequired).toEqual([]);
  });

  it('רווחים בלבד אינם נחשבים מילוי', () => {
    setSetting(db, 'synagogue_name', '   ');
    expect(() => completeSetup(db)).toThrow();
  });

  it('האשף נשאר סגור אחרי השלמה, גם אם הגבאי ניקה שדה אחר', () => {
    setSetting(db, 'synagogue_name', 'בית הכנסת');
    completeSetup(db);
    setSetting(db, 'synagogue_city', '');
    expect(wizardState(db).completed).toBe(true);
  });

  it('פתיחה מחדש מחזירה את האשף', () => {
    setSetting(db, 'synagogue_name', 'בית הכנסת');
    completeSetup(db);
    const state = reopenSetup(db);
    expect(state.completed).toBe(false);
    expect(state.completedAt).toBeNull();
  });

  it('התקנה שכבר הוגדרה אינה רואה את האשף (מיגרציה 011)', () => {
    // מיגרציה 010 הוסיפה את השדה ריק לכולם, ולכן מערכת עם 90 חברים
    // וקבלות קיבלה מסך "ברוך הבא – הגדרה ראשונה". התגלה בהתקנה אמיתית.
    //
    // נבדק ה-SQL עצמו ולא `openDatabase`, כי ה-DB כאן כבר ממוגרר לגרסה
    // האחרונה – והמצב שמעניין הוא זה של משתמש קיים שמשדרג.
    setSetting(db, 'synagogue_name', 'בית כנסת ותיק');
    setSetting(db, 'setup_completed_at', '');
    expect(wizardState(db).completed).toBe(false);

    db.exec(migration011());
    expect(wizardState(db).completed).toBe(true);
    expect(wizardState(db).completedAt).toBe('pre-wizard');
  });

  it('התקנה חדשה שמשדרגת עדיין רואה את האשף', () => {
    // בלי שם בית כנסת אין על מה לדלג.
    setSetting(db, 'setup_completed_at', '');
    db.exec(migration011());
    expect(wizardState(db).completed).toBe(false);
  });

  it('המיגרציה אינה דורסת אשף שכבר הושלם', () => {
    setSetting(db, 'synagogue_name', 'בית כנסת');
    completeSetup(db);
    const before = wizardState(db).completedAt;
    db.exec(migration011());
    expect(wizardState(db).completedAt).toBe(before);
  });

  it('המצב אינו נגזר משם בית הכנסת', () => {
    // זו הבעיה שהאשף בא לפתור: קודם, מילוי השם לבדו סימן "מוגדר",
    // והגבאי מעולם לא נשאל על מספר הקבלה הראשון.
    setSetting(db, 'synagogue_name', 'בית הכנסת');
    expect(wizardState(db).completed).toBe(false);
  });
});
