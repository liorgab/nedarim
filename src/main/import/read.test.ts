import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importEntity } from './catalog';
import { writeTemplate } from './template';
import {
  detectHeaderRow,
  missingRequiredHeaders,
  parseCsv,
  readWorkbook,
  rowsFromMatrix,
  unknownHeaders,
} from './read';

/** קריאת הקובץ. הפרסור וזיהוי הכותרות הם מה שנשבר על קובץ אמיתי. */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-read-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseCsv', () => {
  it('שורות ותאים פשוטים', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('תא מצוטט עם פסיק בתוכו', () => {
    expect(parseCsv('a,"ישראל, ישראלי",c')).toEqual([['a', 'ישראל, ישראלי', 'c']]);
  });

  it('מרכאה כפולה בתוך תא מצוטט', () => {
    // בלי הטיפול הזה כל הערה עם גרשיים שוברת את הקובץ.
    expect(parseCsv('"בית הכנסת ""ברית"" שלום"')).toEqual([['בית הכנסת "ברית" שלום']]);
  });

  it('ירידת שורה בתוך תא מצוטט', () => {
    expect(parseCsv('a,"שורה\nשנייה"')).toEqual([['a', 'שורה\nשנייה']]);
  });

  it('סיומי שורה של Windows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('BOM ש-Excel כותב אינו הופך לכותרת', () => {
    expect(parseCsv('﻿מספר חבר,שם')[0]![0]).toBe('מספר חבר');
  });

  it('תאים ריקים נשמרים במקומם', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('שורה אחרונה בלי ירידת שורה', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('קלט ריק', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('detectHeaderRow', () => {
  const member = importEntity('member');

  it('מוצא כותרות בשורה הראשונה – קובץ ידני', () => {
    const matrix = [
      ['מספר חבר', 'שם פרטי', 'שם משפחה'],
      ['1', 'ישראל', 'ישראלי'],
    ];
    expect(detectHeaderRow(matrix, member)).toEqual({ index: 0, matched: 3 });
  });

  it('מוצא כותרות בשורה השנייה – התבנית', () => {
    const matrix = [
      ['חברי בית הכנסת. זו היישות הראשונה…'],
      ['מספר חבר *', 'שם פרטי *', 'שם משפחה *'],
      ['חובה', 'חובה', 'חובה'],
    ];
    // הכוכבית מהתבנית מנורמלת החוצה.
    expect(detectHeaderRow(matrix, member).index).toBe(1);
  });

  it('מדלג על שורות ריקות וכותרת שהמשתמש הוסיף', () => {
    const matrix = [
      ['רשימת החברים שלי'],
      [],
      ['מספר חבר', 'שם פרטי', 'שם משפחה'],
    ];
    expect(detectHeaderRow(matrix, member).index).toBe(2);
  });

  it('קובץ בלי כותרות מוכרות', () => {
    expect(detectHeaderRow([['a', 'b']], member)).toEqual({ index: -1, matched: 0 });
  });

  it('בוחר את השורה עם ההתאמה הטובה ביותר', () => {
    const matrix = [
      ['מספר חבר', 'סתם'],
      ['מספר חבר', 'שם פרטי', 'שם משפחה'],
    ];
    expect(detectHeaderRow(matrix, member).index).toBe(1);
  });
});

describe('rowsFromMatrix', () => {
  const member = importEntity('member');

  it('ממפה לפי כותרות', () => {
    const { rows } = rowsFromMatrix(
      [
        ['מספר חבר', 'שם פרטי'],
        ['1', 'ישראל'],
        ['2', 'משה'],
      ],
      0,
      member,
    );
    expect(rows).toEqual([
      { 'מספר חבר': '1', 'שם פרטי': 'ישראל' },
      { 'מספר חבר': '2', 'שם פרטי': 'משה' },
    ]);
  });

  it('כוכבית מהתבנית מנורמלת לשם השדה', () => {
    const { rows, headers } = rowsFromMatrix([['מספר חבר *'], ['7']], 0, member);
    expect(headers).toEqual(['מספר חבר']);
    expect(rows[0]).toEqual({ 'מספר חבר': '7' });
  });

  it('מספר השורה הראשונה נכון לדיווח שגיאות', () => {
    // כותרת בשורה 2 של Excel → הנתונים מתחילים בשורה 3.
    expect(rowsFromMatrix([[], ['מספר חבר'], ['1']], 1, member).firstRowNumber).toBe(3);
  });

  it('תא חסר הופך ל-null ולא מזיז עמודות', () => {
    const { rows } = rowsFromMatrix([['מספר חבר', 'שם פרטי'], ['1']], 0, member);
    expect(rows[0]).toEqual({ 'מספר חבר': '1', 'שם פרטי': null });
  });

  it('עמודה בלי כותרת מדולגת', () => {
    const { rows } = rowsFromMatrix([['מספר חבר', ''], ['1', 'זבל']], 0, member);
    expect(Object.keys(rows[0]!)).toEqual(['מספר חבר']);
  });
});

describe('בדיקות כותרות', () => {
  const member = importEntity('member');

  it('עמודה לא מוכרת מדווחת', () => {
    expect(unknownHeaders(['מספר חבר', 'גיל'], member)).toEqual(['גיל']);
  });

  it('שדה חובה חסר מדווח', () => {
    const missing = missingRequiredHeaders(['מספר חבר'], member);
    expect(missing).toContain('שם פרטי');
    expect(missing).toContain('שם משפחה');
  });

  it('כל החובה קיימים', () => {
    expect(missingRequiredHeaders(['מספר חבר', 'שם פרטי', 'שם משפחה'], member)).toEqual([]);
  });
});

describe('מסע הלוך ושוב – התבנית נקראת על ידי הקורא', () => {
  it('כל גיליון בתבנית נקרא וכותרותיו מזוהות', async () => {
    // הבדיקה החשובה: מה שנכתב ב-template.ts נקרא על ידי read.ts.
    // שני צדדים של אותו חוזה, שנוטים להתפצל.
    const path = await writeTemplate(join(dir, 'tpl.xlsx'));
    const sheets = await readWorkbook(path);

    for (const entityId of ['member', 'donation', 'vow_charge'] as const) {
      const entity = importEntity(entityId);
      const sheet = sheets.find((s) => s.name === entity.sheet);
      expect(sheet, entity.sheet).toBeDefined();

      const header = detectHeaderRow(sheet!.matrix, entity);
      expect(header.index, entity.sheet).toBeGreaterThanOrEqual(0);
      // כל שדות היישות זוהו, לא רק חלקם.
      expect(header.matched, entity.sheet).toBe(entity.fields.length);

      const { headers } = rowsFromMatrix(sheet!.matrix, header.index, entity);
      expect(missingRequiredHeaders(headers, entity), entity.sheet).toEqual([]);
    }
  });

  it('שורת הדוגמה בתבנית מגיעה כשורת נתונים', async () => {
    // ולכן חייבת להיות מזוהה ומדולגת באימות – מה שנבדק ב-validate.
    const path = await writeTemplate(join(dir, 'tpl2.xlsx'));
    const sheets = await readWorkbook(path);
    const entity = importEntity('member');
    const sheet = sheets.find((s) => s.name === entity.sheet)!;
    const header = detectHeaderRow(sheet.matrix, entity);
    const { rows } = rowsFromMatrix(sheet.matrix, header.index, entity);

    const values = rows.flatMap((r) => Object.values(r)).map((v) => String(v ?? ''));
    expect(values.some((v) => v.startsWith('דוגמה – למחוק'))).toBe(true);
  });
});
