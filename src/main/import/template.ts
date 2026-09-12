import { IMPORT_ENTITIES, type ImportEntity, type ImportField } from './catalog';
import { importOrder } from './order';

/**
 * F-122 – תבנית האקסל לייבוא: גיליון לכל יישות, שדות מוכנים.
 *
 * **שדה חובה באדום, שדה רשות בירוק.** הצבע הוא הדבר היחיד שהגבאי באמת
 * קורא בקובץ עם עשר עמודות, ולכן הוא נושא את המידע החשוב ביותר – מה
 * חייב להתמלא. שורת ההסבר מתחת לכותרת חוזרת על אותו מידע במילים, כי
 * הדפסה בשחור-לבן והתאמות צבע מבטלות את ההבחנה.
 *
 * הגיליונות מסודרים לפי סדר הייבוא (`importOrder`) ולא לפי סדר הקטלוג:
 * מי שפותח את הקובץ רואה קודם חברים ורק אחר כך נדרים, וזה בדיוק הסדר
 * שבו הוא אמור למלא אותם.
 */

/** צבעים מרוככים – כותרת צבעונית מדי הופכת קובץ עבודה לקשה לקריאה. */
const REQUIRED_BG = '#F8D7DA';
const REQUIRED_FG = '#842029';
const OPTIONAL_BG = '#D1E7DD';
const OPTIONAL_FG = '#0F5132';
const INTRO_FG = '#555555';

/** תא בפורמט של `write-excel-file`. */
interface Cell {
  value?: string | null;
  type?: typeof String;
  fontWeight?: 'bold';
  backgroundColor?: string;
  color?: string;
  align?: 'left' | 'right' | 'center';
  span?: number;
  wrap?: boolean;
}

const text = (value: string, extra: Partial<Cell> = {}): Cell => ({
  type: String,
  value,
  ...extra,
});

/** ההסבר שמתחת לכותרת: חובה/רשות, עזרה, וערכים מותרים. */
export function fieldHint(field: ImportField): string {
  const parts = [field.required ? 'חובה' : 'רשות'];
  if (field.choices !== undefined) parts.push(field.choices.join(' / '));
  if (field.help !== undefined) parts.push(field.help);
  if (field.ref !== undefined) parts.push(`מתוך גיליון "${entitySheet(field.ref.entity)}"`);
  return parts.join(' · ');
}

function entitySheet(id: ImportEntity['id']): string {
  return IMPORT_ENTITIES.find((e) => e.id === id)?.sheet ?? id;
}

/**
 * ארבע שורות לכל גיליון:
 * 1. הסבר על היישות (ממוזג לרוחב)
 * 2. כותרות – אדום לחובה, ירוק לרשות
 * 3. הסבר לכל עמודה
 * 4. שורת דוגמה
 *
 * שורת הדוגמה מסומנת במפורש כדי שהגבאי ימחק אותה; בלי סימון היא
 * מיובאת כרשומה אמיתית, וזו טעות שקורית כמעט תמיד.
 */
export function sheetRows(entity: ImportEntity): Cell[][] {
  const width = entity.fields.length;

  const intro: Cell[] = [
    text(entity.intro, { span: width, color: INTRO_FG, wrap: true, align: 'right' }),
  ];

  const headers: Cell[] = entity.fields.map((f) =>
    text(f.required ? `${f.label} *` : f.label, {
      fontWeight: 'bold',
      backgroundColor: f.required ? REQUIRED_BG : OPTIONAL_BG,
      color: f.required ? REQUIRED_FG : OPTIONAL_FG,
      align: 'right',
    }),
  );

  const hints: Cell[] = entity.fields.map((f) =>
    text(fieldHint(f), { color: INTRO_FG, align: 'right', wrap: true }),
  );

  const example: Cell[] = entity.fields.map((f, i) =>
    text(i === 0 ? `דוגמה – למחוק: ${f.example ?? ''}` : (f.example ?? ''), {
      color: INTRO_FG,
      align: 'right',
    }),
  );

  return [intro, headers, hints, example];
}

/** רוחב עמודה לפי הטיפוס. טקסט חופשי זקוק ליותר מקום ממספר. */
function columnWidth(field: ImportField): number {
  if (field.type === 'money' || field.type === 'number') return 14;
  if (field.type === 'date' || field.type === 'bool') return 13;
  return Math.max(16, Math.min(34, field.label.length + 10));
}

export interface TemplateSheet {
  data: Cell[][];
  sheet: string;
  columns: Array<{ width: number }>;
  rightToLeft: true;
}

/** כל הגיליונות, בסדר הייבוא. */
export function templateSheets(
  entities: readonly ImportEntity[] = IMPORT_ENTITIES,
): TemplateSheet[] {
  return importOrder(entities).map((entity) => ({
    data: sheetRows(entity),
    sheet: entity.sheet,
    columns: entity.fields.map((f) => ({ width: columnWidth(f) })),
    rightToLeft: true as const,
  }));
}

/**
 * כותב את התבנית. הספרייה נטענת דינמית, כמו בשאר הייצוא.
 */
export async function writeTemplate(
  path: string,
  entities: readonly ImportEntity[] = IMPORT_ENTITIES,
): Promise<string> {
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  await writeXlsxFile(templateSheets(entities) as never).toFile(path);
  return path;
}

/** שם הקובץ המוצע. ללא תווים שאסורים ב-Windows. */
export const TEMPLATE_FILE_NAME = 'נדרים - תבנית ייבוא.xlsx';
