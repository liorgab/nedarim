import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * GPLv3 §5 – "Appropriate Legal Notices".
 *
 * הרישיון, הודעות צד שלישי ומדיניות הפרטיות חייבים להיות קריאים **מתוך
 * היישום**, לא רק ב-GitHub. הגבאי שמתקין קובץ אחד לא גולש לרפוזיטורי.
 *
 * המסמכים נקראים מהקבצים עצמם ולא מועתקים ל-`he.ts`: עותק שני בקוד
 * מתיישן בשקט, ודווקא כאן הפער בין מה שכתוב לבין מה שמוצג הוא הבעיה.
 * `electron-builder` אורז אותם (`files` ב-`electron-builder.yml`), ו-
 * `app.getAppPath()` מחזיר את שורש הפרויקט בפיתוח ואת ה-asar באריזה –
 * `readFileSync` עובד על שניהם.
 */

export type LegalDocId = 'license' | 'notices' | 'privacy' | 'changelog';

const FILES: Record<LegalDocId, string> = {
  license: 'LICENSE',
  notices: 'THIRD-PARTY-NOTICES.md',
  privacy: 'PRIVACY.md',
  changelog: 'CHANGELOG.md',
};

export const LEGAL_DOC_IDS: readonly LegalDocId[] = [
  'changelog',
  'privacy',
  'license',
  'notices',
];

export interface LegalDoc {
  id: LegalDocId;
  /** שם הקובץ, כדי שאפשר יהיה למצוא אותו גם מחוץ ליישום. */
  fileName: string;
  text: string;
}

/**
 * קורא מסמך. **לעולם לא זורק**: מסך "אודות" שקורס בגלל קובץ חסר גרוע
 * ממסך שאומר שהקובץ חסר, והמשתמש ממילא לא יכול לתקן את זה.
 */
export function legalDoc(id: LegalDocId): LegalDoc {
  const fileName = FILES[id];
  try {
    return { id, fileName, text: readFileSync(join(app.getAppPath(), fileName), 'utf8') };
  } catch {
    return {
      id,
      fileName,
      text: `הקובץ ${fileName} לא נמצא בהתקנה. הוא זמין ברפוזיטורי של הפרויקט.`,
    };
  }
}
