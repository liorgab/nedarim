import { HDate, HebrewCalendar, Locale, gematriya, getSedra } from '@hebcal/core';
import type { HebrewDateInfo, IsoDate } from '@shared/types';

/**
 * עטיפה יחידה סביב @hebcal/core (B-06). כל חישוב של תאריך עברי, שנה עברית או
 * פרשת שבוע במערכת עובר דרך כאן – לא ישירות מול הספרייה.
 *
 * `israel = true`: לוח ארץ ישראל (יום טוב אחד), כפי שנהוג בבית הכנסת.
 */
const ISRAEL = true;

/** בונה Date מקומי מתאריך ISO בלי להיגרר לאזור זמן (מלכודת שנמצאה בקובץ הישן). */
export function isoToLocalDate(iso: IsoDate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`תאריך ISO לא תקין: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function localDateToIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function todayIso(): IsoDate {
  return localDateToIso(new Date());
}

/** שנה עברית באותיות, למשל 5787 → 'תשפ״ז'. */
export function hebrewYearLabel(hebrewYear: number): string {
  return gematriya(hebrewYear);
}

/** התאריך העברי המלא בעברית, למשל 'כ״ג באלול תשפ״ו'. */
export function toHebrewDate(iso: IsoDate): string {
  const hd = new HDate(isoToLocalDate(iso));
  const day = gematriya(hd.getDate());
  const month = Locale.gettext(hd.getMonthName(), 'he-x-NoNikud') || hd.getMonthName();
  return `${day} ב${month} ${hebrewYearLabel(hd.getFullYear())}`;
}

/** מפתח הפרשה של השבת של אותו שבוע (או של התאריך עצמו אם הוא שבת). */
export function parashaKeyForDate(iso: IsoDate): string | null {
  const hd = new HDate(isoToLocalDate(iso));
  const sedra = getSedra(hd.getFullYear(), ISRAEL);
  const parts = sedra.get(hd);
  if (!parts || parts.length === 0) return null;
  return parts.join('-');
}

/**
 * hebcal מוסיף את השנה העברית לשמות מסוימים ("Rosh Hashana 5787" →
 * "ראש השנה 5787"). בצ'יפ בממשק זו כפילות – השנה כבר מופיעה בתאריך העברי לצדו.
 */
const TRAILING_YEAR = /\s+\d{4}$/;

/**
 * שם החג שחל בתאריך, **בעברית**, אם יש.
 *
 * התרגום מגיע מ-hebcal עצמו (`render('he-x-NoNikud')`) ולא מטבלת `occasion`:
 * `getHolidaysOnDate` מחזיר מזהים כמו `Chanukah: 8th Day` ו-`Pesach III
 * (CH''M)` שאין להם שורה בטבלה, ומיפוי ידני שלהם היה רשימה שמתיישנת.
 * אותו מקור ואותו locale שמשמשים כבר ב-`toHebrewDate`.
 */
export function holidayForDate(iso: IsoDate): string | null {
  const events = HebrewCalendar.getHolidaysOnDate(new HDate(isoToLocalDate(iso)), ISRAEL);
  const event = events?.[0];
  if (!event) return null;
  try {
    const he = event.render('he-x-NoNikud').trim();
    return he === '' ? null : he.replace(TRAILING_YEAR, '');
  } catch {
    // locale חסר – עדיף המזהה האנגלי מאשר כלום.
    return event.getDesc();
  }
}

/**
 * מפתחות מועמדים לחיפוש ב-`occasion`, מהספציפי לכללי.
 *
 * `getHolidaysOnDate` מחזיר 97 מזהים שונים לאורך שלוש שנים, בכמה צורות:
 * `Yom Kippur` · `Rosh Hashana 5787` · `Chanukah: 3 Candles` ·
 * `Pesach IV (CH''M)` · `Sukkot VII (Hoshana Raba)`. הטבלה מחזיקה את
 * הצורה הקנונית, ולכן צריך לקלף.
 *
 * **הסדר קריטי.** ההתאמה המדויקת ראשונה, אחרת `Sukkot VII (Hoshana Raba)`
 * היה מתקלף ל-`Sukkot` ו'הושענא רבה' לא הייתה נבחרת לעולם. מאותה סיבה
 * `Pesach VII` (שביעי של פסח) חייב להתאים לפני קילוף הספרה הרומית.
 *
 * **אין התאמת prefix.** `Yom Kippur Katan Adar` מתחיל ב-`Yom Kippur`, וכל
 * אחד מתשעת ימי כיפור קטן בשנה היה הופך ליום כיפור.
 */
export function holidayCandidateKeys(desc: string): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    const t = v.trim();
    if (t !== '' && !out.includes(t)) out.push(t);
  };

  add(desc);
  add(desc.replace(TRAILING_YEAR, ''));

  const base = desc.replace(TRAILING_YEAR, '');
  // "Chanukah: 3 Candles" → "Chanukah"
  const colon = base.indexOf(':');
  if (colon > 0) add(base.slice(0, colon));
  // "Pesach IV (CH''M)" → "Pesach IV"
  const withoutParens = base.replace(/\s*\([^)]*\)\s*$/, '');
  add(withoutParens);
  // "Pesach IV" → "Pesach", "Rosh Hashana II" → "Rosh Hashana"
  add(withoutParens.replace(/\s+[IVX]+$/, ''));

  return out;
}

/**
 * כל המפתחות המועמדים לכל החגים שחלים בתאריך, בסדר שבו hebcal מחזיר אותם.
 *
 * לתאריך אחד עשויים לחול כמה אירועים (10/12/2026: חג הבנות, נר ז׳ של
 * חנוכה, וראש חודש טבת), ולכן עוברים על כולם ולא רק על הראשון.
 */
export function holidayKeysForDate(iso: IsoDate): string[] {
  const events = HebrewCalendar.getHolidaysOnDate(new HDate(isoToLocalDate(iso)), ISRAEL) ?? [];
  return events.flatMap((ev) => holidayCandidateKeys(ev.getDesc()));
}

/** האם התאריך הוא שבת. */
export function isShabbat(iso: IsoDate): boolean {
  return isoToLocalDate(iso).getDay() === 6;
}

/** כל המידע העברי לתאריך אחד – זה מה שנחשף ב-IPC. */
export function hebrewInfo(iso: IsoDate): HebrewDateInfo {
  const hd = new HDate(isoToLocalDate(iso));
  return {
    gregorian: iso,
    hebrew: toHebrewDate(iso),
    hebrewYear: hebrewYearLabel(hd.getFullYear()),
    parasha: parashaKeyForDate(iso),
    holiday: holidayForDate(iso),
  };
}

/**
 * הפרשה הרלוונטית להזנת נדר בתאריך נתון (F-31): השבת האחרונה שעברה,
 * ואם התאריך עצמו שבת – היא עצמה. נדרים נרשמים במוצאי שבת על מה שהיה בבוקר.
 */
export function parashaKeyForVowDate(iso: IsoDate): string | null {
  const d = isoToLocalDate(iso);
  const daysSinceShabbat = (d.getDay() + 1) % 7; // 6=שבת → 0
  d.setDate(d.getDate() - daysSinceShabbat);
  return parashaKeyForDate(localDateToIso(d));
}

/** שנה עברית של מועד ההפקה – מודפסת על הקבלה (SPEC 4.6). */
export function hebrewYearForIssue(isoDateTime: string): string {
  const iso = isoDateTime.slice(0, 10) as IsoDate;
  return hebrewYearLabel(new HDate(isoToLocalDate(iso)).getFullYear());
}

/**
 * גבולות שנה כספית לפי חודש התחלה מההגדרות (B-07).
 * לדוגמה חודש 9 ושנה 2025 → 2025-09-01 עד 2026-08-31.
 */
export function fiscalYearRange(
  startMonth: number,
  startYear: number,
): { from: IsoDate; to: IsoDate } {
  const from = new Date(startYear, startMonth - 1, 1);
  const to = new Date(startYear + 1, startMonth - 1, 0);
  return { from: localDateToIso(from), to: localDateToIso(to) };
}
