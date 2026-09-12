import { describe, expect, it } from 'vitest';
import { rowRulesFor } from './rules';

/** כללים שבלעדיהם השגיאה מגיעה כאילוץ DB סתום באמצע הכתיבה. */

const check = (entity: Parameters<typeof rowRulesFor>[0], values: Record<string, string | number | null>) =>
  rowRulesFor(entity).map((r) => r(values)).filter((m): m is string => m !== null);

describe('נדרים', () => {
  it('זיכוי בלי סיבה נדחה', () => {
    expect(check('vow_charge', { סוג: 'זיכוי', 'סיבת זיכוי': '' })[0]).toContain('סיבה');
  });

  it('זיכוי עם סיבה עובר', () => {
    expect(check('vow_charge', { סוג: 'זיכוי', 'סיבת זיכוי': 'טעות' })).toEqual([]);
  });

  it('נדר רגיל אינו מחייב סיבה', () => {
    expect(check('vow_charge', { סוג: 'נדר', 'סיבת זיכוי': null })).toEqual([]);
    expect(check('vow_charge', { סוג: null, 'סיבת זיכוי': null })).toEqual([]);
  });
});

describe('תרומות', () => {
  it('בלי חבר ובלי שם תורם נדחית', () => {
    expect(check('donation', { 'מספר חבר': null, 'שם התורם': '' })[0]).toContain('שם תורם');
  });

  it('חבר בלבד מספיק', () => {
    expect(check('donation', { 'מספר חבר': 5, 'שם התורם': '' })).toEqual([]);
  });

  it('שם תורם בלבד מספיק – תורם שאינו חבר', () => {
    expect(check('donation', { 'מספר חבר': null, 'שם התורם': 'אלמוני' })).toEqual([]);
  });
});

describe('הוצאות', () => {
  it('סכום שלילי בלי סימון החזר נדחה', () => {
    expect(check('expense', { 'סכום (₪)': -500, החזר: null })[0]).toContain('החזר');
  });

  it('סכום שלילי עם החזר עובר', () => {
    expect(check('expense', { 'סכום (₪)': -500, החזר: 1 })).toEqual([]);
  });

  it('סכום חיובי תמיד עובר', () => {
    expect(check('expense', { 'סכום (₪)': 700, החזר: null })).toEqual([]);
  });
});

describe('יישות בלי כללים', () => {
  it('מחזירה רשימה ריקה', () => {
    expect(rowRulesFor('member')).toEqual([]);
  });
});
