import { IMPORT_ENTITIES, type ImportEntity, type ImportEntityId } from './catalog';

/**
 * F-121 – סדר הייבוא.
 *
 * **טהור בכוונה.** הסדר הוא ההבדל בין ייבוא שעובד לבין 1,268 נדרים
 * שנדחים כי החברים עוד לא קיימים. הוא נגזר מ-`dependsOn` ולא מרשימה
 * ידנית, כי רשימה ידנית מתיישנת בשקט ברגע שמוסיפים יישות – והתסמין
 * יהיה "הייבוא נכשל על חצי מהקובץ" ולא שגיאת קומפילציה.
 */

/**
 * מיון טופולוגי. בין יישויות שאין ביניהן תלות נשמר הסדר שבו הן מוגדרות
 * בקטלוג, כדי שהתוצאה תהיה יציבה ושהתבנית תיראה תמיד אותו דבר.
 */
export function importOrder(
  entities: readonly ImportEntity[] = IMPORT_ENTITIES,
): ImportEntity[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const sorted: ImportEntity[] = [];
  const done = new Set<ImportEntityId>();
  const visiting = new Set<ImportEntityId>();

  const visit = (entity: ImportEntity, path: ImportEntityId[]): void => {
    if (done.has(entity.id)) return;
    if (visiting.has(entity.id)) {
      // מעגל תלויות הוא באג בקטלוג, לא קלט של משתמש – לכן זריקה ולא דילוג.
      throw new Error(`מעגל תלויות בקטלוג הייבוא: ${[...path, entity.id].join(' → ')}`);
    }
    visiting.add(entity.id);
    for (const depId of entity.dependsOn) {
      const dep = byId.get(depId);
      // תלות שאינה בקטלוג היא שגיאת הקלדה שאסור שתישאר שקטה.
      if (dep === undefined) {
        throw new Error(`היישות ${entity.id} תלויה ב-${depId}, שאינה בקטלוג`);
      }
      visit(dep, [...path, entity.id]);
    }
    visiting.delete(entity.id);
    done.add(entity.id);
    sorted.push(entity);
  };

  for (const entity of entities) visit(entity, []);
  return sorted;
}

/** כל היישויות שיישות נתונה תלויה בהן, ישירות ובעקיפין. */
export function allDependencies(
  id: ImportEntityId,
  entities: readonly ImportEntity[] = IMPORT_ENTITIES,
): ImportEntityId[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out = new Set<ImportEntityId>();

  const walk = (current: ImportEntityId): void => {
    for (const dep of byId.get(current)?.dependsOn ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      walk(dep);
    }
  };
  walk(id);
  return [...out];
}

/**
 * מסנן את הסדר לגיליונות שהמשתמש באמת סיפק, ומדווח על תלויות חסרות.
 *
 * חסר אינו בהכרח שגיאה: מי שמייבא רק תרומות למערכת שכבר מלאה בחברים
 * אינו צריך את גיליון החברים. ההחלטה אם זו בעיה מתקבלת בשלב האימות,
 * מול מה שקיים ב-DB – לא כאן.
 */
export interface PlannedImport {
  order: ImportEntity[];
  /** יישויות שהסופקו תלויות בהן ושאינן בקובץ. */
  missingDependencies: ImportEntityId[];
}

export function planImport(
  provided: readonly ImportEntityId[],
  entities: readonly ImportEntity[] = IMPORT_ENTITIES,
): PlannedImport {
  const providedSet = new Set(provided);
  const order = importOrder(entities).filter((e) => providedSet.has(e.id));

  const missing = new Set<ImportEntityId>();
  for (const id of provided) {
    for (const dep of allDependencies(id, entities)) {
      if (!providedSet.has(dep)) missing.add(dep);
    }
  }
  return { order, missingDependencies: [...missing] };
}
