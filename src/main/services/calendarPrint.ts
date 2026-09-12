import type { CalendarDayRow } from './calendarRange';
import type { ExportableTable } from './exporters';
import type { ReportColumn } from './reports';

/**
 * F-90 – ייצוא והדפסה של לוח השנה.
 *
 * הטבלה נבנית פעם אחת כ-`ExportableTable`, ומשם CSV ו-Excel מגיעים בחינם
 * מ-`exporters.ts`. ה-HTML נבנה כאן ולא ב-renderer כי ההדפסה רצה בחלון
 * נסתר ב-main, באותו דפוס בדיוק שבו מודפסת קבלה.
 */

export const CALENDAR_COLUMNS: readonly ReportColumn[] = [
  { key: 'gregorian', label: 'תאריך לועזי', format: 'date' },
  { key: 'dayOfWeek', label: 'יום', format: 'text' },
  { key: 'hebrew', label: 'תאריך עברי', format: 'text' },
  { key: 'parasha', label: 'פרשת השבוע', format: 'text' },
  { key: 'holiday', label: 'חג / מועד', format: 'text' },
  { key: 'occasion', label: 'אירוע לנדר', format: 'text' },
];

export function calendarTable(rows: readonly CalendarDayRow[], title: string): ExportableTable {
  return {
    title,
    columns: CALENDAR_COLUMNS,
    rows: rows.map((r) => ({
      gregorian: r.gregorian,
      dayOfWeek: r.dayOfWeek,
      hebrew: r.hebrew,
      parasha: r.parasha,
      holiday: r.holiday,
      occasion: r.occasion,
    })),
    totals: null,
  };
}

/** `dd/mm/yyyy`, כמו בכל המערכת (כלל 2). */
export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** כותרת הדף המודפס. `dd/mm/yyyy` כמו בכל המערכת. */
export function calendarTitle(from: string, to: string): string {
  return `לוח שנה ${formatDisplayDate(from)} - ${formatDisplayDate(to)}`;
}

/**
 * שם הקובץ המוצע. **נפרד מהכותרת בכוונה**: `dd/mm/yyyy` מכיל `/`, שאינו
 * חוקי בשם קובץ ב-Windows, ודיאלוג השמירה היה נפתח עם נתיב שבור.
 */
export function calendarFileName(from: string, to: string): string {
  return calendarTitle(from, to).replace(/\//g, '.');
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface CalendarHtmlInput {
  rows: readonly CalendarDayRow[];
  title: string;
  subtitle: string;
  synagogueName: string;
}

/**
 * דף מוכן להדפסה.
 *
 * `javascript: false` בחלון ההדפסה, ולכן הכול סטטי. הצבעים מודפסים רק עם
 * `printBackground`, ולכן שבת וחג מסומנים **גם** בטקסט מודגש ולא בצבע
 * בלבד – אחרת ההדפסה בשחור-לבן מאבדת את ההבחנה.
 */
export function renderCalendarHtml(input: CalendarHtmlInput): string {
  const body = input.rows
    .map((r) => {
      const classes = [r.isShabbat ? 'shabbat' : '', r.isHoliday ? 'holiday' : '']
        .filter(Boolean)
        .join(' ');
      const cells = [
        formatDisplayDate(r.gregorian),
        r.dayOfWeek,
        r.hebrew,
        r.parasha ?? '',
        r.holiday ?? '',
        r.occasion ?? '',
      ];
      return `<tr class="${classes}">${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
    })
    .join('\n');

  const head = CALENDAR_COLUMNS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Arial Hebrew", Arial, sans-serif;
    direction: rtl; margin: 0; color: #111;
  }
  header { margin-bottom: 10px; border-bottom: 2px solid #1b3a57; padding-bottom: 6px; }
  h1 { font-size: 17pt; margin: 0 0 2px; color: #1b3a57; }
  .sub { font-size: 9.5pt; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 1px solid #c9d2da; padding: 3px 6px; text-align: start; }
  thead th { background: #eef3f7; font-weight: 700; }
  /* חזרת הכותרת בכל עמוד, ואיסור חיתוך שורה באמצע. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  tr.shabbat td { background: #f2f6fa; font-weight: 700; }
  tr.holiday td { background: #fff4e5; }
  tr.shabbat.holiday td { background: #f7efe4; }
  footer { margin-top: 8px; font-size: 8pt; color: #777; text-align: start; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="sub">${escapeHtml(input.subtitle)}</div>
  </header>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <footer>${escapeHtml(input.synagogueName)}</footer>
</body>
</html>`;
}
