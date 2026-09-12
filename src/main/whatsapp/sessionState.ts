import type { WaState } from '@shared/api';

/**
 * גזירת מצב החיבור מתוך מה שנמצא בדף (W-51).
 *
 * מופרד מ-`SessionMonitor` בכוונה: הדגימה עצמה דורשת `webContents`, אבל
 * **ההחלטה** מה המצב היא פונקציה טהורה של ארבעה בוליאנים – וכך היא נבדקת
 * ב-Vitest בלי Electron ובלי WhatsApp אמיתי.
 */

/** מה שנמדד בדף בכל דגימה. */
export interface PageProbe {
  /** הדף נטען בכלל (יש `document.body`). */
  loaded: boolean;
  /** קיים אלמנט QR. */
  hasQr: boolean;
  /** קיימת רשימת שיחות. */
  hasChatList: boolean;
  /** מופיע טקסט של "פתוח בחלון אחר" / "דפדפן לא נתמך". */
  hasStaleText: boolean;
}

export interface DerivedStatus {
  state: WaState;
  message?: string;
}

/**
 * סדר הבדיקות אינו שרירותי:
 *
 * 1. `stale` **לפני** הכול – המסך הזה מופיע גם כשיש סשן תקף, והוא חוסם
 *    שליחה. אם היינו בודקים אותו אחרון, מצב שבו WhatsApp פתוח גם בכרום
 *    היה מדווח `ready` והשליחה הייתה נכשלת בלי הסבר.
 * 2. `qr` לפני `ready` – בזמן התנתקות שתי הבדיקות עשויות להתקיים לרגע,
 *    ועדיף להציג "סרוק" מאשר לשלוח לחלון שכבר לא מחובר.
 */
export function deriveState(probe: PageProbe, windowOpen: boolean): DerivedStatus {
  if (!windowOpen) {
    return { state: 'disconnected', message: 'חלון WhatsApp סגור' };
  }
  if (!probe.loaded) {
    return { state: 'loading' };
  }
  if (probe.hasStaleText) {
    return {
      state: 'stale',
      message: 'WhatsApp Web פתוח במקום אחר. סגור אותו בדפדפן ולחץ "השתמש כאן" בחלון.',
    };
  }
  if (probe.hasQr) {
    return { state: 'qr', message: 'סרוק את הקוד בטלפון כדי להתחבר' };
  }
  if (probe.hasChatList) {
    return { state: 'ready' };
  }
  // הדף נטען אבל אין בו לא QR ולא רשימת שיחות: או שהוא עדיין נטען, או
  // ש-WhatsApp שינה את ה-DOM ו-`selectors.ts` דורש עדכון.
  return { state: 'loading' };
}

/** האם במצב הזה מותר לשלוח הודעה. */
export function canSend(state: WaState): boolean {
  return state === 'ready';
}

/**
 * הערכת משך קמפיין לפי טווח ההשהיות (שלב 3 באשף).
 *
 * ההודעה הראשונה נשלחת מיד, ולכן יש `n-1` השהיות ולא `n`. לכל הודעה
 * מתווספות כמה שניות של ניווט ואימות – בלעדיהן ההערכה נמוכה מהמציאות
 * בערך פי שניים בקמפיין קצר.
 */
export const SECONDS_PER_MESSAGE = 8;

export function estimateSeconds(
  recipientCount: number,
  minDelaySec: number,
  maxDelaySec: number,
): { minSeconds: number; maxSeconds: number } {
  if (recipientCount <= 0) return { minSeconds: 0, maxSeconds: 0 };
  const gaps = recipientCount - 1;
  const work = recipientCount * SECONDS_PER_MESSAGE;
  return {
    minSeconds: work + gaps * minDelaySec,
    maxSeconds: work + gaps * maxDelaySec,
  };
}

/** ניסוח משך בעברית: "כ-4 דקות", "כ-1 שעה ו-20 דקות". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `כ-${Math.max(1, Math.round(seconds))} שניות`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `כ-${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `כ-${hours} שעות` : `כ-${hours} שעות ו-${rest} דקות`;
}

/**
 * W-56 – חילוץ מספר הטלפון מתוך ה-WID שנשמר ב-localStorage של WhatsApp.
 *
 * הפורמט הוא `"972501234567:39@c.us"` – מספר, נקודתיים, **מזהה מכשיר**,
 * ואז הדומיין. מי שמסיר פשוט כל תו שאינו ספרה מקבל `97250123456739`
 * ומציג לגבאי מספר שאינו שלו. זו לא תקלה תאורטית: היא נצפתה בבדיקה החיה
 * הראשונה עם סשן אמיתי.
 */
export function parseWid(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const withoutQuotes = raw.replace(/"/g, '').trim();
  if (withoutQuotes === '') return null;

  const beforeDomain = withoutQuotes.split('@')[0] ?? '';
  const beforeDevice = beforeDomain.split(':')[0] ?? '';
  const digits = beforeDevice.replace(/\D/g, '');

  // E.164 מגביל ל-15 ספרות; פחות מ-8 אינו מספר טלפון.
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
