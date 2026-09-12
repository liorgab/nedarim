import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, stripInline } from './markdownLite';

describe('stripInline', () => {
  it('מסיר הדגשה', () => {
    expect(stripInline('**חשוב** מאוד')).toBe('חשוב מאוד');
  });

  it('מסיר סימוני קוד', () => {
    expect(stripInline('הקובץ `LICENSE` נמצא בשורש')).toBe('הקובץ LICENSE נמצא בשורש');
  });

  it('קישור נשאר כטקסט בלי הכתובת', () => {
    expect(stripInline('ראו [המדיניות](PRIVACY.md) המלאה')).toBe('ראו המדיניות המלאה');
  });

  it('טקסט בלי סימונים אינו משתנה', () => {
    expect(stripInline('שורה רגילה')).toBe('שורה רגילה');
  });

  it('כוכבית בודדת אינה נחשבת הדגשה', () => {
    expect(stripInline('5 * 3')).toBe('5 * 3');
  });
});

describe('parseMarkdown', () => {
  it('כותרות בשלוש רמות', () => {
    const blocks = parseMarkdown('# אחת\n\n## שתיים\n\n### שלוש');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'אחת' },
      { kind: 'heading', level: 2, text: 'שתיים' },
      { kind: 'heading', level: 3, text: 'שלוש' },
    ]);
  });

  it('פסקה מרובת שורות מתאחדת לשורה אחת', () => {
    const blocks = parseMarkdown('שורה ראשונה\nוהמשכה');
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'שורה ראשונה והמשכה' }]);
  });

  it('שורה ריקה מפרידה פסקאות', () => {
    expect(parseMarkdown('אחת\n\nשתיים')).toHaveLength(2);
  });

  it('רשימה נאספת לבלוק אחד', () => {
    const blocks = parseMarkdown('- ראשון\n- שני\n- שלישי');
    expect(blocks).toEqual([{ kind: 'list', items: ['ראשון', 'שני', 'שלישי'] }]);
  });

  it('טבלה נשמרת כטקסט, בלי שורת המפריד', () => {
    const blocks = parseMarkdown('| מה | איפה |\n|---|---|\n| DB | כאן |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('pre');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('| מה | איפה |');
    expect(text).not.toContain('---');
  });

  it('רשימה אחרי כותרת אינה בולעת אותה', () => {
    const blocks = parseMarkdown('## כותרת\n- פריט');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list']);
  });

  it('טקסט ריק מחזיר רשימה ריקה', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});

describe('מסמכי המדיניות האמיתיים', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

  it('PRIVACY.md מתפרסר לבלוקים משמעותיים', () => {
    const blocks = parseMarkdown(read('PRIVACY.md'));
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.filter((b) => b.kind === 'heading').length).toBeGreaterThan(3);
    expect(blocks.some((b) => b.kind === 'list')).toBe(true);
    expect(blocks.some((b) => b.kind === 'pre')).toBe(true); // הטבלה
  });

  it('אף בלוק אינו מכיל סימוני Markdown שנותרו', () => {
    // מה שלא זוהה מוצג כטקסט – אבל `**` ו-`#` לא אמורים לשרוד.
    for (const file of ['PRIVACY.md', 'THIRD-PARTY-NOTICES.md']) {
      for (const b of parseMarkdown(read(file))) {
        const text = b.kind === 'list' ? b.items.join(' ') : b.text;
        expect(text, `${file}: ${text.slice(0, 40)}`).not.toMatch(/\*\*/);
        if (b.kind === 'heading') expect(text).not.toMatch(/^#/);
      }
    }
  });

  it('שום תוכן לא אבד – כל מילה במקור מופיעה בפלט', () => {
    // ההגנה המרכזית: מסמך משפטי לא יאבד משפט בגלל סימון שלא זוהה.
    const source = read('PRIVACY.md');
    const rendered = parseMarkdown(source)
      .map((b) => (b.kind === 'list' ? b.items.join(' ') : b.text))
      .join(' ');
    const words = source
      .replace(/[#*`|_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !w.includes('](') && !w.includes('.md'));
    for (const w of words) expect(rendered, w).toContain(w);
  });
});
