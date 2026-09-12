import type { ImportEntity, ImportField } from './catalog';
import { toText } from './parse';
import type { RawRow } from './validate';

/**
 * F-125 – שלב מיפוי השדות.
 *
 * כשהקובץ הוא התבנית שלנו, המיפוי טריוויאלי והשלב עובר בלחיצה. השלב
 * קיים בשביל המקרה השני: קובץ שהגבאי ניהל שנים, שבו העמודה נקראת
 * "נייד" ולא "טלפון נייד", "ת. זהות" ולא "תעודת זהות", ו-"סכום ₪" ולא
 * "סכום".
 *
 * ההצעה האוטומטית **מנחשת ומסמנת את הביטחון**, ולא מחליטה בשקט. מיפוי
 * שגוי בשקט הוא הדבר הגרוע ביותר שיכול לקרות כאן: 1,268 נדרים עם הסכום
 * בעמודת התאריך נראים כמו ייבוא מוצלח עד שמסתכלים בדוח.
 */

export type MatchQuality =
  /** כותרת זהה – התבנית שלנו, או קובץ שהועתק ממנה. */
  | 'exact'
  /** דומה מספיק. הגבאי מתבקש לאשר. */
  | 'likely'
  /** לא נמצאה עמודה. */
  | 'none';

export interface FieldMapping {
  /** ה-label של השדה ביישות. */
  field: string;
  /** אינדקס העמודה בקובץ, או `null` כשהשדה לא ממופה. */
  column: number | null;
  quality: MatchQuality;
}

/** מיפוי שלם לגיליון אחד. */
export type SheetMapping = readonly FieldMapping[];

const normalize = (v: string): string =>
  toText(v)
    .toLowerCase()
    // סימני התבנית, מטבע וסימני פיסוק שאיש אינו מקליד באופן עקבי.
    .replace(/[*״"'׳.,:;()\-–₪]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** מילים שאינן מבדילות בין שדות, ולכן אינן ראיה להתאמה. */
const STOP_WORDS = new Set(['של', 'ה', 'מספר', 'שם', 'תאריך', 'סוג']);

const tokens = (v: string): string[] => normalize(v).split(' ').filter((t) => t !== '');

/**
 * ציון התאמה בין כותרת בקובץ לשדה.
 *
 * מכוון לזהירות: `likely` ניתן רק כשיש חפיפה של מילה **מבדילה**. "שם
 * פרטי" ו"שם משפחה" חולקים את "שם", וללא רשימת המילים הנייטרליות כל אחד
 * מהם היה מתמפה לשני – בדיוק השגיאה שהופכת את כל רשימת החברים.
 */
function score(header: string, field: ImportField): number {
  const h = normalize(header);
  const f = normalize(field.label);
  if (h === '' || f === '') return 0;
  if (h === f) return 100;

  const ht = tokens(header);
  const ft = tokens(field.label);
  const meaningful = ft.filter((t) => !STOP_WORDS.has(t));
  const shared = meaningful.filter((t) => ht.includes(t));

  // כותרת שמכילה את שם השדה במלואו: "סכום ₪" מול "סכום".
  if (h.includes(f) || f.includes(h)) return 80;
  if (shared.length === 0) return 0;
  return 40 + Math.round((shared.length / meaningful.length) * 30);
}

/**
 * מציע מיפוי לכל שדות היישות.
 *
 * כל עמודה משמשת פעם אחת בלבד: ההצעות נבחרות מהחזקה לחלשה, וכך "שם
 * פרטי" תופס את העמודה המדויקת שלו לפני ש"שם משפחה" מנסה לנחש אותה.
 */
export function suggestMapping(
  headers: readonly string[],
  entity: ImportEntity,
): FieldMapping[] {
  const candidates: Array<{ field: string; column: number; value: number }> = [];
  entity.fields.forEach((field) => {
    headers.forEach((header, column) => {
      const value = score(header, field);
      if (value >= 40) candidates.push({ field: field.label, column, value });
    });
  });
  candidates.sort((a, b) => b.value - a.value);

  const byField = new Map<string, { column: number; value: number }>();
  const usedColumns = new Set<number>();
  for (const c of candidates) {
    if (byField.has(c.field) || usedColumns.has(c.column)) continue;
    byField.set(c.field, { column: c.column, value: c.value });
    usedColumns.add(c.column);
  }

  return entity.fields.map((field) => {
    const hit = byField.get(field.label);
    if (hit === undefined) return { field: field.label, column: null, quality: 'none' };
    return {
      field: field.label,
      column: hit.column,
      quality: hit.value === 100 ? 'exact' : 'likely',
    };
  });
}

/** שדות חובה שאין להם עמודה במיפוי – השלב לא יכול להסתיים בלעדיהם. */
export function unmappedRequired(
  mapping: SheetMapping,
  entity: ImportEntity,
): string[] {
  const mapped = new Set(mapping.filter((m) => m.column !== null).map((m) => m.field));
  return entity.fields.filter((f) => f.required && !mapped.has(f.label)).map((f) => f.label);
}

/** עמודות בקובץ שלא מופו לשום שדה – מוצגות כדי שלא ייעלמו בשקט. */
export function unmappedColumns(
  headers: readonly string[],
  mapping: SheetMapping,
): Array<{ column: number; header: string }> {
  const used = new Set(mapping.map((m) => m.column).filter((c): c is number => c !== null));
  return headers
    .map((header, column) => ({ column, header }))
    .filter((h) => h.header.trim() !== '' && !used.has(h.column));
}

/** שדות שהגבאי מתבקש לאשר לפני המעבר לשלב הבא. */
export function needsConfirmation(mapping: SheetMapping): FieldMapping[] {
  return mapping.filter((m) => m.quality === 'likely');
}

/**
 * ממיר את מטריצת הגיליון לשורות לפי המיפוי.
 *
 * המפתחות הם ה-labels של השדות, כי זו השפה שבה `validateSheet` עובד:
 * מכאן והלאה אין יותר משמעות לכותרות שהיו בקובץ.
 */
export function rowsFromMapping(
  matrix: readonly (readonly unknown[])[],
  headerIndex: number,
  mapping: SheetMapping,
): { rows: RawRow[]; firstRowNumber: number } {
  const rows: RawRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const source = matrix[i] ?? [];
    const row: RawRow = {};
    for (const m of mapping) {
      row[m.field] = m.column === null ? null : (source[m.column] ?? null);
    }
    rows.push(row);
  }
  // +1 למעבר ל-1-based, +1 לדילוג על שורת הכותרות.
  return { rows, firstRowNumber: headerIndex + 2 };
}
