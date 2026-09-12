import { formatAgorot } from '@shared/money';
import { amountToHebrewWords } from '@shared/hebrewWords';
import type { Receipt } from './receipts';
import { toHebrewDate } from './hebrewCalendar';

/**
 * תבנית ה-HTML של הקבלה (SPEC F-71, נספח ב').
 *
 * שומרת את מבנה התבנית מגיליון 'קבלות' ומוסיפה: שנה עברית **דינמית** (במקום
 * הטקסט הקבוע 'תשפ"ב' שהיה שגוי), סכום במילים, תאריך עברי לצד הלועזי, שדה 'עבור',
 * סימון 'העתק' בהדפסה חוזרת וסימון 'מבוטלת'.
 *
 * ה-HTML עצמאי לחלוטין – בלי גופנים חיצוניים ובלי תמונות מרוחקות (CLAUDE.md כלל 11).
 * הגופן מוטמע כ-base64 על ידי המתקשר אם נדרש; ברירת המחדל היא גופני המערכת.
 */

export interface SynagogueDetails {
  name: string;
  city: string;
  address: string;
  phone: string;
  associationNumber: string;
  /** data: URI או נתיב מקומי; ריק = לא מוצג. */
  logoDataUri: string;
  signatureDataUri: string;
  footerText: string;
}

export interface RenderReceiptOptions {
  receipt: Receipt;
  synagogue: SynagogueDetails;
  /** true בהדפסה חוזרת – מוסיף חותמת 'העתק' (F-72). */
  isCopy: boolean;
  paperSize: 'A4' | 'A5';
  /** להטמעת הגופן העברי ב-PDF. */
  fontCss?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function safeHebrew(iso: string): string {
  try {
    return toHebrewDate(iso.slice(0, 10));
  } catch {
    return '';
  }
}

export function renderReceiptHtml(options: RenderReceiptOptions): string {
  const { receipt: r, synagogue: s, isCopy, paperSize } = options;
  const cancelled = r.cancelledAt !== null;

  const headerLine = [s.city, s.address, s.phone ? `טל' ${s.phone}` : '']
    .filter((x) => x && x.trim() !== '')
    .join(' · ');

  const reference =
    r.paymentReference && r.paymentReference.trim() !== ''
      ? ` (אסמכתא: ${esc(r.paymentReference)})`
      : '';

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>קבלה ${r.receiptNumber}</title>
<style>
${options.fontCss ?? ''}
@page { size: ${paperSize} landscape; margin: 10mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: 'Assistant', 'Segoe UI', Arial, sans-serif;
  color: #111; background: #fff;
}
body { padding: 6mm 8mm; position: relative; }
.frame { border: 2px solid #1b4965; border-radius: 6px; padding: 6mm 7mm; height: 100%; }
header { display: flex; align-items: center; gap: 6mm; border-bottom: 1.5px solid #1b4965;
         padding-bottom: 3mm; margin-bottom: 4mm; }
header img { height: 18mm; }
.title { flex: 1; }
.title h1 { margin: 0; font-size: 20pt; font-weight: 700; color: #1b4965; }
.title .sub { font-size: 10pt; color: #444; margin-top: 1mm; }
.receipt-no { text-align: center; border: 1.5px solid #1b4965; border-radius: 5px;
              padding: 2mm 4mm; min-width: 34mm; }
.receipt-no .label { font-size: 8.5pt; color: #444; }
.receipt-no .num { font-size: 19pt; font-weight: 700; letter-spacing: 1px; color: #1b4965; }
.receipt-no .year { font-size: 10pt; }
.row { display: flex; gap: 3mm; align-items: baseline; margin: 2.6mm 0; font-size: 12pt; }
.row .k { color: #444; min-width: 32mm; }
.row .v { font-weight: 600; flex: 1; }
.amount { font-size: 17pt; font-weight: 700; color: #1b4965; }
.words { font-size: 11pt; font-weight: 400; color: #333; }
footer { margin-top: 5mm; padding-top: 3mm; border-top: 1px dashed #999;
         display: flex; justify-content: space-between; align-items: flex-end; font-size: 10pt; }
.sign { text-align: center; min-width: 45mm; }
.sign img { height: 14mm; display: block; margin: 0 auto 1mm; }
.sign .line { border-top: 1px solid #333; padding-top: 1mm; }
.stamp { position: absolute; top: 34%; inset-inline-start: 50%; transform: translateX(50%) rotate(-18deg);
         font-size: 44pt; font-weight: 800; letter-spacing: 6px; opacity: .16; pointer-events: none; }
.stamp.copy { color: #1b4965; }
.stamp.cancelled { color: #b3261e; }
</style>
</head>
<body>
${cancelled ? '<div class="stamp cancelled">מבוטלת</div>' : ''}
${!cancelled && isCopy ? '<div class="stamp copy">העתק</div>' : ''}
<div class="frame">
  <header>
    ${s.logoDataUri ? `<img src="${esc(s.logoDataUri)}" alt="" />` : ''}
    <div class="title">
      <h1>${esc(s.name || 'בית הכנסת')}</h1>
      ${headerLine ? `<div class="sub">${esc(headerLine)}</div>` : ''}
      ${s.associationNumber ? `<div class="sub">מס' עמותה: ${esc(s.associationNumber)}</div>` : ''}
    </div>
    <div class="receipt-no">
      <div class="label">קבלה מס'</div>
      <div class="num">${String(r.receiptNumber).padStart(4, '0')}</div>
      <div class="year">שנת ${esc(r.hebrewYear)}</div>
    </div>
  </header>

  <div class="row">
    <span class="k">נתקבל בתודה מ:</span>
    <span class="v">${esc(r.payerName)}</span>
  </div>

  <div class="row">
    <span class="k">סך:</span>
    <span class="v amount">${esc(formatAgorot(r.amountAgorot))}</span>
  </div>
  <div class="row">
    <span class="k"></span>
    <span class="v words">${esc(amountToHebrewWords(r.amountAgorot))}</span>
  </div>

  <div class="row">
    <span class="k">באמצעות:</span>
    <span class="v">${esc(r.paymentMethodText)}${reference}</span>
  </div>

  <div class="row">
    <span class="k">עבור:</span>
    <span class="v">${esc(r.purposeText)}</span>
  </div>

  <div class="row">
    <span class="k">תאריך התשלום:</span>
    <span class="v">${formatIsoDate(r.paymentDate)}${
      safeHebrew(r.paymentDate) ? ` &nbsp;(${esc(safeHebrew(r.paymentDate))})` : ''
    }</span>
  </div>

  ${
    cancelled
      ? `<div class="row"><span class="k">בוטלה:</span><span class="v">${formatIsoDate(
          r.cancelledAt!,
        )} – ${esc(r.cancelReason ?? '')}</span></div>`
      : ''
  }

  <footer>
    <div>
      <div>${esc(s.footerText || 'בתודה, ועד בית הכנסת')}</div>
      <div style="color:#555;margin-top:1mm">תאריך הפקה: ${formatIsoDate(r.issuedAt)}</div>
    </div>
    <div class="sign">
      ${s.signatureDataUri ? `<img src="${esc(s.signatureDataUri)}" alt="" />` : ''}
      <div class="line">חתימה</div>
    </div>
  </footer>
</div>
</body>
</html>`;
}
