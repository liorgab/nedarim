import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractVersionNotes } from './notes';

const SAMPLE = `# יומן שינויים

הקדמה כלשהי.

## [לא שוחרר]

### נוסף

- משהו שעוד לא יצא

## [0.2.0] – 2026-09-12

### נוסף

- לוח שנה
- אשף התקנה

### תוקן

- באג בפרשה

## [0.1.0] – 2026-09-06

הגרסה הראשונה.
`;

describe('extractVersionNotes', () => {
  it('מחלץ את הסעיף הנכון', () => {
    const notes = extractVersionNotes(SAMPLE, '0.2.0');
    expect(notes?.version).toBe('0.2.0');
    expect(notes?.body).toContain('לוח שנה');
    expect(notes?.body).toContain('באג בפרשה');
  });

  it('עוצר בכותרת הגרסה הבאה', () => {
    const notes = extractVersionNotes(SAMPLE, '0.2.0');
    expect(notes?.body).not.toContain('הגרסה הראשונה');
    expect(notes?.body).not.toContain('משהו שעוד לא יצא');
  });

  it('הגרסה האחרונה בקובץ נחתכת בסופו', () => {
    const notes = extractVersionNotes(SAMPLE, '0.1.0');
    expect(notes?.body).toBe('הגרסה הראשונה.');
  });

  it('תגית עם v מוצאת את הסעיף', () => {
    // GitHub מתייג `v0.2.0`, וב-CHANGELOG כתוב `[0.2.0]`.
    expect(extractVersionNotes(SAMPLE, 'v0.2.0')?.version).toBe('0.2.0');
  });

  it('גרסה שאינה בקובץ מחזירה null', () => {
    expect(extractVersionNotes(SAMPLE, '9.9.9')).toBeNull();
  });

  it('שורת הכותרת עצמה אינה נכללת בגוף', () => {
    expect(extractVersionNotes(SAMPLE, '0.2.0')?.body).not.toContain('## [0.2.0]');
  });

  it('הגוף מגיע בלי רווחים מיותרים בקצוות', () => {
    const body = extractVersionNotes(SAMPLE, '0.2.0')!.body;
    expect(body).toBe(body.trim());
  });
});

describe('CHANGELOG.md האמיתי', () => {
  const changelog = () => readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');

  it('לכל גרסה ב-package.json יש סעיף – או סעיף "לא שוחרר"', () => {
    // אחרת השחרור נכשל ב-CI, וזה עדיף על שחרור בלי תיאור.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    const text = changelog();
    const hasVersion = extractVersionNotes(text, pkg.version) !== null;
    const hasUnreleased = text.includes('## [לא שוחרר]');
    expect(hasVersion || hasUnreleased).toBe(true);
  });

  it('סעיף 0.1.0 קיים ואינו ריק', () => {
    const notes = extractVersionNotes(changelog(), '0.1.0');
    expect(notes).not.toBeNull();
    expect(notes!.body.length).toBeGreaterThan(20);
  });
});
