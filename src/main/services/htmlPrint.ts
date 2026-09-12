import { writeFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';

/**
 * הדפסה ושמירת PDF של HTML שנבנה ב-main.
 *
 * מופרד מ-`calendarPrint.ts` כדי שבניית ה-HTML תישאר טהורה וניתנת לבדיקה
 * בלי Electron. אותו דפוס שבו מודפסת קבלה (`receiptPdf.ts`): חלון נסתר,
 * `javascript: false`, וסגירה ב-`finally` גם כשההמרה נכשלה.
 */

const PAGE_OPTIONS = { printBackground: true } as const;

function hiddenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false },
  });
}

const asDataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

/** שומר את ה-HTML כ-PDF ומחזיר את הנתיב. */
export async function htmlToPdf(html: string, path: string): Promise<string> {
  const win = hiddenWindow();
  try {
    await win.loadURL(asDataUrl(html));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      ...PAGE_OPTIONS,
      margins: { marginType: 'default' },
    });
    await writeFile(path, pdf);
    return path;
  } finally {
    win.destroy();
  }
}

/**
 * שולח למדפסת. `silent: false` – נפתח דיאלוג המדפסת של מערכת ההפעלה,
 * כי בניגוד לקבלה (שנשלחת למדפסת קבועה) לוח שנה מודפס מדי פעם ולגבאי
 * צריכה להיות אפשרות לבחור מדפסת, טווח עמודים וכיוון.
 */
export async function printHtml(html: string, printerName?: string): Promise<void> {
  const win = hiddenWindow();
  try {
    await win.loadURL(asDataUrl(html));
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        { silent: false, ...PAGE_OPTIONS, ...(printerName ? { deviceName: printerName } : {}) },
        (success, reason) => {
          // ביטול על ידי המשתמש אינו שגיאה.
          if (success || reason === 'cancelled') resolve();
          else reject(new Error(reason || 'ההדפסה נכשלה'));
        },
      );
    });
  } finally {
    win.destroy();
  }
}
