import { describe, expect, it } from 'vitest';
import { agorotToShekel, formatAgorot, parseShekelInput, shekelToAgorot, sumAgorot } from './money';

describe('shekelToAgorot', () => {
  it('ממיר שלמים', () => {
    expect(shekelToAgorot(1000)).toBe(100_000);
    expect(shekelToAgorot(0)).toBe(0);
  });

  it('מטפל בשברים בלי שגיאות float', () => {
    expect(shekelToAgorot(0.1 + 0.2)).toBe(30);
    expect(shekelToAgorot(516.4)).toBe(51_640);
    expect(shekelToAgorot(162071.4)).toBe(16_207_140);
    expect(shekelToAgorot(1.005)).toBe(101); // עיגול חצי כלפי מעלה
  });

  it('שומר סימטריה לשליליים', () => {
    expect(shekelToAgorot(-3000)).toBe(-300_000);
    expect(shekelToAgorot(-1.005)).toBe(-101);
    expect(shekelToAgorot(-0)).toBe(0);
  });

  it('מקבל מחרוזות קלט של משתמש', () => {
    expect(shekelToAgorot('1,000')).toBe(100_000);
    expect(shekelToAgorot('1,234.56 ₪')).toBe(123_456);
    expect(shekelToAgorot(' -50 ')).toBe(-5_000);
  });

  it('זורק על קלט לא מספרי', () => {
    expect(() => shekelToAgorot('abc')).toThrow();
    expect(() => shekelToAgorot('')).toThrow();
    expect(() => shekelToAgorot(Number.NaN)).toThrow();
  });
});

describe('parseShekelInput', () => {
  it.each([
    ['100', 100],
    ['100.5', 100.5],
    ['1,000,000', 1_000_000],
    ['₪ 250', 250],
    ['+7', 7],
  ])('מפרסר %s', (input, expected) => {
    expect(parseShekelInput(input)).toBe(expected);
  });

  it.each(['', '-', 'שלוש מאות', '1.2.3', '5-'])('דוחה %s', (input) => {
    expect(parseShekelInput(input)).toBeNull();
  });
});

describe('agorotToShekel / formatAgorot', () => {
  it('מחזיר שקלים', () => {
    expect(agorotToShekel(123_456)).toBe(1234.56);
  });

  it('מעצב עם מפריד אלפים ו-₪ (B-11)', () => {
    const s = formatAgorot(100_000);
    expect(s).toContain('1,000');
    expect(s).toContain('₪');
  });

  it('סכום עגול בלי אגורות, סכום עם אגורות תמיד בשתי ספרות', () => {
    expect(formatAgorot(100_000)).toContain('1,000');
    expect(formatAgorot(100_000)).not.toContain('.00');
    expect(formatAgorot(128_160)).toContain('1,281.60');
    expect(formatAgorot(51_640)).toContain('516.40');
    expect(formatAgorot(5)).toContain('0.05');
  });
});

describe('sumAgorot', () => {
  it('סוכם במדויק גם על סכומים רבים', () => {
    const values = Array.from({ length: 1000 }, () => 33);
    expect(sumAgorot(values)).toBe(33_000);
  });

  it('סכום ריק הוא 0', () => {
    expect(sumAgorot([])).toBe(0);
  });
});
