import { describe, expect, it } from 'vitest';
import { legacyMonthKey, simulateLegacyMacro, vbaCInt } from './legacySim';
import type { LegacyWorkbook } from './workbook';

const txt = (v: string) => ({ t: 's', v });
const serial = (v: number) => ({ t: 'n', v, z: 'dd\\.mm\\.yyyy;@' });

describe('vbaCInt', () => {
  it('מתנהג כמו CInt של VBA', () => {
    expect(vbaCInt('09')).toBe(9);
    expect(vbaCInt('2024')).toBe(2024);
    expect(vbaCInt('3.2')).toBe(3);
    expect(vbaCInt('')).toBe(0);
  });

  it('מקבל נקודה עוקבת, כמו VBA: Mid("13.3.2024",4,2) = "3."', () => {
    expect(vbaCInt('3.')).toBe(3);
    expect(vbaCInt('0.')).toBe(0); // חודש 0 נדחה אחר כך ב-legacyMonthKey
  });

  it('מחזיר null על מה ש-CInt היה נופל עליו', () => {
    expect(vbaCInt('/2')).toBeNull();
    expect(vbaCInt('אב')).toBeNull();
  });
});

describe('legacyMonthKey – שחזור Mid(cell,4,2) ו-Right(cell,4)', () => {
  it('פורמט תקין נקרא נכון', () => {
    expect(legacyMonthKey(txt('01.09.2023'))).toBe('2023-09');
    expect(legacyMonthKey(txt('25/09/2023'))).toBe('2023-09');
    expect(legacyMonthKey(txt('14.10.2025'))).toBe('2025-10');
  });

  it('יום חד-ספרתי מזיז את החיתוך ומפיל את השורה', () => {
    // '5.10.2025' → Mid(...,4,2) = '0.' → חודש 0. זו הסיבה לסטייה ב-10/2025.
    expect(legacyMonthKey(txt('5.10.2025'))).toBeNull();
    // אבל '13.3.2024' → Mid = '3.' → חודש 3, והמאקרו כן סופר אותו
    expect(legacyMonthKey(txt('13.3.2024'))).toBe('2024-03');
  });

  it('שנה בלתי אפשרית מפילה את השורה', () => {
    // התרומה מ-27.07.2925 – לכן היא חסרה במאזן הישן של 07/2025
    expect(legacyMonthKey(txt('27.07.2925'))).toBeNull();
  });

  it('תא תאריך אמיתי נקרא לפי פורמט dd/MM/yyyy של Windows בעברית', () => {
    expect(legacyMonthKey(serial(45935))).toBe('2025-10'); // 2025-10-07
  });

  it('חודשים מחוץ לחלון 09/2023–09/2026 אינם נספרים', () => {
    expect(legacyMonthKey(txt('01.08.2023'))).toBeNull();
    expect(legacyMonthKey(txt('01.10.2026'))).toBeNull();
    expect(legacyMonthKey(txt('29.12.2026'))).toBeNull();
  });

  it('תא ריק', () => {
    expect(legacyMonthKey(null)).toBeNull();
  });
});

describe('simulateLegacyMacro', () => {
  const wb = {
    donations: [
      { date: txt('10.10.2023'), amount: 40 },
      { date: txt('27.07.2925'), amount: 52 }, // המאקרו מפיל
    ],
    payments: [
      { date: txt('14.10.2025'), amount: 100 },
      { date: txt('5.10.2025'), amount: 100 }, // המאקרו מפיל
    ],
    expenses: [
      { date: txt('02.09.2023'), amount: 3500 },
      { date: txt('01.09.2023'), amount: 75.4 },
    ],
  } as unknown as LegacyWorkbook;

  it('סופר רק את מה שהמאקרו מסוגל לקרוא', () => {
    const sim = simulateLegacyMacro(wb);
    expect(sim.get('2023-10')?.donations).toBe(40);
    expect(sim.get('2025-10')?.vowPayments).toBe(100);
  });

  it('חותך את ההוצאות למספר שלם (As Long)', () => {
    const sim = simulateLegacyMacro(wb);
    expect(sim.get('2023-09')?.expenses).toBe(3575); // 3575.4 → 3575
  });
});
