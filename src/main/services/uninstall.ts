import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F-131 – הסרת התוכנה מהמחשב, מתוך היישום עצמו.
 *
 * **למה זה לא יכול לקרות בתוך התהליך הרץ:** היישום מחזיק את בסיס הנתונים
 * פתוח, ואת קובצי ה-Cache של Electron, ואת קובץ ה-exe של עצמו. אי אפשר
 * למחוק את התיקייה שממנה אתה רץ. לכן נכתב תסריט קטן שממתין ליציאה,
 * מוחק את הנתונים (אם התבקש) ואז מריץ את ה-Uninstaller של NSIS.
 *
 * ההפרדה כאן היא בין **מה נכתב בתסריט** – פונקציה טהורה שנבדקת – לבין
 * הרצתו, שהיא שורה אחת של `spawn`.
 */

export interface UninstallPlan {
  /** נתיב ה-Uninstaller של NSIS. `null` = לא נמצא (למשל בהרצת פיתוח). */
  uninstaller: string | null;
  /** תיקיית הנתונים שתימחק, כשהמשתמש ביקש זאת. */
  userDataDir: string;
  deleteData: boolean;
}

/**
 * מאתר את ה-Uninstaller בתיקיית ההתקנה.
 *
 * electron-builder יוצר `Uninstall <שם המוצר>.exe` לצד ה-exe. שם המוצר
 * כאן הוא בעברית, ולכן חיפוש לפי תבנית ולא לפי מחרוזת בנויה: קידוד שונה
 * של אותו שם היה מחזיר "לא נמצא" על התקנה תקינה לחלוטין.
 */
export function findUninstaller(
  installDir: string,
  listDir: (dir: string) => string[] = (dir) => (existsSync(dir) ? readdirSync(dir) : []),
): string | null {
  const match = listDir(installDir).find(
    (name) => /^uninstall.*\.exe$/i.test(name) || /^unins\d*\.exe$/i.test(name),
  );
  return match === undefined ? null : join(installDir, match);
}

/**
 * תוכן התסריט שמבצע את ההסרה.
 *
 * `chcp 65001` הכרחי: הנתיבים מכילים עברית, ובקוד-עמוד ברירת המחדל של
 * cmd הם הופכים לג'יבריש ו-`rmdir` נכשל בשקט על תיקייה "שאינה קיימת".
 *
 * המחיקה בלולאה ולא בניסיון אחד: היציאה של Electron אינה מיידית, ובזמן
 * שהתסריט רץ ייתכן שקובץ ה-WAL עדיין נעול. עשרים ניסיונות במרווח שנייה
 * הם הרבה יותר מהנדרש, והחלופה היא הסרה שמשאירה את כל הנתונים במקום
 * אחרי שהמשתמש אישר במפורש שהוא רוצה למחוק אותם.
 */
export function uninstallScript(plan: UninstallPlan): string {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'rem נדרים – הסרה יזומה מתוך היישום. הקובץ מוחק את עצמו בסוף.',
    'timeout /t 2 /nobreak >nul',
  ];

  if (plan.deleteData) {
    lines.push(
      'for /l %%i in (1,1,20) do (',
      `  rmdir /s /q "${plan.userDataDir}" 2>nul`,
      `  if not exist "${plan.userDataDir}" goto removed`,
      '  timeout /t 1 /nobreak >nul',
      ')',
      ':removed',
    );
  }

  if (plan.uninstaller !== null) {
    // ללא `/S`: ה-Uninstaller מציג את המסך שלו והמשתמש מאשר שם. הסרה
    // שקטה לגמרי מתוך לחיצה אחת ביישום היא בדיוק מה שאי אפשר לבטל.
    lines.push(`start "" "${plan.uninstaller}"`);
  }

  lines.push('del "%~f0"');
  return `${lines.join('\r\n')}\r\n`;
}

export interface UninstallResult {
  scriptPath: string;
  plan: UninstallPlan;
}

/**
 * כותב את התסריט ומחזיר את נתיבו. ההרצה והיציאה הן באחריות המתקשר, כדי
 * שהבדיקה תוכל לעצור כאן.
 */
export function writeUninstallScript(tempDir: string, plan: UninstallPlan): UninstallResult {
  const scriptPath = join(tempDir, `nedarim-uninstall-${Date.now()}.cmd`);
  writeFileSync(scriptPath, uninstallScript(plan), 'utf8');
  return { scriptPath, plan };
}
