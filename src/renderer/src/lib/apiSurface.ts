import { IPC_CHANNELS, type IpcChannel } from '@shared/api';

/**
 * בדיקה שה-`window.api` שנחשף ב-preload תואם לחוזה שה-renderer מכיר.
 *
 * למה זה נדרש: ב-`electron-vite dev` ה-renderer מתרענן בחם, אבל ה-preload
 * נטען פעם אחת בלבד בפתיחת החלון. אחרי הוספת ערוץ, האפליקציה שכבר רצה
 * ממשיכה עם ה-preload הישן – והתקלה מתגלה רק כשמישהו לוחץ על הכפתור
 * החדש ומקבל `... is not a function` באמצע דיאלוג.
 *
 * הבדיקה נגזרת מ-`IPC_CHANNELS` עצמו ולא מרשימה ידנית, ולכן היא לא יכולה
 * להתיישן: כל ערוץ `ns:fn` מחייב ש-`window.api[ns][fn]` תהיה פונקציה.
 */

export interface ApiSurfaceCheck {
  ok: boolean;
  /** שמות הערוצים שחסרים ב-`window.api`. */
  missing: string[];
}

// ה-API מועבר במפורש ולא כברירת מחדל `window.api`: ערך ברירת מחדל היה
// נכנס לפעולה גם כשמעבירים `undefined` בכוונה, ואז אי אפשר לבדוק את המקרה
// שבו אין API בכלל.
export function verifyApiSurface(api: unknown): ApiSurfaceCheck {
  const missing: string[] = [];
  const root = api as Record<string, Record<string, unknown> | undefined> | undefined;

  if (root === undefined || root === null) {
    return { ok: false, missing: ['window.api'] };
  }

  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    const [namespace, fn] = channel.split(':');
    if (namespace === undefined || fn === undefined) continue;
    const group = root[namespace];
    if (group === undefined || typeof group[fn] !== 'function') {
      missing.push(channel);
    }
  }

  return { ok: missing.length === 0, missing };
}
