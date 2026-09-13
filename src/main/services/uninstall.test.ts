import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findUninstaller, uninstallScript, writeUninstallScript } from './uninstall';

/**
 * F-131 – הסרת התוכנה.
 *
 * התסריט עצמו נבדק כאן במלואו, כי הרצתו האמיתית מוחקת את היישום ואי אפשר
 * לחזור ממנה. שגיאה בו מתגלה רק כשכבר מאוחר.
 */

const INSTALL = 'C:\\Users\\lior\\AppData\\Local\\Programs\\nedarim';
const DATA = 'C:\\Users\\lior\\AppData\\Roaming\\nedarim';

describe('findUninstaller', () => {
  it('מוצא את הקובץ של electron-builder', () => {
    const found = findUninstaller(INSTALL, () => ['נדרים.exe', 'Uninstall נדרים.exe', 'LICENSE']);
    expect(found).toBe(join(INSTALL, 'Uninstall נדרים.exe'));
  });

  it('שם עברי אינו מפריע', () => {
    // החיפוש לפי תבנית ולא לפי מחרוזת בנויה: קידוד שונה של אותו שם היה
    // מחזיר "לא נמצא" על התקנה תקינה.
    const found = findUninstaller(INSTALL, () => ['Uninstall בית הכנסת.exe']);
    expect(found).not.toBeNull();
  });

  it('גם בצורת unins000.exe', () => {
    expect(findUninstaller(INSTALL, () => ['unins000.exe'])).not.toBeNull();
  });

  it('אין Uninstaller – מוחזר null ולא קורס', () => {
    // זה המצב בהרצת פיתוח, והכפתור צריך לדעת לומר זאת.
    expect(findUninstaller(INSTALL, () => ['נדרים.exe'])).toBeNull();
  });

  it('תיקייה שאינה קיימת', () => {
    expect(findUninstaller('C:\\nope\\nope')).toBeNull();
  });
});

describe('uninstallScript', () => {
  const base = { uninstaller: join(INSTALL, 'Uninstall נדרים.exe'), userDataDir: DATA };

  it('מגדיר קוד-עמוד UTF-8', () => {
    // בלי זה נתיב עברי הופך לג׳יבריש ו-rmdir נכשל בשקט.
    expect(uninstallScript({ ...base, deleteData: true })).toContain('chcp 65001');
  });

  it('בלי מחיקת נתונים – אין rmdir בכלל', () => {
    const script = uninstallScript({ ...base, deleteData: false });
    expect(script).not.toContain('rmdir');
    expect(script).toContain('Uninstall נדרים.exe');
  });

  it('עם מחיקת נתונים – מוחק את תיקיית הנתונים', () => {
    const script = uninstallScript({ ...base, deleteData: true });
    expect(script).toContain(`rmdir /s /q "${DATA}"`);
  });

  it('המחיקה בלולאה, כי היציאה של היישום אינה מיידית', () => {
    const script = uninstallScript({ ...base, deleteData: true });
    expect(script).toContain('for /l %%i in (1,1,20)');
  });

  it('הסרה אינה שקטה – המשתמש מאשר במסך של ה-Uninstaller', () => {
    // לחיצה אחת ביישום לא אמורה להסיר תוכנה בלי אישור נוסף.
    expect(uninstallScript({ ...base, deleteData: true })).not.toContain('/S');
  });

  it('התסריט מוחק את עצמו', () => {
    expect(uninstallScript({ ...base, deleteData: false })).toContain('del "%~f0"');
  });

  it('בלי Uninstaller – עדיין מוחק נתונים ולא מנסה להריץ כלום', () => {
    const script = uninstallScript({ uninstaller: null, userDataDir: DATA, deleteData: true });
    expect(script).toContain('rmdir');
    expect(script).not.toContain('start ""');
  });

  it('שורות בסיומי CRLF – cmd לא קורא אחרת', () => {
    expect(uninstallScript({ ...base, deleteData: false })).toContain('\r\n');
  });

  it('ממתין לפני שהוא נוגע במשהו', () => {
    expect(uninstallScript({ ...base, deleteData: false })).toContain('timeout /t 2');
  });
});

describe('writeUninstallScript', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nedarim-uninst-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('כותב קובץ cmd שאפשר להריץ', () => {
    const { scriptPath } = writeUninstallScript(dir, {
      uninstaller: null,
      userDataDir: DATA,
      deleteData: true,
    });
    expect(scriptPath.endsWith('.cmd')).toBe(true);
    expect(readFileSync(scriptPath, 'utf8')).toContain('rmdir');
  });
});
