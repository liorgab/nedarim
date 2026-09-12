import { describe, expect, it } from 'vitest';
import { importEntity } from './catalog';
import {
  groupIssues,
  isBlankRow,
  isExampleRow,
  summarize,
  validateSheet,
  type RawRow,
  type RefResolver,
} from './validate';

/**
 * האימות רץ **לפני** שנוגעים ב-DB. העיקרון: דוח עם 40 שגיאות שהגבאי
 * מתקן בבת אחת עדיף על ייבוא שנעצר בשורה 12 ומשאיר חצי מצב.
 */

/** פותר שמכיר מספרי חברים 1–3 ואת אמצעי התשלום "מזומן". */
const resolver: RefResolver = (entity, key) => {
  if (entity === 'member') return ['1', '2', '3'].includes(key);
  if (entity === 'payment_method') return key === 'מזומן';
  if (entity === 'donation_type') return key === 'בדק בית';
  if (entity === 'occasion') return key === 'בראשית';
  return false;
};

const memberRow = (over: Partial<RawRow> = {}): RawRow => ({
  'מספר חבר': '10',
  'שם פרטי': 'ישראל',
  'שם משפחה': 'ישראלי',
  ...over,
});

describe('שורות מיוחדות', () => {
  it('שורה ריקה מזוהה', () => {
    expect(isBlankRow({ a: '', b: null, c: '   ' })).toBe(true);
    expect(isBlankRow({ a: '', b: 'x' })).toBe(false);
  });

  it('שורת הדוגמה מהתבנית מזוהה', () => {
    expect(isExampleRow({ 'מספר חבר': 'דוגמה – למחוק: 35' })).toBe(true);
    expect(isExampleRow({ 'מספר חבר': '35' })).toBe(false);
  });

  it('שורה ריקה מדולגת בלי אזהרה', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow(), { 'מספר חבר': '', 'שם פרטי': '', 'שם משפחה': '' }],
      resolveRef: resolver,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
  });

  it('שורת הדוגמה מדולגת עם אזהרה ולא מיובאת', () => {
    // בלי זה היא נכנסת כחבר אמיתי בשם "דוגמה – למחוק: 35".
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [{ 'מספר חבר': 'דוגמה – למחוק: 35', 'שם פרטי': 'ישראל', 'שם משפחה': 'ישראלי' }],
      resolveRef: resolver,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0]!.severity).toBe('warning');
    expect(r.rejected).toBe(0);
  });
});

describe('אימות שדות', () => {
  it('שורה תקינה עוברת', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow()],
      resolveRef: resolver,
    });
    expect(r.issues).toHaveLength(0);
    expect(r.rows[0]!.values['מספר חבר']).toBe(10);
    expect(r.rows[0]!.values['שם פרטי']).toBe('ישראל');
  });

  it('שדה חובה ריק נדחה עם שם העמודה', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ 'שם משפחה': '' })],
      resolveRef: resolver,
    });
    expect(r.rejected).toBe(1);
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0]!.column).toBe('שם משפחה');
    expect(r.issues[0]!.message).toContain('חובה');
  });

  it('שדה רשות ריק אינו שגיאה', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ כינוי: '', 'דוא״ל': '' })],
      resolveRef: resolver,
    });
    expect(r.issues).toHaveLength(0);
  });

  it('מספר השורה הוא כפי שהיא נראית ב-Excel', () => {
    // כדי שאפשר יהיה לפתוח את הקובץ ולקפוץ לשורה.
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow(), memberRow({ 'מספר חבר': '11', 'שם פרטי': '' })],
      resolveRef: resolver,
    });
    expect(r.issues[0]!.row).toBe(4); // 2 = כותרות, 3 = ראשונה, 4 = שנייה
  });

  it('סכום לא תקין מדווח עם הערך שהוקלד', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ 'יתרת פתיחה (₪)': 'בערך 500' })],
      resolveRef: resolver,
    });
    expect(r.issues[0]!.value).toBe('בערך 500');
  });
});

describe('הפניות – הלב של הדיווח', () => {
  const donation = (over: Partial<RawRow> = {}): RawRow => ({
    תאריך: '09/09/2026',
    'מספר חבר': '1',
    'שם התורם': 'ישראל ישראלי',
    'סוג תרומה': 'בדק בית',
    'אמצעי תשלום': 'מזומן',
    'סכום (₪)': '200',
    ...over,
  });

  it('תרומה לחבר קיים עוברת', () => {
    const r = validateSheet({
      entity: importEntity('donation'),
      raw: [donation()],
      resolveRef: resolver,
    });
    expect(r.issues).toHaveLength(0);
  });

  it('תרומה לחבר שאינו קיים – זו השגיאה שביקשנו', () => {
    const r = validateSheet({
      entity: importEntity('donation'),
      raw: [donation({ 'מספר חבר': '47' })],
      resolveRef: resolver,
    });
    expect(r.rejected).toBe(1);
    const found = r.issues[0]!;
    expect(found.column).toBe('מספר חבר');
    expect(found.message).toContain('47');
    expect(found.message).toContain('לא נמצא');
  });

  it('אמצעי תשלום שאינו ברשימה', () => {
    const r = validateSheet({
      entity: importEntity('donation'),
      raw: [donation({ 'אמצעי תשלום': 'ביטקוין' })],
      resolveRef: resolver,
    });
    expect(r.issues.some((i) => i.message.includes('ביטקוין'))).toBe(true);
  });

  it('הפניה ריקה בשדה רשות אינה נבדקת', () => {
    // תרומה של תורם שאינו חבר.
    const r = validateSheet({
      entity: importEntity('donation'),
      raw: [donation({ 'מספר חבר': '' })],
      resolveRef: resolver,
    });
    expect(r.issues).toHaveLength(0);
  });
});

describe('כפילות מפתח בתוך הקובץ', () => {
  it('שני חברים עם אותו מספר', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ 'מספר חבר': '10' }), memberRow({ 'מספר חבר': '10', 'שם פרטי': 'משה' })],
      resolveRef: resolver,
    });
    expect(r.rejected).toBe(1);
    expect(r.issues[0]!.message).toContain('שורה 3');
  });

  it('יישות בלי מפתח טבעי אינה נבדקת לכפילות', () => {
    // לנדר אין מזהה ייחודי – שני נדרים זהים הם מצב לגיטימי.
    const row: RawRow = {
      'מספר חבר': '1',
      תאריך: '18/10/2025',
      'פרשה / אירוע': 'בראשית',
      'סכום (₪)': '360',
    };
    const r = validateSheet({
      entity: importEntity('vow_charge'),
      raw: [row, { ...row }],
      resolveRef: resolver,
    });
    expect(r.rows).toHaveLength(2);
    expect(r.issues).toHaveLength(0);
  });
});

describe('כללי שורה', () => {
  it('כלל שנכשל דוחה את השורה', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow()],
      resolveRef: resolver,
      rowRules: [() => 'כלל שנכשל תמיד'],
    });
    expect(r.rejected).toBe(1);
    expect(r.issues[0]!.message).toBe('כלל שנכשל תמיד');
  });

  it('כלל שעובר אינו מפריע', () => {
    const r = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow()],
      resolveRef: resolver,
      rowRules: [() => null],
    });
    expect(r.rows).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('מסכם על פני גיליונות', () => {
    const good = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow()],
      resolveRef: resolver,
    });
    const bad = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ 'שם פרטי': '' })],
      resolveRef: resolver,
    });
    const s = summarize([good, bad]);
    expect(s.totalRows).toBe(1);
    expect(s.totalRejected).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.canImport).toBe(true);
  });

  it('קובץ שכולו שגוי אינו ניתן לייבוא', () => {
    const bad = validateSheet({
      entity: importEntity('member'),
      raw: [memberRow({ 'שם פרטי': '' })],
      resolveRef: resolver,
    });
    expect(summarize([bad]).canImport).toBe(false);
  });
});

describe('groupIssues', () => {
  it('300 שגיאות תאריך זהות הופכות לשורה אחת', () => {
    // רשימה של 300 שורות אינה קריאה; הגבאי צריך לדעת דבר אחד.
    const raw = Array.from({ length: 300 }, (_, i) => ({
      'מספר חבר': String(100 + i),
      'שם פרטי': 'א',
      'שם משפחה': 'ב',
      'יתרת פתיחה (₪)': 'לא מספר',
    }));
    const r = validateSheet({ entity: importEntity('member'), raw, resolveRef: resolver });
    const grouped = groupIssues(r.issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.count).toBe(300);
    expect(grouped[0]!.column).toBe('יתרת פתיחה (₪)');
  });

  it('עד שלוש שורות לדוגמה', () => {
    const raw = Array.from({ length: 10 }, () => ({ 'מספר חבר': '', 'שם פרטי': 'א', 'שם משפחה': 'ב' }));
    const r = validateSheet({ entity: importEntity('member'), raw, resolveRef: resolver });
    expect(groupIssues(r.issues)[0]!.sampleRows).toHaveLength(3);
  });

  it('הקיבוץ ממוין לפי כמות', () => {
    const issues = [
      { sheet: 'א', row: 1, column: 'x', value: '', severity: 'error' as const, message: 'נדיר' },
      ...Array.from({ length: 5 }, (_, i) => ({
        sheet: 'א', row: i, column: 'y', value: '', severity: 'error' as const, message: 'נפוץ',
      })),
    ];
    expect(groupIssues(issues)[0]!.message).toBe('נפוץ');
  });

  it('שגיאות מאותה צורה עם ערכים שונים מתקבצות יחד', () => {
    const issues = [
      { sheet: 'א', row: 1, column: 'x', value: '', severity: 'error' as const, message: 'ערך "47" לא נמצא' },
      { sheet: 'א', row: 2, column: 'x', value: '', severity: 'error' as const, message: 'ערך "52" לא נמצא' },
    ];
    expect(groupIssues(issues)).toHaveLength(1);
  });
});
