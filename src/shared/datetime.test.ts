import { describe, expect, it } from 'vitest';
import { nowIso, todayIso } from './datetime';

/**
 * חותמות הזמן חייבות להיות **מקומיות**. בלי זה, פעולה שנעשית בערב מוצגת
 * ביומן הביקורת בשעה מוקדמת יותר, ובאזורי זמן חיוביים היא אפילו מקבלת
 * את התאריך של אתמול – מה שסותר את `payment_date` שנקבע לפי היום המקומי.
 */
describe('חותמות זמן מקומיות', () => {
  it('todayIso מחזיר את היום המקומי, לא את היום ב-UTC', () => {
    // 01:00 בבוקר בשעון מקומי חיובי הוא עדיין אתמול ב-UTC.
    const d = new Date(2026, 8, 7, 1, 0, 0); // 7 בספטמבר 2026, 01:00 מקומי
    expect(todayIso(d)).toBe('2026-09-07');
  });

  it('nowIso מחזיר שעה מקומית בפורמט המערכת', () => {
    const d = new Date(2026, 8, 7, 14, 5, 9);
    expect(nowIso(d)).toBe('2026-09-07T14:05:09');
  });

  it('מרפד לאפסים בכל השדות', () => {
    expect(nowIso(new Date(2026, 0, 3, 4, 5, 6))).toBe('2026-01-03T04:05:06');
  });

  it('nowIso מתחיל תמיד ב-todayIso של אותו רגע', () => {
    const d = new Date(2026, 11, 31, 23, 59, 59);
    expect(nowIso(d).startsWith(todayIso(d))).toBe(true);
    expect(nowIso(d)).toBe('2026-12-31T23:59:59');
  });

  it('ברירת המחדל היא הרגע הנוכחי, ובאורך קבוע', () => {
    expect(nowIso()).toHaveLength(19);
    expect(todayIso()).toHaveLength(10);
    expect(nowIso().startsWith(todayIso())).toBe(true);
  });
});
