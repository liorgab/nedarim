import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importEntity } from './catalog';
import { isBackupFolder, matchSheetToEntity } from './detect';

/** F-123 – זיהוי היישות שבגיליון. ניחוש שגוי כאן כותב נתונים לטבלה הלא נכונה. */

const headersOf = (id: Parameters<typeof importEntity>[0]): string[] =>
  importEntity(id).fields.map((f) => f.label);

describe('matchSheetToEntity', () => {
  it('שם הגיליון בתבנית מזהה ודאית', () => {
    const entity = importEntity('member');
    const match = matchSheetToEntity(entity.sheet, [headersOf('member')]);
    expect(match).toMatchObject({ entity: 'member', by: 'sheet_name', headerRow: 0 });
  });

  it('גיליון בשם גנרי מזוהה לפי הכותרות', () => {
    const match = matchSheetToEntity('גיליון1', [headersOf('member'), ['1', 'ישראל', 'ישראלי']]);
    expect(match).toMatchObject({ entity: 'member', by: 'headers' });
  });

  it('שורת כותרות שאינה הראשונה', () => {
    const match = matchSheetToEntity('Sheet1', [['רשימת החברים'], [], headersOf('member')]);
    expect(match?.headerRow).toBe(2);
  });

  it('כותרות חלקיות שאינן מכסות את שדות החובה – אין זיהוי', () => {
    // "תאריך" לבדו מתאים חלקית לארבע יישויות. ניחוש ביניהן הוא איך
    // נדרים נכתבים כהוצאות.
    expect(matchSheetToEntity('גיליון1', [['תאריך']])).toBeNull();
  });

  it('גיליון ריק אינו מזוהה', () => {
    expect(matchSheetToEntity('גיליון1', [])).toBeNull();
  });

  it('שם גיליון עם רווחים מיותרים עדיין מזוהה', () => {
    const entity = importEntity('donation');
    const match = matchSheetToEntity(`  ${entity.sheet}  `, [headersOf('donation')]);
    expect(match).toMatchObject({ entity: 'donation', by: 'sheet_name' });
  });

  it('שם גיליון מנצח כותרות של יישות אחרת', () => {
    // המשתמש שינה כותרות אבל השאיר את שם הגיליון – השם הוא הראיה החזקה.
    const entity = importEntity('expense');
    const match = matchSheetToEntity(entity.sheet, [headersOf('member')]);
    expect(match?.entity).toBe('expense');
  });
});

describe('isBackupFolder', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nedarim-detect-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('תיקייה עם DB ומניפסט היא גיבוי', () => {
    writeFileSync(join(dir, 'nedarim.db'), '');
    writeFileSync(join(dir, 'manifest.json'), '{}');
    expect(isBackupFolder(dir)).toBe(true);
  });

  it('תיקייה עם DB בלבד אינה גיבוי', () => {
    writeFileSync(join(dir, 'nedarim.db'), '');
    expect(isBackupFolder(dir)).toBe(false);
  });

  it('תיקייה אחרת אינה גיבוי', () => {
    expect(isBackupFolder(dir)).toBe(false);
  });
});
