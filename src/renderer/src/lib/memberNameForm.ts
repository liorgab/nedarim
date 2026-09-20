/**
 * F-13 – ההיגיון של שדה השם בטופס החבר, כפונקציות טהורות.
 *
 * המקרה שבגללו הן כאן ולא בתוך הרכיב: בית כנסת שניהל עד היום שם פרטי ושם
 * משפחה בנפרד, ועובר ל"שם מלא". השדה היחיד חייב להציג את **כל** השם –
 * אחרת שם המשפחה נעלם מהעין, הגבאי מקליד אותו שוב, ונוצר
 * "ישראל ישראלי ישראלי".
 */

export type NameMode = 'split' | 'full';

export interface StoredName {
  firstName: string;
  lastName: string;
}

/** השם כפי שהוא נראה לעין – גם כשהוא שמור מפוצל. */
export function joinName(name: StoredName): string {
  return `${name.firstName} ${name.lastName}`.trim();
}

/**
 * מה להציג בשדה/בשדות בפתיחת הטופס.
 *
 * במצב "שם מלא" השדה היחיד מקבל את השם המאוחד, גם אם בבסיס הנתונים הוא
 * שמור בשני שדות.
 */
export function nameForForm(mode: NameMode, stored: StoredName): StoredName {
  if (mode === 'full') return { firstName: joinName(stored), lastName: '' };
  return { firstName: stored.firstName, lastName: stored.lastName };
}

/**
 * מה לשמור, לפי מה שהוקלד ומה היה קודם.
 *
 * במצב "שם מלא" השם נכנס כולו ל-`firstName`. אבל אם המשתמש **לא נגע בשם**
 * – פתח את החבר כדי לעדכן טלפון – הפיצול הקיים נשמר: עריכת טלפון אינה
 * אמורה למזג שם שאיש לא ביקש למזג, ומיזוג אינו ניתן לביטול אוטומטי.
 */
export function nameForSave(
  mode: NameMode,
  typed: StoredName,
  original: StoredName | null,
): StoredName {
  const firstName = typed.firstName.trim();
  const lastName = typed.lastName.trim();
  if (mode !== 'full') return { firstName, lastName };
  if (original !== null && firstName === joinName(original)) return original;
  return { firstName, lastName: '' };
}

/**
 * האם השם מלא מספיק כדי לשמור.
 *
 * במצב "נפרד" שני השדות חובה – אבל **לא** לחבר שנשמר בעבר כשם מלא אחד.
 * בית כנסת שעובר משם מלא לניהול נפרד ממשיך להשתמש בשם שכבר קיים, ומפצל
 * אותו כשנוח לו. עדכון טלפון אינו אמור לחייב פיצול שם.
 */
export function nameIsComplete(
  mode: NameMode,
  typed: StoredName,
  original: StoredName | null = null,
): boolean {
  if (typed.firstName.trim() === '') return false;
  if (mode === 'full' || typed.lastName.trim() !== '') return true;
  return original !== null && original.lastName.trim() === '';
}
