import { describe, expect, it } from 'vitest';
import {
  formatE164ForDisplay,
  normalizeMobile,
  type MobileReason,
  type MobileStatus,
} from './phone';

/**
 * טבלת המקרים מ-`docs/DATA-MODEL.md` ("PhoneNormalizer – טבלת מקרים"), שורה
 * לשורה. הטבלה היא המפרט; אם היא משתנה, הבדיקה הזו חייבת להשתנות איתה.
 */
const CASES: ReadonlyArray<{
  input: string | null;
  e164: string | null;
  status: MobileStatus;
  reason?: MobileReason;
  note?: string;
}> = [
  { input: null, e164: null, status: 'missing' },
  { input: '', e164: null, status: 'missing' },
  { input: '  ', e164: null, status: 'missing' },
  { input: 'אין', e164: null, status: 'missing', reason: 'no_digits' },
  { input: 'לברר', e164: null, status: 'missing', reason: 'no_digits' },

  { input: '0501234567', e164: '972501234567', status: 'valid' },
  { input: '050-123-4567', e164: '972501234567', status: 'valid' },
  { input: '050 123 4567', e164: '972501234567', status: 'valid' },

  {
    input: '501234567',
    e164: '972501234567',
    status: 'valid',
    note: 'Excel אכל את האפס המוביל',
  },

  { input: '+972501234567', e164: '972501234567', status: 'valid' },
  { input: '972501234567', e164: '972501234567', status: 'valid' },
  { input: '00972501234567', e164: '972501234567', status: 'valid' },
  {
    input: '9720501234567',
    e164: '972501234567',
    status: 'valid',
    note: 'קידומת מדינה + אפס מקומי מיותר',
  },

  { input: '02-6543210', e164: null, status: 'invalid', reason: 'landline' },
  { input: '036543210', e164: null, status: 'invalid', reason: 'landline' },

  { input: '05292593', e164: null, status: 'invalid', reason: 'too_short' },

  {
    input: '050-1234567 / 054-1112222',
    e164: '972501234567',
    status: 'valid',
    reason: 'multiple',
    note: 'לוקחים את הראשון ומסמנים שיש עוד',
  },

  { input: '+1 212 555 0100', e164: '12125550100', status: 'valid', reason: 'foreign' },

  { input: '0501234567 של הבן', e164: '972501234567', status: 'valid' },
];

describe('PhoneNormalizer – טבלת המקרים מ-DATA-MODEL', () => {
  for (const c of CASES) {
    const label = `${JSON.stringify(c.input)} → ${c.e164 ?? 'NULL'} / ${c.status}${
      c.reason ? ` (${c.reason})` : ''
    }${c.note ? ` – ${c.note}` : ''}`;
    it(label, () => {
      const result = normalizeMobile(c.input);
      expect(result.e164).toBe(c.e164);
      expect(result.status).toBe(c.status);
      if (c.reason === undefined) {
        expect(result.reason).toBeUndefined();
      } else {
        expect(result.reason).toBe(c.reason);
      }
    });
  }
});

describe('PhoneNormalizer – התנהגות נוספת', () => {
  it('הפונקציה טהורה: אותו קלט מחזיר אותה תוצאה, והקלט לא משתנה', () => {
    const input = '050-123-4567';
    const a = normalizeMobile(input);
    const b = normalizeMobile(input);
    expect(a).toEqual(b);
    expect(input).toBe('050-123-4567');
  });

  it('קידומת מדינה אחרת מכובדת', () => {
    // ברירת המחדל היא 972 אלא אם צוין אחרת (החלטת הגבאי, 2026-09-06).
    expect(normalizeMobile('0501234567', '972').e164).toBe('972501234567');
    expect(normalizeMobile('0501234567', '44').e164).toBe('44501234567');
  });

  it('מפריד גם על פסיק, נקודה-פסיק ו"או"', () => {
    for (const raw of [
      '0501234567, 0541112222',
      '0501234567; 0541112222',
      '0501234567 או 0541112222',
    ]) {
      const r = normalizeMobile(raw);
      expect(r.e164).toBe('972501234567');
      expect(r.reason).toBe('multiple');
    }
  });

  it('מספר ארוך מדי נדחה ולא נשלח', () => {
    expect(normalizeMobile('+1234567890123456').status).toBe('invalid');
  });

  it('מספר זר קצר מדי נדחה', () => {
    expect(normalizeMobile('+1 212').status).toBe('invalid');
  });

  it('רווחים, סוגריים ומקפים אינם משנים את התוצאה', () => {
    const expected = '972501234567';
    for (const raw of ['(050) 123-4567', ' 050.123.4567 ', '050–123–4567']) {
      expect(normalizeMobile(raw).e164).toBe(expected);
    }
  });

  describe('formatE164ForDisplay', () => {
    it('מעצב נייד ישראלי לקריאה', () => {
      expect(formatE164ForDisplay('972501234567')).toBe('+972-50-123-4567');
    });
    it('מספר זר מוצג עם + בלבד', () => {
      expect(formatE164ForDisplay('12125550100')).toBe('+12125550100');
    });
    it('ריק מחזיר מחרוזת ריקה', () => {
      expect(formatE164ForDisplay(null)).toBe('');
      expect(formatE164ForDisplay('')).toBe('');
    });
  });
});
