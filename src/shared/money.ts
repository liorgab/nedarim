/**
 * כל הסכומים במערכת נשמרים כמספר שלם של אגורות (CLAUDE.md כלל 1).
 * המרה לתצוגה נעשית כאן בלבד – אין חישובי כסף ב-float בשום מקום אחר.
 */

export const AGOROT_IN_SHEKEL = 100;

/** ממיר שקלים (מספר או מחרוזת קלט מהמשתמש) לאגורות, בעיגול חצי-למעלה. */
export function shekelToAgorot(value: number | string): number {
  const n = typeof value === 'string' ? parseShekelInput(value) : value;
  if (n === null || !Number.isFinite(n)) {
    throw new TypeError(`סכום לא תקין: ${String(value)}`);
  }
  // כפל ב-100 מייצר שגיאת ייצוג (1.005*100 = 100.49999999999999) שהייתה מעגלת כלפי מטה.
  // toFixed(4) מנרמל את הרעש לפני העיגול, ואז Math.round נותן עיגול חצי-כלפי-מעלה אמיתי.
  // הסימן מטופל בנפרד כדי שהעיגול יהיה סימטרי (-1.005 → -101).
  const scaled = Number((Math.abs(n) * AGOROT_IN_SHEKEL).toFixed(4));
  const magnitude = Math.round(scaled);
  const rounded = n < 0 ? -magnitude : magnitude;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** ממיר אגורות לשקלים כמספר עשרוני (לתצוגה/ייצוא בלבד). */
export function agorotToShekel(agorot: number): number {
  return agorot / AGOROT_IN_SHEKEL;
}

/** מנקה קלט משתמש: פסיקים, ₪, רווחים, סימן מינוס. מחזיר null אם לא מספרי. */
export function parseShekelInput(raw: string): number | null {
  const cleaned = raw
    .replace(/[‎‏؜]/g, '') // סימני כיווניות
    .replace(/[₪\s,]/g, '')
    .replace(/^\+/, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatter(digits: number, currency: boolean): Intl.NumberFormat {
  return new Intl.NumberFormat('he-IL', {
    ...(currency ? { style: 'currency' as const, currency: 'ILS' } : {}),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const ILS_WHOLE = formatter(0, true);
const ILS_CENTS = formatter(2, true);
const PLAIN_WHOLE = formatter(0, false);
const PLAIN_CENTS = formatter(2, false);

/**
 * תצוגה עם ₪ ומפריד אלפים (B-11).
 * סכום עגול מוצג בלי אגורות ("1,000 ₪"); סכום עם אגורות מוצג תמיד בשתי ספרות
 * ("1,281.60 ₪") – חצי אגורה שנעלמת בתצוגה נראית כמו טעות בקבלה.
 */
export function formatAgorot(agorot: number): string {
  const f = agorot % AGOROT_IN_SHEKEL === 0 ? ILS_WHOLE : ILS_CENTS;
  return f.format(agorotToShekel(agorot));
}

/** תצוגה ללא סימן מטבע, לטבלאות שבהן הכותרת כבר מציינת ₪. */
export function formatAgorotPlain(agorot: number): string {
  const f = agorot % AGOROT_IN_SHEKEL === 0 ? PLAIN_WHOLE : PLAIN_CENTS;
  return f.format(agorotToShekel(agorot));
}

/** סכום בטוח של אגורות (מספרים שלמים בלבד). */
export function sumAgorot(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
