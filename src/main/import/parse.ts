import type { ImportField } from './catalog';

/**
 * F-123 – פרסור ערך אחד מהגיליון.
 *
 * **טהור לחלוטין.** זה הקוד שמחליט אם "18/10/2025" הוא תאריך תקין ואם
 * "1,250.50" הוא 125050 אגורות. טעות כאן נכנסת לבסיס הנתונים כנתון
 * כספי שגוי – ואי אפשר לדעת מהיתרה הסופית אילו שורות נפגעו.
 *
 * הפרסור סלחני בכוונה בקלט ונוקשה בפלט: קובץ שנערך ביד מכיל רווחים
 * כפולים, פסיקים במספרים, "כן"/"לא" בכל הטיות, ותאריכים בשלושה פורמטים.
 * כל אלה מתקבלים; מה שלא ניתן לפרש חד-משמעית נדחה עם הודעה שאומרת מה
 * היה מצופה.
 */

export type ParseResult =
  | { ok: true; value: string | number | null }
  | { ok: false; message: string };

const ok = (value: string | number | null): ParseResult => ({ ok: true, value });
const fail = (message: string): ParseResult => ({ ok: false, message });

/** Excel מחזיר מספרים, תאריכים ומחרוזות; הכול מנורמל למחרוזת מגוזמת. */
export function toText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim().replace(/\s+/g, ' ');
}

// ------------------------------------------------------------- תאריך

/** `dd/mm/yyyy`, `dd.mm.yyyy`, `dd-mm-yyyy` או ISO. */
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  // בנייה מקומית ובדיקה חוזרת – תופסת 31/02 ו-30/02 שעוברות בדיקת טווח.
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function parseDate(raw: unknown): ParseResult {
  const text = toText(raw);
  if (text === '') return ok(null);

  const iso = ISO.exec(text);
  if (iso !== null) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return validDate(y, m, d) ? ok(`${y}-${pad(m)}-${pad(d)}`) : fail(`תאריך שאינו קיים: ${text}`);
  }

  const dmy = DMY.exec(text);
  if (dmy !== null) {
    const [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (!validDate(y, m, d)) return fail(`תאריך שאינו קיים: ${text}`);
    return ok(`${y}-${pad(m)}-${pad(d)}`);
  }

  return fail(`תאריך לא תקין: "${text}". מצופה dd/mm/yyyy`);
}

// -------------------------------------------------------------- כסף

/**
 * שקלים → אגורות. מקבל פסיקים, ₪, רווחים וסימני כיווניות.
 *
 * העיגול הוא `Math.round` על התוצאה ולא `parseFloat` ישיר: `12.34 * 100`
 * ב-JavaScript הוא 1233.9999999999998, ובלי עיגול כל סכום שני היה נכנס
 * אגורה אחת בפחות.
 */
export function parseMoney(raw: unknown): ParseResult {
  const text = toText(raw)
    .replace(/[₪‎‏]/g, '')
    .replace(/,/g, '')
    .trim();
  if (text === '') return ok(null);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return fail(`סכום לא תקין: "${toText(raw)}"`);

  const shekels = Number(text);
  if (!Number.isFinite(shekels)) return fail(`סכום לא תקין: "${toText(raw)}"`);
  return ok(Math.round(shekels * 100));
}

// ------------------------------------------------------------ מספר

export function parseNumber(raw: unknown): ParseResult {
  const text = toText(raw).replace(/,/g, '');
  if (text === '') return ok(null);
  if (!/^-?\d+$/.test(text)) return fail(`מצופה מספר שלם, התקבל "${toText(raw)}"`);
  return ok(Number(text));
}

// ----------------------------------------------------------- כן / לא

const TRUE_WORDS = new Set(['כן', 'yes', 'true', '1', 'v', '✓', 'x']);
const FALSE_WORDS = new Set(['לא', 'no', 'false', '0', '-']);

export function parseBool(raw: unknown): ParseResult {
  const text = toText(raw).toLowerCase();
  if (text === '') return ok(null);
  if (TRUE_WORDS.has(text)) return ok(1);
  if (FALSE_WORDS.has(text)) return ok(0);
  return fail(`מצופה כן/לא, התקבל "${toText(raw)}"`);
}

// ------------------------------------------------------ ערך מרשימה

/** השוואה מקלה: רווחים כפולים וגרשיים שונים לא יפילו התאמה. */
const normalizeChoice = (v: string): string =>
  v.toLowerCase().replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();

export function parseChoice(raw: unknown, choices: readonly string[]): ParseResult {
  const text = toText(raw);
  if (text === '') return ok(null);
  const match = choices.find((c) => normalizeChoice(c) === normalizeChoice(text));
  if (match === undefined) {
    return fail(`ערך לא מוכר: "${text}". מותר: ${choices.join(' / ')}`);
  }
  return ok(match);
}

// -------------------------------------------------------------- הכול

/**
 * מפרסר ערך לפי הגדרת השדה. **אינו בודק חובה** – זו אחריות האימות,
 * כי שדה ריק הוא תקין בשדה רשות ושגיאה בשדה חובה, ואותה פונקציה
 * משמשת לשניהם.
 */
export function parseField(field: ImportField, raw: unknown): ParseResult {
  switch (field.type) {
    case 'date':
      return parseDate(raw);
    case 'money':
      return parseMoney(raw);
    case 'number':
      return parseNumber(raw);
    case 'bool':
      return parseBool(raw);
    case 'choice':
      return parseChoice(raw, field.choices ?? []);
    default: {
      const text = toText(raw);
      return ok(text === '' ? null : text);
    }
  }
}
