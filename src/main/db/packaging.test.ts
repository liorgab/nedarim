import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * מה נארז בקובץ ההתקנה.
 *
 * הרקע: אחרי ההתקנה הראשונה נשאלה השאלה "מאיפה הגיעו הנתונים של בית
 * הכנסת?". התשובה הייתה שהם מגיעים מ-`%APPDATA%` של אותו מחשב ולא
 * מקובץ ההתקנה – אבל זו בדיוק שאלה שאסור שתישאר ברמת "בדקתי פעם אחת".
 *
 * `.exe` מופץ לכל מי שמוריד. אם יום אחד מישהו יוסיף `data/**` או
 * `*.db` ל-`files`, זו תהיה דליפה של שמות, טלפונים והיסטוריה כספית של
 * חברי בית כנסת אמיתי – ואי אפשר לבטל הפצה.
 */

const ROOT = process.cwd();

/** רשימת `files` מתוך `electron-builder.yml`. */
function packagedPatterns(): string[] {
  const lines = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === 'files:');
  expect(start, 'לא נמצא בלוק files').toBeGreaterThanOrEqual(0);

  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith(' ')) break;
    const item = /^\s+-\s*'?([^']+?)'?\s*$/.exec(line);
    if (item !== null) out.push(item[1]!);
  }
  return out;
}

describe('אריזה – מה נכנס לקובץ ההתקנה', () => {
  it('אין דפוס שיכול לגרור נתונים', () => {
    const forbidden = /(^|\/)data\b|\.db\b|\.xlsm\b|\.xlsx\b|backups?\b|legacy\b/i;
    for (const pattern of packagedPatterns()) {
      // דפוסי שלילה (`!`) אינם מסוכנים – הם מוציאים ולא מכניסים.
      if (pattern.startsWith('!')) continue;
      expect(pattern, `דפוס מסוכן ב-electron-builder.yml: ${pattern}`).not.toMatch(forbidden);
    }
  });

  it('הרשימה מפורשת ואינה כוללת-הכול', () => {
    // `**/*` או `.` היו אורזים את כל הפרויקט, כולל `data/legacy`.
    const patterns = packagedPatterns().filter((p) => !p.startsWith('!'));
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(['**/*', '**', '.', './**'], `דפוס רחב מדי: ${p}`).not.toContain(p);
    }
  });

  it('נארזים רק הקוד המהודר ומסמכי הרישוי', () => {
    const patterns = packagedPatterns().filter((p) => !p.startsWith('!'));
    const allowed = new Set([
      'out/**',
      'package.json',
      'LICENSE',
      'THIRD-PARTY-NOTICES.md',
      'PRIVACY.md',
      'CHANGELOG.md',
    ]);
    for (const p of patterns) {
      expect(allowed, `דפוס חדש ב-files שדורש בדיקה: ${p}`).toContain(p);
    }
  });

  it('data/legacy מוחרג ב-gitignore עם נתיב מלא', () => {
    // שכבת הגנה שנייה: גם אם דפוס אריזה ישתנה, הקובץ לא נמצא בריפו.
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toContain('data/legacy/');
  });

  it('אין קובץ בסיס נתונים מנוהל בריפו', () => {
    // `*.db` ב-gitignore, אבל הבדיקה מוודאת שהדפוס באמת שם.
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\*\.db$/m);
  });
});
