/**
 * WB-06 – **כל** ה-selectors של WhatsApp Web, במקום אחד.
 *
 * WhatsApp משנה את ה-DOM שלו כל כמה שבועות בלי הודעה. הריכוז כאן הוא ההגנה:
 * כשמשהו נשבר, התיקון הוא בקובץ הזה בלבד ולא בלוגיקה. selector שכתוב בקובץ
 * אחר הוא באג – גם אם הוא עובד.
 *
 * לכל אלמנט **מערך** של selectors שנבדקים לפי הסדר, מהיציב לשביר:
 *   1. `data-testid` – מה ש-WhatsApp עצמו משתמש בו לבדיקות; הכי יציב.
 *   2. `aria-label` – משתנה עם שפת הממשק, ולכן מופיע בכמה שפות.
 *   3. מבנה DOM – הכי שביר, ולכן אחרון.
 *
 * לפני כל release יש להריץ את בדיקת העשן ולעדכן את התאריך למטה.
 */

/** התאריך שבו ה-selectors נבדקו מול WhatsApp Web אמיתי. */
export const SELECTORS_VERIFIED_ON = '2026-09-09';

/** גרסת ה-UA שנשלחת ל-WhatsApp Web (WB-04). מתעדכנת עם Electron. */
export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const WHATSAPP_URL = 'https://web.whatsapp.com';

/** בונה כתובת שליחה ישירה (WB-03). */
export function sendUrl(phoneE164: string, text: string): string {
  return `${WHATSAPP_URL}/send?phone=${encodeURIComponent(phoneE164)}&text=${encodeURIComponent(text)}`;
}

export interface SelectorGroup {
  /** תיאור לצורכי לוג ושגיאות, בעברית. */
  label: string;
  selectors: readonly string[];
}

/**
 * מסך ה-QR. קיים רק כשאין סשן.
 *
 * **אומת מול WhatsApp Web אמיתי ב-2026-09-06.** ה-testid ההיסטורי
 * `qrcode`, שמופיע כמעט בכל מדריך ברשת ובאיפיון המקורי, **כבר אינו קיים** –
 * הוא הוחלף ב-`link-device-qr-code`. בלי התיקון הזה המערכת מדווחת `loading`
 * לנצח מול מסך QR תקין לגמרי. הישן נשאר ברשימה כגיבוי לגרסאות ישנות.
 */
export const QR_CANVAS: SelectorGroup = {
  label: 'קוד QR',
  selectors: [
    '[data-testid="link-device-qr-code"]',
    '[data-testid="link-device-qrcode-alt-linking-tc"]',
    '[data-testid="qrcode"]',
    'canvas[aria-label*="Scan this QR code"]',
    'canvas[aria-label*="Scan"]',
    'canvas[aria-label*="סרוק"]',
    'div[data-ref] canvas',
  ],
};

/**
 * רשימת השיחות. הסימן הבטוח ביותר לכך שיש סשן פעיל.
 *
 * **אומת מול סשן מחובר ב-2026-09-07**: אחרי סריקת QR בטלפון אמיתי המצב
 * עבר ל-`ready` – כלומר אחד מה-selectors כאן נמצא בפועל.
 */
export const CHAT_LIST: SelectorGroup = {
  label: 'רשימת שיחות',
  selectors: [
    '[data-testid="chat-list"]',
    '#pane-side',
    'div[aria-label="Chat list"]',
    'div[aria-label="רשימת צ׳אטים"]',
    'div[aria-label="רשימת צ\'אטים"]',
  ],
};

/**
 * תיבת הכתיבה של ההודעה. `contenteditable`, לא `<input>` – ולכן לא ניתן
 * לקרוא את הערך דרך `.value`, וגם לא למקד אותה דרך `webContents.focus()`.
 *
 * **אומת בשליחה אמיתית ב-2026-09-09.**
 */
export const MESSAGE_INPUT: SelectorGroup = {
  label: 'תיבת כתיבת ההודעה',
  selectors: [
    '[data-testid="conversation-compose-box-input"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][data-tab="6"]',
  ],
};

/** כפתור השליחה. משמש כגיבוי בלבד – השליחה עצמה היא Enter (W-60). */
export const SEND_BUTTON: SelectorGroup = {
  label: 'כפתור שליחה',
  selectors: [
    '[data-testid="send"]',
    'button[aria-label="Send"]',
    'button[aria-label="שלח"]',
    'span[data-icon="send"]',
  ],
};

/**
 * הדיאלוג "המספר אינו ב-WhatsApp". מזוהה גם לפי טקסט, כי ה-testid שלו
 * השתנה בעבר.
 */
export const INVALID_NUMBER_DIALOG: SelectorGroup = {
  label: 'הודעת מספר לא קיים',
  selectors: [
    '[data-testid="popup-controls-ok"]',
    'div[data-animate-modal-body="true"]',
    'div[role="dialog"]',
  ],
};

/** טקסטים שמופיעים בדיאלוג הזה, בעברית ובאנגלית. */
export const INVALID_NUMBER_TEXTS: readonly string[] = [
  'Phone number shared via url is invalid',
  'phone number shared via url is invalid',
  'מספר הטלפון ששותף באמצעות כתובת ה-URL אינו תקין',
  'אינו נמצא ב-WhatsApp',
  'is not on WhatsApp',
];

/**
 * הבועות בשיחה. משמש לאימות שההודעה נשלחה (W-60 שלב 6).
 *
 * **אומת בשליחה אמיתית ב-2026-09-09**: הבועה זוהתה והאימות עבר.
 */
export const OUTGOING_BUBBLE: SelectorGroup = {
  label: 'בועת הודעה יוצאת',
  selectors: ['div.message-out', '[data-testid="msg-container"]', 'div[data-id$="_true"]'],
};

/**
 * אייקון סטאטוס ההודעה. "שעון" = טרם נשלחה לשרת; ✓ אחד ומעלה = נשלחה.
 */
export const MESSAGE_STATUS_ICON: SelectorGroup = {
  label: 'סטאטוס הודעה',
  selectors: ['span[data-icon]', '[data-testid="status-icon"]'],
};

/** ערכי `data-icon` שמשמעותם "עדיין לא נשלח". */
export const PENDING_STATUS_ICONS: readonly string[] = ['msg-time', 'status-time'];

/** ערכי `data-icon` שמשמעותם "הגיע לשרת ומעלה". */
export const SENT_STATUS_ICONS: readonly string[] = [
  'msg-check',
  'msg-dblcheck',
  'status-check',
  'status-dblcheck',
];

/**
 * מסך "WhatsApp פתוח בחלון אחר" / "עדכן את Chrome" – מצב `stale` (W-51).
 */
export const STALE_TEXTS: readonly string[] = [
  'WhatsApp is open in another window',
  'WhatsApp פתוח בחלון אחר',
  'Use here',
  'השתמש כאן',
  'update Chrome',
  'Your browser is not supported',
  'הדפדפן שלך אינו נתמך',
];

/**
 * בונה ביטוי JS שמחזיר את האלמנט הראשון שנמצא מתוך הקבוצה, או null.
 * מוזרק ל-`executeJavaScript`, ולכן חייב להיות ביטוי יחיד.
 */
export function firstMatchExpression(group: SelectorGroup): string {
  const list = JSON.stringify(group.selectors);
  return `(${list}.map((s) => document.querySelector(s)).find((el) => el !== null) ?? null)`;
}

/** האם קיים אלמנט כלשהו מהקבוצה. */
export function existsExpression(group: SelectorGroup): string {
  const list = JSON.stringify(group.selectors);
  return `${list}.some((s) => document.querySelector(s) !== null)`;
}

/** האם טקסט כלשהו מהרשימה מופיע בגוף העמוד. */
export function bodyContainsExpression(texts: readonly string[]): string {
  const list = JSON.stringify(texts);
  return `(() => { const t = document.body ? document.body.innerText : ''; return ${list}.some((s) => t.includes(s)); })()`;
}
