import type { ImportEntityId } from './catalog';

/**
 * F-127 – כללים ברמת שורה שלמה.
 *
 * מופרדים מהקטלוג כי הקטלוג הוא **נתונים** וכללים הם **קוד**: "זיכוי
 * חייב סיבה" אינו תכונה של שדה בודד אלא יחס בין שניים, ואי אפשר לבטא
 * אותו בטבלה בלי להמציא שפה.
 *
 * כל כלל מחזיר הודעה או `null`. הם נבדקים באימות, **לפני** שנוגעים
 * ב-DB – אחרת הם מתגלים כשגיאת אילוץ סתומה באמצע הכתיבה.
 */

export type RowRule = (values: Record<string, string | number | null>) => string | null;

const isEmpty = (v: string | number | null | undefined): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const RULES: Partial<Record<ImportEntityId, RowRule[]>> = {
  vow_charge: [
    // אילוץ ב-DB: kind <> 'credit' OR credit_reason IS NOT NULL.
    (v) =>
      v['סוג'] === 'זיכוי' && isEmpty(v['סיבת זיכוי'])
        ? 'זיכוי מחייב סיבה. יש למלא את העמודה "סיבת זיכוי".'
        : null,
  ],
  donation: [
    // תרומה בלי חבר ובלי שם תורם אינה ניתנת לשיוך לאיש.
    (v) =>
      isEmpty(v['מספר חבר']) && isEmpty(v['שם התורם'])
        ? 'יש למלא מספר חבר או שם תורם – אחרת אי אפשר לדעת למי התרומה משויכת.'
        : null,
  ],
  expense: [
    // אילוץ ב-DB: amount_agorot >= 0 OR is_refund = 1.
    (v) =>
      typeof v['סכום (₪)'] === 'number' && v['סכום (₪)'] < 0 && v['החזר'] !== 1
        ? 'סכום שלילי מותר רק כשהעמודה "החזר" מסומנת "כן".'
        : null,
  ],
};

export function rowRulesFor(entity: ImportEntityId): RowRule[] {
  return RULES[entity] ?? [];
}
