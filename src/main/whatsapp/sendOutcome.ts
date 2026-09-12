/**
 * W-60..W-66 – התוצאה של ניסיון שליחה אחד.
 *
 * מופרד מ-`MessageSender` באותה סיבה שבגללה `deriveState` הופרד: ההחלטה
 * "מה קרה" היא פונקציה טהורה של מה שנמצא בדף, ולכן היא נבדקת בלי Electron
 * ובלי WhatsApp. הבאג של מזהה המכשיר (W-56) נולד בדיוק מקוד שישב בתוך
 * מחרוזת מוזרקת ולכן לא נבדק – זה לא יחזור כאן.
 */

/** קודי השגיאה. מיפוי לעברית ב-`errorText`, במקום אחד (SPEC §6). */
export type SendErrorCode =
  | 'invalid_number'
  | 'not_on_whatsapp'
  | 'timeout'
  | 'not_connected'
  | 'selector'
  | 'daily_cap'
  | 'cancelled';

export type SendOutcome =
  { ok: true } | { ok: false; errorCode: SendErrorCode; errorMessage: string };

/** מה שנמדד בדף בזמן ההמתנה אחרי הניווט (שלב 4 באלגוריתם). */
export interface SendProbe {
  /** תיבת הכתיבה נמצאה. */
  hasInput: boolean;
  /** מוצג הדיאלוג "המספר אינו ב-WhatsApp". */
  hasInvalidNumberDialog: boolean;
  /** חזרנו למסך QR – הסשן נותק באמצע. */
  hasQr: boolean;
  /** מסך "פתוח בחלון אחר". */
  hasStaleText: boolean;
}

/**
 * מה לעשות אחרי דגימה אחת בזמן ההמתנה.
 *
 * `wait` פירושו "עוד לא ברור, לדגום שוב"; רק כשנגמר הזמן זה הופך ל-`timeout`.
 */
export type WaitDecision =
  | { kind: 'ready' }
  | { kind: 'wait' }
  | { kind: 'failed'; errorCode: SendErrorCode; errorMessage: string };

/**
 * סדר הבדיקות: קודם הכישלונות הוודאיים, ורק אחר כך ההצלחה.
 *
 * הדיאלוג "המספר אינו ב-WhatsApp" מופיע **מעל** מסך שיש בו תיבת כתיבה.
 * בדיקת `hasInput` ראשונה הייתה מדווחת הצלחה ואז שולחת Enter לדיאלוג –
 * ההודעה לא נשלחת, והפריט מסומן `sent` בטעות. שליחה שדווחה בטעות כמוצלחת
 * גרועה יותר מכישלון, כי איש לא יחזור אליה.
 */
export function decideWait(probe: SendProbe): WaitDecision {
  if (probe.hasInvalidNumberDialog) {
    return {
      kind: 'failed',
      errorCode: 'not_on_whatsapp',
      errorMessage: 'המספר אינו רשום ב-WhatsApp',
    };
  }
  if (probe.hasStaleText) {
    return {
      kind: 'failed',
      errorCode: 'not_connected',
      errorMessage: 'WhatsApp Web נפתח במקום אחר',
    };
  }
  if (probe.hasQr) {
    return {
      kind: 'failed',
      errorCode: 'not_connected',
      errorMessage: 'החיבור נותק באמצע השליחה',
    };
  }
  if (probe.hasInput) {
    return { kind: 'ready' };
  }
  return { kind: 'wait' };
}

/** מה שנמדד אחרי לחיצת Enter (שלב 6 – אימות). */
export interface VerifyProbe {
  /** נמצאה בועה יוצאת שהטקסט שלה תואם למה ששלחנו. */
  hasMatchingBubble: boolean;
  /**
   * אייקון הסטאטוס של אותה בועה. `null` = לא נמצא אייקון בכלל.
   * "שעון" פירושו שההודעה עדיין לא הגיעה לשרת.
   */
  statusIcon: string | null;
  /** האם האייקון הוא אחד מ"ממתין". */
  isPending: boolean;
}

/**
 * ✓ אחד מספיק – ההודעה הגיעה לשרת של WhatsApp. אין טעם להמתין ל-✓✓
 * (נמסר למכשיר) כי הוא תלוי בכך שהנמען מחובר, ובקמפיין של 90 הודעות
 * זו המתנה שלא תיגמר.
 */
export function decideVerify(probe: VerifyProbe): WaitDecision {
  if (!probe.hasMatchingBubble) return { kind: 'wait' };
  if (probe.isPending) return { kind: 'wait' };
  if (probe.statusIcon === null) return { kind: 'wait' };
  return { kind: 'ready' };
}

/** מיפוי יחיד של קוד שגיאה לעברית ידידותית (SPEC §6 – שפה). */
const ERROR_TEXT: Record<SendErrorCode, string> = {
  invalid_number: 'מספר הטלפון אינו תקין',
  not_on_whatsapp: 'המספר אינו רשום ב-WhatsApp',
  timeout: 'השליחה לא הסתיימה בזמן',
  not_connected: 'אין חיבור ל-WhatsApp',
  selector: 'WhatsApp השתנה – יש לעדכן את המערכת',
  daily_cap: 'הגעת למכסה היומית',
  cancelled: 'הקמפיין בוטל',
};

export function errorText(code: SendErrorCode): string {
  return ERROR_TEXT[code];
}

/** כשלים שניתן לנסות שוב (W-46). מספר שאינו ב-WhatsApp לא ישתנה מניסיון נוסף. */
const RETRYABLE: ReadonlySet<SendErrorCode> = new Set<SendErrorCode>([
  'timeout',
  'not_connected',
  'selector',
  'daily_cap',
  'cancelled',
]);

export function isRetryable(code: SendErrorCode): boolean {
  return RETRYABLE.has(code);
}
