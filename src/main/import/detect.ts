import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORT_ENTITIES, type ImportEntity, type ImportEntityId } from './catalog';
import { detectHeaderRow, normalizeHeader } from './read';
import { toText } from './parse';

/**
 * F-123 – זיהוי מה יש בקובץ.
 *
 * הגיליון בתבנית נקרא בשם היישות, ואז הזיהוי ודאי. קובץ שהגבאי הכין
 * בעצמו נקרא "גיליון1", ואז הראיה היחידה היא הכותרות – ולכן הזיהוי
 * מדווח **רמת ודאות** ולא מחליט בשקט.
 */

export interface EntityMatch {
  entity: ImportEntityId;
  /** לפי שם הגיליון (ודאי) או לפי הכותרות (ניחוש). */
  by: 'sheet_name' | 'headers';
  /** כמה מכותרות היישות זוהו. */
  matched: number;
  /** אינדקס שורת הכותרות במטריצה. */
  headerRow: number;
}

const normalizeName = (v: string): string =>
  toText(v).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * מתאים גיליון ליישות.
 *
 * דרישת המינימום לזיהוי לפי כותרות היא **כל שדות החובה**. פחות מזה אינו
 * ראיה: גיליון עם עמודת "תאריך" בלבד מתאים חלקית לארבע יישויות שונות,
 * וניחוש ביניהן הוא איך 1,268 נדרים נכתבים כהוצאות.
 */
export function matchSheetToEntity(
  sheetName: string,
  matrix: readonly (readonly unknown[])[],
): EntityMatch | null {
  const byName = IMPORT_ENTITIES.find(
    (e) => normalizeName(e.sheet) === normalizeName(sheetName),
  );
  if (byName !== undefined) {
    const header = detectHeaderRow(matrix, byName);
    return {
      entity: byName.id,
      by: 'sheet_name',
      matched: header.matched,
      headerRow: Math.max(header.index, 0),
    };
  }

  let best: EntityMatch | null = null;
  for (const entity of IMPORT_ENTITIES) {
    const header = detectHeaderRow(matrix, entity);
    if (header.index < 0) continue;
    if (!coversRequired(matrix[header.index] ?? [], entity)) continue;
    if (best === null || header.matched > best.matched) {
      best = {
        entity: entity.id,
        by: 'headers',
        matched: header.matched,
        headerRow: header.index,
      };
    }
  }
  return best;
}

function coversRequired(row: readonly unknown[], entity: ImportEntity): boolean {
  const present = new Set(row.map((c) => normalizeHeader(toText(c))));
  return entity.fields
    .filter((f) => f.required)
    .every((f) => present.has(normalizeHeader(f.label)));
}

/**
 * זיהוי תיקיית גיבוי.
 *
 * הגבאי שמתבקש "לבחור קובץ נתונים" יבחר לפעמים את הגיבוי – זה הקובץ
 * שהוא מכיר. במקום להיכשל על "אין גיליונות", האשף מזהה אותו ומציע את
 * מסלול השחזור, שהוא בכל מקרה הדרך הנכונה להחזיר גיבוי: שחזור מחזיר גם
 * את הקבלות והקבצים המצורפים, ייבוא לא.
 */
export function isBackupFolder(path: string): boolean {
  return existsSync(join(path, 'nedarim.db')) && existsSync(join(path, 'manifest.json'));
}
