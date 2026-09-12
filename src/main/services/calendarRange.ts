import type { Database } from 'better-sqlite3';
import type { IsoDate } from '@shared/types';
import {
  hebrewYearLabel,
  holidayForDate,
  isoToLocalDate,
  isShabbat,
  localDateToIso,
  parashaKeyForDate,
  toHebrewDate,
} from './hebrewCalendar';
import { findOccasionByHebcalKey } from './lookups';
import { defaultOccasionFor } from './vows';
import { HDate } from '@hebcal/core';

/**
 * F-90 – לוח שנה: טווח תאריכים עם התאריך העברי, היום בשבוע, החג והפרשה.
 *
 * הכול נגזר מהתאריך הלועזי ושום דבר לא נשמר (כלל 3 באותה רוח שבה יתרות
 * מחושבות): הלוח הוא תצוגה של חישוב, לא טבלה נוספת ב-DB.
 *
 * ה-DB נדרש רק לתרגום מפתחות hebcal לשמות עבריים דרך `occasion`, כדי
 * שהלוח ידבר באותה שפה שבה מוצגים הנדרים.
 */

/** יום בשבוע בעברית. `Date.getDay()` מחזיר 0=ראשון. */
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

export function dayOfWeekName(iso: IsoDate): string {
  return DAY_NAMES[isoToLocalDate(iso).getDay()]!;
}

export interface CalendarDayRow {
  gregorian: IsoDate;
  dayOfWeek: string;
  /** 'כ״ט באלול תשפ״ו' */
  hebrew: string;
  hebrewYear: string;
  /** שם הפרשה של אותו שבוע, בעברית. */
  parasha: string | null;
  /** שם החג בעברית, אם יש. */
  holiday: string | null;
  /** האירוע שיוצע בהזנת נדר לתאריך הזה (F-31). */
  occasion: string | null;
  isShabbat: boolean;
  isHoliday: boolean;
}

/**
 * תקרה לטווח. שנתיים הן יותר ממה שגבאי מדפיס בפועל, והן שומרות על המסך
 * ועל קובץ הייצוא בגודל שפוי.
 */
export const MAX_RANGE_DAYS = 750;

/** שם הפרשה בעברית. נופל למפתח האנגלי אם אין שורה – עדיף מאשר ריק. */
function parashaName(db: Database, iso: IsoDate): string | null {
  const key = parashaKeyForDate(iso);
  if (key === null) return null;
  return findOccasionByHebcalKey(db, key)?.name ?? key;
}

export function calendarDay(db: Database, iso: IsoDate): CalendarDayRow {
  const holiday = holidayForDate(iso);
  return {
    gregorian: iso,
    dayOfWeek: dayOfWeekName(iso),
    hebrew: toHebrewDate(iso),
    hebrewYear: hebrewYearLabel(new HDate(isoToLocalDate(iso)).getFullYear()),
    parasha: parashaName(db, iso),
    holiday,
    occasion: defaultOccasionFor(db, iso)?.name ?? null,
    isShabbat: isShabbat(iso),
    isHoliday: holiday !== null,
  };
}

export interface CalendarRangeInput {
  from: IsoDate;
  to: IsoDate;
}

export function calendarRange(db: Database, input: CalendarRangeInput): CalendarDayRow[] {
  const start = isoToLocalDate(input.from);
  const end = isoToLocalDate(input.to);
  if (end.getTime() < start.getTime()) {
    throw new Error('תאריך הסיום מוקדם מתאריך ההתחלה');
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`הטווח ארוך מ-${MAX_RANGE_DAYS} ימים. יש לצמצם את התאריכים.`);
  }

  const rows: CalendarDayRow[] = [];
  for (let i = 0; i < days; i++) {
    // בנייה מרכיבי התאריך ולא מחיבור מילישניות: מעבר שעון קיץ מזיז יום
    // שלם כשמוסיפים 24 שעות בכל צעד.
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    rows.push(calendarDay(db, localDateToIso(d)));
  }
  return rows;
}

/** החודש הלועזי שהתאריך נופל בו – ברירת המחדל בפתיחת המסך. */
export function monthRange(iso: IsoDate): CalendarRangeInput {
  const d = isoToLocalDate(iso);
  return {
    from: localDateToIso(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: localDateToIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}
