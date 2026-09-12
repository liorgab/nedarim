import { describe, expect, it } from 'vitest';
import type { ImportField } from './catalog';
import { parseBool, parseChoice, parseDate, parseField, parseMoney, parseNumber, toText } from './parse';

/**
 * זה הקוד שמחליט אם "1,250.50" הוא 125050 אגורות. טעות כאן נכנסת ל-DB
 * כנתון כספי שגוי, ואי אפשר לדעת מהיתרה הסופית אילו שורות נפגעו.
 */

const value = (r: ReturnType<typeof parseMoney>) => (r.ok ? r.value : `שגיאה: ${r.message}`);

describe('toText', () => {
  it('מנרמל רווחים ומגזם', () => {
    expect(toText('  ישראל   ישראלי  ')).toBe('ישראל ישראלי');
  });

  it('ריק וחסר', () => {
    for (const v of [null, undefined, '', '   ']) expect(toText(v)).toBe('');
  });

  it('מספר מ-Excel', () => {
    expect(toText(360)).toBe('360');
  });

  it('תאריך מ-Excel מגיע כאובייקט Date', () => {
    expect(toText(new Date(Date.UTC(2026, 8, 12)))).toBe('2026-09-12');
  });
});

describe('parseDate', () => {
  it('dd/mm/yyyy – הפורמט של הגבאי', () => {
    expect(value(parseDate('18/10/2025'))).toBe('2025-10-18');
  });

  it('נקודות ומקפים כמפרידים', () => {
    expect(value(parseDate('18.10.2025'))).toBe('2025-10-18');
    expect(value(parseDate('18-10-2025'))).toBe('2025-10-18');
  });

  it('ספרה בודדת ביום ובחודש', () => {
    expect(value(parseDate('5/9/2026'))).toBe('2026-09-05');
  });

  it('ISO מתקבל כמו שהוא', () => {
    expect(value(parseDate('2026-09-12'))).toBe('2026-09-12');
  });

  it('ריק הוא null ולא שגיאה', () => {
    expect(value(parseDate(''))).toBeNull();
  });

  it('תאריך שאינו קיים נדחה', () => {
    // 31/02 עובר בדיקת טווח אבל אינו יום אמיתי.
    for (const bad of ['31/02/2026', '30/02/2026', '32/01/2026', '01/13/2026']) {
      expect(parseDate(bad).ok, bad).toBe(false);
    }
  });

  it('שנה מעוברת', () => {
    expect(value(parseDate('29/02/2028'))).toBe('2028-02-29');
    expect(parseDate('29/02/2026').ok).toBe(false);
  });

  it('טקסט שאינו תאריך – ההודעה אומרת מה מצופה', () => {
    const r = parseDate('אתמול');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('dd/mm/yyyy');
  });

  it('mm/dd אינו מנוחש – 13 בחודש נדחה ולא מתהפך', () => {
    // פרשנות אוטומטית הייתה הופכת 01/13 ל-13 בינואר בשקט.
    expect(parseDate('01/13/2026').ok).toBe(false);
  });
});

describe('parseMoney', () => {
  it('שקלים לאגורות', () => {
    expect(value(parseMoney('360'))).toBe(36000);
    expect(value(parseMoney('0'))).toBe(0);
  });

  it('אגורות נשמרות במדויק', () => {
    // 12.34 * 100 ב-JavaScript הוא 1233.9999999999998.
    expect(value(parseMoney('12.34'))).toBe(1234);
    expect(value(parseMoney('1250.50'))).toBe(125050);
    expect(value(parseMoney('0.01'))).toBe(1);
  });

  it('פסיקים, ₪ ורווחים', () => {
    expect(value(parseMoney('1,250.50'))).toBe(125050);
    expect(value(parseMoney(' 360 ₪ '))).toBe(36000);
    expect(value(parseMoney('12,816'))).toBe(1281600);
  });

  it('סכום שלילי – זיכוי או החזר', () => {
    expect(value(parseMoney('-500'))).toBe(-50000);
  });

  it('ריק הוא null', () => {
    expect(value(parseMoney(''))).toBeNull();
  });

  it('טקסט נדחה ולא הופך ל-NaN', () => {
    for (const bad of ['בערך 300', '12.3.4', '--5', '3א']) {
      expect(parseMoney(bad).ok, bad).toBe(false);
    }
  });

  it('סכומים גדולים', () => {
    expect(value(parseMoney('123456.78'))).toBe(12345678);
  });
});

describe('parseNumber', () => {
  it('מספר שלם', () => {
    expect(value(parseNumber('35'))).toBe(35);
    expect(value(parseNumber('1,268'))).toBe(1268);
  });

  it('ריק', () => {
    expect(value(parseNumber(''))).toBeNull();
  });

  it('שבר נדחה – מספר חבר אינו 3.5', () => {
    expect(parseNumber('3.5').ok).toBe(false);
  });

  it('טקסט נדחה', () => {
    expect(parseNumber('חבר 35').ok).toBe(false);
  });
});

describe('parseBool', () => {
  it('כן ולא בעברית', () => {
    expect(value(parseBool('כן'))).toBe(1);
    expect(value(parseBool('לא'))).toBe(0);
  });

  it('צורות נפוצות מקובץ שנערך ביד', () => {
    for (const t of ['yes', 'TRUE', '1', 'V', '✓']) expect(value(parseBool(t)), t).toBe(1);
    for (const f of ['no', 'false', '0', '-']) expect(value(parseBool(f)), f).toBe(0);
  });

  it('ריק הוא null – ברירת המחדל של השדה קובעת', () => {
    expect(value(parseBool(''))).toBeNull();
  });

  it('ערך לא מוכר נדחה ולא מפורש כ"לא"', () => {
    expect(parseBool('אולי').ok).toBe(false);
  });
});

describe('parseChoice', () => {
  const choices = ['פעיל', 'לא פעיל'];

  it('התאמה מדויקת', () => {
    expect(value(parseChoice('פעיל', choices))).toBe('פעיל');
  });

  it('רווחים כפולים וגרשיים לא מפילים התאמה', () => {
    expect(value(parseChoice('  לא  פעיל ', choices))).toBe('לא פעיל');
  });

  it('ריק', () => {
    expect(value(parseChoice('', choices))).toBeNull();
  });

  it('ערך לא מוכר – ההודעה מונה את המותרים', () => {
    const r = parseChoice('מושהה', choices);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('פעיל');
  });
});

describe('parseField', () => {
  const field = (over: Partial<ImportField>): ImportField => ({
    label: 'שדה',
    column: 'col',
    type: 'text',
    required: false,
    ...over,
  });

  it('מנתב לפי הטיפוס', () => {
    expect(value(parseField(field({ type: 'money' }), '360'))).toBe(36000);
    expect(value(parseField(field({ type: 'date' }), '18/10/2025'))).toBe('2025-10-18');
    expect(value(parseField(field({ type: 'number' }), '35'))).toBe(35);
    expect(value(parseField(field({ type: 'bool' }), 'כן'))).toBe(1);
  });

  it('טקסט חופשי', () => {
    expect(value(parseField(field({}), '  הערה  כלשהי '))).toBe('הערה כלשהי');
  });

  it('אינו בודק חובה – זו אחריות האימות', () => {
    // אותה פונקציה משמשת לשדה חובה ולשדה רשות; ריק הוא null בשניהם.
    expect(parseField(field({ required: true }), '').ok).toBe(true);
    expect(value(parseField(field({ required: true }), ''))).toBeNull();
  });

  it('choice בלי רשימה אינו קורס', () => {
    expect(parseField(field({ type: 'choice' }), 'משהו').ok).toBe(false);
  });
});
