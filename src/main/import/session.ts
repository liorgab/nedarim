import { basename, extname } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  IMPORT_ENTITIES,
  importEntity,
  type ImportEntityId,
} from './catalog';
import { matchSheetToEntity } from './detect';
import { blockingReasons, buildResolver, executeImport, existingKeys } from './execute';
import { suggestMapping, rowsFromMapping, unmappedColumns, unmappedRequired, type FieldMapping } from './mapping';
import type { ImportMode } from './modes';
import { importOrder } from './order';
import { readCsvMatrix, readWorkbook } from './read';
import { rowRulesFor } from './rules';
import {
  groupIssues,
  isExampleRow,
  summarize,
  validateSheet,
  type GroupedIssue,
  type SheetValidation,
} from './validate';

/**
 * F-121..F-129 – הרכבת האשף.
 *
 * המודול הזה הוא **התפר בלבד**: הוא מחזיק את הקובץ שנפתח ומעביר אותו בין
 * השלבים. כל החלטה אמיתית – איזו יישות, איזו עמודה, האם הערך תקין, מה
 * עושים עם שורה קיימת – נמצאת במודולים הטהורים ונבדקת שם.
 *
 * המצב נשמר בזיכרון התהליך הראשי ולא ב-DB: אשף ייבוא שנקטע הוא אשף
 * שמתחילים מחדש, ושמירת חצי-מצב הייתה מזמינה ייבוא שממשיך מקובץ שכבר
 * השתנה על הדיסק.
 */

export interface SessionSheet {
  /** מזהה יציב לשלב המיפוי – אינדקס הגיליון בקובץ. */
  index: number;
  sheetName: string;
  entity: ImportEntityId | null;
  detectedBy: 'sheet_name' | 'headers' | null;
  headerRow: number;
  headers: string[];
  dataRows: number;
  mapping: FieldMapping[];
  /** ברירת מחדל: כלול כשזוהתה יישות ויש שורות. */
  include: boolean;
}

export interface OpenedFile {
  path: string;
  fileName: string;
  kind: 'workbook' | 'csv';
  sheets: SessionSheet[];
}

interface SessionState extends OpenedFile {
  matrices: unknown[][][];
}

let state: SessionState | null = null;

export function clearSession(): void {
  state = null;
}

export function currentSession(): OpenedFile | null {
  if (state === null) return null;
  // המטריצות נשארות בתהליך הראשי: העברת קובץ של 1,268 שורות דרך IPC
  // בכל לחיצה במסך המיפוי היא העתקה מיותרת של כל הנתונים.
  return {
    path: state.path,
    fileName: state.fileName,
    kind: state.kind,
    sheets: state.sheets,
  };
}

/** שלב 2 – פתיחת הקובץ וזיהוי מה יש בו. */
export async function openImportFile(path: string): Promise<OpenedFile> {
  const isCsv = extname(path).toLowerCase() === '.csv';
  const raw = isCsv
    ? [{ name: basename(path, extname(path)), matrix: (await readCsvMatrix(path)) as unknown[][] }]
    : await readWorkbook(path);

  const sheets: SessionSheet[] = raw.map((sheet, index) => {
    const match = matchSheetToEntity(sheet.name, sheet.matrix);
    const headerRow = match?.headerRow ?? 0;
    const headers = (sheet.matrix[headerRow] ?? []).map((c) => String(c ?? '').trim());
    // שורות הנתונים בלבד, בלי הכותרת ובלי שורות ריקות בסוף הגיליון.
    const dataRows = sheet.matrix
      .slice(headerRow + 1)
      .filter((row) => row.some((c) => String(c ?? '').trim() !== '')).length;

    const entity = match === null ? null : importEntity(match.entity);
    return {
      index,
      sheetName: sheet.name,
      entity: entity?.id ?? null,
      detectedBy: match?.by ?? null,
      headerRow,
      headers,
      dataRows,
      mapping: entity === null ? [] : suggestMapping(headers, entity),
      include: entity !== null && dataRows > 0,
    };
  });

  state = {
    path,
    fileName: basename(path),
    kind: isCsv ? 'csv' : 'workbook',
    sheets,
    matrices: raw.map((s) => s.matrix),
  };
  return currentSession()!;
}

/**
 * שלב 3 – עדכון המיפוי שהמשתמש קבע.
 *
 * כולל שינוי היישות: ב-CSV מקובץ ישן הזיהוי האוטומטי נכשל לעיתים קרובות,
 * והמשתמש בוחר ביד. שינוי היישות מאפס את המיפוי להצעה חדשה – מיפוי ישן
 * מצביע על שדות שאינם קיימים ביישות החדשה.
 */
export function updateSheet(
  index: number,
  patch: { entity?: ImportEntityId | null; include?: boolean; mapping?: FieldMapping[]; headerRow?: number },
): OpenedFile {
  if (state === null) throw new Error('לא נפתח קובץ ייבוא');
  const sheet = state.sheets[index];
  if (sheet === undefined) throw new Error(`אין גיליון במיקום ${index}`);

  if (patch.headerRow !== undefined && patch.headerRow !== sheet.headerRow) {
    sheet.headerRow = patch.headerRow;
    sheet.headers = (state.matrices[index]?.[patch.headerRow] ?? []).map((c) =>
      String(c ?? '').trim(),
    );
    if (sheet.entity !== null) {
      sheet.mapping = suggestMapping(sheet.headers, importEntity(sheet.entity));
    }
  }

  if (patch.entity !== undefined && patch.entity !== sheet.entity) {
    sheet.entity = patch.entity;
    sheet.detectedBy = null;
    sheet.mapping =
      patch.entity === null ? [] : suggestMapping(sheet.headers, importEntity(patch.entity));
  }

  if (patch.mapping !== undefined) sheet.mapping = patch.mapping;
  if (patch.include !== undefined) sheet.include = patch.include;

  return currentSession()!;
}

// ------------------------------------------------------------ שלב 4: בדיקה

export interface MappingProblem {
  sheetName: string;
  entityLabel: string;
  missingRequired: string[];
  ignoredColumns: string[];
}

export interface PreflightReport {
  /** שדות חובה שלא מופו – חוסם את המעבר לבדיקת התקינות. */
  problems: MappingProblem[];
  /** יישויות שנבחרו וחסרות להן יישויות שהן תלויות בהן. */
  missingDependencies: Array<{ entityLabel: string; needsLabel: string }>;
}

/**
 * בדיקת המיפוי לפני האימות.
 *
 * התלויות נבדקות מול **הקובץ ומול ה-DB יחד**: ייבוא תרומות לבד תקין
 * לחלוטין כשהחברים כבר במערכת, ואזהרה עליו הייתה רעש. היא נחוצה רק
 * כשהחברים לא נמצאים באף אחד מהשניים.
 */
export function preflight(db: Database | null, sheets: readonly SessionSheet[]): PreflightReport {
  const active = sheets.filter((s) => s.include && s.entity !== null);
  const problems: MappingProblem[] = [];

  for (const sheet of active) {
    const entity = importEntity(sheet.entity!);
    const missingRequired = unmappedRequired(sheet.mapping, entity);
    const ignored = unmappedColumns(sheet.headers, sheet.mapping).map((c) => c.header);
    if (missingRequired.length > 0 || ignored.length > 0) {
      problems.push({
        sheetName: sheet.sheetName,
        entityLabel: entity.label,
        missingRequired,
        ignoredColumns: ignored,
      });
    }
  }

  const selected = new Set(active.map((s) => s.entity!));
  const missingDependencies: PreflightReport['missingDependencies'] = [];
  for (const id of selected) {
    for (const need of importEntity(id).dependsOn) {
      if (selected.has(need)) continue;
      // יש כבר נתונים במערכת? אז אין בעיה.
      if (db !== null && existingKeys(db, importEntity(need)).size > 0) continue;
      missingDependencies.push({
        entityLabel: importEntity(id).label,
        needsLabel: importEntity(need).label,
      });
    }
  }

  return { problems, missingDependencies };
}

export interface ValidationReport {
  sheets: Array<{
    entity: ImportEntityId;
    entityLabel: string;
    sheetName: string;
    rows: number;
    rejected: number;
    skippedExample: number;
  }>;
  totalRows: number;
  totalRejected: number;
  errors: number;
  warnings: number;
  issues: GroupedIssue[];
  blocks: Array<{ entityLabel: string; message: string }>;
  canImport: boolean;
  /** תצוגה מקדימה אמיתית של מה שייכתב – מהרצה יבשה. */
  preview: Array<{ entityLabel: string; insert: number; update: number; enrich: number; skip: number }>;
}

interface Prepared {
  entity: ImportEntityId;
  validation: SheetValidation;
  skippedExample: number;
}

/**
 * מריץ את האימות על כל הגיליונות שנבחרו, **בסדר הייבוא**.
 *
 * הסדר חשוב כבר כאן ולא רק בכתיבה: `pending` נבנה תוך כדי, כך שכשמאמתים
 * את גיליון התרומות, החברים שבגיליון החברים באותו קובץ כבר ידועים
 * לפותר. בלי זה כל תרומה בייבוא ראשוני הייתה נדחית כ"חבר לא נמצא".
 */
function prepare(db: Database, sheets: readonly SessionSheet[], matrices: readonly unknown[][][]): Prepared[] {
  const active = sheets.filter((s) => s.include && s.entity !== null);
  const byEntity = new Map(active.map((s) => [s.entity!, s]));
  const ordered = importOrder(IMPORT_ENTITIES).filter((e) => byEntity.has(e.id));

  const pending = new Map<ImportEntityId, Set<string>>();
  const resolver = buildResolver(db, pending);
  const results: Prepared[] = [];

  for (const entity of ordered) {
    const sheet = byEntity.get(entity.id)!;
    const { rows, firstRowNumber } = rowsFromMapping(
      matrices[sheet.index] ?? [],
      sheet.headerRow,
      sheet.mapping,
    );

    // השורות מועברות **כמו שהן**, כולל ריקות ושורת הדוגמה: `validateSheet`
    // מדלג עליהן בעצמו. סינון מוקדם היה מזיז את מספרי השורות, וכל שגיאה
    // הייתה מצביעה על השורה הלא נכונה בקובץ שהגבאי פותח לתקן.
    const examples = rows.filter((r) => isExampleRow(r)).length;

    const validation = validateSheet({
      entity,
      raw: rows,
      firstRowNumber,
      resolveRef: resolver,
      rowRules: rowRulesFor(entity.id),
    });

    // המפתחות של השורות התקינות זמינים ליישויות שתלויות בהן.
    const keys = new Set<string>();
    for (const row of validation.rows) {
      const key = entity.naturalKey.map((k) => String(row.values[k] ?? '')).join('|');
      if (key !== '') keys.add(key);
    }
    pending.set(entity.id, keys);

    results.push({ entity: entity.id, validation, skippedExample: examples });
  }

  return results;
}

/**
 * `userId` נדרש גם לבדיקה ולא רק לייבוא: ההרצה היבשה כותבת `created_by`,
 * ועמודה זו היא מפתח זר ל-`user`. מזהה פיקטיבי היה מפיל את כל הבדיקה על
 * "FOREIGN KEY constraint failed" – שגיאה שאינה קשורה לקובץ בכלל.
 */
export function validateSession(
  db: Database,
  mode: ImportMode,
  userId: number,
): ValidationReport {
  if (state === null) throw new Error('לא נפתח קובץ ייבוא');
  const prepared = prepare(db, state.sheets, state.matrices);
  const summary = summarize(prepared.map((p) => p.validation));
  const blocks = blockingReasons(db, mode, prepared.map((p) => p.entity)).map((b) => ({
    entityLabel: importEntity(b.entity).label,
    message: b.message,
  }));

  // הרצה יבשה: המספרים שמוצגים כאן הם מה שיקרה, ולא הערכה.
  const preview =
    summary.canImport && blocks.length === 0
      ? executeImport(db, {
          mode,
          userId,
          dryRun: true,
          sheets: prepared.map((p) => ({ entity: p.entity, rows: p.validation.rows })),
        }).sheets.map((s) => ({ entityLabel: s.label, ...s.counts }))
      : [];

  return {
    sheets: prepared.map((p) => ({
      entity: p.entity,
      entityLabel: importEntity(p.entity).label,
      sheetName: p.validation.sheet,
      rows: p.validation.rows.length,
      rejected: p.validation.rejected,
      skippedExample: p.skippedExample,
    })),
    totalRows: summary.totalRows,
    totalRejected: summary.totalRejected,
    errors: summary.errors,
    warnings: summary.warnings,
    issues: groupIssues(prepared.flatMap((p) => p.validation.issues)),
    blocks,
    canImport: summary.canImport && blocks.length === 0,
    preview,
  };
}

// ------------------------------------------------------------ שלב 5: ייבוא

export function runImport(
  db: Database,
  mode: ImportMode,
  userId: number,
): ReturnType<typeof executeImport> {
  if (state === null) throw new Error('לא נפתח קובץ ייבוא');
  const prepared = prepare(db, state.sheets, state.matrices);
  const blocks = blockingReasons(db, mode, prepared.map((p) => p.entity));
  if (blocks.length > 0) throw new Error(blocks[0]!.message);

  return executeImport(db, {
    mode,
    userId,
    sheets: prepared.map((p) => ({ entity: p.entity, rows: p.validation.rows })),
  });
}
