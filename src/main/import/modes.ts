/**
 * F-125 – ארבעת מצבי הייבוא.
 *
 * **ההחלטה טהורה, הכתיבה לא.** מה לעשות עם שורה נתונה היא פונקציה של
 * המצב, של קיום רשומה תואמת ושל מה שכבר מלא בה – ותו לא. הפרדה כזו היא
 * מה שמאפשר לבדוק את "העשרה אינה דורסת ערך קיים" בלי בסיס נתונים, וזה
 * בדיוק סוג הכלל ששובר נתונים כספיים כשהוא שגוי.
 */

export type ImportMode =
  /** מוחק את כל הרשומות הקיימות ומייבא את הקובץ במקומן. בלתי הפיך. */
  | 'replace'
  /** מעדכן רשומות קיימות לפי מפתח ומוסיף חדשות. */
  | 'upsert'
  /** מוסיף רק רשומות שאינן קיימות. לא נוגע בקיימות. */
  | 'insert'
  /** מאכלס שדות ריקים ברשומות קיימות. לא יוצר ולא דורס. */
  | 'enrich';

export const IMPORT_MODES: readonly ImportMode[] = ['replace', 'upsert', 'insert', 'enrich'];

export interface ImportModeInfo {
  mode: ImportMode;
  label: string;
  description: string;
  /** אזהרה שמוצגת באדום. `null` = אין סכנה. */
  danger: string | null;
  /** דורש מפתח טבעי כדי לזהות רשומה קיימת. */
  requiresKey: boolean;
}

export const MODE_INFO: Record<ImportMode, ImportModeInfo> = {
  replace: {
    mode: 'replace',
    label: 'מחיקה וייבוא מחדש',
    description: 'מוחק את כל הרשומות הקיימות ומייבא את הקובץ במקומן.',
    danger: 'פעולה זו בלתי הפיכה! כל הרשומות הקיימות יימחקו.',
    requiresKey: false,
  },
  upsert: {
    mode: 'upsert',
    label: 'עדכון קיימות + הוספת חסרות',
    description: 'מעדכן שדות ברשומות קיימות (לפי מפתח) ומוסיף רשומות חדשות.',
    danger: null,
    requiresKey: true,
  },
  insert: {
    mode: 'insert',
    label: 'הוספת חסרות בלבד',
    description: 'מוסיף רק רשומות שלא קיימות (לפי מפתח). לא משנה רשומות קיימות.',
    danger: null,
    requiresKey: true,
  },
  enrich: {
    mode: 'enrich',
    label: 'העשרה — אכלוס שדות נוספים',
    description: 'ממלא שדות ריקים ברשומות קיימות. לא יוצר רשומות חדשות ולא דורס ערך שכבר קיים.',
    danger: null,
    requiresKey: true,
  },
};

// ------------------------------------------------------ ההחלטה לכל שורה

export type SkipReason =
  | 'already-exists'
  | 'no-match'
  | 'no-natural-key'
  | 'nothing-to-fill';

export type RowAction =
  | { kind: 'insert' }
  | { kind: 'update'; id: number }
  /** `fields` = הכותרות שימולאו בפועל. תמיד תת-קבוצה של הריקים. */
  | { kind: 'enrich'; id: number; fields: string[] }
  | { kind: 'skip'; reason: SkipReason };

export const SKIP_TEXT: Record<SkipReason, string> = {
  'already-exists': 'קיימת כבר במערכת',
  'no-match': 'אין רשומה תואמת להעשיר',
  'no-natural-key': 'ליישות אין מזהה ייחודי, ולכן אי אפשר להתאים לרשומה קיימת',
  'nothing-to-fill': 'כל השדות כבר מלאים',
};

export interface ExistingRecord {
  id: number;
  /** ערכי הרשומה הקיימת לפי כותרת. `null`/`''` = ריק. */
  values: Record<string, string | number | null>;
}

export interface DecideRowInput {
  mode: ImportMode;
  /** `false` ליישות בלי מפתח טבעי – נדרים למשל. */
  hasNaturalKey: boolean;
  /** הרשומה הקיימת שהותאמה לפי המפתח, אם נמצאה. */
  existing: ExistingRecord | null;
  /** הערכים מהקובץ. */
  incoming: Record<string, string | number | null>;
}

const isEmpty = (v: string | number | null | undefined): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * שדות שאפשר למלא בהעשרה: ריקים ברשומה הקיימת **ומלאים** בקובץ.
 *
 * שני התנאים הכרחיים. בלי הראשון ההעשרה דורסת, ובלי השני היא מוחקת
 * ערך קיים בגלל תא ריק בגיליון – שתי דרכים לאבד נתונים בשקט.
 */
export function fillableFields(
  existing: Record<string, string | number | null>,
  incoming: Record<string, string | number | null>,
): string[] {
  return Object.keys(incoming).filter(
    (key) => isEmpty(existing[key]) && !isEmpty(incoming[key]),
  );
}

export function decideRowAction(input: DecideRowInput): RowAction {
  const { mode, existing, incoming } = input;

  // `replace` מוחק הכול מראש, ולכן כל שורה היא הוספה – גם ליישות
  // בלי מפתח טבעי.
  if (mode === 'replace') return { kind: 'insert' };

  if (!input.hasNaturalKey) {
    // בלי מזהה אין דרך להתאים. הוספה עדיין אפשרית; עדכון והעשרה לא.
    if (mode === 'insert' || mode === 'upsert') return { kind: 'insert' };
    return { kind: 'skip', reason: 'no-natural-key' };
  }

  if (existing === null) {
    if (mode === 'enrich') return { kind: 'skip', reason: 'no-match' };
    return { kind: 'insert' };
  }

  if (mode === 'insert') return { kind: 'skip', reason: 'already-exists' };
  if (mode === 'upsert') return { kind: 'update', id: existing.id };

  const fields = fillableFields(existing.values, incoming);
  return fields.length === 0
    ? { kind: 'skip', reason: 'nothing-to-fill' }
    : { kind: 'enrich', id: existing.id, fields };
}

// ------------------------------------------------------------- סיכום

export interface ActionCounts {
  insert: number;
  update: number;
  enrich: number;
  skip: number;
}

export function countActions(actions: readonly RowAction[]): ActionCounts {
  const counts: ActionCounts = { insert: 0, update: 0, enrich: 0, skip: 0 };
  for (const a of actions) counts[a.kind] += 1;
  return counts;
}
