import { excelSerialToIso, type RawCell } from './dates';
import type { LegacyWorkbook } from './workbook';

/**
 * סימולציה של המאקרו `MaazanSheet` מהקובץ הישן.
 *
 * המאקרו לא מפרסר תאריך – הוא חותך תווים לפי מיקום:
 *   `Truma_month = Mid(cell, 4, 2)`  ·  `Truma_year = Right(cell, 4)`
 * ואז `CInt` על שתי המחרוזות, ומשווה מול 37 מקרים קשיחים (09/2023–09/2026).
 *
 * הסימולציה מאפשרת להבחין בין שני סוגי סטיות במאזן:
 *   א. המאקרו לא הצליח לקרוא את השורה (תאריך כתא-תאריך אמיתי, שנה שגויה, פורמט חריג)
 *      → הסטייה היא **באג בקובץ הישן**, והמערכת החדשה צודקת.
 *   ב. המאקרו היה קורא את השורה אילו היה רץ → השורה נוספה **אחרי ההרצה האחרונה** של המאקרו.
 */

const WINDOW_START = { year: 2023, month: 9 };
const WINDOW_END = { year: 2026, month: 9 };

/** `CInt` של VBA: מקבל גם "3.2" (→3) ודוחה כל דבר שאינו מספרי. עיגול חצי-לזוגי. */
export function vbaCInt(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return 0; // המאקרו ממיר מחרוזת ריקה ל-0 במפורש
  // VBA מקבל גם "3." (תוצאה של Mid על "13.3.2024") ומחזיר 3.
  if (!/^-?\d+\.?\d*$/.test(s)) return null;
  const n = Number(s);
  const floor = Math.floor(n);
  const frac = n - floor;
  if (frac !== 0.5) return Math.round(n);
  return floor % 2 === 0 ? floor : floor + 1; // banker's rounding
}

/**
 * הטקסט ש-VBA היה מקבל מהתא. תא טקסט – כפי שהוא; תא תאריך אמיתי – מומר למחרוזת
 * לפי פורמט התאריך הקצר של Windows בעברית (`dd/MM/yyyy`, עם אפסים מובילים),
 * שזה מה ש-`Mid`/`Right` היו קוראים בפועל.
 */
function vbaText(cell: RawCell): string | null {
  if (cell.t === 's') return String(cell.v);
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isInteger(cell.v)) {
    const iso = excelSerialToIso(cell.v);
    if (!iso) return null;
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  }
  return null;
}

/** לאיזה תא במערך של המאקרו הישן הייתה נופלת השורה. `null` = המאקרו מתעלם ממנה. */
export function legacyMonthKey(cell: RawCell | null | undefined): string | null {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  const v = vbaText(cell);
  if (v === null) return null;
  const month = vbaCInt(v.substring(3, 5)); // VBA Mid(v, 4, 2)
  const year = vbaCInt(v.slice(-4)); // VBA Right(v, 4)
  if (month === null || year === null) return null;
  if (month < 1 || month > 12) return null;
  if (year < WINDOW_START.year || year > WINDOW_END.year) return null;
  if (year === WINDOW_START.year && month < WINDOW_START.month) return null;
  if (year === WINDOW_END.year && month > WINDOW_END.month) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export interface LegacyMonthSum {
  donations: number;
  vowPayments: number;
  expenses: number;
}

/** מריץ את הלוגיקה של המאקרו על הנתונים הגולמיים ומחזיר את מה שהוא *היה* מחשב עכשיו. */
export function simulateLegacyMacro(wb: LegacyWorkbook): Map<string, LegacyMonthSum> {
  const out = new Map<string, LegacyMonthSum>();
  const bucket = (ym: string): LegacyMonthSum => {
    let b = out.get(ym);
    if (!b) {
      b = { donations: 0, vowPayments: 0, expenses: 0 };
      out.set(ym, b);
    }
    return b;
  };

  for (const d of wb.donations) {
    const ym = legacyMonthKey(d.date);
    if (ym) bucket(ym).donations += d.amount;
  }
  for (const p of wb.payments) {
    const ym = legacyMonthKey(p.date);
    if (ym) bucket(ym).vowPayments += p.amount;
  }
  for (const e of wb.expenses) {
    const ym = legacyMonthKey(e.date);
    if (ym) bucket(ym).expenses += e.amount;
  }

  // `SumHotzaa` מוגדר `As Long` ולכן נחתך למספר שלם (בניגוד לשני האחרים, שהם Variant).
  for (const b of out.values()) {
    b.expenses = Math.round(b.expenses);
  }
  return out;
}

export type DiffCause = 'legacy-parse-bug' | 'stale-macro' | 'rounding' | 'unknown';

export const DIFF_CAUSE_LABEL: Record<DiffCause, string> = {
  'legacy-parse-bug':
    'המאקרו הישן אינו מצליח לקרוא את התאריך בשורה זו (הוא חותך תווים במקום לפרסר) – הסכום במערכת החדשה הוא הנכון',
  'stale-macro':
    'השורה נוספה לקובץ אחרי ההרצה האחרונה של המאקרו `מאזן שנתי` – הקובץ הישן פשוט לא עודכן',
  rounding: 'עיגול של `As Long` בעמודת ההוצאות במאקרו הישן',
  unknown: 'לא הוסבר – דורש בדיקה ידנית',
};

/**
 * מסביר סטייה בחודש מסוים: משווה את המאזן שבקובץ למה שהמאקרו *היה* מחשב היום.
 * אם הם שווים – הסטייה נובעת מכשל פענוח של המאקרו; אחרת – המאזן פשוט לא עודכן.
 */
export function explainDiff(
  field: 'donations' | 'vowPayments' | 'expenses',
  legacySheetAgorot: number,
  simulatedAgorot: number,
  importedAgorot: number,
): DiffCause {
  const simMatchesSheet =
    Math.abs(simulatedAgorot - legacySheetAgorot) <= (field === 'expenses' ? 100 : 0);
  if (simMatchesSheet && simulatedAgorot !== importedAgorot) return 'legacy-parse-bug';
  if (!simMatchesSheet && Math.abs(simulatedAgorot - importedAgorot) <= 100) return 'stale-macro';
  if (field === 'expenses' && Math.abs(importedAgorot - legacySheetAgorot) <= 100)
    return 'rounding';
  return 'unknown';
}
