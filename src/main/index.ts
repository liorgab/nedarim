import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { BrowserWindow, app, shell } from 'electron';
import { closeDatabase, getDb, getUserDataDir, initDatabase } from './db';
import { printReceipt, synagogueDetails } from './services/receiptPdf';
import { renderReceiptHtml } from './services/receiptTemplate';
import { getReceiptByNumber } from './services/receipts';
import { registerIpcHandlers } from './ipc';
import { disposeWhatsApp } from './whatsapp/WhatsAppWindow';

const isDev = !app.isPackaged;

/**
 * משימת רקע ללא חלון ראשי (הפקת PDF לבדיקה). כשהיא רצה, סגירת חלון העזר
 * שמשמש להמרה ל-PDF לא אמורה לסגור את היישום ולנתק את בסיס הנתונים.
 */
let headlessTask = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'נדרים',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  if (process.env['NEDARIM_LOG_CONSOLE']) {
    // Electron 38: הפרמטר השני הוא אובייקט פרטים, ולא (level, message, line, source).
    win.webContents.on('console-message', (details) => {
      console.log(
        `[renderer ${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
      );
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => console.log('LOAD FAIL', code, desc));
  }

  // קישורים חיצוניים נפתחים בדפדפן, לא בתוך היישום.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // מסך פתיחה אופציונלי לצורכי בדיקה, למשל '#/card/35'.
  const startHash = (process.env['NEDARIM_SCREENSHOT_HASH'] ?? '').replace(/^#/, '');
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(startHash ? `${devUrl}#${startHash}` : devUrl);
  } else {
    void win.loadFile(
      join(__dirname, '../renderer/index.html'),
      startHash ? { hash: startHash } : undefined,
    );
  }

  // עזר בדיקות: NEDARIM_SCREENSHOT=<path> מצלם את החלון ויוצא.
  // מאפשר אימות ויזואלי של מסכים בלי הרצה ידנית (CLAUDE.md כלל-על 17).
  const shotPath = process.env['NEDARIM_SCREENSHOT'];
  if (shotPath) {
    win.webContents.once('did-finish-load', () => {
      void (async () => {
        // עזר בדיקות: NEDARIM_DEV_SCRIPT=<קובץ JS> מריץ תרחיש בממשק לפני הצילום
        // (למשל: ללחוץ על "הפקת קבלה" ולצלם את התוצאה). מאפשר לשחזר תקלות
        // שקורות רק ברצף פעולות אמיתי, ולא בפתיחה ישירה של מסך.
        const scriptPath = process.env['NEDARIM_DEV_SCRIPT'];
        if (scriptPath) {
          try {
            const source = await readFile(scriptPath, 'utf8');
            const result: unknown = await win.webContents.executeJavaScript(source, true);
            console.log('[dev-script]', JSON.stringify(result));
          } catch (e) {
            console.error('[dev-script]', e instanceof Error ? e.message : String(e));
          }
        }
        await new Promise((r) => setTimeout(r, 2500));
        const img = await win.webContents.capturePage();
        await writeFile(shotPath, img.toPNG());
        app.exit(0);
      })();
    });
  }
  return win;
}

/**
 * עזר בדיקות: NEDARIM_PRINT_RECEIPT=<מספר קבלה> מפיק את ה-PDF של אותה קבלה ויוצא.
 * מאפשר לאמת את פלט ההדפסה בלי לעבור במסכים (CLAUDE.md כלל-על 17).
 */
async function runPrintReceiptTask(numberText: string): Promise<void> {
  const db = getDb();
  const receipt = getReceiptByNumber(db, Number(numberText));
  if (!receipt) throw new Error(`קבלה ${numberText} לא נמצאה`);
  const user = db.prepare("SELECT id FROM user WHERE username = 'admin'").get() as { id: number };
  const res = await printReceipt(db, receipt, user.id, { userDataDir: getUserDataDir() });
  console.log(res.pdfPath);

  // NEDARIM_SCREENSHOT יחד עם המשימה מייצר גם PNG של אותה קבלה, לאימות ויזואלי.
  const shot = process.env['NEDARIM_SCREENSHOT'];
  if (shot) {
    const html = renderReceiptHtml({
      receipt: res.receipt,
      synagogue: synagogueDetails(db),
      isCopy: res.receipt.printCount > 1,
      paperSize: 'A5',
    });
    const preview = new BrowserWindow({
      show: false,
      width: 1120,
      height: 760,
      webPreferences: { sandbox: true, javascript: false },
    });
    try {
      await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((r) => setTimeout(r, 800));
      const img = await preview.webContents.capturePage();
      await writeFile(shot, img.toPNG());
    } finally {
      preview.destroy();
    }
  }
}

app.whenReady().then(() => {
  // NEDARIM_DB_DIR מאפשר להריץ את היישום מול DB אחר (למשל תוצאת הייבוא) בלי להתקין מחדש.
  initDatabase(process.env['NEDARIM_DB_DIR'] ?? app.getPath('userData'));
  registerIpcHandlers();

  const printTask = process.env['NEDARIM_PRINT_RECEIPT'];
  if (printTask) {
    headlessTask = true;
    void runPrintReceiptTask(printTask)
      .then(() => app.exit(0))
      .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        app.exit(1);
      });
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!headlessTask) app.quit();
});

app.on('will-quit', () => {
  disposeWhatsApp();
  closeDatabase();
});
