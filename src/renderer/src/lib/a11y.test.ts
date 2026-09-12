import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * נגישות: לכל כפתור אייקון יש שם.
 *
 * `<IconButton>` עם אייקון בלבד הוא כפתור **בלי שם** לקורא מסך. `<Tooltip>`
 * אינו פותר את זה: MUI מוסיף `aria-describedby` כשהטולטיפ פתוח, אבל תיאור
 * אינו שם, וכשהטולטיפ סגור אין כלום.
 *
 * נמצאו 26 כאלה מתוך 28. הבדיקה סורקת את קוד המקור ולא DOM מרונדר, כי
 * היא צריכה לתפוס כפתור חדש ברגע שנכתב – לא רק אם במקרה יש לו בדיקת
 * רכיב.
 */

const ROOT = join(process.cwd(), 'src', 'renderer', 'src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

/** סוף התג הפותח, תוך התעלמות מ-`>` שנמצא בתוך ביטוי `{...}`. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

function unlabelled(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');
    const re = /<IconButton\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const tag = openingTag(source, m.index);
      // `{...props}` מעביר שם מבחוץ ולכן נחשב מתויג.
      if (tag.includes('aria-label') || tag.includes('{...')) continue;
      const line = source.slice(0, m.index).split('\n').length;
      found.push(`${file.slice(process.cwd().length + 1)}:${line}`);
    }
  }
  return found;
}

describe('נגישות – כפתורי אייקון', () => {
  it('לכל IconButton יש aria-label', () => {
    expect(unlabelled(), 'כפתורי אייקון בלי שם לקורא מסך').toEqual([]);
  });

  it('הסריקה אכן מוצאת כפתורים – לא עוברת על ריק', () => {
    // שומר מפני regex שנשבר והבדיקה הופכת לחסרת ערך.
    const count = tsxFiles(ROOT)
      .map((f) => (readFileSync(f, 'utf8').match(/<IconButton\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(count).toBeGreaterThan(20);
  });
});
