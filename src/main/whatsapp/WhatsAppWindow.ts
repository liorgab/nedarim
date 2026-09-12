import { BrowserWindow, session, shell } from 'electron';
import type { WaStatusDto } from '@shared/api';
import { nowIso } from '@shared/datetime';
import {
  CHAT_LIST,
  CHROME_USER_AGENT,
  QR_CANVAS,
  STALE_TEXTS,
  WHATSAPP_URL,
  bodyContainsExpression,
  existsExpression,
} from './selectors';
import { deriveState, parseWid, type PageProbe } from './sessionState';

/**
 * W-50, WB-01/04/05 – חלון WhatsApp Web ייעודי.
 *
 * החלון **גלוי בכוונה**: הגבאי רואה את ה-QR, רואה את ההודעות נשלחות, ויכול
 * להתערב. חלון נסתר היה הופך את המודול לקופסה שחורה שאי אפשר לאבחן כשהיא
 * נתקעת.
 *
 * הסשן יושב ב-partition נפרד (`persist:whatsapp`) בתוך `userData`, ולכן הוא
 * שורד הפעלות ואינו מתערבב עם ה-session של היישום.
 */

const PARTITION = 'persist:whatsapp';
const POLL_INTERVAL_MS = 2000;

let win: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastStatus: WaStatusDto = {
  state: 'disconnected',
  phone: null,
  since: nowIso(),
  windowOpen: false,
};

/** מנויים לשינויי מצב. ה-IPC רושם כאן את הדחיפה ל-renderer. */
type StatusListener = (status: WaStatusDto) => void;
const listeners = new Set<StatusListener>();

export function onStatusChange(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * true בזמן קמפיין פעיל. אז סגירת החלון **מסתירה** אותו במקום לסגור –
 * סגירה באמצע שליחה הייתה מנתקת את הסשן ומשאירה פריט תקוע ב-`sending`.
 */
let campaignRunning = false;

export function setCampaignRunning(running: boolean): void {
  campaignRunning = running;
}

export function currentStatus(): WaStatusDto {
  return lastStatus;
}

function publish(next: WaStatusDto): void {
  // מפרסמים רק כשמשהו באמת השתנה: דגימה כל 2 שניות שמייצרת אירוע זהה
  // הייתה מרנדרת מחדש את כל המסך ללא צורך.
  const changed =
    next.state !== lastStatus.state ||
    next.phone !== lastStatus.phone ||
    next.windowOpen !== lastStatus.windowOpen ||
    next.message !== lastStatus.message;
  if (!changed) return;
  lastStatus = next;
  for (const listener of listeners) listener(next);
}

export function isWindowOpen(): boolean {
  return win !== null && !win.isDestroyed();
}

/**
 * WB-01 – פותח את החלון, או מביא אותו לחזית אם הוא כבר קיים.
 *
 * `url` מאפשר לפתוח ישר על היעד. בלעדיו שליחה שפותחת את החלון הייתה
 * גורמת ל**שתי** טעינות מלאות של WhatsApp Web – אחת לדף הבית ואחת ל-`/send`
 * – וזה הכפיל את זמן ההמתנה מ-15 שניות ל-30.
 */
export function openWhatsAppWindow(url: string = WHATSAPP_URL): WaStatusDto {
  if (isWindowOpen()) {
    win!.show();
    win!.focus();
    return lastStatus;
  }

  const partition = session.fromPartition(PARTITION);
  // WB-04 – WhatsApp Web חוסם UA לא מוכר. חייב להיות Chrome אמיתי, בלי
  // המחרוזת `Electron/`.
  partition.setUserAgent(CHROME_USER_AGENT);

  win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'WhatsApp – נדרים',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: PARTITION,
      // אין preload ואין גישה ל-Node: הדף הזה הוא אתר חיצוני.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.webContents.setUserAgent(CHROME_USER_AGENT);

  // קישורים חיצוניים מתוך WhatsApp נפתחים בדפדפן, לא בחלון נוסף.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('ready-to-show', () => win?.show());

  win.on('close', (event) => {
    // W-50 – בזמן קמפיין הסגירה מוסתרת במקום להתבצע.
    if (campaignRunning) {
      event.preventDefault();
      win?.hide();
    }
  });

  win.on('closed', () => {
    win = null;
    stopPolling();
    publish({ state: 'disconnected', phone: null, since: nowIso(), windowOpen: false });
  });

  void win.loadURL(url);
  startPolling();

  return lastStatus;
}

export function hideWhatsAppWindow(): void {
  if (isWindowOpen()) win!.hide();
}

/** WB-05 – ניתוק אמיתי: מחיקת ה-partition כולו. */
export async function logoutWhatsApp(): Promise<WaStatusDto> {
  stopPolling();
  if (isWindowOpen()) {
    win!.destroy();
    win = null;
  }
  await session.fromPartition(PARTITION).clearStorageData();
  const status: WaStatusDto = {
    state: 'disconnected',
    phone: null,
    since: nowIso(),
    windowOpen: false,
  };
  lastStatus = { ...status, state: 'ready' }; // כדי ש-publish יזהה שינוי
  publish(status);
  return status;
}

/**
 * דגימה אחת של הדף. כל ה-selectors מגיעים מ-`selectors.ts` (WB-06).
 */
async function probePage(): Promise<PageProbe> {
  if (!isWindowOpen()) {
    return { loaded: false, hasQr: false, hasChatList: false, hasStaleText: false };
  }
  const expression = `(() => ({
    loaded: document.body !== null,
    hasQr: ${existsExpression(QR_CANVAS)},
    hasChatList: ${existsExpression(CHAT_LIST)},
    hasStaleText: ${bodyContainsExpression(STALE_TEXTS)},
  }))()`;
  try {
    return (await win!.webContents.executeJavaScript(expression, true)) as PageProbe;
  } catch {
    // הדף באמצע ניווט – נדגום שוב בעוד 2 שניות.
    return { loaded: false, hasQr: false, hasChatList: false, hasStaleText: false };
  }
}

/**
 * W-56 – חילוץ המספר המחובר. best-effort: ה-WID יושב ב-localStorage תחת
 * מפתח שמשתנה בין גרסאות, ולכן כישלון כאן אינו חוסם דבר.
 *
 * הפורמט הוא WID מלא, למשל `"972501234567:39@c.us"` – **כולל מזהה מכשיר**
 * אחרי נקודתיים. הסרה של כל תו שאינו ספרה הייתה מדביקה את `39` למספר
 * ומציגה לגבאי `+97250123456739`, מספר שאינו שלו. לכן חותכים תחילה ב-`:`
 * וב-`@`, ורק אז משאירים ספרות.
 */
async function probePhone(): Promise<string | null> {
  if (!isWindowOpen()) return null;
  // הסקריפט המוזרק מחזיר את הערך הגולמי בלבד; הפרסור נעשה ב-`parseWid`,
  // שהיא פונקציה טהורה עם בדיקות יחידה. קוד שיושב בתוך מחרוזת אינו נבדק,
  // ובדיוק שם הסתתר הבאג של מזהה המכשיר.
  const expression = `(() => {
    try {
      for (const key of ['last-wid-md', 'last-wid']) {
        const raw = window.localStorage.getItem(key);
        if (raw) return raw;
      }
    } catch (e) { /* localStorage חסום */ }
    return null;
  })()`;
  try {
    const raw = (await win!.webContents.executeJavaScript(expression, true)) as string | null;
    return parseWid(raw);
  } catch {
    return null;
  }
}

async function poll(): Promise<void> {
  const open = isWindowOpen();
  const probe = await probePage();
  const derived = deriveState(probe, open);
  const phone = derived.state === 'ready' ? await probePhone() : null;

  publish({
    state: derived.state,
    phone,
    since: nowIso(),
    windowOpen: open,
    ...(derived.message !== undefined ? { message: derived.message } : {}),
  });
}

function startPolling(): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();
}

function stopPolling(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/** נקרא בסגירת היישום. */
export function disposeWhatsApp(): void {
  stopPolling();
  listeners.clear();
  if (isWindowOpen()) win!.destroy();
  win = null;
}

/**
 * החלון עצמו, למי שצריך לשלוח דרכו (`MessageSender`). מוחזר `null` כשאין
 * חלון פתוח – המתקשר אחראי לטפל בזה ולא לשלוח לחלון שנסגר.
 */
export function whatsAppWindow(): BrowserWindow | null {
  return isWindowOpen() ? win : null;
}
