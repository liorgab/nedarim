import type { IsoDate } from '@shared/types';

/**
 * נורמליזציית תאריכים מהקובץ הישן (SPEC 7.2).
 *
 * בקובץ נמצאו חמישה ייצוגים שונים לאותו דבר:
 *   1. ערך תאריך אמיתי של Excel (serial)  – 51 בצד החיוב, 7 בצד הזיכוי
 *   2. טקסט `dd.mm.yyyy`                   – 878
 *   3. טקסט `dd/mm/yyyy`                   – 374
 *   4. טקסט/מספר פגום (`29.092023`, `04/052026`, `.01.09.2023`, `01/06//2026`, `25.07.26`)
 *   5. ריק
 *
 * כל ניחוש מסומן ב-`confidence: 'guessed'` ומגיע לדוח החריגים.
 */

export type DateConfidence = 'exact' | 'guessed' | 'failed';

export interface ParsedDate {
  iso: IsoDate | null;
  confidence: DateConfidence;
  /** התיאור המקורי, לדוח החריגים. */
  raw: string;
  /** הסבר קצר למה סומן כניחוש/כישלון. */
  reason?: string;
}

/** תא Excel כפי שמגיע מ-SheetJS (`cellDates: false`). */
export interface RawCell {
  t?: string;
  v?: unknown;
  z?: string;
}

// טווח רחב בכוונה: שנה חריגה (נמצא 2925) חייבת לעבור את הפירוק כדי ש-fixImplausibleYear
// יוכל לתקן אותה. סינון השנים הסביר נעשה שם, לא כאן.
const MIN_YEAR = 1900;
const MAX_YEAR = 3000;

/** ממיר serial של Excel (1900 date system) ל-ISO, ללא מעבר דרך Date כדי לא להיגרר לאזור זמן. */
export function excelSerialToIso(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // Excel מתייחס בטעות ל-1900 כשנה מעוברת; מתקנים לסריאלים אחרי 59 (28/02/1900).
  const days = Math.floor(serial) - (serial > 59 ? 1 : 0);
  // 30/12/1899 הוא היום 0 אחרי התיקון.
  const epoch = Date.UTC(1899, 11, 31);
  const d = new Date(epoch + days * 86_400_000);
  const y = d.getUTCFullYear();
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function build(day: number, month: number, year: number): IsoDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  // אימות אמיתי (31/02 ייפול)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** מנקה סימני כיווניות, רווחים כפולים ומפרידים כפולים/מיותרים בקצוות. */
function clean(raw: string): string {
  return raw
    .replace(/[‎‏؜]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[.\-/\s]+/, '')
    .replace(/[.\-/\s]+$/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\.{2,}/g, '.');
}

export function parseLegacyDate(cell: RawCell | null | undefined): ParsedDate {
  if (cell === null || cell === undefined || cell.v === undefined || cell.v === null) {
    return { iso: null, confidence: 'failed', raw: '', reason: 'תא ריק' };
  }

  const rawText = String(cell.v);

  // (1) serial אמיתי של Excel – מזוהה לפי פורמט תאריך או לפי טווח סביר
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const n = cell.v;
    const looksLikeDateFormat = Boolean(cell.z && /[dmy]/i.test(String(cell.z)));
    if (Number.isInteger(n) && (looksLikeDateFormat || (n > 30000 && n < 60000))) {
      const iso = excelSerialToIso(n);
      if (iso) return { iso, confidence: 'exact', raw: rawText };
    }
    // (4א) מספר עשרוני שהוא בעצם תאריך: 29.092023 → 29/09/2023
    const m = /^(\d{1,2})\.(\d{2})(\d{4})$/.exec(rawText);
    if (m) {
      const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
      if (iso) {
        return { iso, confidence: 'guessed', raw: rawText, reason: 'מספר עשרוני שפורש כתאריך' };
      }
    }
    return { iso: null, confidence: 'failed', raw: rawText, reason: 'מספר שאינו תאריך' };
  }

  const text = clean(rawText);
  if (text === '') {
    return { iso: null, confidence: 'failed', raw: rawText, reason: 'תא ריק' };
  }

  // (2)(3) dd.mm.yyyy | dd/mm/yyyy | dd-mm-yyyy
  let m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(text);
  if (m) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) {
      const guessed = rawText !== text;
      return {
        iso,
        confidence: guessed ? 'guessed' : 'exact',
        raw: rawText,
        ...(guessed ? { reason: 'תווים מיותרים נוקו' } : {}),
      };
    }
    return { iso: null, confidence: 'failed', raw: rawText, reason: 'תאריך לא קיים בלוח' };
  }

  // (4ב) שנה דו-ספרתית: 25.07.26 → 2026
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/.exec(text);
  if (m) {
    const iso = build(Number(m[1]), Number(m[2]), 2000 + Number(m[3]));
    if (iso)
      return { iso, confidence: 'guessed', raw: rawText, reason: 'שנה דו-ספרתית הושלמה ל-20xx' };
  }

  // (4ג) מפריד חסר בין חודש לשנה: 04/052026 → 04/05/2026
  m = /^(\d{1,2})[.\-/](\d{2})(\d{4})$/.exec(text);
  if (m) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) return { iso, confidence: 'guessed', raw: rawText, reason: 'מפריד חסר בין חודש לשנה' };
  }

  // (4ד) ללא מפרידים כלל: 29092023
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (m) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) return { iso, confidence: 'guessed', raw: rawText, reason: 'תאריך ללא מפרידים' };
  }

  return { iso: null, confidence: 'failed', raw: rawText, reason: 'פורמט לא מזוהה' };
}

/**
 * תיקון שנה בלתי אפשרית (נמצאה תרומה בתאריך 27.07.2925).
 * מחזיר את התאריך המתוקן אם השנה חורגת מטווח הנתונים הסביר.
 */
export function fixImplausibleYear(
  iso: IsoDate,
  minYear: number,
  maxYear: number,
): { iso: IsoDate; fixed: boolean; reason?: string } {
  const year = Number(iso.slice(0, 4));
  if (year >= minYear && year <= maxYear) return { iso, fixed: false };
  // 2925 → 2025: מחליפים את ספרת המאות בזו של טווח הנתונים.
  const candidate = `${String(minYear).slice(0, 2)}${iso.slice(2)}` as IsoDate;
  const candidateYear = Number(candidate.slice(0, 4));
  if (candidateYear >= minYear && candidateYear <= maxYear) {
    return { iso: candidate, fixed: true, reason: `שנה ${year} תוקנה ל-${candidateYear}` };
  }
  return { iso, fixed: false, reason: `שנה ${year} מחוץ לטווח הנתונים` };
}
