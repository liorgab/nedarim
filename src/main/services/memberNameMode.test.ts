import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { setSetting } from './settings';
import { SETTING_SPECS } from './configuration';
import { WIZARD_STEPS, wizardKeys } from './setupWizard';
import { createMember, getMember, updateMember } from './members';

/**
 * F-13 – ניהול השם כשדה אחד או כשניים.
 *
 * הבדיקה כאן היא על **השרת** ולא על הטופס: ה-renderer אינו הגבול, וייבוא
 * או קריאת IPC ישירה חייבים להיתקל באותו כלל. במימוש הראשון השרת דחה שם
 * משפחה ריק תמיד, וכל שמירה במצב "שם מלא" הייתה נכשלת.
 */

let dir: string;
let db: Database;

const input = (first: string, last: string) => ({
  firstName: first,
  lastName: last,
  nickname: null,
  mobile: null,
  email: null,
  address: null,
  notes: null,
  openingBalanceAgorot: 0,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-namemode-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ההגדרה', () => {
  it('קיימת ב-SETTING_SPECS עם שתי אפשרויות', () => {
    const spec = SETTING_SPECS.find((x) => x.key === 'member_name_mode');
    expect(spec).toBeDefined();
    expect(spec?.choices?.map((c) => c.value)).toEqual(['split', 'full']);
  });

  it('יושבת בקבוצה הראשונה במסך ההגדרות', () => {
    // קודם היא ישבה בקבוצת "מערכת וגיבוי", בתחתית הדף, לצד תיקיית
    // הגיבוי – והמשתמש לא מצא אותה. זו החלטה שמתקבלת פעם אחת
    // בהתחלה ומשפיעה על כל הזנת חבר, ולכן מקומה למעלה.
    expect(SETTING_SPECS.find((x) => x.key === 'member_name_mode')?.group).toBe('synagogue');
  });

  it('מופיעה באשף ההקמה, בצעד פרטי בית הכנסת', () => {
    // השאלה חייבת להישאל לפני שמוזן חבר ראשון: המעבר אפשרי תמיד,
    // אבל אחרי אלף חברים הוא כרוך בהשלמה ידנית חבר-חבר.
    expect(WIZARD_STEPS.find((x) => x.id === 'synagogue')?.keys).toContain('member_name_mode');
    expect(wizardKeys()).toContain('member_name_mode');
  });

  it('ברירת המחדל היא "נפרד" – התנהגות זהה להתקנה קיימת', () => {
    const row = db
      .prepare("SELECT value FROM setting WHERE key = 'member_name_mode'")
      .get() as { value: string };
    expect(row.value).toBe('split');
  });
});

describe('מצב "נפרד" (ברירת מחדל)', () => {
  it('שני השדות חובה', () => {
    expect(() => createMember(db, input('ישראל', ''), 1)).toThrow(/שם משפחה/);
  });

  it('שם פרטי ריק נדחה', () => {
    expect(() => createMember(db, input('', 'ישראלי'), 1)).toThrow(/שם/);
  });

  it('שני שמות – נשמר', () => {
    const m = createMember(db, input('ישראל', 'ישראלי'), 1);
    expect(m.firstName).toBe('ישראל');
    expect(m.lastName).toBe('ישראלי');
  });
});

describe('מצב "שם מלא"', () => {
  beforeEach(() => {
    setSetting(db, 'member_name_mode', 'full');
  });

  it('שם משפחה ריק מתקבל', () => {
    const m = createMember(db, input('ישראל ישראלי', ''), 1);
    expect(m.firstName).toBe('ישראל ישראלי');
    expect(m.lastName).toBe('');
  });

  it('שם ריק לגמרי עדיין נדחה', () => {
    // "שם מלא" אינו "בלי שם".
    expect(() => createMember(db, input('   ', ''), 1)).toThrow(/שם/);
  });

  it('עריכה בלי שם משפחה מתקבלת', () => {
    const m = createMember(db, input('משה כהן', ''), 1);
    const updated = updateMember(db, m.id, input('משה כהן הלוי', ''), 1);
    expect(updated.firstName).toBe('משה כהן הלוי');
  });
});

describe('מעבר בין המצבים', () => {
  it('חבר שנוצר כשם מלא ניתן לפיצול אחר כך', () => {
    // זו הדרישה המפורשת: מי שניהל שם מלא יוכל לעבור לניהול נפרד
    // ולהשלים את שם המשפחה חבר-חבר.
    setSetting(db, 'member_name_mode', 'full');
    const m = createMember(db, input('ישראל ישראלי', ''), 1);

    setSetting(db, 'member_name_mode', 'split');
    const split = updateMember(db, m.id, input('ישראל', 'ישראלי'), 1);

    expect(split.firstName).toBe('ישראל');
    expect(split.lastName).toBe('ישראלי');
    expect(getMember(db, m.id)?.lastName).toBe('ישראלי');
  });

  it('חבר קיים עם שני שמות אינו נפגע מהמעבר ל"שם מלא"', () => {
    const m = createMember(db, input('ישראל', 'ישראלי'), 1);
    setSetting(db, 'member_name_mode', 'full');
    // הנתונים נשארים; רק הטופס מציג שדה אחד.
    expect(getMember(db, m.id)?.lastName).toBe('ישראלי');
  });
});
