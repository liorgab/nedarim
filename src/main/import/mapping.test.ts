import { describe, expect, it } from 'vitest';
import { importEntity } from './catalog';
import {
  needsConfirmation,
  rowsFromMapping,
  suggestMapping,
  unmappedColumns,
  unmappedRequired,
} from './mapping';

/** F-125 – שלב המיפוי. הסכנה כאן היא ניחוש שגוי **בשקט**. */

const member = importEntity('member');
const donation = importEntity('donation');

const columnOf = (mapping: ReturnType<typeof suggestMapping>, field: string): number | null =>
  mapping.find((m) => m.field === field)?.column ?? null;

const qualityOf = (mapping: ReturnType<typeof suggestMapping>, field: string): string =>
  mapping.find((m) => m.field === field)!.quality;

describe('suggestMapping', () => {
  it('כותרות התבנית ממופות במדויק', () => {
    const headers = member.fields.map((f) => f.label);
    const mapping = suggestMapping(headers, member);
    expect(mapping.every((m) => m.quality === 'exact')).toBe(true);
    expect(mapping.map((m) => m.column)).toEqual(headers.map((_, i) => i));
  });

  it('כוכבית מהתבנית עדיין נחשבת התאמה מדויקת', () => {
    const headers = member.fields.map((f) => `${f.label} *`);
    expect(suggestMapping(headers, member).every((m) => m.quality === 'exact')).toBe(true);
  });

  it('"שם פרטי" ו"שם משפחה" אינם מתחלפים', () => {
    // המילה "שם" משותפת לשניהם. ניחוש לפיה היה הופך את כל רשימת החברים.
    const mapping = suggestMapping(['שם משפחה', 'שם פרטי'], member);
    expect(columnOf(mapping, 'שם פרטי')).toBe(1);
    expect(columnOf(mapping, 'שם משפחה')).toBe(0);
  });

  it('סימן מטבע וסוגריים אינם משנים את ההתאמה', () => {
    // השדה הוא "סכום (₪)" והגבאי כתב "סכום ₪". אותו דבר.
    const mapping = suggestMapping(['סכום ₪'], donation);
    expect(columnOf(mapping, 'סכום (₪)')).toBe(0);
    expect(qualityOf(mapping, 'סכום (₪)')).toBe('exact');
  });

  it('כותרת שמכילה את שם השדה מזוהה כניחוש', () => {
    const mapping = suggestMapping(['שם התורם המלא'], donation);
    expect(columnOf(mapping, 'שם התורם')).toBe(0);
    expect(qualityOf(mapping, 'שם התורם')).toBe('likely');
  });

  it('כותרת לא קשורה אינה ממופה', () => {
    const mapping = suggestMapping(['גיל', 'צבע עיניים'], member);
    expect(mapping.every((m) => m.column === null)).toBe(true);
  });

  it('אותה עמודה אינה משמשת שני שדות', () => {
    const mapping = suggestMapping(['שם'], member);
    const used = mapping.map((m) => m.column).filter((c) => c !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('התאמה מדויקת מנצחת התאמה חלקית על אותה עמודה', () => {
    const mapping = suggestMapping(['שם משפחה', 'משפחה'], member);
    expect(columnOf(mapping, 'שם משפחה')).toBe(0);
  });

  it('עמודה ריקה אינה ממופה', () => {
    const mapping = suggestMapping(['', 'מספר חבר'], member);
    expect(columnOf(mapping, 'מספר חבר')).toBe(1);
  });
});

describe('בדיקות לפני המעבר לשלב הבא', () => {
  it('שדה חובה שלא מופה מדווח', () => {
    const mapping = suggestMapping(['מספר חבר'], member);
    const missing = unmappedRequired(mapping, member);
    expect(missing).toContain('שם פרטי');
    expect(missing).not.toContain('מספר חבר');
  });

  it('כל החובה ממופים – אין חסמים', () => {
    const mapping = suggestMapping(member.fields.map((f) => f.label), member);
    expect(unmappedRequired(mapping, member)).toEqual([]);
  });

  it('עמודה בקובץ שלא מופתה מדווחת ולא נעלמת בשקט', () => {
    const headers = ['מספר חבר', 'שם פרטי', 'שם משפחה', 'הערת גבאי פרטית'];
    const mapping = suggestMapping(headers, member);
    expect(unmappedColumns(headers, mapping)).toContainEqual({
      column: 3,
      header: 'הערת גבאי פרטית',
    });
  });

  it('ניחושים מסומנים לאישור, התאמות מדויקות לא', () => {
    const exact = suggestMapping(member.fields.map((f) => f.label), member);
    expect(needsConfirmation(exact)).toEqual([]);

    const guessed = suggestMapping(['שם התורם המלא'], donation);
    expect(needsConfirmation(guessed).map((m) => m.field)).toEqual(['שם התורם']);
  });
});

describe('rowsFromMapping', () => {
  const mapping = [
    { field: 'מספר חבר', column: 2, quality: 'exact' as const },
    { field: 'שם פרטי', column: 0, quality: 'exact' as const },
    { field: 'שם משפחה', column: null, quality: 'none' as const },
  ];

  it('קורא לפי אינדקס העמודה ולא לפי הסדר בקובץ', () => {
    const { rows } = rowsFromMapping([['כותרת'], ['ישראל', 'זבל', '7']], 0, mapping);
    expect(rows[0]).toMatchObject({ 'מספר חבר': '7', 'שם פרטי': 'ישראל' });
  });

  it('שדה לא ממופה מגיע כ-null', () => {
    const { rows } = rowsFromMapping([['כותרת'], ['ישראל', 'זבל', '7']], 0, mapping);
    expect(rows[0]!['שם משפחה']).toBeNull();
  });

  it('תא חסר בסוף השורה אינו מזיז עמודות', () => {
    const { rows } = rowsFromMapping([['כותרת'], ['ישראל']], 0, mapping);
    expect(rows[0]).toEqual({ 'מספר חבר': null, 'שם פרטי': 'ישראל', 'שם משפחה': null });
  });

  it('מספר השורה הראשונה תואם ל-Excel', () => {
    // כותרת בשורה 2 → הנתונים מתחילים בשורה 3, וזה מה שמופיע בדוח.
    expect(rowsFromMapping([[], ['כותרת'], ['x']], 1, mapping).firstRowNumber).toBe(3);
  });
});
