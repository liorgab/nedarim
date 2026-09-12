import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { localDateToIso, parashaKeyForDate } from './hebrewCalendar';
import { findOccasionByHebcalKey } from './lookups';
import { defaultOccasionFor } from './vows';

/**
 * כיסוי `occasion.hebcal_key` מול מה ש-`getSedra` באמת מחזיר.
 *
 * הרקע (מיגרציה 008): `hebcal_key` נקרא אך ורק במסלול של `getSedra`, אבל
 * ל-'פסח' ול-'סוכות' נרשמו `Pesach I`/`Sukkot I` – מזהי האירוע של
 * `getHolidaysOnDate`, מקור אחר לגמרי ש-`getSedra` לעולם לא מחזיר. לשתי
 * שבתות חול המועד לא נרשם מפתח כלל. התוצאה: ארבע שבתות בלי ברירת מחדל
 * בהזנת נדר, דווקא אלה עם הקהל הגדול.
 *
 * הבדיקה סורקת שנים ולא תאריכים בודדים, כי בדיוק זה מה שהחמיץ אותן: כל
 * אחת מהן חוזרת רק אחת לכמה שנים, ואף בדיקה עם תאריך קבוע לא הייתה נוגעת
 * בהן.
 */

const YEARS = 12;
const START = new Date(2025, 0, 1);

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-occ-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

/** כל השבתות בטווח הסריקה, עם מפתח הסדרה שלהן. */
function shabbatKeys(): Array<{ iso: string; key: string }> {
  const out: Array<{ iso: string; key: string }> = [];
  for (let i = 0; i < 365 * YEARS; i++) {
    const d = new Date(START.getFullYear(), START.getMonth(), START.getDate() + i);
    if (d.getDay() !== 6) continue;
    const iso = localDateToIso(d);
    const key = parashaKeyForDate(iso);
    if (key !== null) out.push({ iso, key });
  }
  return out;
}

describe('כיסוי אירועים מול getSedra', () => {
  it(`לכל שבת ב-${YEARS} שנים יש אירוע מתאים בטבלה`, () => {
    const unmapped = new Map<string, string>();
    for (const { iso, key } of shabbatKeys()) {
      if (findOccasionByHebcalKey(db, key) === null && !unmapped.has(key)) {
        unmapped.set(key, iso);
      }
    }
    // הודעת כישלון שאומרת גם *מה* חסר וגם *מתי* – בלי זה צריך לשחזר סריקה.
    expect(
      [...unmapped].map(([key, iso]) => `${key} (${iso})`),
      'מפתחות סדרה ללא שורה ב-occasion',
    ).toEqual([]);
  });

  it('נסרקו מספיק שבתות כדי שהבדיקה תהיה משמעותית', () => {
    // שומר מפני סריקה שהתרוקנה בשקט ועברה על ריק.
    const rows = shabbatKeys();
    expect(rows.length).toBeGreaterThan(600);
    expect(new Set(rows.map((r) => r.key)).size).toBeGreaterThan(60);
  });

  it('ארבע השבתות שהיו שבורות לפני מיגרציה 008', () => {
    const cases: Array<[string, string]> = [
      ['2027-04-24', 'שבת חול המועד פסח'],
      ['2025-10-11', 'שבת חול המועד סוכות'],
      ['2029-03-31', 'פסח'], // פסח שחל בשבת
      ['2026-09-26', 'סוכות'], // סוכות שחל בשבת
    ];
    for (const [iso, expected] of cases) {
      expect(defaultOccasionFor(db, iso)?.name, iso).toBe(expected);
    }
  });

  it('Pesach I ו-Sukkot I אינם משמשים יותר כמפתחות', () => {
    // הם מזהי getHolidaysOnDate; getSedra לעולם לא מחזיר אותם, ולכן שורה
    // שנושאת אותם אינה ניתנת להגעה.
    const dead = db
      .prepare("SELECT name FROM occasion WHERE hebcal_key IN ('Pesach I','Sukkot I')")
      .all();
    expect(dead).toEqual([]);
  });

  it('שבת רגילה ממשיכה לעבוד', () => {
    expect(defaultOccasionFor(db, '2026-10-10')?.name).toBe('בראשית');
    expect(defaultOccasionFor(db, '2027-04-17')?.name).toBe('מצורע');
  });

  it('ברירת המחדל באמצע שבוע היא השבת שעברה (F-31)', () => {
    // יום שלישי אחרי שבת בראשית.
    expect(defaultOccasionFor(db, '2026-10-13')?.name).toBe('בראשית');
  });
});

describe('חג גובר על השבת האחרונה ביום חול (F-31)', () => {
  it('יום כיפור באמצע שבוע', () => {
    // 21/09/2026 – יום שני. לפני השינוי: "נצבים-וילך".
    expect(defaultOccasionFor(db, '2026-09-21')?.name).toBe('יום כיפור');
  });

  it('יום ראשון של פסח באמצע שבוע', () => {
    // 22/04/2027 – חמישי. זה המקרה שפתח את הדיון; לפני כן: "מצורע".
    expect(defaultOccasionFor(db, '2027-04-22')?.name).toBe('פסח');
  });

  it('שבועות – המקרה שדרש את מיגרציה 009', () => {
    // hebcal מחזיר `Shavuot`, ובטבלה היה `Shavuot I`.
    expect(defaultOccasionFor(db, '2026-05-22')?.name).toBe('שבועות');
  });

  it('חנוכה באמצע שבוע', () => {
    expect(defaultOccasionFor(db, '2026-12-07')?.name).toBe('חנוכה');
  });

  it('הושענא רבה מקבל את עצמו ולא את "סוכות"', () => {
    // ההתאמה המדויקת קודמת לקילוף – אחרת 'הושענא רבה' לא היה נבחר לעולם.
    expect(defaultOccasionFor(db, '2026-10-02')?.name).toBe('הושענא רבה');
  });

  it('שביעי של פסח מקבל את עצמו ולא את "פסח"', () => {
    expect(defaultOccasionFor(db, '2026-04-08')?.name).toBe('שביעי של פסח');
  });

  it('חול המועד סוכות ביום חול → סוכות', () => {
    expect(defaultOccasionFor(db, '2026-09-28')?.name).toBe('סוכות');
  });

  it('ראש השנה יום שני', () => {
    expect(defaultOccasionFor(db, '2026-09-13')?.name).toBe('ראש השנה');
  });
});

describe('מה שלא אמור להשתנות', () => {
  it('בשבת מנצחת הקריאה ולא רשימת החגים', () => {
    // שבת חול המועד פסח: getSedra מדייק (`Pesach Shabbat Chol ha-Moed`)
    // בעוד שרשימת החגים הייתה מתקלפת ל'פסח'.
    expect(defaultOccasionFor(db, '2027-04-24')?.name).toBe('שבת חול המועד פסח');
    expect(defaultOccasionFor(db, '2025-10-11')?.name).toBe('שבת חול המועד סוכות');
  });

  it('שבת רגילה – פרשה', () => {
    expect(defaultOccasionFor(db, '2026-10-10')?.name).toBe('בראשית');
  });

  it('יום חול ללא חג – השבת האחרונה, כמו קודם', () => {
    expect(defaultOccasionFor(db, '2026-10-13')?.name).toBe('בראשית');
    expect(defaultOccasionFor(db, '2026-10-15')?.name).toBe('בראשית');
  });

  it('יום זיכרון או ראש חודש אינם חוטפים את ברירת המחדל', () => {
    // הם מוחזרים על ידי hebcal אך אין להם שורה ב-occasion, והטבלה היא
    // המסננת. יום הזיכרון ליצחק רבין – 22/10/2026, חמישי; השבת שקדמה
    // לו (17/10) היא פרשת נח.
    expect(defaultOccasionFor(db, '2026-10-22')?.name).toBe('נח');
    // ראש חודש חשון – 11/10/2026, ראשון.
    expect(defaultOccasionFor(db, '2026-10-11')?.name).toBe('בראשית');
  });

  it('יום כיפור קטן אינו הופך ליום כיפור', () => {
    // 16/02/2026, יום שני. הבדיקה המכרעת נגד התאמת prefix.
    expect(defaultOccasionFor(db, '2026-02-16')?.name).not.toBe('יום כיפור');
  });

  it('הגבאי שולט: השבתת האירוע מחזירה את הפרשה', () => {
    // כלל 12 – רשימת האירועים היא שלו.
    expect(defaultOccasionFor(db, '2026-09-21')?.name).toBe('יום כיפור');
    db.prepare("UPDATE occasion SET is_active = 0 WHERE name = 'יום כיפור'").run();
    // השבת שקדמה ל-21/09/2026 היא 19/09 – שבת שובה, פרשת האזינו.
    expect(defaultOccasionFor(db, '2026-09-21')?.name).toBe('האזינו');
  });
});
