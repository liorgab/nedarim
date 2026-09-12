import type { IsoDate } from './types';

/**
 * חותמות זמן במערכת.
 *
 * **הכול בשעון המקומי של המחשב, לא ב-UTC.**
 *
 * `new Date().toISOString()` מחזיר UTC, וישראל היא UTC+2/+3. בית הכנסת עובד
 * במחשב אחד ובאזור זמן אחד, ולכן חותמת UTC לא נותנת שום יתרון – אבל היא כן
 * גורמת לשני נזקים:
 *
 * 1. **תצוגה שקרית.** יומן הביקורת והקבלות מציגים את החותמת כמו שהיא, כך
 *    שפעולה שנעשתה ב-14:05 מוצגת כ-11:05.
 * 2. **תאריך שונה מהתאריך העסקי.** `payment_date` נקבע לפי היום המקומי; קבלה
 *    שהופקה ב-01:00 בלילה הייתה מקבלת `issued_at` של היום הקודם.
 *
 * לכן כל חותמת נכתבת בפורמט `YYYY-MM-DDTHH:mm:ss` **מקומי**, בלי אזור זמן –
 * בדיוק כמו שהתאריכים במערכת הם `YYYY-MM-DD` מקומי (CLAUDE.md כלל 2).
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** התאריך של היום, מקומי. */
export function todayIso(date = new Date()): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** חותמת זמן מלאה, מקומית: `YYYY-MM-DDTHH:mm:ss`. */
export function nowIso(date = new Date()): string {
  return `${todayIso(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
