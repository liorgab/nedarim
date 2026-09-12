import { writeFileSync } from 'node:fs';
import { agorotToShekel } from '@shared/money';
import type { ReportCell, ReportColumn } from './reports';

/**
 * F-87 – ייצוא כל דוח ל-CSV ול-Excel, ו-F-104 – ייצוא מלא של הנתונים.
 *
 * הייצוא עובד על המבנה האחיד של `ReportResult`, ולכן דוח חדש מקבל ייצוא בחינם.
 * סכומים מיוצאים כשקלים עשרוניים (לא אגורות), כדי שהקובץ יהיה שמיש בגיליון.
 */

/**
 * המינימום שהמייצאים צריכים. `ReportResult` מקיים אותו מבנית, ולכן כל דוח
 * ממשיך לעבוד – אבל גם טבלה שאינה דוח (לוח השנה, F-90) מקבלת ייצוא בחינם
 * בלי להידחף לתוך האיחוד `ReportId`.
 */
export interface ExportableTable {
  title: string;
  columns: readonly ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  totals: Record<string, ReportCell> | null;
}

function cellForExport(value: ReportCell, column: ReportColumn): string | number | null {
  if (value === null || value === undefined) return null;
  if (column.format === 'money' && typeof value === 'number') return agorotToShekel(value);
  if (column.format === 'date' && typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return value;
}

/** מטריצה של הדוח: כותרות, שורות ושורת סיכום. משמשת גם ל-CSV וגם ל-Excel. */
export function reportToMatrix(report: ExportableTable): Array<Array<string | number | null>> {
  const header = report.columns.map((c) => c.label);
  const body = report.rows.map((row) =>
    report.columns.map((c) => cellForExport(row[c.key] ?? null, c)),
  );
  const matrix: Array<Array<string | number | null>> = [header, ...body];
  if (report.totals) {
    matrix.push(report.columns.map((c) => cellForExport(report.totals![c.key] ?? null, c)));
  }
  return matrix;
}

/** CSV עם BOM, כדי ש-Excel בעברית יפתח אותו בקידוד הנכון. */
export function toCsv(report: ExportableTable): string {
  const escape = (v: string | number | null): string => {
    if (v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = reportToMatrix(report).map((row) => row.map(escape).join(','));
  const BOM = '\uFEFF'; // Excel בעברית זקוק ל-BOM כדי לזהות UTF-8
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function writeCsv(report: ExportableTable, path: string): string {
  writeFileSync(path, toCsv(report), 'utf8');
  return path;
}

/**
 * תא בפורמט ש-`write-excel-file` מצפה לו. מספר נשאר מספר כדי שאפשר יהיה
 * לסכם אותו בגיליון; כל השאר מחרוזת.
 */
type SheetCell = { type: typeof Number; value: number } | { type: typeof String; value: string };

function toSheetCell(v: string | number | null): SheetCell {
  return typeof v === 'number'
    ? { type: Number, value: v }
    : { type: String, value: v === null ? '' : String(v) };
}

const toSheet = (matrix: Array<Array<string | number | null>>): SheetCell[][] =>
  matrix.map((row) => row.map(toSheetCell));

/**
 * ייצוא ל-Excel. הספרייה נטענת דינמית כדי לא לשלם עליה בכל הפעלה של היישום.
 */
export async function writeXlsx(report: ExportableTable, path: string): Promise<string> {
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  await writeXlsxFile(toSheet(reportToMatrix(report)), {
    sheet: sheetName(report.title),
    // הגיליון נפתח מימין לשמאל, כמו כל המערכת.
    rightToLeft: true,
    columns: report.columns.map((c) => ({ width: c.format === 'text' ? 24 : 14 })),
  }).toFile(path);
  return path;
}

/** שם גיליון חוקי ב-Excel: עד 31 תווים, בלי : \ / ? * [ ] */
export function sheetName(title: string): string {
  return (
    title
      .replace(/[:\\/?*[\]]/g, ' ')
      .trim()
      .slice(0, 31) || 'דוח'
  );
}

export interface ExportTable {
  name: string;
  matrix: Array<Array<string | number | null>>;
}

/**
 * F-104 – ייצוא מלא: גיליון לכל ישות, כדי שבית הכנסת לעולם לא יהיה נעול במערכת.
 * מיוצא כטבלה גולמית עם שמות העמודות של ה-DB, לשקיפות מלאה.
 */
export async function writeFullExport(
  tables: readonly ExportTable[],
  path: string,
): Promise<string> {
  const { default: writeXlsxFile } = await import('write-excel-file/node');

  // שמות גיליונות ייחודיים: Excel דוחה קובץ עם שני גיליונות באותו שם,
  // וקיצור ל-31 תווים עלול ליצור התנגשות משמות ארוכים שונים.
  const used = new Set<string>();
  const names = tables.map((t) => {
    let name = sheetName(t.name);
    let i = 2;
    while (used.has(name)) name = sheetName(`${t.name} ${i++}`);
    used.add(name);
    return name;
  });

  await writeXlsxFile(
    tables.map((t, i) => ({ data: toSheet(t.matrix), sheet: names[i]!, rightToLeft: true })),
  ).toFile(path);
  return path;
}
