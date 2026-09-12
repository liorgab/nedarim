/**
 * רינדור תת-קבוצה קטנה של Markdown, למסמכי המדיניות במסך "אודות".
 *
 * **למה לא ספריית Markdown:** כל תלות נוספת היא עוד רישיון לבדוק ועוד
 * שטח תקיפה – ודווקא במסך שכל תפקידו להצהיר שהמערכת נקייה. המסמכים כאן
 * נכתבים בבית ומשתמשים בחמישה סימנים בלבד, ולכן 60 שורות טהורות ובדוקות
 * עדיפות על ספרייה של מגה-בייט.
 *
 * מה שלא נתמך (הדגשה נטויה, קישורים, ציטוטים) פשוט מוצג כטקסט – בלי
 * לאבד תוכן. מסמך משפטי לא יאבד מילה בגלל סימון שלא זוהה.
 */

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  /** טבלאות וקוד – נשמרים כפי שהם, במקום לנסות לרנדר ולהיכשל. */
  | { kind: 'pre'; text: string };

/** מסיר סימוני הדגשה וקוד. הקישור נשאר כטקסט שלו, בלי הכתובת. */
export function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

const isTableRow = (line: string): boolean => line.trimStart().startsWith('|');

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.split('\n');
  let i = 0;

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return;
    blocks.push({ kind: 'paragraph', text: stripInline(buffer.join(' ').trim()) });
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph(paragraph);
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      flushParagraph(paragraph);
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: stripInline(heading[2]!),
      });
      i++;
      continue;
    }

    if (isTableRow(trimmed)) {
      flushParagraph(paragraph);
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i]!.trim())) {
        rows.push(lines[i]!.trim());
        i++;
      }
      // שורת המפריד (`|---|---|`) היא רעש ויזואלי בתצוגת טקסט.
      const visible = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      blocks.push({ kind: 'pre', text: visible.map(stripInline).join('\n') });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph(paragraph);
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) {
        items.push(stripInline(lines[i]!.trim().replace(/^[-*]\s+/, '')));
        i++;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    paragraph.push(trimmed);
    i++;
  }

  flushParagraph(paragraph);
  return blocks;
}
