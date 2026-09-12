import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import {
  MAX_RANGE_DAYS,
  calendarDay,
  calendarRange,
  dayOfWeekName,
  monthRange,
} from './calendarRange';
import {
  calendarFileName,
  calendarTable,
  calendarTitle,
  renderCalendarHtml,
} from './calendarPrint';
import { toCsv } from './exporters';

/** F-90 – לוח שנה. */

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-cal-'));
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

describe('dayOfWeekName', () => {
  it('שבת וראשון', () => {
    expect(dayOfWeekName('2026-09-12')).toBe('שבת');
    expect(dayOfWeekName('2026-09-13')).toBe('ראשון');
    expect(dayOfWeekName('2026-09-11')).toBe('שישי');
  });
});

describe('calendarDay', () => {
  it('יום עם חג – ראש השנה', () => {
    const row = calendarDay(db, '2026-09-12');
    expect(row).toMatchObject({
      gregorian: '2026-09-12',
      dayOfWeek: 'שבת',
      hebrewYear: 'תשפ״ז',
      holiday: 'ראש השנה',
      isShabbat: true,
      isHoliday: true,
    });
    expect(row.hebrew).toContain('תשרי');
  });

  it('יום חול רגיל', () => {
    const row = calendarDay(db, '2026-10-13');
    expect(row.holiday).toBeNull();
    expect(row.isHoliday).toBe(false);
    expect(row.isShabbat).toBe(false);
    // `parasha` היא פרשת השבוע שהיום נמצא בו – כלומר השבת **הקרובה**
    // (17/10 = נח). זו מוסכמת הלוח, ובכוונה שונה מעמודת האירוע.
    expect(row.parasha).toBe('נח');
  });

  it('פרשת השבוע ואירוע הנדר נבדלים בכוונה', () => {
    // שלישי 13/10/2026: השבוע הוא של נח (השבת הקרובה), אבל נדר שנרשם
    // באותו יום שייך לשבת שעברה – בראשית (F-31).
    const row = calendarDay(db, '2026-10-13');
    expect(row.parasha).toBe('נח');
    expect(row.occasion).toBe('בראשית');
  });

  it('הפרשה מוצגת בעברית ולא כמפתח אנגלי', () => {
    for (const iso of ['2026-10-10', '2026-10-13', '2027-04-17']) {
      expect(calendarDay(db, iso).parasha).toMatch(/[֐-׿]/);
    }
  });

  it('עמודת האירוע תואמת לברירת המחדל בהזנת נדר', () => {
    // 21/09/2026 – יום כיפור בשני. אותה לוגיקה, לא חישוב שני.
    expect(calendarDay(db, '2026-09-21').occasion).toBe('יום כיפור');
  });
});

describe('calendarRange', () => {
  it('מחזיר יום לכל יום בטווח כולל הקצוות', () => {
    const rows = calendarRange(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(rows).toHaveLength(30);
    expect(rows[0]!.gregorian).toBe('2026-09-01');
    expect(rows[29]!.gregorian).toBe('2026-09-30');
  });

  it('יום בודד', () => {
    expect(calendarRange(db, { from: '2026-09-12', to: '2026-09-12' })).toHaveLength(1);
  });

  it('אין ימים כפולים או חסרים לאורך שנה', () => {
    // המלכודת: הוספת 24 שעות בכל צעד מדלגת או משכפלת יום במעבר שעון קיץ.
    const rows = calendarRange(db, { from: '2026-01-01', to: '2026-12-31' });
    expect(rows).toHaveLength(365);
    expect(new Set(rows.map((r) => r.gregorian)).size).toBe(365);
  });

  it('חוצה מעבר שעון קיץ בלי לאבד יום', () => {
    const rows = calendarRange(db, { from: '2026-03-25', to: '2026-04-02' });
    expect(rows.map((r) => r.gregorian)).toEqual([
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
  });

  it('טווח הפוך נחסם', () => {
    expect(() => calendarRange(db, { from: '2026-09-30', to: '2026-09-01' })).toThrow(/מוקדם/);
  });

  it('טווח ארוך מדי נחסם עם הודעה מובנת', () => {
    expect(() => calendarRange(db, { from: '2020-01-01', to: '2030-01-01' })).toThrow(
      new RegExp(String(MAX_RANGE_DAYS)),
    );
  });

  it('בדיוק בגבול עובר', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, MAX_RANGE_DAYS);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(calendarRange(db, { from: iso(start), to: iso(end) })).toHaveLength(MAX_RANGE_DAYS);
  });
});

describe('monthRange', () => {
  it('חודש מלא', () => {
    expect(monthRange('2026-09-11')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('חודש בן 31', () => {
    expect(monthRange('2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('פברואר בשנה מעוברת', () => {
    expect(monthRange('2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('פברואר בשנה רגילה', () => {
    expect(monthRange('2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('דצמבר אינו גולש לשנה הבאה', () => {
    expect(monthRange('2026-12-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('ייצוא והדפסה', () => {
  const rows = () => calendarRange(db, { from: '2026-09-11', to: '2026-09-13' });

  it('הטבלה נבנית עם שש עמודות', () => {
    const table = calendarTable(rows(), 'בדיקה');
    expect(table.columns).toHaveLength(6);
    expect(table.rows).toHaveLength(3);
    expect(table.totals).toBeNull();
  });

  it('CSV מכיל את התאריך הלועזי בפורמט תצוגה ואת התאריך העברי', () => {
    const csv = toCsv(calendarTable(rows(), 'בדיקה'));
    expect(csv).toContain('11/09/2026');
    expect(csv).toContain('ערב ראש השנה');
    // BOM, אחרת Excel בעברית פותח ג'יבריש.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('שם הקובץ ללא תווים אסורים ב-Windows', () => {
    // הכותרת עצמה מכילה `/` כחלק מ-dd/mm/yyyy, ולכן שם הקובץ נפרד ממנה –
    // אחרת דיאלוג השמירה נפתח עם נתיב שבור.
    expect(calendarTitle('2026-09-01', '2026-09-30')).toContain('/');
    expect(calendarFileName('2026-09-01', '2026-09-30')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('ה-HTML הוא RTL ומכיל את כל השורות', () => {
    const html = renderCalendarHtml({
      rows: rows(),
      title: 'בדיקה',
      subtitle: 'תת-כותרת',
      synagogueName: 'בית הכנסת',
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('11/09/2026');
    expect(html).toContain('13/09/2026');
    // שבת מסומנת גם במחלקה וגם בהדגשה, כדי לשרוד הדפסה בשחור-לבן.
    expect(html).toContain('class="shabbat holiday"');
    expect(html).toContain('font-weight: 700');
    // הכותרת חוזרת בכל עמוד.
    expect(html).toContain('table-header-group');
  });

  it('HTML בורח מתווים מיוחדים', () => {
    const html = renderCalendarHtml({
      rows: [],
      title: '<script>alert(1)</script>',
      subtitle: '',
      synagogueName: 'בית הכנסת "דוגמה"',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });
});
