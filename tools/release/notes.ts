/**
 * מחלץ מ-`CHANGELOG.md` את הסעיף של גרסה מסוימת, לטובת תיאור ה-Release.
 *
 * המודול טהור. ההרצה עצמה ב-`write-notes.ts` – בלי ההפרדה, ייבוא
 * הפונקציה בבדיקה היה כותב קובץ.
 *
 * למה לא להשאיר ל-GitHub לייצר "מה השתנה" מרשימת ה-commits: רשימת commits
 * נכתבת למפתחים. מה שמופיע בכפתור "בדוק אם יש עדכון" נקרא על ידי הגבאי,
 * והוא צריך משפטים בעברית שמסבירים מה השתנה עבורו.
 */
/** כותרת גרסה ב-Keep a Changelog: `## [0.2.0] – 2026-09-12`. */
const HEADING = /^##\s+\[([^\]]+)\]/;

export interface VersionNotes {
  version: string;
  /** תוכן הסעיף בלי שורת הכותרת. */
  body: string;
}

/**
 * מחזיר את הסעיף של הגרסה. השוואה גמישה לקידומת `v` כדי שתגית `v0.2.0`
 * תמצא את `## [0.2.0]`.
 */
export function extractVersionNotes(changelog: string, version: string): VersionNotes | null {
  const wanted = version.replace(/^v/, '').trim();
  const lines = changelog.split('\n');

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]!);
    if (m !== null && m[1]!.replace(/^v/, '').trim() === wanted) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // הסעיף נגמר בכותרת הגרסה הבאה, או בסוף הקובץ.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  return { version: wanted, body: lines.slice(start + 1, end).join('\n').trim() };
}
