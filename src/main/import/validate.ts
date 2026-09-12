import type { ImportEntity, ImportEntityId, ImportField } from './catalog';
import { parseField, toText } from './parse';

/**
 * F-124 – אימות הקובץ לפני שנוגעים ב-DB.
 *
 * **טהור: מקבל פותר-הפניות כתלות ולא `db`.** זו הסיבה שאפשר לבדוק כאן
 * "תרומה לחבר 47 שאינו קיים" בלי בסיס נתונים בכלל, וזו גם הסיבה
 * שההחלטה "החבר קיים" זהה בין חבר שנמצא ב-DB לבין חבר שמופיע בגיליון
 * החברים באותו קובץ – שני מקורות, פותר אחד.
 *
 * העיקרון: **שום דבר לא נכתב עד שכל הקובץ נבדק.** דוח עם 40 שגיאות
 * שהגבאי מתקן בבת אחת עדיף על ייבוא שנעצר בשורה 12 ומשאיר חצי מצב.
 */

export type IssueSeverity = 'error' | 'warning';

export interface RowIssue {
  sheet: string;
  /** מספר השורה כפי שהיא נראית ב-Excel, כדי שאפשר יהיה לקפוץ אליה. */
  row: number;
  /** כותרת העמודה בעברית. ריק = בעיה ברמת השורה. */
  column: string;
  value: string;
  severity: IssueSeverity;
  message: string;
}

/** שורה גולמית מהגיליון: כותרת → ערך. */
export type RawRow = Record<string, unknown>;

/** רשומה שעברה אימות ומוכנה לכתיבה. */
export interface ParsedRow {
  /** מספר השורה במקור, לדיווח. */
  row: number;
  /** ערכים מפורסרים לפי label. הפניות נשארות כמפתח האנושי. */
  values: Record<string, string | number | null>;
}

/**
 * בודק אם מפתח אנושי קיים – ב-DB או בקובץ עצמו.
 * מוזרק כדי שהאימות יישאר טהור.
 */
export type RefResolver = (entity: ImportEntityId, key: string) => boolean;

export interface SheetValidation {
  entity: ImportEntityId;
  sheet: string;
  rows: ParsedRow[];
  issues: RowIssue[];
  /** שורות שנדחו – יש בהן לפחות שגיאה אחת. */
  rejected: number;
}

/** שורת הכותרות היא 2 בתבנית (1 = הסבר), והנתונים מתחילים אחריה. */
export const TEMPLATE_HEADER_ROW = 2;

const issue = (
  sheet: string,
  row: number,
  column: string,
  value: unknown,
  message: string,
  severity: IssueSeverity = 'error',
): RowIssue => ({ sheet, row, column, value: toText(value), severity, message });

/** האם השורה ריקה לחלוטין – שורות כאלה מדולגות בשקט. */
export function isBlankRow(raw: RawRow): boolean {
  return Object.values(raw).every((v) => toText(v) === '');
}

/**
 * שורת הדוגמה שבתבנית. היא מסומנת "למחוק", אבל היא נשארת בקובץ בפועל
 * לעיתים קרובות מאוד – ואז היא מיובאת כרשומה אמיתית.
 */
export function isExampleRow(raw: RawRow): boolean {
  return Object.values(raw).some((v) => toText(v).startsWith('דוגמה – למחוק'));
}

function validateField(
  entity: ImportEntity,
  field: ImportField,
  raw: RawRow,
  rowNumber: number,
  resolveRef: RefResolver,
): { issues: RowIssue[]; value: string | number | null } {
  const issues: RowIssue[] = [];
  const rawValue = raw[field.label];
  const parsed = parseField(field, rawValue);

  if (!parsed.ok) {
    issues.push(issue(entity.sheet, rowNumber, field.label, rawValue, parsed.message));
    return { issues, value: null };
  }

  if (parsed.value === null) {
    if (field.required) {
      issues.push(issue(entity.sheet, rowNumber, field.label, rawValue, 'שדה חובה ריק'));
    }
    return { issues, value: null };
  }

  // הפניה: הערך הוא מפתח אנושי שחייב להתקיים.
  if (field.ref !== undefined && !resolveRef(field.ref.entity, String(parsed.value))) {
    issues.push(
      issue(
        entity.sheet,
        rowNumber,
        field.label,
        rawValue,
        `${field.label} "${toText(parsed.value)}" לא נמצא. יש להוסיף אותו לגיליון המתאים או למערכת לפני הייבוא.`,
      ),
    );
  }

  return { issues, value: parsed.value };
}

export interface ValidateSheetInput {
  entity: ImportEntity;
  raw: readonly RawRow[];
  /** מספר השורה בקובץ של השורה הראשונה ב-`raw`. */
  firstRowNumber?: number;
  resolveRef: RefResolver;
  /** בדיקות ברמת שורה שלמה – מה שלא נובע משדה יחיד. */
  rowRules?: ReadonlyArray<(values: Record<string, string | number | null>) => string | null>;
}

export function validateSheet(input: ValidateSheetInput): SheetValidation {
  const { entity, raw, resolveRef } = input;
  const first = input.firstRowNumber ?? TEMPLATE_HEADER_ROW + 1;

  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  const seenKeys = new Map<string, number>();
  let rejected = 0;

  raw.forEach((rawRow, i) => {
    const rowNumber = first + i;
    if (isBlankRow(rawRow)) return;
    if (isExampleRow(rawRow)) {
      issues.push(
        issue(entity.sheet, rowNumber, '', '', 'שורת הדוגמה מהתבנית – דולגה', 'warning'),
      );
      return;
    }

    const values: Record<string, string | number | null> = {};
    const rowIssues: RowIssue[] = [];

    for (const field of entity.fields) {
      const result = validateField(entity, field, rawRow, rowNumber, resolveRef);
      rowIssues.push(...result.issues);
      values[field.label] = result.value;
    }

    for (const rule of input.rowRules ?? []) {
      const message = rule(values);
      if (message !== null) rowIssues.push(issue(entity.sheet, rowNumber, '', '', message));
    }

    // כפילות מפתח בתוך הקובץ עצמו: שתי שורות עם אותו מספר חבר.
    if (entity.naturalKey.length > 0) {
      const key = entity.naturalKey.map((k) => toText(values[k])).join('|');
      if (key !== '' && !key.split('|').every((p) => p === '')) {
        const previous = seenKeys.get(key);
        if (previous !== undefined) {
          rowIssues.push(
            issue(
              entity.sheet,
              rowNumber,
              entity.naturalKey.join(' + '),
              key,
              `מופיע גם בשורה ${previous} – שתי שורות עם אותו מזהה`,
            ),
          );
        } else {
          seenKeys.set(key, rowNumber);
        }
      }
    }

    issues.push(...rowIssues);
    if (rowIssues.some((x) => x.severity === 'error')) rejected += 1;
    else rows.push({ row: rowNumber, values });
  });

  return { entity: entity.id, sheet: entity.sheet, rows, issues, rejected };
}

// ------------------------------------------------------------- סיכום

export interface ValidationSummary {
  sheets: SheetValidation[];
  totalRows: number;
  totalRejected: number;
  errors: number;
  warnings: number;
  /** אפשר לייבא? שורות תקינות קיימות ולא כל הקובץ נדחה. */
  canImport: boolean;
}

export function summarize(sheets: readonly SheetValidation[]): ValidationSummary {
  const all = sheets.flatMap((s) => s.issues);
  const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
  return {
    sheets: [...sheets],
    totalRows,
    totalRejected: sheets.reduce((n, s) => n + s.rejected, 0),
    errors: all.filter((i) => i.severity === 'error').length,
    warnings: all.filter((i) => i.severity === 'warning').length,
    canImport: totalRows > 0,
  };
}

/**
 * מקבץ שגיאות חוזרות להודעה אחת.
 *
 * קובץ עם 300 תרומות שבו עמודת התאריך בפורמט שגוי מייצר 300 שגיאות
 * זהות. רשימה כזו אינה קריאה, והגבאי צריך לדעת דבר אחד: "עמודת תאריך
 * בגיליון תרומות – 300 שורות".
 */
export interface GroupedIssue {
  sheet: string;
  column: string;
  message: string;
  severity: IssueSeverity;
  count: number;
  /** עד שלוש שורות לדוגמה, כדי שאפשר יהיה לפתוח את הקובץ ולראות. */
  sampleRows: number[];
}

export function groupIssues(issues: readonly RowIssue[]): GroupedIssue[] {
  const map = new Map<string, GroupedIssue>();
  for (const i of issues) {
    // ההודעה מכילה את הערך עצמו; מקבצים לפי הצורה ולא לפי הערך המדויק.
    const shape = i.message.replace(/"[^"]*"/g, '"…"');
    const key = `${i.sheet}|${i.column}|${shape}|${i.severity}`;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, {
        sheet: i.sheet,
        column: i.column,
        message: shape,
        severity: i.severity,
        count: 1,
        sampleRows: [i.row],
      });
    } else {
      existing.count += 1;
      if (existing.sampleRows.length < 3) existing.sampleRows.push(i.row);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
