import { describe, expect, it } from 'vitest';
import { VOW_ITEMS } from '../db/vow-items';
import { decideScope } from './vowItemScope';

/**
 * F-141 – השיוך של כל כיבוד למועד.
 *
 * הבדיקה רצה על **כל 103 השורות** של הפנקס ולא על דוגמאות: שיוך שגוי
 * מציג לגבאי את הרשימה הלא נכונה בדיוק ברגע שבו אין לו זמן לחפש.
 */

const byName = (name: string) => {
  const item = VOW_ITEMS.find((i) => i.name === name);
  if (item === undefined) throw new Error(`אין שורה בשם "${name}" בפנקס`);
  return decideScope(item);
};

describe('שבת רגילה', () => {
  it('כל 18 הכיבודים של שבת רגילה הם shabbat', () => {
    const shabbat = VOW_ITEMS.filter((i) => i.category === 'שבת רגילה');
    expect(shabbat).toHaveLength(18);
    for (const item of shabbat) {
      expect(decideScope(item).scope, item.name).toBe('shabbat');
    }
  });

  it('עלייה בשבת אינה נקשרת לחג', () => {
    expect(byName('עליית שלישי (שחרית)')).toEqual({ scope: 'shabbat', occasions: [] });
  });
});

describe('ימים נוראים', () => {
  it('כל נדרי – יום כיפור', () => {
    expect(byName('פתיחת ההיכל ל"כל נדרי"').occasions).toEqual(['יום כיפור']);
  });

  it('מפטיר יונה – יום כיפור', () => {
    expect(byName('מפטיר יונה (קריאת ספר יונה)').occasions).toEqual(['יום כיפור']);
  });

  it('נעילה – יום כיפור', () => {
    expect(byName('פתיחת ההיכל ל"נעילה"').occasions).toEqual(['יום כיפור']);
  });

  it('תפילת המלך – ראש השנה', () => {
    // בשם מופיע (ר"ה) בלבד, בלי המילה "ראש השנה".
    expect(byName('פתיחת ההיכל לתפילת המלך / ספרי תורה (ר"ה)').occasions).toEqual(['ראש השנה']);
  });
});

describe('סדר הכללים', () => {
  it('שביעי של פסח אינו נופל לפסח', () => {
    // בלי הסדר הנכון כל כיבודי השביעי היו נעלמים מהיום שבו הם נמכרים.
    expect(byName('שביעי של פסח - עליית שלישי (שירת הים)').occasions).toEqual(['שביעי של פסח']);
  });

  it('אחרון של פסח – עם שביעי של פסח', () => {
    expect(byName('אחרון של פסח (חו"ל) - עליית ראשון (כהן)').occasions).toEqual([
      'שביעי של פסח',
    ]);
  });

  it('פסח יום א׳ – פסח', () => {
    expect(byName("פסח - יום א' - עליית ראשון (כהן)").occasions).toEqual(['פסח']);
  });

  it('חול המועד פסח – גם שבת חוה״מ וגם פסח', () => {
    expect(byName('חול המועד פסח - עליית ראשון').occasions).toEqual([
      'שבת חול המועד פסח',
      'פסח',
    ]);
  });

  it('שמיני עצרת אינו נופל לסוכות', () => {
    expect(byName('שמיני עצרת - עליית ראשון (כהן)').occasions).toEqual(['שמיני עצרת']);
  });

  it('הקפות של שמחת תורה', () => {
    expect(byName('מכירת הקפה 1 (שמחת תורה)').occasions).toEqual(['שמחת תורה', 'הקפות']);
  });

  it('חתן תורה – שמחת תורה', () => {
    expect(byName('עליית חתן תורה (שמחת תורה)').occasions).toEqual(['שמחת תורה']);
  });

  it('סוכות יום א׳ – סוכות', () => {
    expect(byName("סוכות - יום א' - עליית ראשון (כהן)").occasions).toEqual(['סוכות']);
  });

  it('שבועות', () => {
    expect(byName("שבועות - יום א' - עליית שלישי (עשרת הדיברות)").occasions).toEqual(['שבועות']);
  });
});

describe('מצוות תקופתיות – תזמון המכירה הוא הקובע', () => {
  it('פרנס קיץ נמכר בערב פסח, ולכן הוא של פסח', () => {
    // הוא מבורך בכל שבת במשך חצי שנה, אבל **נמכר** בערב פסח.
    const decision = byName('פרנס חצי-שנתי (קיץ)');
    expect(decision.occasions).toEqual(['פסח']);
  });

  it('פרנס חורף ופרנס השנה נמכרים בערב יום כיפור', () => {
    expect(byName('פרנס חצי-שנתי (חורף)').occasions).toEqual(['יום כיפור']);
    expect(byName('פרנס השנה').occasions).toEqual(['יום כיפור']);
  });

  it('שמן למאור שנתי – ערב יום כיפור', () => {
    expect(byName('שמן למאור שנתי').occasions).toEqual(['יום כיפור']);
  });

  it('פרנס החודש נמכר בשבת מברכים – שבת', () => {
    expect(byName('פרנס החודש').scope).toBe('shabbat');
  });

  it('שמן למאור שבועי נמכר בכל שבת', () => {
    expect(byName('שמן למאור שבועי').scope).toBe('shabbat');
  });
});

describe('כיסוי מלא של הפנקס', () => {
  it('לכל 103 השורות יש שיוך', () => {
    expect(VOW_ITEMS).toHaveLength(103);
    for (const item of VOW_ITEMS) {
      const decision = decideScope(item);
      if (decision.scope === 'occasion') {
        expect(decision.occasions.length, item.name).toBeGreaterThan(0);
      }
    }
  });

  it('אף שורה אינה נופלת ל-always', () => {
    // `always` הוא רשת ביטחון לכיבוד שהגבאי יוסיף, לא מצב נורמלי לפנקס
    // שהגיע מהקובץ. שורה כזו פירושה כלל חסר.
    const unmatched = VOW_ITEMS.filter((i) => decideScope(i).scope === 'always');
    expect(unmatched.map((i) => i.name)).toEqual([]);
  });

  it('כל שם מועד שמוחזר קיים ברשימת המועדים הזרועה', async () => {
    // אחרת השיוך מצביע על מועד שאינו קיים, והרשימה תישאר ריקה תמיד.
    const { HOLIDAYS } = await import('../db/seed-data');
    const known = new Set(HOLIDAYS.map((h) => h.he));
    for (const item of VOW_ITEMS) {
      for (const name of decideScope(item).occasions) {
        expect(known.has(name), `${item.name} → ${name}`).toBe(true);
      }
    }
  });
});
