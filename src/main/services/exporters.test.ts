import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sheetName, writeFullExport, writeXlsx, type ExportableTable } from './exporters';

/**
 * אימות round-trip לייצוא Excel.
 *
 * הרקע: `xlsx` (Apache-2.0) הוחלף ב-`write-excel-file` (MIT) כדי שהבינארי
 * המופץ לא יערבב Apache-2.0 עם ה-GPL של hebcal, וגם כדי להיפטר מ-CVE
 * שאין לו תיקון ב-npm. החלפת ספריית ייצוא היא בדיוק המקום שבו קובץ יוצא
 * "תקין לכאורה" ונפתח שבור ב-Excel.
 *
 * לכן הבדיקה **קוראת את הקובץ בחזרה** ולא מסתפקת בכך שנוצר. הקריאה
 * נעשית עם `xlsx`, שנשאר ב-devDependencies ככלי הייבוא – כלומר קורא
 * עצמאי, לא אותה ספרייה שכתבה.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-xlsx-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** קורא גיליון בחזרה למטריצה, עם קורא עצמאי. */
async function readBack(path: string): Promise<Record<string, string[][]>> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(path, { type: 'file' });
  const out: Record<string, string[][]> = {};
  for (const name of book.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(book.Sheets[name]!, {
      header: 1,
      raw: false,
      defval: '',
    }) as string[][];
  }
  return out;
}

const table: ExportableTable = {
  title: 'חייבים',
  columns: [
    { key: 'name', label: 'שם', format: 'text' },
    { key: 'amount', label: 'יתרה', format: 'money' },
    { key: 'date', label: 'תאריך', format: 'date' },
  ],
  rows: [
    { name: 'ישראל ישראלי', amount: 36000, date: '2026-09-12' },
    { name: 'דוד מזרחי', amount: -500, date: null },
  ],
  totals: { name: 'סה״כ', amount: 35500, date: null },
};

describe('writeXlsx', () => {
  it('הקובץ הוא ZIP תקין', async () => {
    const path = await writeXlsx(table, join(dir, 'a.xlsx'));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK');
  });

  it('נקרא בחזרה עם כל השורות והעמודות', async () => {
    const path = await writeXlsx(table, join(dir, 'b.xlsx'));
    const sheets = await readBack(path);
    const rows = sheets['חייבים'];
    expect(rows).toBeDefined();
    // כותרת + שתי שורות + סיכום
    expect(rows).toHaveLength(4);
    expect(rows![0]).toEqual(['שם', 'יתרה', 'תאריך']);
    expect(rows![1]![0]).toBe('ישראל ישראלי');
    expect(rows![3]![0]).toBe('סה״כ');
  });

  it('עברית שורדת את המסע', async () => {
    const path = await writeXlsx(table, join(dir, 'c.xlsx'));
    const rows = (await readBack(path))['חייבים']!;
    expect(rows.flat().join(' ')).toContain('ישראל ישראלי');
    expect(rows.flat().join(' ')).toContain('דוד מזרחי');
  });

  it('סכומים מיוצאים כשקלים ולא כאגורות', async () => {
    const path = await writeXlsx(table, join(dir, 'd.xlsx'));
    const rows = (await readBack(path))['חייבים']!;
    // 36000 אגורות = 360 ₪. ייצוא באגורות היה הופך כל גיליון לחסר שימוש.
    expect(rows[1]![1]).toBe('360');
    expect(rows[2]![1]).toBe('-5');
  });

  it('תאריך מיוצא בפורמט תצוגה, וריק נשאר ריק', async () => {
    const path = await writeXlsx(table, join(dir, 'e.xlsx'));
    const rows = (await readBack(path))['חייבים']!;
    expect(rows[1]![2]).toBe('12/09/2026');
    expect(rows[2]![2]).toBe('');
  });

  it('טבלה בלי שורות אינה מפילה את הייצוא', async () => {
    const empty: ExportableTable = { ...table, rows: [], totals: null };
    const path = await writeXlsx(empty, join(dir, 'f.xlsx'));
    expect((await readBack(path))['חייבים']).toHaveLength(1);
  });
});

describe('writeFullExport', () => {
  it('גיליון לכל טבלה, עם השמות הנכונים', async () => {
    const path = await writeFullExport(
      [
        { name: 'חברים', matrix: [['id', 'name'], [1, 'ישראל']] },
        { name: 'קבלות', matrix: [['number'], [453]] },
      ],
      join(dir, 'full.xlsx'),
    );
    const sheets = await readBack(path);
    expect(Object.keys(sheets).sort()).toEqual(['חברים', 'קבלות']);
    expect(sheets['חברים']![1]).toEqual(['1', 'ישראל']);
    expect(sheets['קבלות']![1]).toEqual(['453']);
  });

  it('שמות גיליונות כפולים מקבלים סיומת ולא דורסים זה את זה', async () => {
    // Excel דוחה קובץ עם שני גיליונות באותו שם – שקט ומעצבן.
    const path = await writeFullExport(
      [
        { name: 'טבלה', matrix: [['a'], [1]] },
        { name: 'טבלה', matrix: [['b'], [2]] },
      ],
      join(dir, 'dup.xlsx'),
    );
    const names = Object.keys(await readBack(path));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('שם ארוך נחתך ל-31 תווים כפי ש-Excel דורש', async () => {
    const long = 'א'.repeat(60);
    expect(sheetName(long)).toHaveLength(31);
    const path = await writeFullExport(
      [{ name: long, matrix: [['a'], [1]] }],
      join(dir, 'long.xlsx'),
    );
    expect(Object.keys(await readBack(path))[0]).toHaveLength(31);
  });
});

describe('sheetName', () => {
  it('מסיר תווים ש-Excel אוסר', () => {
    expect(sheetName('דוח: חייבים / 2026')).not.toMatch(/[:\\/?*[\]]/);
  });

  it('שם ריק מקבל ברירת מחדל', () => {
    expect(sheetName('   ')).toBe('דוח');
  });
});
