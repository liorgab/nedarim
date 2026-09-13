import type { Database } from 'better-sqlite3';
import { writeAudit } from './audit';
import type { VowItemScope } from './vowItemScope';

/**
 * F-140..F-143 – רשימת הנדרים למכירה.
 *
 * קטלוג הכיבודים, לא תנועה כספית. מי קנה ובכמה נשאר ב-`vow_charge`, וכאן
 * יושב רק **מה נמכר, מתי הוא נמכר ולאיזה מועד הוא שייך**.
 *
 * החיפוש והסינון נעשים ב-SQL ולא ב-renderer: 103 שורות אפשר היה להעביר
 * במלואן, אבל ברגע שגבאי מוסיף כיבודים משלו זה כבר לא נכון, והגבול בין
 * "מספיק קטן" ל"לא מספיק" אינו מקום טוב לסמוך עליו.
 */

export interface VowItem {
  id: number;
  name: string;
  category: string | null;
  duration: string | null;
  saleTiming: string | null;
  performanceTiming: string | null;
  scope: VowItemScope;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
  /** מזהי המועדים המשויכים. ריק כש-`scope` אינו `occasion`. */
  occasionIds: number[];
  /** שמות המועדים, לתצוגה בטבלה בלי שאילתה נוספת. */
  occasionNames: string[];
}

export interface VowItemInput {
  name: string;
  category?: string | null;
  duration?: string | null;
  saleTiming?: string | null;
  performanceTiming?: string | null;
  scope: VowItemScope;
  notes?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  occasionIds?: number[];
}

export interface VowItemFilter {
  /** חיפוש חופשי בשם, בקטגוריה ובתזמון המכירה. */
  search?: string;
  category?: string;
  scope?: VowItemScope;
  /** רק כיבודים המשויכים למועד הזה (כולל `shabbat`/`always` לפי סוג המועד). */
  occasionId?: number;
  includeInactive?: boolean;
}

interface Row {
  id: number;
  name: string;
  category: string | null;
  duration: string | null;
  sale_timing: string | null;
  performance_timing: string | null;
  scope: VowItemScope;
  notes: string | null;
  sort_order: number;
  is_active: number;
  occasion_ids: string | null;
  occasion_names: string | null;
}

/** התו שמפריד בין שמות המועדים ב-`group_concat` (ראו BASE_SELECT). */
const UNIT_SEPARATOR = String.fromCharCode(31);

const toItem = (row: Row): VowItem => ({
  id: row.id,
  name: row.name,
  category: row.category,
  duration: row.duration,
  saleTiming: row.sale_timing,
  performanceTiming: row.performance_timing,
  scope: row.scope,
  notes: row.notes,
  sortOrder: row.sort_order,
  isActive: row.is_active === 1,
  occasionIds:
    row.occasion_ids === null || row.occasion_ids === ''
      ? []
      : row.occasion_ids.split(',').map(Number),
  occasionNames:
    row.occasion_names === null || row.occasion_names === ''
      ? []
      : row.occasion_names.split(UNIT_SEPARATOR),
});

/**
 * `group_concat` עם מפריד היחידה (0x1F) ולא פסיק: שמות מועדים מכילים
 * פסיקים ("שבת חול המועד סוכות" לא, אבל אירוע שהגבאי יוסיף בהחלט יכול),
 * ופיצול לפי פסיק היה שובר אותם.
 */
const BASE_SELECT = `
  SELECT i.*,
         (SELECT group_concat(o.id) FROM vow_item_occasion l
            JOIN occasion o ON o.id = l.occasion_id
           WHERE l.vow_item_id = i.id) AS occasion_ids,
         (SELECT group_concat(o.name, char(31)) FROM vow_item_occasion l
            JOIN occasion o ON o.id = l.occasion_id
           WHERE l.vow_item_id = i.id) AS occasion_names
    FROM vow_item i`;

export function listVowItems(db: Database, filter: VowItemFilter = {}): VowItem[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.includeInactive !== true) where.push('i.is_active = 1');

  if (filter.search !== undefined && filter.search.trim() !== '') {
    where.push(
      '(i.name LIKE @search OR i.category LIKE @search OR i.sale_timing LIKE @search)',
    );
    params['search'] = `%${filter.search.trim()}%`;
  }
  if (filter.category !== undefined && filter.category !== '') {
    where.push('i.category = @category');
    params['category'] = filter.category;
  }
  if (filter.scope !== undefined) {
    where.push('i.scope = @scope');
    params['scope'] = filter.scope;
  }

  if (filter.occasionId !== undefined) {
    // `shabbat` נכלל רק כשהמועד הוא פרשה: בשמיני עצרת אין קריאה של שבת
    // רגילה, והצגת 18 עליות השבת שם הייתה מטביעה את מה שבאמת נמכר.
    where.push(`(
      i.scope = 'always'
      OR (i.scope = 'shabbat' AND (SELECT type FROM occasion WHERE id = @occasionId) = 'parasha')
      OR (i.scope = 'occasion'
          AND EXISTS (SELECT 1 FROM vow_item_occasion l
                       WHERE l.vow_item_id = i.id AND l.occasion_id = @occasionId))
    )`);
    params['occasionId'] = filter.occasionId;
  }

  const sql = `${BASE_SELECT}
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY i.sort_order, i.name`;

  return (db.prepare(sql).all(params) as Row[]).map(toItem);
}

export function getVowItem(db: Database, id: number): VowItem | null {
  const row = db.prepare(`${BASE_SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  return row === undefined ? null : toItem(row);
}

/** הקטגוריות הקיימות בפועל – לסרגל הסינון, בלי רשימה קשיחה בקוד. */
export function vowItemCategories(db: Database): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT category FROM vow_item
          WHERE category IS NOT NULL AND category <> '' ORDER BY category`,
      )
      .all() as Array<{ category: string }>
  ).map((r) => r.category);
}

function writeLinks(db: Database, itemId: number, occasionIds: readonly number[]): void {
  db.prepare('DELETE FROM vow_item_occasion WHERE vow_item_id = ?').run(itemId);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO vow_item_occasion (vow_item_id, occasion_id) VALUES (?, ?)',
  );
  for (const occasionId of occasionIds) ins.run(itemId, occasionId);
}

function validate(input: VowItemInput): void {
  if (input.name.trim() === '') throw new Error('שם הכיבוד הוא שדה חובה');
  if (input.scope === 'occasion' && (input.occasionIds ?? []).length === 0) {
    // אחרת הכיבוד לא יופיע לעולם: הוא מוגדר "למועדים מסוימים" ואין לו
    // אף מועד. שגיאה כאן עדיפה על רשומה שקטה שאיש לא מוצא.
    throw new Error('כיבוד המשויך למועדים מסוימים חייב לפחות מועד אחד');
  }
}

export function createVowItem(db: Database, input: VowItemInput, userId: number): VowItem {
  validate(input);
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vow_item
           (name, category, duration, sale_timing, performance_timing, scope, notes, sort_order, is_active)
         VALUES (@name, @category, @duration, @saleTiming, @performanceTiming, @scope, @notes, @sortOrder, @isActive)`,
      )
      .run({
        name: input.name.trim(),
        category: input.category ?? null,
        duration: input.duration ?? null,
        saleTiming: input.saleTiming ?? null,
        performanceTiming: input.performanceTiming ?? null,
        scope: input.scope,
        notes: input.notes ?? null,
        sortOrder: input.sortOrder ?? nextSortOrder(db),
        isActive: input.isActive === false ? 0 : 1,
      });

    const id = Number(info.lastInsertRowid);
    writeLinks(db, id, input.occasionIds ?? []);
    writeAudit(db, {
      userId,
      entity: 'vow_item',
      entityId: id,
      action: 'create',
      after: { name: input.name, scope: input.scope },
    });
    return getVowItem(db, id)!;
  })();
}

export function updateVowItem(
  db: Database,
  id: number,
  input: VowItemInput,
  userId: number,
): VowItem {
  validate(input);
  const before = getVowItem(db, id);
  if (before === null) throw new Error('הכיבוד לא נמצא');

  return db.transaction(() => {
    db.prepare(
      `UPDATE vow_item SET
         name = @name, category = @category, duration = @duration,
         sale_timing = @saleTiming, performance_timing = @performanceTiming,
         scope = @scope, notes = @notes, sort_order = @sortOrder, is_active = @isActive
       WHERE id = @id`,
    ).run({
      id,
      name: input.name.trim(),
      category: input.category ?? null,
      duration: input.duration ?? null,
      saleTiming: input.saleTiming ?? null,
      performanceTiming: input.performanceTiming ?? null,
      scope: input.scope,
      notes: input.notes ?? null,
      sortOrder: input.sortOrder ?? before.sortOrder,
      isActive: input.isActive === false ? 0 : 1,
    });

    writeLinks(db, id, input.occasionIds ?? []);
    writeAudit(db, {
      userId,
      entity: 'vow_item',
      entityId: id,
      action: 'update',
      before: { name: before.name, scope: before.scope },
      after: { name: input.name, scope: input.scope },
    });
    return getVowItem(db, id)!;
  })();
}

export interface DeleteVowItemResult {
  /** נמחק לגמרי. `false` = כובה בלבד, כי יש נדרים שמצביעים עליו. */
  deleted: boolean;
  /** כמה נדרים מקושרים לכיבוד. */
  usedBy: number;
}

/**
 * מוחק כיבוד, או מכבה אותו כשהוא בשימוש.
 *
 * כיבוד שכבר נמכר **אינו נמחק**: החיוב ההיסטורי מצביע עליו, ומחיקה הייתה
 * הופכת "עליית שלישי, 180 ₪" ל"נדר בלי שם" בכרטיסייה של החבר. כיבוי משיג
 * את מה שהגבאי רצה – שהוא ייעלם מהרשימה – בלי למחוק היסטוריה (כלל 6).
 */
export function deleteVowItem(db: Database, id: number, userId: number): DeleteVowItemResult {
  const item = getVowItem(db, id);
  if (item === null) throw new Error('הכיבוד לא נמצא');

  const usedBy = (
    db.prepare('SELECT COUNT(*) AS n FROM vow_charge WHERE vow_item_id = ?').get(id) as {
      n: number;
    }
  ).n;

  return db.transaction(() => {
    if (usedBy > 0) {
      db.prepare('UPDATE vow_item SET is_active = 0 WHERE id = ?').run(id);
      writeAudit(db, {
        userId,
        entity: 'vow_item',
        entityId: id,
        action: 'update',
        before: { name: item.name, isActive: true },
        after: { isActive: false, reason: 'בשימוש בנדרים קיימים' },
      });
      return { deleted: false, usedBy };
    }

    db.prepare('DELETE FROM vow_item WHERE id = ?').run(id);
    writeAudit(db, {
      userId,
      entity: 'vow_item',
      entityId: id,
      action: 'delete',
      before: { name: item.name, scope: item.scope },
    });
    return { deleted: true, usedBy: 0 };
  })();
}

function nextSortOrder(db: Database): number {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM vow_item').get() as {
    m: number;
  };
  return row.m + 10;
}
