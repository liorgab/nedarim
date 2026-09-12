import type { ImportEntity } from './catalog';
import { toText } from './parse';
import type { RawRow } from './validate';

/**
 * F-128 – קריאת הקובץ.
 *
 * שתי צורות קלט: קובץ אקסל אחד עם גיליון לכל יישות, או CSV בודד עבור
 * יישות אחת. הפרסור של CSV והזיהוי של שורת הכותרות **טהורים** – הם
 * הלוגיקה שנשברת על קובץ אמיתי, והחלק שנוגע במערכת הקבצים הוא עטיפה
 * דקה סביבם.
 */

// ------------------------------------------------------------------ CSV

/**
 * פרסור CSV לפי RFC 4180, כולל מרכאות וירידות שורה בתוך תא.
 *
 * נכתב ולא נלקח מספרייה: CSV הוא 40 שורות, וכל תלות נוספת היא עוד
 * רישיון לבדוק. מה שכן צריך זהירות הוא המרכאה הכפולה (`""`) בתוך תא
 * מצוטט – בלעדיה כל הערה עם גרשיים שוברת את הקובץ.
 */
export function parseCsv(text: string): string[][] {
  // BOM שנכתב על ידי Excel יהפוך את הכותרת הראשונה ללא מזוהה.
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;

    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }

  // השורה האחרונה, כשהקובץ אינו מסתיים בירידת שורה.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------- זיהוי שורת הכותרות

export interface HeaderMatch {
  /** אינדקס השורה במטריצה (0-based). `-1` = לא נמצאה. */
  index: number;
  /** כמה מכותרות היישות זוהו בשורה. */
  matched: number;
}

/**
 * נורמליזציה של כותרת לצורך השוואה. מיוצאת כדי שכל מי שמשווה כותרות
 * (זיהוי היישות, המיפוי) ישווה **באותו כלל** – שני כללים שונים יוצרים
 * זיהוי שמצליח בשלב אחד ונכשל בשני.
 */
export const normalizeHeader = (v: string): string =>
  toText(v).toLowerCase().replace(/[*״"'׳]/g, '').replace(/\s+/g, ' ').trim();

const normalize = normalizeHeader;

/**
 * מוצא את שורת הכותרות.
 *
 * בתבנית היא שורה 2 (שורה 1 היא ההסבר), אבל בקובץ שהגבאי הכין בעצמו
 * היא לרוב שורה 1. חיפוש לפי התאמה לשמות השדות עובד בשני המקרים, וגם
 * כשמישהו הוסיף שורות ריקות או כותרת משלו מעל.
 *
 * נסרקות 10 השורות הראשונות בלבד – מעבר לזה זה כבר לא קובץ עם כותרות.
 */
export function detectHeaderRow(
  matrix: readonly (readonly unknown[])[],
  entity: ImportEntity,
): HeaderMatch {
  const labels = new Set(entity.fields.map((f) => normalize(f.label)));
  let best: HeaderMatch = { index: -1, matched: 0 };

  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const matched = new Set(
      (matrix[i] ?? []).map((c) => normalize(String(c ?? ''))).filter((c) => labels.has(c)),
    ).size;
    if (matched > best.matched) best = { index: i, matched };
  }
  return best;
}

/**
 * ממיר מטריצה לשורות לפי כותרות.
 *
 * הכותרות מנורמלות מול שמות השדות כדי ש-"מספר חבר *" מהתבנית ו-"מספר
 * חבר" מקובץ ידני ייקראו אותו דבר. עמודה שאינה מזוהה נשמרת בשמה המקורי
 * ופשוט לא תשמש – היא מוצגת בשלב המיפוי.
 */
export function rowsFromMatrix(
  matrix: readonly (readonly unknown[])[],
  headerIndex: number,
  entity: ImportEntity,
): { rows: RawRow[]; headers: string[]; firstRowNumber: number } {
  const rawHeaders = (matrix[headerIndex] ?? []).map((c) => toText(c));
  const byNormalized = new Map(entity.fields.map((f) => [normalize(f.label), f.label]));
  const headers = rawHeaders.map((h) => byNormalized.get(normalize(h)) ?? h);

  const rows: RawRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const source = matrix[i] ?? [];
    const row: RawRow = {};
    headers.forEach((h, c) => {
      if (h !== '') row[h] = source[c] ?? null;
    });
    rows.push(row);
  }

  // +1 כי מספרי שורות ב-Excel הם 1-based, ועוד 1 כדי לדלג על הכותרת.
  return { rows, headers, firstRowNumber: headerIndex + 2 };
}

/** עמודות בקובץ שאינן מוכרות ליישות – מוצגות בשלב המיפוי. */
export function unknownHeaders(headers: readonly string[], entity: ImportEntity): string[] {
  const known = new Set(entity.fields.map((f) => f.label));
  return headers.filter((h) => h !== '' && !known.has(h));
}

/** שדות חובה שאין להם עמודה בקובץ. */
export function missingRequiredHeaders(
  headers: readonly string[],
  entity: ImportEntity,
): string[] {
  const present = new Set(headers);
  return entity.fields.filter((f) => f.required && !present.has(f.label)).map((f) => f.label);
}

// ------------------------------------------------------- קריאה מהדיסק

/**
 * כל הגיליונות בקובץ, כל אחד כמטריצה גולמית.
 *
 * `readXlsxFile` מחזיר את הקובץ כולו בקריאה אחת, ולכן אין טעם לקרוא
 * גיליון-גיליון: זה היה פותח ומפרק את אותו ZIP שוב ושוב.
 */
export interface WorkbookSheet {
  name: string;
  matrix: unknown[][];
}

export async function readWorkbook(path: string): Promise<WorkbookSheet[]> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = await readXlsxFile(path);
  return sheets.map((s) => ({ name: s.sheet, matrix: s.data as unknown[][] }));
}

/** קובץ CSV כמטריצה. */
export async function readCsvMatrix(path: string): Promise<string[][]> {
  const { readFile } = await import('node:fs/promises');
  return parseCsv(await readFile(path, 'utf8'));
}
