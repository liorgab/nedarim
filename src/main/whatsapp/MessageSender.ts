import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { nowIso } from '@shared/datetime';
import {
  INVALID_NUMBER_DIALOG,
  INVALID_NUMBER_TEXTS,
  MESSAGE_INPUT,
  MESSAGE_STATUS_ICON,
  OUTGOING_BUBBLE,
  PENDING_STATUS_ICONS,
  QR_CANVAS,
  SEND_BUTTON,
  STALE_TEXTS,
  bodyContainsExpression,
  existsExpression,
  firstMatchExpression,
  sendUrl,
} from './selectors';
import {
  decideVerify,
  decideWait,
  errorText,
  type SendOutcome,
  type SendProbe,
  type VerifyProbe,
} from './sendOutcome';

/**
 * W-60..W-66 – שליחת הודעה אחת.
 *
 * האלגוריתם (SPEC §4.6): ניווט ל-`/send?phone=&text=` → המתנה לתיבת הכתיבה
 * → Enter דרך `sendInputEvent` → אימות שהבועה יצאה.
 *
 * **למה Enter ולא לחיצה על כפתור השליחה:** ה-selector של הכפתור משתנה
 * לעיתים קרובות יותר מהתנהגות המקלדת, ו-`sendInputEvent` עובד ברמת
 * Chromium ולא תלוי ב-DOM בכלל. אבל Enter דורש שתיבת הכתיבה תהיה ממוקדת
 * ב-DOM – `webContents.focus()` לבדו ממקד את החלון ולא את התיבה, וההודעה
 * נשארת מוקלדת ולא נשלחת. לכן: מיקוד מפורש, ואם אחרי 4 שניות ההודעה עדיין
 * לא יצאה – לחיצה על הכפתור כגיבוי.
 *
 * כל ההחלטות ("מה קרה") ב-`sendOutcome.ts` – פונקציות טהורות עם בדיקות.
 * כאן נשארת רק האינטראקציה עם החלון.
 */

const WAIT_FOR_INPUT_MS = 25_000;
const WAIT_FOR_VERIFY_MS = 15_000;
/** מתי לעבור מ-Enter ללחיצה על כפתור השליחה. */
const FALLBACK_AFTER_MS = 4_000;
const POLL_MS = 500;

export interface SendRequest {
  phoneE164: string;
  text: string;
}

export interface SendContext {
  window: BrowserWindow;
  userDataDir: string;
  /** מאפשר לבדיקות להריץ בלי המתנות אמיתיות. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** דגימה אחת בזמן ההמתנה לתיבת הכתיבה. */
async function probeSend(win: BrowserWindow): Promise<SendProbe> {
  const expression = `(() => ({
    hasInput: ${existsExpression(MESSAGE_INPUT)},
    hasInvalidNumberDialog: ${existsExpression(INVALID_NUMBER_DIALOG)} && ${bodyContainsExpression(INVALID_NUMBER_TEXTS)},
    hasQr: ${existsExpression(QR_CANVAS)},
    hasStaleText: ${bodyContainsExpression(STALE_TEXTS)},
  }))()`;
  try {
    return (await win.webContents.executeJavaScript(expression, true)) as SendProbe;
  } catch {
    // הדף באמצע ניווט – נדגום שוב.
    return {
      hasInput: false,
      hasInvalidNumberDialog: false,
      hasQr: false,
      hasStaleText: false,
    };
  }
}

/**
 * מחפש את הבועה האחרונה בשיחה ובודק אם הטקסט שלה תואם למה ששלחנו.
 *
 * ההשוואה היא על 40 התווים הראשונים ולא על הטקסט המלא: WhatsApp מוסיף
 * רווחים, מקצר הודעות ארוכות ומעצב `*מודגש*`, ולכן השוואה מלאה הייתה
 * נכשלת על הודעות תקינות.
 */
async function probeVerify(win: BrowserWindow, text: string): Promise<VerifyProbe> {
  const needle = text.replace(/[*_~]/g, '').trim().slice(0, 40);
  const expression = `(() => {
    const bubbles = ${JSON.stringify(OUTGOING_BUBBLE.selectors)}
      .flatMap((s) => [...document.querySelectorAll(s)]);
    const needle = ${JSON.stringify(needle)};
    const last = bubbles.reverse().find((el) => (el.innerText || '').replace(/[*_~]/g, '').includes(needle));
    if (!last) return { hasMatchingBubble: false, statusIcon: null, isPending: false };
    const icons = ${JSON.stringify(MESSAGE_STATUS_ICON.selectors)}
      .flatMap((s) => [...last.querySelectorAll(s)])
      .map((el) => el.getAttribute('data-icon'))
      .filter((v) => v !== null);
    const icon = icons.length > 0 ? icons[icons.length - 1] : null;
    return {
      hasMatchingBubble: true,
      statusIcon: icon,
      isPending: icon !== null && ${JSON.stringify(PENDING_STATUS_ICONS)}.some((p) => icon.includes(p)),
    };
  })()`;
  try {
    return (await win.webContents.executeJavaScript(expression, true)) as VerifyProbe;
  } catch {
    return { hasMatchingBubble: false, statusIcon: null, isPending: false };
  }
}

/**
 * ממקד את תיבת הכתיבה עצמה.
 *
 * `contenteditable` אינו מקבל מיקוד מ-`webContents.focus()`, ובלי מיקוד
 * ה-Enter שנשלח ב-`sendInputEvent` פשוט לא מגיע ליעד: ההודעה נשארת מוקלדת
 * בתיבה ולא נשלחת. הקליק הסינתטי לפני ה-focus נדרש כי WhatsApp מאזין גם
 * לאירועי עכבר כדי לסמן את התיבה כפעילה.
 */
async function focusComposeBox(win: BrowserWindow): Promise<boolean> {
  const expression = `(() => {
    const el = ${firstMatchExpression(MESSAGE_INPUT)};
    if (!el) return false;
    el.click();
    el.focus();
    // ממקמים את הסמן בסוף הטקסט שכבר בתיבה.
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return document.activeElement === el;
  })()`;
  try {
    return (await win.webContents.executeJavaScript(expression, true)) as boolean;
  } catch {
    return false;
  }
}

/** גיבוי ל-Enter: לחיצה על כפתור השליחה. */
async function clickSendButton(win: BrowserWindow): Promise<boolean> {
  const expression = `(() => {
    const el = ${firstMatchExpression(SEND_BUTTON)};
    if (!el) return false;
    // ה-selector עשוי להחזיר את האייקון ולא את הכפתור עצמו.
    const button = el.closest('button') || el;
    button.click();
    return true;
  })()`;
  try {
    return (await win.webContents.executeJavaScript(expression, true)) as boolean;
  } catch {
    return false;
  }
}

/**
 * W-66 – צילום מסך כשאף selector לא נמצא. זה מה שמאפשר לתקן את
 * `selectors.ts` בלי לשחזר את התקלה.
 */
async function captureFailure(win: BrowserWindow, userDataDir: string, tag: string): Promise<void> {
  try {
    const dir = join(userDataDir, 'logs', 'whatsapp');
    mkdirSync(dir, { recursive: true });
    const name = `${nowIso().replace(/[:T]/g, '-')}-${tag}.png`;
    const image = await win.webContents.capturePage();
    await writeFile(join(dir, name), image.toPNG());
  } catch {
    // צילום שנכשל לא אמור להפיל את השליחה.
  }
}

/**
 * שולח הודעה אחת ומחזיר תוצאה מוקלדת. **אינו** נוגע ב-DB ואינו מעדכן
 * מונים – זו אחריות המתקשר, כדי שהפונקציה תישאר בדיקה אחת לכל דבר.
 */
export async function sendOne(request: SendRequest, context: SendContext): Promise<SendOutcome> {
  const { window: win, userDataDir } = context;
  const sleep = context.sleep ?? defaultSleep;
  const now = context.now ?? Date.now;

  if (win.isDestroyed()) {
    return { ok: false, errorCode: 'not_connected', errorMessage: errorText('not_connected') };
  }

  // שלב 3 – ניווט. לא ממתינים ל-`loadURL`: WhatsApp Web ממשיך לטעון
  // משאבים ברקע והבטחה הזו עלולה לא להיפתר כלל.
  void win.webContents.loadURL(sendUrl(request.phoneE164, request.text)).catch(() => undefined);

  // שלב 4 – המתנה לתיבת הכתיבה, או לאחד הכישלונות המזוהים.
  const inputDeadline = now() + WAIT_FOR_INPUT_MS;
  let ready = false;
  while (now() < inputDeadline) {
    await sleep(POLL_MS);
    if (win.isDestroyed()) {
      return { ok: false, errorCode: 'not_connected', errorMessage: errorText('not_connected') };
    }
    const decision = decideWait(await probeSend(win));
    if (decision.kind === 'failed') {
      return {
        ok: false,
        errorCode: decision.errorCode,
        errorMessage: decision.errorMessage,
      };
    }
    if (decision.kind === 'ready') {
      ready = true;
      break;
    }
  }

  if (!ready) {
    // לא נמצאה תיבת כתיבה ולא זוהה כישלון מוכר – סימן מובהק לכך
    // ש-WhatsApp שינה את ה-DOM.
    await captureFailure(win, userDataDir, 'no-input');
    return { ok: false, errorCode: 'selector', errorMessage: errorText('selector') };
  }

  // שלב 5 – Enter.
  //
  // `webContents.focus()` לבדו אינו מספיק: הוא ממקד את **החלון**, בעוד
  // שתיבת הכתיבה היא `contenteditable` שצריכה מיקוד DOM משלה. בלי המיקוד
  // המפורש ההודעה מודבקת בתיבה ונשארת שם – בדיוק מה שנצפה בבדיקה הראשונה.
  win.webContents.focus();
  await focusComposeBox(win);

  // בלי אירוע `char`: ב-`contenteditable` הוא מכניס שורה חדשה במקום לשלוח.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });

  // שלב 6 – אימות שהבועה יצאה.
  //
  // אם אחרי `FALLBACK_AFTER_MS` ההודעה עדיין לא יצאה, לוחצים על כפתור
  // השליחה. Enter הוא הדרך המועדפת (פחות תלוי ב-selectors), אבל כשהוא
  // נכשל עדיף ללחוץ מאשר להיכשל – ההודעה כבר מוקלדת בתיבה.
  const verifyDeadline = now() + WAIT_FOR_VERIFY_MS;
  const fallbackAt = now() + FALLBACK_AFTER_MS;
  let clickedFallback = false;

  while (now() < verifyDeadline) {
    await sleep(POLL_MS);
    if (win.isDestroyed()) {
      return { ok: false, errorCode: 'not_connected', errorMessage: errorText('not_connected') };
    }
    if (decideVerify(await probeVerify(win, request.text)).kind === 'ready') {
      return { ok: true };
    }
    if (!clickedFallback && now() >= fallbackAt) {
      clickedFallback = true;
      await clickSendButton(win);
    }
  }

  // ההודעה אולי נשלחה ואולי לא. `timeout` ולא `sent` – ראו WB-08:
  // עדיף פריט שדורש בדיקה ידנית מאשר פריט שדווח כנשלח ולא נשלח.
  await captureFailure(win, userDataDir, 'verify-timeout');
  return { ok: false, errorCode: 'timeout', errorMessage: errorText('timeout') };
}
