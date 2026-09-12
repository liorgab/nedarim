import { describe, expect, it } from 'vitest';
import { excelSerialToIso, fixImplausibleYear, parseLegacyDate } from './dates';

const txt = (v: string) => ({ t: 's', v });
const num = (v: number, z?: string) => ({ t: 'n', v, ...(z ? { z } : {}) });

describe('excelSerialToIso', () => {
  it('ממיר סריאלים ידועים', () => {
    expect(excelSerialToIso(45170)).toBe('2023-09-01'); // נמצא בכרטיסיית חבר 16
    expect(excelSerialToIso(45209)).toBe('2023-10-10');
    expect(excelSerialToIso(46265)).toBe('2026-08-31'); // תאריך ההפקה בתבנית 'קבלות'
  });

  it('דוחה ערכים מחוץ לטווח', () => {
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(-5)).toBeNull();
  });
});

describe('parseLegacyDate – הפורמטים שנמצאו בקובץ', () => {
  it('serial עם פורמט תאריך', () => {
    expect(parseLegacyDate(num(45170, 'dd\\.mm\\.yyyy;@'))).toMatchObject({
      iso: '2023-09-01',
      confidence: 'exact',
    });
  });

  it('טקסט dd.mm.yyyy', () => {
    expect(parseLegacyDate(txt('01.09.2023'))).toMatchObject({
      iso: '2023-09-01',
      confidence: 'exact',
    });
  });

  it('טקסט dd/mm/yyyy', () => {
    expect(parseLegacyDate(txt('25/09/2023'))).toMatchObject({
      iso: '2023-09-25',
      confidence: 'exact',
    });
  });

  it('נקודה מובילה: ".01.09.2023"', () => {
    const r = parseLegacyDate(txt('.01.09.2023'));
    expect(r.iso).toBe('2023-09-01');
    expect(r.confidence).toBe('guessed');
  });

  it('לוכסן כפול: "01/06//2026"', () => {
    const r = parseLegacyDate(txt('01/06//2026'));
    expect(r.iso).toBe('2026-06-01');
    expect(r.confidence).toBe('guessed');
  });

  it('מפריד חסר: "04/052026"', () => {
    const r = parseLegacyDate(txt('04/052026'));
    expect(r.iso).toBe('2026-05-04');
    expect(r.confidence).toBe('guessed');
  });

  it('שנה דו-ספרתית: "25.07.26"', () => {
    const r = parseLegacyDate(txt('25.07.26'));
    expect(r.iso).toBe('2026-07-25');
    expect(r.confidence).toBe('guessed');
  });

  it('מספר עשרוני: 29.092023 (גיליון הוצאות שורה 8)', () => {
    const r = parseLegacyDate(num(29.092023));
    expect(r.iso).toBe('2023-09-29');
    expect(r.confidence).toBe('guessed');
  });

  it('תא ריק', () => {
    expect(parseLegacyDate(null).confidence).toBe('failed');
    expect(parseLegacyDate(txt('   ')).confidence).toBe('failed');
  });

  it('תאריך שאינו קיים בלוח', () => {
    expect(parseLegacyDate(txt('31.02.2024')).confidence).toBe('failed');
  });

  it('טקסט שאינו תאריך', () => {
    expect(parseLegacyDate(txt('שולם')).confidence).toBe('failed');
    expect(parseLegacyDate(num(100)).confidence).toBe('failed');
  });

  it('לא מזיז יום בגלל אזור זמן', () => {
    // הבדיקה שנכשלה בניתוח הראשוני עם cellDates:true
    for (const s of ['2023-09-01', '2024-03-31', '2026-08-31']) {
      const [y, m, d] = s.split('-').map(Number);
      const serial = Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000) + 25569; // 25569 = 1970-01-01
      expect(excelSerialToIso(serial)).toBe(s);
    }
  });
});

describe('fixImplausibleYear', () => {
  it('מתקן 2925 → 2025 (תרומה מס"ד 21)', () => {
    const r = fixImplausibleYear('2925-07-27', 2020, 2030);
    expect(r).toMatchObject({ iso: '2025-07-27', fixed: true });
  });

  it('לא נוגע בשנה תקינה', () => {
    expect(fixImplausibleYear('2026-08-16', 2020, 2030)).toEqual({
      iso: '2026-08-16',
      fixed: false,
    });
  });
});
