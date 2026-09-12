import { describe, expect, it } from 'vitest';
import {
  fiscalYearRange,
  hebrewInfo,
  hebrewYearForIssue,
  hebrewYearLabel,
  isoToLocalDate,
  localDateToIso,
  parashaKeyForDate,
  parashaKeyForVowDate,
  holidayCandidateKeys,
  holidayForDate,
  holidayKeysForDate,
  isShabbat,
  toHebrewDate,
} from './hebrewCalendar';

describe('המרות ISO ↔ Date', () => {
  it('לא מזיז את התאריך בגלל אזור זמן', () => {
    const d = isoToLocalDate('2023-09-01');
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
    expect(localDateToIso(d)).toBe('2023-09-01');
  });

  it('זורק על פורמט לא תקין', () => {
    expect(() => isoToLocalDate('01/09/2023')).toThrow();
  });
});

describe('שנה עברית', () => {
  it('מחשבת שנה נכונה במקום הטקסט הקבוע בקובץ הישן (ממצא #4)', () => {
    // 30/08/2026 = כ״ז אלול תשפ״ו – בקובץ הישן הודפס תמיד תשפ״ב
    expect(hebrewYearForIssue('2026-08-30T10:00:00')).toBe('תשפ״ו');
    // 20/09/2026 כבר אחרי ראש השנה תשפ״ז
    expect(hebrewYearForIssue('2026-09-20T10:00:00')).toBe('תשפ״ז');
  });

  it('gematriya', () => {
    expect(hebrewYearLabel(5783)).toBe('תשפ״ג');
    expect(hebrewYearLabel(5787)).toBe('תשפ״ז');
  });
});

describe('תאריך עברי', () => {
  it('מציג יום, חודש ושנה בעברית ללא ניקוד', () => {
    expect(toHebrewDate('2026-09-05')).toBe('כ״ג באלול תשפ״ו');
  });
});

describe('פרשת שבוע', () => {
  it('מזהה פרשה מחוברת', () => {
    expect(parashaKeyForDate('2026-09-05')).toBe('Nitzavim-Vayeilech');
  });

  it('נדר שנרשם ביום ראשון משויך לשבת שקדמה לו (F-31)', () => {
    // 2026-09-05 שבת (נצבים-וילך); 2026-09-06 ראשון
    expect(parashaKeyForVowDate('2026-09-06')).toBe('Nitzavim-Vayeilech');
    expect(parashaKeyForVowDate('2026-09-05')).toBe('Nitzavim-Vayeilech');
  });

  it('נדר ביום שישי משויך לשבת הקודמת', () => {
    expect(parashaKeyForVowDate('2026-09-11')).toBe('Nitzavim-Vayeilech');
  });
});

describe('hebrewInfo', () => {
  it('מחזיר את כל השדות', () => {
    const info = hebrewInfo('2026-09-12');
    expect(info.gregorian).toBe('2026-09-12');
    expect(info.hebrewYear).toBe('תשפ״ז');
    // שם החג בעברית, לא המזהה האנגלי של hebcal.
    expect(info.holiday).toBe('ראש השנה');
  });
});

describe('שם החג בעברית', () => {
  it('חג רגיל', () => {
    expect(holidayForDate('2026-10-03')).toBe('שמיני עצרת');
  });

  it('ערב חג', () => {
    expect(holidayForDate('2026-09-11')).toBe('ערב ראש השנה');
  });

  it('יום רגיל מחזיר null', () => {
    expect(holidayForDate('2026-10-17')).toBeNull();
  });

  it('השנה העברית נחתכת מהשם', () => {
    // hebcal מחזיר "Rosh Hashana 5787"; השנה כבר מופיעה בתאריך העברי לצדו.
    const name = holidayForDate('2026-09-12');
    expect(name).toBe('ראש השנה');
    expect(name).not.toMatch(/\d/);
  });

  it('חג מרובה ימים מקבל את היום שבו הוא עומד', () => {
    expect(holidayForDate('2026-12-12')).toContain('חנוכה');
  });

  it('אין מזהים באנגלית באף תאריך לאורך שנה', () => {
    // הרגרסיה שנמנעת: המזהה האנגלי הגולמי שדלף לחוזה ה-IPC.
    const start = new Date(2026, 0, 1);
    for (let i = 0; i < 365; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const name = holidayForDate(localDateToIso(d));
      if (name !== null) expect(name).toMatch(/[֐-׿]/);
    }
  });
});

describe('שנה כספית (B-07)', () => {
  it('ספטמבר–אוגוסט כברירת מחדל', () => {
    expect(fiscalYearRange(9, 2025)).toEqual({ from: '2025-09-01', to: '2026-08-31' });
  });

  it('תומך בחודש התחלה אחר – ערך פרמטרי מההגדרות', () => {
    expect(fiscalYearRange(1, 2025)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(fiscalYearRange(4, 2024)).toEqual({ from: '2024-04-01', to: '2025-03-31' });
  });
});

describe('מפתחות מועמדים לחג (F-31)', () => {
  it('מזהה פשוט מוחזר כמו שהוא', () => {
    expect(holidayCandidateKeys('Yom Kippur')).toEqual(['Yom Kippur']);
  });

  it('שנה עברית נחתכת', () => {
    expect(holidayCandidateKeys('Rosh Hashana 5787')).toContain('Rosh Hashana');
  });

  it('נקודתיים – חנוכה', () => {
    expect(holidayCandidateKeys('Chanukah: 3 Candles')).toContain('Chanukah');
  });

  it('סוגריים וספרה רומית – חול המועד', () => {
    const keys = holidayCandidateKeys("Pesach IV (CH''M)");
    expect(keys).toContain('Pesach IV');
    expect(keys).toContain('Pesach');
  });

  it('ספרה רומית בלבד', () => {
    expect(holidayCandidateKeys('Sukkot I')).toEqual(['Sukkot I', 'Sukkot']);
    expect(holidayCandidateKeys('Rosh Hashana II')).toContain('Rosh Hashana');
  });

  it('ההתאמה המדויקת תמיד ראשונה', () => {
    // אחרת 'הושענא רבה' ו'שביעי של פסח' לא היו נבחרים לעולם – הם היו
    // מתקלפים ל-Sukkot ול-Pesach לפני שהמפתח המדויק שלהם נבדק.
    expect(holidayCandidateKeys('Sukkot VII (Hoshana Raba)')[0]).toBe(
      'Sukkot VII (Hoshana Raba)',
    );
    expect(holidayCandidateKeys('Pesach VII')[0]).toBe('Pesach VII');
  });

  it('אין קילוף שהופך יום כיפור קטן ליום כיפור', () => {
    // המלכודת המסוכנת ביותר: תשעה ימי כיפור קטן בשנה, כולם מתחילים
    // ב-"Yom Kippur".
    for (const desc of ['Yom Kippur Katan Adar', "Yom Kippur Katan Sh'vat"]) {
      expect(holidayCandidateKeys(desc)).not.toContain('Yom Kippur');
    }
  });

  it('לא נוצרות כפילויות ברשימה', () => {
    const keys = holidayCandidateKeys('Purim');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('תאריך עם כמה אירועים מחזיר את כולם', () => {
    // 10/12/2026 – חג הבנות, נר ז׳ של חנוכה, ראש חודש טבת.
    expect(holidayKeysForDate('2026-12-10')).toContain('Chanukah');
  });

  it('יום רגיל מחזיר רשימה ריקה', () => {
    expect(holidayKeysForDate('2026-10-17')).toEqual([]);
  });
});

describe('isShabbat', () => {
  it('מזהה שבת', () => {
    expect(isShabbat('2026-09-12')).toBe(true);
    expect(isShabbat('2026-09-11')).toBe(false);
    expect(isShabbat('2026-09-13')).toBe(false);
  });
});
