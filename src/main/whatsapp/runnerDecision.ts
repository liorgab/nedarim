import type { SendErrorCode } from './sendOutcome';

/**
 * W3 / WB-07, WB-08, W-45 – **ההחלטה** של מנוע הקמפיין, בלי ה-I/O.
 *
 * מנוע קמפיין הוא לולאה שמערבבת המתנות, שליחות, ניתוקים ולחיצות משתמש.
 * לולאה כזו כמעט בלתי אפשרית לבדוק כשההחלטה מעורבבת עם `await sleep()`
 * ועם קריאות ל-DB. לכן ההחלטה יושבת כאן כפונקציה טהורה: היא מקבלת תמונת
 * מצב ומחזירה את הצעד הבא, ו-`CampaignRunner` רק מבצע.
 *
 * זה אותו דפוס כמו `deriveState`, `decideNotify` ו-`decideRowAction`.
 */

export type RunnerPhase = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';

/** למה הקמפיין נעצר – כל אחד מהם דורש הודעה אחרת למשתמש. */
export type StopReason =
  /** המשתמש לחץ "השהה". */
  | 'user_pause'
  /** המשתמש לחץ "בטל". */
  | 'user_cancel'
  /** המכסה היומית נגמרה (WB-07). */
  | 'daily_cap'
  /** שלושה כשלים רצופים – סימן מובהק לבעיה שיטתית (WB-07). */
  | 'consecutive_failures'
  /** החיבור ל-WhatsApp נותק באמצע (W-45). */
  | 'disconnected';

/**
 * מה שהמנוע עושה בצעד הבא.
 *
 * `wait` ו-`send` מופרדים בכוונה: ההמתנה היא מצב שהמשתמש רואה ("ממתין 14
 * שנ'…") ושאפשר לעצור באמצעו, ולא תופעת לוואי שקופה בתוך השליחה.
 */
export type RunnerStep =
  | { kind: 'send'; itemId: number }
  | { kind: 'wait'; seconds: number; nextItemId: number }
  | { kind: 'stop'; reason: StopReason }
  | { kind: 'done' };

export interface RunnerInput {
  /** מה המשתמש ביקש: להמשיך, להשהות או לבטל. */
  request: 'run' | 'pause' | 'cancel';
  /** הפריט הממתין הבא, או `null` כשאין עוד. */
  nextItemId: number | null;
  /** כמה כשלים ברצף עד כה. */
  consecutiveFailures: number;
  /** כמה הודעות נותרו במכסה היומית. */
  quotaRemaining: number;
  /** האם החיבור ל-WhatsApp פעיל כרגע. */
  connected: boolean;
  /**
   * כמה ניסיונות שליחה נעשו מאז שהמנוע התחיל לרוץ. `0` = ההודעה הראשונה,
   * שיוצאת בלי המתנה.
   *
   * נספרים ניסיונות ולא הצלחות: ההשהיה היא בין פעולות מול WhatsApp, וגם
   * ניסיון שנכשל היה פעולה כזו.
   */
  attemptsSinceStart: number;
  /**
   * ההמתנה לצעד הזה כבר הושלמה.
   *
   * בלי זה ההחלטה הייתה מחזירה `wait` שוב ושוב אחרי כל המתנה – לולאה
   * אינסופית שבה שום הודעה אינה יוצאת. הדגל מגיע מבחוץ ולא נשמר כאן, כדי
   * שההחלטה תישאר טהורה **וכדי שהתנאים ייבדקו מחדש אחרי ההמתנה**: טלפון
   * שהתנתק בזמן ספירה לאחור של 20 שניות חייב לעצור, ולא לשלוח.
   */
  waitCompleted: boolean;
  /** ההשהיה שהוגרלה לצעד הזה, בשניות. */
  delaySeconds: number;
  /**
   * כמה כשלים רצופים עוצרים את הקמפיין. מגיע מההגדרה
   * `whatsapp_stop_after_consecutive_failures` ולא מקבוע בקוד (כלל 12):
   * בית כנסת עם רשימה בעייתית ירצה סף אחר.
   */
  failureThreshold: number;
}

/** ברירת המחדל של ההגדרה (WB-07) – לשימוש כשהערך חסר או פסול. */
export const DEFAULT_FAILURE_THRESHOLD = 3;

/**
 * מחליט מה לעשות עכשיו.
 *
 * **סדר הבדיקות הוא ההתנהגות.** בקשת המשתמש קודמת לכול: גבאי שלחץ "בטל"
 * אינו אמור לראות עוד הודעה יוצאת רק מפני שהמכסה עדיין מאפשרת. אחריה
 * באות העצירות האוטומטיות, ורק בסוף – "יש עוד עבודה".
 *
 * `done` מגיע לפני עצירות המכסה והכשלים בכוונה: קמפיין שהפריט האחרון בו
 * נכשל הסתיים, ואין טעם לדווח עליו "נעצר עקב כשלים" כשלא נשאר מה לשלוח.
 */
export function decideStep(input: RunnerInput): RunnerStep {
  if (input.request === 'cancel') return { kind: 'stop', reason: 'user_cancel' };
  if (input.nextItemId === null) return { kind: 'done' };
  if (input.request === 'pause') return { kind: 'stop', reason: 'user_pause' };

  if (!input.connected) return { kind: 'stop', reason: 'disconnected' };
  if (input.quotaRemaining <= 0) return { kind: 'stop', reason: 'daily_cap' };
  // סף אפס או שלילי פירושו "בלי עצירה אוטומטית", ולא "עצור מיד".
  if (input.failureThreshold > 0 && input.consecutiveFailures >= input.failureThreshold) {
    return { kind: 'stop', reason: 'consecutive_failures' };
  }

  // אין המתנה לפני ההודעה הראשונה: היא רק מרגישה כמו תקלה.
  if (input.attemptsSinceStart === 0 || input.waitCompleted) {
    return { kind: 'send', itemId: input.nextItemId };
  }
  return { kind: 'wait', seconds: input.delaySeconds, nextItemId: input.nextItemId };
}

/**
 * ההשהיה בין הודעות (WB-07).
 *
 * אקראית בטווח שהוגדר, ולא קבועה: רצף הודעות במרווחים זהים לשנייה הוא
 * החתימה הברורה ביותר של שליחה אוטומטית.
 *
 * `random` מוזרק כדי שהבדיקה תהיה דטרמיניסטית.
 */
export function pickDelaySeconds(
  minSeconds: number,
  maxSeconds: number,
  random: () => number = Math.random,
): number {
  const low = Math.max(0, Math.floor(Math.min(minSeconds, maxSeconds)));
  const high = Math.max(low, Math.floor(Math.max(minSeconds, maxSeconds)));
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * הפאזה שאליה עובר הקמפיין כשהמנוע עוצר.
 *
 * ביטול הוא סופי; כל השאר ניתנים להמשך, ולכן `paused` ולא `cancelled` –
 * ההבדל הוא בין קמפיין שאפשר להמשיך אחרי שסורקים מחדש לבין קמפיין שמת.
 */
export function phaseForStop(reason: StopReason): RunnerPhase {
  return reason === 'user_cancel' ? 'cancelled' : 'paused';
}

/** האם הכישלון הזה נספר כ"כשל רצוף" (WB-07). */
export function countsAsFailure(code: SendErrorCode): boolean {
  // מספר שאינו ב-WhatsApp אינו תקלה במנגנון אלא עובדה על החבר. שלושה
  // כאלה ברצף ברשימה ממוינת לפי שם הם צירוף מקרים, ועצירת הקמפיין בגללם
  // הופכת את ההגנה למטרד.
  return code !== 'not_on_whatsapp' && code !== 'invalid_number';
}

/**
 * האם כשל כזה ניתן לניסיון חוזר (W-46).
 *
 * "נסה שוב כשלים" יוצר קמפיין המשך רק מאלה: ניסיון חוזר למספר שאינו
 * ב-WhatsApp ייכשל שוב בדיוק באותו אופן.
 */
export function isRetryable(code: SendErrorCode): boolean {
  return code === 'timeout' || code === 'selector' || code === 'not_connected';
}

/**
 * הודעה בעברית לכל סיבת עצירה – מוצגת במודאל ההתקדמות.
 *
 * סף הכשלים מגיע כפרמטר ולא כתוב במחרוזת: ההודעה חייבת לומר את המספר
 * שנקבע בהגדרות, ולא "שלוש" כשהגבאי קבע חמש.
 */
export function stopText(reason: StopReason, failureThreshold = DEFAULT_FAILURE_THRESHOLD): string {
  switch (reason) {
    case 'user_pause':
      return 'הקמפיין מושהה. אפשר להמשיך מהנקודה הזו.';
    case 'user_cancel':
      return 'הקמפיין בוטל. הפריטים שטרם נשלחו סומנו כמבוטלים.';
    case 'daily_cap':
      return 'המכסה היומית נוצלה. אפשר להמשיך מחר, או להגדיל את המכסה בהגדרות.';
    case 'consecutive_failures':
      return `${failureThreshold} הודעות נכשלו ברצף והקמפיין נעצר. כדאי לבדוק את החיבור לפני שממשיכים.`;
    case 'disconnected':
      return 'החיבור לוואטסאפ נותק – יש לסרוק מחדש ואז להמשיך.';
  }
}
