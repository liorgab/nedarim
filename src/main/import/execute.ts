import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { writeAudit } from '../services/audit';
import { IMPORT_ENTITIES, importEntity, type ImportEntity, type ImportEntityId } from './catalog';
import { importOrder } from './order';
import {
  countActions,
  decideRowAction,
  type ActionCounts,
  type ImportMode,
  type RowAction,
} from './modes';
import type { ParsedRow, RefResolver } from './validate';

/**
 * F-126 – כתיבת הייבוא.
 *
 * **הכול בטרנזקציה אחת.** ייבוא שנכשל באמצע משאיר מערכת עם חצי מהחברים
 * ובלי הנדרים שלהם – מצב גרוע יותר מכישלון מלא, כי הוא נראה כמו הצלחה.
 * SQLite מגלגלת אחורה, והגבאי חוזר בדיוק למצב שלפני.
 *
 * **הסדר נקבע ב-`importOrder`**: חברים לפני נדרים, אמצעי תשלום לפני
 * תשלומים. בלעדיו 1,268 נדרים נדחים כי החברים עוד לא נכתבו.
 */

export interface SheetData {
  entity: ImportEntityId;
  rows: readonly ParsedRow[];
}

export interface ExecuteInput {
  mode: ImportMode;
  sheets: readonly SheetData[];
  userId: number;
}

export interface SheetResult {
  entity: ImportEntityId;
  label: string;
  counts: ActionCounts;
  /** דילוגים עם הסבר, לדוח הסיכום. */
  skipped: Array<{ row: number; reason: string }>;
}

export interface ExecuteResult {
  sheets: SheetResult[];
  totals: ActionCounts;
}

// ------------------------------------------------------------- חסימות

export interface ImportBlock {
  entity: ImportEntityId;
  message: string;
}

/**
 * מצבים שאסור להריץ על המערכת הזו.
 *
 * `replace` על תשלומים או תרומות שיש עליהן קבלות הוא הגבול האמיתי:
 * מספר קבלה לעולם אינו משוחרר ואינו מוקצה מחדש (CLAUDE.md כלל 4). מחיקת
 * התשלומים הייתה מותירה 452 קבלות שמצביעות על רשומות שאינן קיימות, או
 * גרוע מכך – על רשומות אחרות שקיבלו את אותם מזהים.
 */
export function blockingReasons(
  db: Database,
  mode: ImportMode,
  entities: readonly ImportEntityId[],
): ImportBlock[] {
  if (mode !== 'replace') return [];

  const blocks: ImportBlock[] = [];
  const receipts = (
    db.prepare('SELECT COUNT(*) AS n FROM receipt WHERE cancelled_at IS NULL').get() as {
      n: number;
    }
  ).n;

  if (receipts > 0) {
    for (const entity of ['vow_payment', 'donation'] as const) {
      if (!entities.includes(entity)) continue;
      blocks.push({
        entity,
        message: `קיימות ${receipts} קבלות במערכת. מחיקה וייבוא מחדש של ${importEntity(entity).label} תותיר אותן מצביעות על רשומות שאינן קיימות, ומספר קבלה לעולם אינו מוקצה מחדש. יש לבטל את הקבלות תחילה, או לבחור מצב אחר.`,
      });
    }
  }
  return blocks;
}

// ---------------------------------------------------- פותר הפניות מול DB

/**
 * בונה פותר שמכיר גם את ה-DB וגם את מה שנכתב באותו ייבוא.
 *
 * שני המקורות הכרחיים: חבר שמופיע בגיליון החברים באותו קובץ עדיין לא
 * ב-DB כשמאמתים את גיליון התרומות, ובלי המקור השני כל התרומות היו
 * נדחות בייבוא ראשוני.
 */
export function buildResolver(db: Database, pending: ReadonlyMap<ImportEntityId, Set<string>>): RefResolver {
  const cache = new Map<string, boolean>();

  return (entity, key) => {
    if (key === '') return false;
    if (pending.get(entity)?.has(key) === true) return true;

    const cacheKey = `${entity}|${key}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;

    const def = importEntity(entity);
    const column = keyColumn(def);
    const row = db
      .prepare(`SELECT 1 FROM "${def.table}" WHERE "${column}" = ? LIMIT 1`)
      .get(key) as unknown;
    const found = row !== undefined;
    cache.set(cacheKey, found);
    return found;
  };
}

/** עמודת ה-DB של המפתח הטבעי. */
function keyColumn(entity: ImportEntity): string {
  const label = entity.naturalKey[0];
  const field = entity.fields.find((f) => f.label === label);
  if (field?.column == null) {
    throw new Error(`ליישות ${entity.id} אין עמודת מפתח`);
  }
  return field.column;
}

/** המפתחות הקיימים ביישות – לבניית `pending` לפני האימות. */
export function existingKeys(db: Database, entity: ImportEntity): Set<string> {
  if (entity.naturalKey.length === 0) return new Set();
  const column = keyColumn(entity);
  const rows = db.prepare(`SELECT "${column}" AS k FROM "${entity.table}"`).all() as Array<{
    k: string | number | null;
  }>;
  return new Set(rows.filter((r) => r.k !== null).map((r) => String(r.k)));
}

// --------------------------------------------------------------- כתיבה

/** רשומה קיימת לפי המפתח הטבעי, עם ערכיה לפי כותרות הקטלוג. */
function findExisting(
  db: Database,
  entity: ImportEntity,
  key: string,
): { id: number; values: Record<string, string | number | null> } | null {
  if (entity.naturalKey.length === 0 || key === '') return null;
  const column = keyColumn(entity);
  const row = db
    .prepare(`SELECT * FROM "${entity.table}" WHERE "${column}" = ? LIMIT 1`)
    .get(key) as Record<string, unknown> | undefined;
  if (row === undefined) return null;

  const values: Record<string, string | number | null> = {};
  for (const field of entity.fields) {
    if (field.column === null) continue;
    const v = row[field.column];
    values[field.label] = v === undefined ? null : (v as string | number | null);
  }
  return { id: Number(row['id']), values };
}

/**
 * מתרגם ערכי הקטלוג לעמודות DB, כולל פתרון הפניות למזהים.
 *
 * **תא ריק מושמט ואינו נכתב כ-`NULL`.** שתי סיבות, ושתיהן התגלו בבדיקה:
 * בהוספה, כתיבת `NULL` לעמודה עם ברירת מחדל (`status`) נכשלת על אילוץ
 * `NOT NULL` – ברירת המחדל פועלת רק כשהעמודה מושמטת. בעדכון, תא ריק
 * בגיליון היה **מוחק ערך קיים** במערכת, וזו אותה מלכודת שנחסמה בהעשרה.
 *
 * המשמעות: אי אפשר לרוקן שדה דרך ייבוא. זה מכוון – ריקון נעשה במסך
 * העריכה, שם הוא פעולה מודעת ולא תוצר לוואי של עמודה שלא מולאה.
 */
function toColumns(
  db: Database,
  entity: ImportEntity,
  values: Record<string, string | number | null>,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};

  for (const field of entity.fields) {
    const value = values[field.label] ?? null;

    if (field.ref !== undefined) {
      // הפניה: מפתח אנושי → מזהה. האימות כבר ודא שהוא קיים.
      if (value === null) continue;
      const target = importEntity(field.ref.entity);
      const row = db
        .prepare(`SELECT id FROM "${target.table}" WHERE "${keyColumn(target)}" = ? LIMIT 1`)
        .get(String(value)) as { id: number } | undefined;
      if (row !== undefined) out[refColumn(entity, field.ref.entity)] = row.id;
      continue;
    }

    if (field.column === null) continue;

    if (value === null) {
      // ברירת מחדל של השדה, כשלעמודה עצמה אין אחת (`vow_charge.kind`).
      if (field.defaultValue !== undefined) out[field.column] = field.defaultValue;
      continue;
    }

    // תרגום ערך בחירה מעברית לערך ה-DB.
    out[field.column] = field.dbValues?.[String(value)] ?? value;
  }
  return out;
}

/**
 * עמודות מספור שהמערכת מקצה כשהן ריקות, מתוך טבלת `sequence`.
 *
 * הקטלוג מבטיח "ריק = המערכת מקצה את הבא בתור", והמימוש חייב לכבד את
 * זה: בלעדיו כל שורה בלי מספר תרומה נכשלת על `NOT NULL`, והגבאי מקבל
 * שגיאה על שדה שהתבנית אמרה לו שהוא רשות.
 *
 * `receipt` אינו ברשימה בכוונה – מספר קבלה מוקצה אך ורק בטרנזקציית
 * `BEGIN IMMEDIATE` ייעודית (כלל 4), ולא בייבוא.
 */
const AUTO_NUMBER: Partial<Record<ImportEntityId, { column: string; sequence: string }>> = {
  donation: { column: 'donation_number', sequence: 'donation' },
  expense: { column: 'expense_number', sequence: 'expense' },
};

/** לוקח את המספר הבא ומקדם את הרצף. נקרא בתוך הטרנזקציה של הייבוא. */
function nextNumber(db: Database, sequence: string): number {
  const row = db.prepare('SELECT next_value FROM sequence WHERE name = ?').get(sequence) as
    | { next_value: number }
    | undefined;
  // רצף חסר – נגזר מהקיים במקום להתחיל מ-1 ולהתנגש.
  const next = row?.next_value ?? 1;
  db.prepare(
    'INSERT INTO sequence (name, next_value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next_value = ?',
  ).run(sequence, next + 1, next + 1);
  return next;
}

/** שם עמודת ה-FK. נגזר משם היישות כדי לא לתחזק מיפוי נוסף. */
function refColumn(entity: ImportEntity, target: ImportEntityId): string {
  const byTarget: Partial<Record<ImportEntityId, string>> = {
    member: 'member_id',
    occasion: 'occasion_id',
    payment_method: 'payment_method_id',
    donation_type: 'donation_type_id',
    expense_category: 'category_id',
  };
  const column = byTarget[target];
  if (column === undefined) {
    throw new Error(`אין עמודת הפניה מוגדרת מ-${entity.id} ל-${target}`);
  }
  return column;
}

function insertRow(
  db: Database,
  entity: ImportEntity,
  columns: Record<string, string | number | null>,
  userId: number,
): void {
  const ts = nowIso();
  const data: Record<string, string | number | null> = { ...columns };

  // עמודות מערכת קיימות רק בטבלאות הנתונים, לא ברשימות הערכים.
  const hasTimestamps = entity.fields.length > 0 && entity.table !== 'occasion';
  if (hasTimestamps && tableHasColumn(db, entity.table, 'created_at')) {
    data['created_at'] = ts;
    data['updated_at'] = ts;
    data['created_by'] = userId;
    data['import_source_ref'] = `import:${ts}`;
  }

  const keys = Object.keys(data);
  db.prepare(
    `INSERT INTO "${entity.table}" (${keys.map((k) => `"${k}"`).join(',')})
     VALUES (${keys.map(() => '?').join(',')})`,
  ).run(...keys.map((k) => data[k] ?? null));
}

function updateRow(
  db: Database,
  entity: ImportEntity,
  id: number,
  columns: Record<string, string | number | null>,
): void {
  const keys = Object.keys(columns);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `"${k}" = ?`);
  if (tableHasColumn(db, entity.table, 'updated_at')) sets.push(`"updated_at" = '${nowIso()}'`);
  db.prepare(`UPDATE "${entity.table}" SET ${sets.join(',')} WHERE id = ?`).run(
    ...keys.map((k) => columns[k] ?? null),
    id,
  );
}

const columnCache = new Map<string, Set<string>>();

function tableHasColumn(db: Database, table: string, column: string): boolean {
  let cols = columnCache.get(table);
  if (cols === undefined) {
    const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    cols = new Set(rows.map((r) => r.name));
    columnCache.set(table, cols);
  }
  return cols.has(column);
}

/**
 * מריץ את הייבוא. **קורא לעצמו בתוך טרנזקציה אחת** – כישלון בכל שלב
 * מגלגל את הכול אחורה.
 */
export function executeImport(db: Database, input: ExecuteInput): ExecuteResult {
  const byId = new Map(input.sheets.map((s) => [s.entity, s]));
  const ordered = importOrder(IMPORT_ENTITIES).filter((e) => byId.has(e.id));

  const run = db.transaction((): ExecuteResult => {
    const results: SheetResult[] = [];

    for (const entity of ordered) {
      const sheet = byId.get(entity.id)!;
      const actions: RowAction[] = [];
      const skipped: SheetResult['skipped'] = [];

      if (input.mode === 'replace') {
        db.prepare(`DELETE FROM "${entity.table}"`).run();
      }

      for (const row of sheet.rows) {
        const key = entity.naturalKey.map((k) => String(row.values[k] ?? '')).join('|');
        const existing =
          input.mode === 'replace' ? null : findExisting(db, entity, key);

        const action = decideRowAction({
          mode: input.mode,
          hasNaturalKey: entity.naturalKey.length > 0,
          existing,
          incoming: row.values,
        });
        actions.push(action);

        if (action.kind === 'skip') {
          skipped.push({ row: row.row, reason: action.reason });
          continue;
        }

        const columns = toColumns(db, entity, row.values);

        // מספור אוטומטי כשהעמודה ריקה – כפי שהתבנית מבטיחה.
        const auto = AUTO_NUMBER[entity.id];
        if (auto !== undefined && action.kind === 'insert' && columns[auto.column] === undefined) {
          columns[auto.column] = nextNumber(db, auto.sequence);
        }

        if (action.kind === 'insert') {
          insertRow(db, entity, columns, input.userId);
        } else if (action.kind === 'update') {
          updateRow(db, entity, action.id, columns);
        } else {
          // העשרה: רק העמודות שהוחלט עליהן, ולא כל השורה.
          const only: Record<string, string | number | null> = {};
          for (const label of action.fields) {
            const field = entity.fields.find((f) => f.label === label);
            if (field?.column != null && columns[field.column] !== undefined) {
              only[field.column] = columns[field.column]!;
            }
          }
          updateRow(db, entity, action.id, only);
        }
      }

      results.push({
        entity: entity.id,
        label: entity.label,
        counts: countActions(actions),
        skipped,
      });
    }

    const totals = results.reduce<ActionCounts>(
      (acc, r) => ({
        insert: acc.insert + r.counts.insert,
        update: acc.update + r.counts.update,
        enrich: acc.enrich + r.counts.enrich,
        skip: acc.skip + r.counts.skip,
      }),
      { insert: 0, update: 0, enrich: 0, skip: 0 },
    );

    writeAudit(db, {
      userId: input.userId,
      entity: 'import',
      entityId: 0,
      action: 'create',
      after: { mode: input.mode, sheets: results.map((r) => r.entity), totals },
    });

    return { sheets: results, totals };
  });

  return run();
}
