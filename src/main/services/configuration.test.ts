import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import {
  addLookupValue,
  getConfiguration,
  getCounters,
  listLookup,
  renameLookupValue,
  setLookupActive,
  setReceiptStartNumber,
  saveSettings,
  pathProblem,
  validateSettings,
} from './configuration';
import { defaultReceiptsRoot, receiptPdfPath, receiptsRoot } from './receiptPdf';
import { createMember } from './members';
import { createPayment } from './payments';

let db: Database;
let userId: number;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  seed(db);
  userId = systemUserId(db);
});
afterEach(() => db.close());

const cash = () =>
  (db.prepare("SELECT id FROM payment_method WHERE name = 'מזומן'").get() as { id: number }).id;

describe('התקנה חדשה (כלל 12–13)', () => {
  it('מתחילה ריקה לגמרי – בלי שם בית כנסת ובלי נתונים', () => {
    const config = getConfiguration(db);
    expect(config.isFirstRun).toBe(true);
    expect(config.settings['synagogue_name']).toBe('');
    expect(config.settings['synagogue_city']).toBe('');
    expect(config.counters.nextReceiptNumber).toBe(1);
    expect(config.counters.nextMemberNumber).toBe(1);
  });

  it('אחרי מילוי שם בית הכנסת – אשף ההפעלה הראשונה לא נפתח שוב', () => {
    saveSettings(db, { synagogue_name: 'בית הכנסת אור החיים' }, userId, 'admin');
    expect(getConfiguration(db).isFirstRun).toBe(false);
  });

  it('כל ההגדרות שהמסך מציג מגיעות מה-spec, לא מקוד קשיח', () => {
    const config = getConfiguration(db);
    const keys = config.specs.map((s) => s.key);
    expect(keys).toContain('synagogue_name');
    expect(keys).toContain('fiscal_year_start_month');
    expect(keys).toContain('credit_approval_threshold_agorot');
    expect(keys).toContain('receipt_paper_size');
    // לכל spec יש ערך בפועל בטבלת setting
    for (const spec of config.specs) {
      expect(config.settings).toHaveProperty(spec.key);
    }
  });
});

describe('אימות הגדרות', () => {
  it('שם בית הכנסת חובה', () => {
    expect(validateSettings({ synagogue_name: '   ' })).toEqual([
      { key: 'synagogue_name', message: 'שם בית הכנסת הוא שדה חובה' },
    ]);
  });

  it('חודש שנה כספית בטווח 1–12', () => {
    expect(validateSettings({ fiscal_year_start_month: '9' })).toEqual([]);
    expect(validateSettings({ fiscal_year_start_month: '13' })).toHaveLength(1);
    expect(validateSettings({ fiscal_year_start_month: '0' })).toHaveLength(1);
    expect(validateSettings({ fiscal_year_start_month: 'ספטמבר' })).toHaveLength(1);
  });

  it('גודל נייר רק מהרשימה', () => {
    expect(validateSettings({ receipt_paper_size: 'A4' })).toEqual([]);
    expect(validateSettings({ receipt_paper_size: 'A3' })).toHaveLength(1);
  });

  it('מפתח לא מוכר נדחה', () => {
    expect(validateSettings({ something_else: 'x' })).toHaveLength(1);
  });
});

describe('שמירת הגדרות', () => {
  it('שומרת ורושמת ביומן הביקורת (B-10)', () => {
    saveSettings(
      db,
      { synagogue_name: 'בית הכנסת אור החיים', synagogue_city: 'מודיעין' },
      userId,
      'admin',
    );
    const config = getConfiguration(db);
    expect(config.settings['synagogue_name']).toBe('בית הכנסת אור החיים');
    expect(config.settings['synagogue_city']).toBe('מודיעין');

    const audit = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity = 'setting'").get() as {
      c: number;
    };
    expect(audit.c).toBe(1);
  });

  it('מזין אינו רשאי לשנות הגדרות (SPEC 6.3)', () => {
    expect(() => saveSettings(db, { synagogue_name: 'x' }, userId, 'clerk')).toThrow(/מנהל/);
  });

  it('שינוי חודש השנה הכספית משפיע בפועל', () => {
    saveSettings(db, { fiscal_year_start_month: '1' }, userId, 'admin');
    expect(getConfiguration(db).settings['fiscal_year_start_month']).toBe('1');
  });
});

describe('מספור קבלות (F-92, B-03)', () => {
  it('בית כנסת חדש יכול להתחיל מכל מספר', () => {
    const counters = setReceiptStartNumber(db, 1001, userId, 'admin');
    expect(counters.nextReceiptNumber).toBe(1001);
  });

  it('לא ניתן לרדת מתחת למספר שכבר הופק', () => {
    setReceiptStartNumber(db, 500, userId, 'admin');
    const m = createMember(db, { firstName: 'ישראל', lastName: 'ישראלי' }, userId);
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-01', amountAgorot: 1000, paymentMethodId: cash() },
      userId,
      { issueReceipt: true },
    );
    expect(getCounters(db).maxIssuedReceiptNumber).toBe(500);

    expect(() => setReceiptStartNumber(db, 400, userId, 'admin')).toThrow(/500/);
    expect(() => setReceiptStartNumber(db, 500, userId, 'admin')).toThrow(/500/);
    expect(() => setReceiptStartNumber(db, 501, userId, 'admin')).not.toThrow();
  });

  it('חוסם ערכים לא חוקיים ומשתמש שאינו מנהל', () => {
    expect(() => setReceiptStartNumber(db, 0, userId, 'admin')).toThrow();
    expect(() => setReceiptStartNumber(db, 1.5, userId, 'admin')).toThrow();
    expect(() => setReceiptStartNumber(db, 10, userId, 'clerk')).toThrow(/מנהל/);
  });

  it('נרשם ביומן הביקורת', () => {
    setReceiptStartNumber(db, 777, userId, 'admin');
    const audit = db
      .prepare("SELECT after_json FROM audit_log WHERE entity = 'sequence'")
      .get() as { after_json: string };
    expect(JSON.parse(audit.after_json)).toEqual({ receipt: 777 });
  });
});

describe('ניהול רשימות (F-91)', () => {
  it('מוסיף ערך חדש', () => {
    const rows = addLookupValue(db, 'donation_type', 'ספר תורה', userId);
    expect(rows.map((r) => r.name)).toContain('ספר תורה');
  });

  it('חוסם כפילות', () => {
    expect(() => addLookupValue(db, 'donation_type', 'בדק בית', userId)).toThrow(/כבר קיים/);
  });

  it('חוסם שם ריק', () => {
    expect(() => addLookupValue(db, 'expense_category', '  ', userId)).toThrow();
  });

  it('מוסיף אמצעי תשלום עם דרישת אסמכתא', () => {
    const rows = addLookupValue(db, 'payment_method', 'שובר', userId, { requiresReference: true });
    expect(rows.find((r) => r.name === 'שובר')?.requiresReference).toBe(true);
  });

  it('מוסיף אירוע חדש לרשימת הפרשות', () => {
    const rows = addLookupValue(db, 'occasion', 'שבת כלה', userId, { type: 'event' });
    const added = rows.find((r) => r.name === 'שבת כלה');
    expect(added?.type).toBe('event');
    expect(added?.isActive).toBe(true);
  });

  it('שינוי שם משנה גם ברשומות קיימות (השם הוא מפתח לוגי אחד)', () => {
    const rows = renameLookupValue(db, 'donation_type', 1, 'בדק הבית', userId);
    expect(rows.find((r) => r.id === 1)?.name).toBe('בדק הבית');
  });

  it('השבתה מסתירה מרשימות הבחירה אך שומרת את הערך', () => {
    setLookupActive(db, 'donation_type', 1, false, userId);
    const rows = listLookup(db, 'donation_type');
    expect(rows.find((r) => r.id === 1)?.isActive).toBe(false);
    expect(rows).toHaveLength(4); // הערך נשאר
  });

  it('מדווח בכמה רשומות כל ערך בשימוש', () => {
    const m = createMember(db, { firstName: 'ישראל', lastName: 'ישראלי' }, userId);
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-01', amountAgorot: 1000, paymentMethodId: cash() },
      userId,
    );
    const rows = listLookup(db, 'payment_method');
    expect(rows.find((r) => r.name === 'מזומן')?.usageCount).toBe(1);
    expect(rows.find((r) => r.name === 'המחאה')?.usageCount).toBe(0);
  });

  it('כל שינוי ברשימה נרשם ביומן', () => {
    addLookupValue(db, 'expense_category', 'ביטוח', userId);
    setLookupActive(db, 'expense_category', 1, false, userId);
    const audit = db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE entity = 'expense_category'")
      .get() as { c: number };
    expect(audit.c).toBe(2);
  });
});

describe('תיקיית ארכיון הקבלות (receipts_dir)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'nedarim-recdir-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ריק = תיקיית הנתונים של היישום', () => {
    expect(receiptsRoot(db, tmp)).toBe(defaultReceiptsRoot(tmp));
    expect(receiptsRoot(db, tmp)).toBe(join(tmp, 'receipts'));
  });

  it('ערך מוגדר גובר, וה-PDF נשמר תחתיו לפי שנת ההפקה', () => {
    const custom = join(tmp, 'ארכיון קבלות');
    saveSettings(db, { receipts_dir: custom }, userId, 'admin');
    expect(receiptsRoot(db, tmp)).toBe(custom);

    const path = receiptPdfPath(db, tmp, {
      id: 1,
      receiptNumber: 77,
      issuedAt: '2026-09-06T10:00:00',
    } as never);
    expect(path).toBe(join(custom, '2026', '0077.pdf'));
    // התיקייה נוצרת בפועל, כדי שההפקה לא תיפול על תיקייה חסרה.
    expect(existsSync(join(custom, '2026'))).toBe(true);
  });

  it('נתיב שאי אפשר לכתוב אליו נדחה בשמירה, ולא ברגע הפקת הקבלה', () => {
    // קובץ, לא תיקייה – mkdir עליו נכשל.
    const file = join(tmp, 'לא-תיקייה.txt');
    writeFileSync(file, 'x');
    expect(() => saveSettings(db, { receipts_dir: file }, userId, 'admin')).toThrow(
      /תיקיית ארכיון הקבלות/,
    );
    // ההגדרה לא נשמרה, ולכן ההפקה ממשיכה לעבוד מול ברירת המחדל.
    expect(receiptsRoot(db, tmp)).toBe(defaultReceiptsRoot(tmp));
  });

  it('pathProblem מאתר קובץ במקום תיקייה ומאשר תיקייה תקינה', () => {
    const file = join(tmp, 'a.txt');
    writeFileSync(file, 'x');
    expect(pathProblem(file)).not.toBeNull();
    expect(pathProblem(join(tmp, 'חדשה'))).toBeNull();
  });
});
