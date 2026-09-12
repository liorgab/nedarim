import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { importEntity } from './catalog';
import { templateSheets } from './template';
import {
  clearSession,
  currentSession,
  openImportFile,
  preflight,
  runImport,
  updateSheet,
  validateSession,
} from './session';

/**
 * F-121..F-129 – האשף מקצה לקצה.
 *
 * הבדיקות כאן מריצות את המסלול השלם: קובץ על הדיסק → זיהוי → מיפוי →
 * אימות → כתיבה, ובודקות מול ה-DB מה נכתב בפועל. זה המקום היחיד שבו
 * מתגלה שהשלבים אינם מדברים אותה שפה.
 */

let dir: string;
let db: Database;

/** כותב חוברת עם הגיליונות שנתבקשו וכל אחד עם השורות שנתנו. */
async function writeBook(
  name: string,
  content: Record<string, string[][]>,
): Promise<string> {
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  const sheets = Object.entries(content).map(([sheet, rows]) => ({
    sheet,
    data: rows.map((row) => row.map((value) => ({ value, type: String }))),
  }));
  const path = join(dir, name);
  await writeXlsxFile(sheets as never).toFile(path);
  return path;
}

const headersOf = (id: Parameters<typeof importEntity>[0]): string[] =>
  importEntity(id).fields.map((f) => f.label);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-session-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  clearSession();
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('פתיחת קובץ', () => {
  it('התבנית הריקה נפתחת, כל גיליון מזוהה לפי שמו', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/node');
    const path = join(dir, 'tpl.xlsx');
    await writeXlsxFile(templateSheets() as never).toFile(path);

    const opened = await openImportFile(path);
    expect(opened.kind).toBe('workbook');
    expect(opened.sheets.every((s) => s.detectedBy === 'sheet_name')).toBe(true);
    // התבנית הריקה מכילה רק את שורת הדוגמה, ולכן אינה נכללת אוטומטית
    // בשום ייבוא של ממש – אבל היא כן נספרת כשורה.
    expect(opened.sheets.length).toBeGreaterThan(0);
  });

  it('CSV לגיליון אחד מזוהה לפי הכותרות', async () => {
    const path = join(dir, 'members.csv');
    writeFileSync(path, `${headersOf('member').join(',')}\n1,ישראל,ישראלי\n`, 'utf8');

    const opened = await openImportFile(path);
    expect(opened.kind).toBe('csv');
    expect(opened.sheets).toHaveLength(1);
    expect(opened.sheets[0]).toMatchObject({ entity: 'member', dataRows: 1, include: true });
  });

  it('גיליון שלא זוהה אינו נכלל, והמשתמש יכול לבחור לו יישות', async () => {
    const path = await writeBook('unknown.xlsx', {
      'הגיליון שלי': [['עמודה א', 'עמודה ב'], ['1', '2']],
    });

    const opened = await openImportFile(path);
    expect(opened.sheets[0]).toMatchObject({ entity: null, include: false });

    const after = updateSheet(0, { entity: 'member', include: true });
    expect(after.sheets[0]!.entity).toBe('member');
    // המיפוי נבנה מחדש ליישות החדשה, ולא נשאר של הקודמת.
    expect(after.sheets[0]!.mapping.map((m) => m.field)).toEqual(headersOf('member'));
  });

  it('אין קובץ פתוח – אין סשן', () => {
    expect(currentSession()).toBeNull();
  });
});

describe('בדיקת המיפוי', () => {
  it('שדה חובה שלא מופה נחסם', async () => {
    const path = await writeBook('partial.xlsx', {
      'חברים': [['מספר חבר'], ['1']],
    });
    await openImportFile(path);
    updateSheet(0, { entity: 'member', include: true });

    const report = preflight(db, currentSession()!.sheets);
    expect(report.problems[0]?.missingRequired).toContain('שם פרטי');
  });

  it('עמודה שלא מופתה מדווחת ולא נעלמת', async () => {
    const path = await writeBook('extra.xlsx', {
      'חברים': [[...headersOf('member'), 'הערה פרטית'], ['1', 'ישראל', 'ישראלי']],
    });
    await openImportFile(path);

    const report = preflight(db, currentSession()!.sheets);
    expect(report.problems[0]?.ignoredColumns).toContain('הערה פרטית');
  });

  it('ייבוא תרומות בלי חברים – כשאין חברים במערכת – מדווח', async () => {
    const path = await writeBook('donations.xlsx', {
      'תרומות': [headersOf('donation')],
    });
    await openImportFile(path);
    updateSheet(0, { include: true });

    const report = preflight(db, currentSession()!.sheets);
    expect(report.missingDependencies.some((d) => d.needsLabel.includes('חבר'))).toBe(true);
  });

  it('אותו ייבוא אינו מדווח כשהחברים כבר במערכת', async () => {
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (1, 'ישראל', 'ישראלי', '2026-01-01T09:00:00', '2026-01-01T09:00:00')`,
    ).run();

    const path = await writeBook('donations2.xlsx', {
      'תרומות': [headersOf('donation')],
    });
    await openImportFile(path);
    updateSheet(0, { include: true });

    const report = preflight(db, currentSession()!.sheets);
    expect(report.missingDependencies).toEqual([]);
  });
});

describe('אימות וייבוא', () => {
  const memberRows = (n: number): string[][] => {
    const rows: string[][] = [headersOf('member')];
    for (let i = 1; i <= n; i++) rows.push([String(i), `פרטי${i}`, `משפחה${i}`]);
    return rows;
  };

  it('קובץ תקין – ייבוא מלא', async () => {
    const path = await writeBook('ok.xlsx', { 'חברים': memberRows(3) });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.errors).toBe(0);
    expect(report.totalRows).toBe(3);
    expect(report.canImport).toBe(true);

    const result = runImport(db, 'insert', 1);
    expect(result.totals.insert).toBe(3);
    const n = db.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number };
    expect(n.n).toBe(3);
  });

  it('התצוגה המקדימה זהה למה שקורה בפועל', async () => {
    // ההרצה היבשה היא אותו קוד; הבדיקה כאן היא שהיא באמת מתגלגלת אחורה
    // ושהמספרים שהוצגו הם מה שנכתב.
    const path = await writeBook('preview.xlsx', { 'חברים': memberRows(4) });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.preview[0]).toMatchObject({ insert: 4 });
    // אחרי ההרצה היבשה ה-DB עדיין ריק.
    expect((db.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number }).n).toBe(0);

    const result = runImport(db, 'insert', 1);
    expect(result.totals.insert).toBe(report.preview[0]!.insert);
  });

  it('תרומה לחבר שאינו קיים – שגיאה עם שם העמודה ומספר השורה', async () => {
    const path = await writeBook('orphan.xlsx', {
      'תרומות': [
        headersOf('donation'),
        ['', '01/01/2026', '47', 'תורם', 'כללי', 'מזומן', '100', '', '', ''],
      ],
    });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.errors).toBeGreaterThan(0);
    const issue = report.issues.find((i) => i.column === 'מספר חבר');
    expect(issue?.message).toContain('לא נמצא');
    expect(issue?.sampleRows).toEqual([2]);
  });

  it('חבר באותו קובץ פותר את התלות – סדר הייבוא עובד', async () => {
    // החבר אינו ב-DB אלא בגיליון אחר באותו קובץ. בלי סדר נכון כל תרומה
    // הייתה נדחית בייבוא ראשוני.
    const path = await writeBook('together.xlsx', {
      'חברים': memberRows(1),
      'תרומות': [
        headersOf('donation'),
        ['', '01/01/2026', '1', 'תורם', 'כללי', 'מזומן', '100', '', '', ''],
      ],
    });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.errors).toBe(0);

    runImport(db, 'insert', 1);
    const donation = db.prepare('SELECT member_id, amount_agorot FROM donation').get() as {
      member_id: number;
      amount_agorot: number;
    };
    expect(donation.amount_agorot).toBe(10000);
    expect(donation.member_id).not.toBeNull();
  });

  it('שגיאה בשורה אחת אינה מפילה את השאר', async () => {
    const rows = memberRows(3);
    rows[2] = ['2', '', 'משפחה2']; // שם פרטי ריק
    const path = await writeBook('partial-bad.xlsx', { 'חברים': rows });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.totalRejected).toBe(1);
    expect(report.totalRows).toBe(2);
    expect(report.canImport).toBe(true);

    runImport(db, 'insert', 1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number }).n).toBe(2);
  });

  it('שורת הדוגמה מהתבנית מדולגת ואינה מיובאת', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/node');
    const path = join(dir, 'tpl-full.xlsx');
    await writeXlsxFile(templateSheets([importEntity('member')]) as never).toFile(path);
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.sheets[0]?.skippedExample).toBe(1);
    expect(report.totalRows).toBe(0);
  });

  it('מספרי השורות בדוח תואמים לקובץ שהגבאי פותח', async () => {
    // כותרת בשורה 1 → השגיאה בשורת הנתונים השנייה היא שורה 3.
    const rows = memberRows(2);
    rows[2] = ['2', '', 'משפחה2'];
    const path = await writeBook('rownum.xlsx', { 'חברים': rows });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.issues[0]?.sampleRows).toEqual([3]);
  });

  it('שני חברים עם אותו מספר בקובץ – כפילות מדווחת', async () => {
    const path = await writeBook('dup.xlsx', {
      'חברים': [headersOf('member'), ['1', 'א', 'א'], ['1', 'ב', 'ב']],
    });
    await openImportFile(path);

    const report = validateSession(db, 'insert', 1);
    expect(report.issues.some((i) => i.message.includes('מופיע גם בשורה'))).toBe(true);
  });

  it('אין קובץ פתוח – אימות נכשל בהודעה ברורה', () => {
    expect(() => validateSession(db, 'insert', 1)).toThrow('לא נפתח');
  });
});
