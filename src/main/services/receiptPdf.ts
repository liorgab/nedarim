import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import type { Database } from 'better-sqlite3';
import { getAllSettings, getSetting } from './settings';
import { renderReceiptHtml, type SynagogueDetails } from './receiptTemplate';
import { registerPrint, setPdfPath, type Receipt } from './receipts';

/**
 * הפקת ה-PDF של הקבלה (F-70). מנוע Chromium של Electron מרנדר עברית ו-RTL
 * בצורה מושלמת, ולכן הקבלה נראית זהה בכל מדפסת.
 *
 * ה-PDF נשמר בארכיון תחת `<תיקיית הקבלות>/<שנה>/<מספר>.pdf` – זה גם מה שמגובה.
 * תיקיית הקבלות ניתנת להגדרה (`receipts_dir`); ברירת המחדל היא `userData/receipts`.
 */

const RECEIPT_DIR = 'receipts';

/** ברירת המחדל: תיקיית הנתונים של היישום. זה גם מה שההתקנה מגבה ומשחזרת. */
export function defaultReceiptsRoot(userDataDir: string): string {
  return join(userDataDir, RECEIPT_DIR);
}

/**
 * תיקיית ארכיון הקבלות. ניתנת להגדרה ב-`receipts_dir` (CLAUDE.md כלל 12), כדי
 * שגבאי יוכל להצביע על תיקיית ענן או על כונן רשת ולקבל עותק נוסף מחוץ למחשב.
 *
 * ריק = ברירת המחדל. הנתיב המלא של כל קבלה נשמר ב-`receipt.pdf_path` בעת
 * ההפקה, ולכן שינוי ההגדרה לא "מאבד" קבלות ישנות – הן נפתחות מהמקום שבו נשמרו.
 */
export function receiptsRoot(db: Database, userDataDir: string): string {
  const configured = (getSetting(db, 'receipts_dir') ?? '').trim();
  return configured === '' ? defaultReceiptsRoot(userDataDir) : configured;
}

export function receiptPdfPath(db: Database, userDataDir: string, receipt: Receipt): string {
  const year = receipt.issuedAt.slice(0, 4);
  const dir = join(receiptsRoot(db, userDataDir), year);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${String(receipt.receiptNumber).padStart(4, '0')}.pdf`);
}

/** קורא את פרטי בית הכנסת מההגדרות. תמונות מומרות ל-data URI כדי שה-PDF יהיה עצמאי. */
export function synagogueDetails(db: Database): SynagogueDetails {
  const s = getAllSettings(db);
  const val = (k: string) => (s[k] ?? '').trim();
  return {
    name: val('synagogue_name'),
    city: val('synagogue_city'),
    address: val('synagogue_address'),
    phone: val('synagogue_phone'),
    associationNumber: val('association_number'),
    logoDataUri: toDataUri(val('logo_path')),
    signatureDataUri: toDataUri(val('signature_path')),
    footerText: val('receipt_footer_text'),
  };
}

function toDataUri(path: string): string {
  if (path === '' || !existsSync(path)) return '';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  try {
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return '';
  }
}

/** מטמיע את הגופן העברי כ-CSS, כדי שה-PDF לא יהיה תלוי בגופני המערכת. */
function embeddedFontCss(): string {
  const candidates = [
    join(
      app.getAppPath(),
      'node_modules/@fontsource/assistant/files/assistant-hebrew-400-normal.woff2',
    ),
    join(
      app.getAppPath(),
      '../node_modules/@fontsource/assistant/files/assistant-hebrew-400-normal.woff2',
    ),
  ];
  const boldCandidates = candidates.map((p) => p.replace('-400-', '-700-'));
  const regular = candidates.find((p) => existsSync(p));
  const bold = boldCandidates.find((p) => existsSync(p));
  if (!regular) return '';
  const face = (path: string, weight: number) =>
    `@font-face{font-family:'Assistant';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(
      path,
    ).toString('base64')}) format('woff2');}`;
  return face(regular, 400) + (bold ? face(bold, 700) : '');
}

export interface GeneratePdfResult {
  pdfPath: string;
  html: string;
}

/**
 * מרנדר את הקבלה ל-PDF בחלון נסתר ושומר אותה בארכיון.
 * החלון נסגר תמיד, גם אם ההמרה נכשלה.
 */
export async function generateReceiptPdf(
  db: Database,
  receipt: Receipt,
  options: { userDataDir: string; isCopy: boolean },
): Promise<GeneratePdfResult> {
  const settings = getAllSettings(db);
  const paperSize = (settings['receipt_paper_size'] ?? 'A5') === 'A4' ? 'A4' : 'A5';
  const html = renderReceiptHtml({
    receipt,
    synagogue: synagogueDetails(db),
    isCopy: options.isCopy,
    paperSize,
    fontCss: embeddedFontCss(),
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      pageSize: paperSize,
      landscape: true,
      printBackground: true,
      margins: { marginType: 'none' },
    });
    const pdfPath = receiptPdfPath(db, options.userDataDir, receipt);
    await writeFile(pdfPath, pdf);
    setPdfPath(db, receipt.id, pdfPath);
    return { pdfPath, html };
  } finally {
    win.destroy();
  }
}

/**
 * F-70/F-72 – הפקה או הדפסה חוזרת: יוצר PDF, מעדכן `print_count` ורושם ביומן.
 * אם ההדפסה נכשלת, הקבלה נשארת עם המונה הקודם וניתן לנסות שוב.
 */
export async function printReceipt(
  db: Database,
  receipt: Receipt,
  userId: number,
  options: { userDataDir: string; toPrinter?: boolean; printerName?: string },
): Promise<{ pdfPath: string; receipt: Receipt }> {
  const isCopy = receipt.printCount > 0;
  const { pdfPath, html } = await generateReceiptPdf(db, receipt, {
    userDataDir: options.userDataDir,
    isCopy,
  });

  if (options.toPrinter) {
    await sendToPrinter(html, options.printerName);
  }

  const updated = registerPrint(db, receipt.id, pdfPath, userId);
  return { pdfPath, receipt: updated };
}

async function sendToPrinter(html: string, printerName?: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          landscape: true,
          ...(printerName ? { deviceName: printerName } : {}),
        },
        (success, reason) => (success ? resolve() : reject(new Error(reason))),
      );
    });
  } finally {
    win.destroy();
  }
}
