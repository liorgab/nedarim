import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOC_IDS } from './legalDocs';

/**
 * GPLv3 §5 – המסמכים חייבים להיות קריאים מתוך היישום.
 *
 * הבדיקה לא קוראת ל-`legalDoc()` עצמה כי היא תלויה ב-`app.getAppPath()`
 * של Electron. מה שהיא כן מוודאת הוא מה שבאמת נשבר בשקט: שהקבצים קיימים,
 * שהם לא ריקים, **ושהם מופיעים ברשימת `files` של electron-builder** – אחרת
 * הם פשוט לא ייכנסו להתקנה, ומסך "אודות" יציג הודעת שגיאה אצל כל מי
 * שיתקין.
 */

const ROOT = process.cwd();

const FILES: Record<string, string> = {
  privacy: 'PRIVACY.md',
  license: 'LICENSE',
  notices: 'THIRD-PARTY-NOTICES.md',
  changelog: 'CHANGELOG.md',
};

describe('מסמכי מדיניות', () => {
  it('לכל מזהה יש קובץ קיים ולא ריק', () => {
    for (const id of LEGAL_DOC_IDS) {
      const file = FILES[id]!;
      const path = join(ROOT, file);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path, 'utf8').trim().length, file).toBeGreaterThan(200);
    }
  });

  it('הרישיון הוא GPLv3 ותואם להצהרה ב-package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      license: string;
    };
    expect(pkg.license).toBe('GPL-3.0-or-later');
    expect(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).toContain('Version 3');
  });

  it('כל המסמכים נכללים ב-files של electron-builder', () => {
    // בלי זה הם לא נארזים, ומסך "אודות" יציג "הקובץ לא נמצא" בכל התקנה.
    // חילוץ ידני ולא js-yaml: js-yaml מגיע רק כתלות עקיפה של
    // electron-builder, ובדיקה שנשענת על חבילה שאיש לא הצהיר עליה
    // נשברת בהתקנה נקייה.
    const lines = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8').split('\n');
    const start = lines.findIndex((l) => l.trim() === 'files:');
    expect(start, 'לא נמצא בלוק files ב-electron-builder.yml').toBeGreaterThanOrEqual(0);

    const listed: string[] = [];
    for (const line of lines.slice(start + 1)) {
      // הבלוק נגמר בשורה הראשונה שאינה מוזחת (ושאינה ריקה או הערה).
      if (line.trim() !== '' && !line.startsWith(' ')) break;
      const item = /^\s+-\s*'?([^']+?)'?\s*$/.exec(line);
      if (item !== null) listed.push(item[1]!);
    }
    for (const file of Object.values(FILES)) {
      expect(listed, file).toContain(file);
    }
  });

  it('מדיניות הפרטיות מצהירה על היעדר רשת ועל החריג', () => {
    const text = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8');
    expect(text).toContain('אינה מתחברת לאינטרנט');
    // החריג חייב להיות כתוב, אחרת ההצהרה מטעה.
    expect(text).toContain('וואטסאפ');
  });

  it('הודעות צד שלישי מזכירות את hebcal ואת הסיבה ל-GPL', () => {
    const text = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(text).toContain('@hebcal/core');
    expect(text).toContain('any later version');
  });
});
