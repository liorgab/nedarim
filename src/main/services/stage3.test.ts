import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import {
  accrualByMonth,
  availableYears,
  fiscalYearOf,
  hebrewYearRange,
  monthlyBalance,
  resolveRange,
} from './balance';
import { dashboardSummary } from './dashboard';
import {
  createDonation,
  deleteDonation,
  donationsForMember,
  listDonations,
  updateDonation,
  validateDonation,
} from './donations';
import {
  createExpense,
  deleteExpense,
  knownSuppliers,
  listExpenses,
  updateExpense,
  validateExpense,
} from './expenses';
import { reportToMatrix, toCsv, writeCsv, writeXlsx, sheetName } from './exporters';
import { createMember } from './members';
import { createPayment } from './payments';
import { runReport } from './reports';
import { createVow } from './vows';
import { saveSettings } from './configuration';

let db: Database;
let userId: number;
let cash: number;
let cheque: number;
let badak: number;
let salary: number;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  seed(db);
  userId = systemUserId(db);
  const id = (sql: string) => (db.prepare(sql).get() as { id: number }).id;
  cash = id("SELECT id FROM payment_method WHERE name = 'מזומן'");
  cheque = id("SELECT id FROM payment_method WHERE name = 'המחאה'");
  badak = id("SELECT id FROM donation_type WHERE name = 'בדק בית'");
  salary = id("SELECT id FROM expense_category WHERE name = 'משכורת לרב'");
});
afterEach(() => db.close());

const member = (first = 'ישראל', last = 'ישראלי') =>
  createMember(db, { firstName: first, lastName: last }, userId);

const donate = (
  date: string,
  amount: number,
  extra: Partial<Parameters<typeof createDonation>[1]> = {},
) =>
  createDonation(
    db,
    {
      donationDate: date,
      donorName: 'תורם',
      donationTypeId: badak,
      paymentMethodId: cash,
      amountAgorot: amount,
      ...extra,
    },
    userId,
  );

const spend = (date: string, amount: number, description = 'משכורת לרב') =>
  createExpense(
    db,
    { expenseDate: date, amountAgorot: amount, categoryId: salary, description },
    userId,
  );

// ---------------------------------------------------------------- תרומות

describe('תרומות (F-50..F-52)', () => {
  it('מקצה מס"ד רץ ואינו חוזר לשימוש (B-08)', () => {
    donate('2026-01-05', 10_000);
    donate('2026-01-06', 20_000);
    expect(listDonations(db).rows.map((r) => r.donationNumber)).toEqual([2, 1]);
    deleteDonation(db, listDonations(db).rows[0]!.id, userId, 'admin');
    donate('2026-01-07', 5_000);
    expect(listDonations(db).rows.map((r) => r.donationNumber)).toEqual([3, 1]);
  });

  it('מפיקה קבלה באותה פעולה', () => {
    const res = createDonation(
      db,
      {
        donationDate: '2026-01-05',
        donorName: 'סמי דדון',
        donationTypeId: badak,
        paymentMethodId: cash,
        amountAgorot: 50_000,
      },
      userId,
      { issueReceipt: true },
    );
    expect(res.receipt?.receiptNumber).toBe(1);
    expect(res.receipt?.purposeText).toBe('תרומה – בדק בית');
    expect(res.receipt?.payerName).toBe('סמי דדון');
  });

  it('מקשרת תרומה לחבר ומציגה אותה בכרטיסייה בלי להשפיע על יתרת הנדרים (F-22)', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 10_000 },
      userId,
    );
    donate('2026-01-05', 30_000, { memberId: m.id, donorName: 'ישראל ישראלי' });

    expect(donationsForMember(db, m.id)).toHaveLength(1);
    const balance = db
      .prepare('SELECT balance_agorot v FROM v_member_balance WHERE member_id = ?')
      .get(m.id) as { v: number };
    expect(balance.v).toBe(10_000); // התרומה אינה מקטינה את החוב
  });

  it('אימותים: סכום, שם תורם, תאריך עתידי', () => {
    const base = {
      donationDate: '2026-01-05',
      donorName: 'תורם',
      donationTypeId: badak,
      paymentMethodId: cash,
      amountAgorot: 100,
    };
    expect(
      validateDonation(db, { ...base, amountAgorot: 0 }).some((i) => i.severity === 'error'),
    ).toBe(true);
    expect(
      validateDonation(db, { ...base, donorName: ' ' }).some((i) => i.severity === 'error'),
    ).toBe(true);
    const future = new Date();
    future.setDate(future.getDate() + 60);
    expect(
      validateDonation(db, { ...base, donationDate: future.toISOString().slice(0, 10) }).some(
        (i) => i.severity === 'error',
      ),
    ).toBe(true);
  });

  it('מזהירה על המחאה בלי אסמכתא', () => {
    const issues = validateDonation(db, {
      donationDate: '2026-01-05',
      donorName: 'תורם',
      donationTypeId: badak,
      paymentMethodId: cheque,
      amountAgorot: 100,
    });
    expect(issues.some((i) => i.field === 'reference' && i.severity === 'warning')).toBe(true);
  });

  it('עריכה חסומה אחרי הפקת קבלה (B-05)', () => {
    const res = createDonation(
      db,
      {
        donationDate: '2026-01-05',
        donorName: 'תורם',
        donationTypeId: badak,
        paymentMethodId: cash,
        amountAgorot: 100,
      },
      userId,
      { issueReceipt: true },
    );
    expect(() =>
      updateDonation(
        db,
        res.donationId,
        {
          donationDate: '2026-01-05',
          donorName: 'תורם אחר',
          donationTypeId: badak,
          paymentMethodId: cash,
          amountAgorot: 200,
        },
        userId,
      ),
    ).toThrow(/קבלה/);
    expect(() => deleteDonation(db, res.donationId, userId, 'admin')).toThrow(/קבלה/);
  });

  it('KPIs לפי הסינון הפעיל', () => {
    donate('2026-01-05', 10_000);
    donate('2026-02-05', 30_000);
    expect(listDonations(db).kpis).toMatchObject({
      count: 2,
      totalAgorot: 40_000,
      averageAgorot: 20_000,
      largestAgorot: 30_000,
    });
    expect(listDonations(db, { from: '2026-02-01' }).kpis).toMatchObject({
      count: 1,
      totalAgorot: 30_000,
    });
  });

  it('סינון לפי עם/בלי קבלה (F-50)', () => {
    donate('2026-01-05', 10_000);
    createDonation(
      db,
      {
        donationDate: '2026-01-06',
        donorName: 'תורם',
        donationTypeId: badak,
        paymentMethodId: cash,
        amountAgorot: 20_000,
      },
      userId,
      { issueReceipt: true },
    );
    expect(listDonations(db, { receiptState: 'with' }).rows).toHaveLength(1);
    expect(listDonations(db, { receiptState: 'without' }).rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- הוצאות

describe('הוצאות (F-60..F-62)', () => {
  it('מקצה מס"ד רץ ומחשבת סיכומים לפי הסינון', () => {
    spend('2026-01-05', 350_000);
    spend('2026-02-05', 150_000, 'חשמל');
    const all = listExpenses(db);
    expect(all.kpis.totalAgorot).toBe(500_000);
    expect(listExpenses(db, { from: '2026-02-01' }).kpis.totalAgorot).toBe(150_000);
  });

  it('פירוט הוא שדה חובה (כמו בקובץ הישן)', () => {
    expect(
      validateExpense(db, {
        expenseDate: '2026-01-05',
        amountAgorot: 100,
        categoryId: salary,
        description: '   ',
      }).some((i) => i.field === 'description'),
    ).toBe(true);
  });

  it('סכום שלילי מותר רק כהחזר ועם הערה', () => {
    const base = { expenseDate: '2026-01-05', categoryId: salary, description: 'החזר' };
    expect(
      validateExpense(db, { ...base, amountAgorot: -300_000 }).some((i) => i.field === 'amount'),
    ).toBe(true);
    expect(
      validateExpense(db, { ...base, amountAgorot: -300_000, isRefund: true }).some(
        (i) => i.field === 'notes',
      ),
    ).toBe(true);
    expect(
      validateExpense(db, {
        ...base,
        amountAgorot: -300_000,
        isRefund: true,
        notes: 'ביטול קבלה',
      }).filter((i) => i.severity === 'error'),
    ).toHaveLength(0);
  });

  it('סיכום לפי קטגוריה, ממוין יורד', () => {
    const electricity = (
      db.prepare("SELECT id FROM expense_category WHERE name = 'חשמל ומים'").get() as { id: number }
    ).id;
    spend('2026-01-05', 350_000);
    createExpense(
      db,
      {
        expenseDate: '2026-01-06',
        amountAgorot: 50_000,
        categoryId: electricity,
        description: 'חשמל',
      },
      userId,
    );
    const byCategory = listExpenses(db).kpis.byCategory;
    expect(byCategory).toEqual([
      { category: 'משכורת לרב', totalAgorot: 350_000, count: 1 },
      { category: 'חשמל ומים', totalAgorot: 50_000, count: 1 },
    ]);
  });

  it('סינון לפי טווח סכומים וספק', () => {
    createExpense(
      db,
      {
        expenseDate: '2026-01-05',
        amountAgorot: 350_000,
        categoryId: salary,
        description: 'משכורת',
        supplier: 'הרב כהן',
      },
      userId,
    );
    spend('2026-01-06', 5_000, 'כיבוד');
    expect(listExpenses(db, { minAmountAgorot: 100_000 }).rows).toHaveLength(1);
    expect(listExpenses(db, { supplier: 'כהן' }).rows).toHaveLength(1);
    expect(knownSuppliers(db)).toEqual(['הרב כהן']);
  });

  it('עריכה ומחיקה לוגית נרשמות ביומן (F-62, B-09)', () => {
    const id = spend('2026-01-05', 100_000);
    updateExpense(
      db,
      id,
      {
        expenseDate: '2026-01-05',
        amountAgorot: 120_000,
        categoryId: salary,
        description: 'משכורת מעודכנת',
      },
      userId,
    );
    deleteExpense(db, id, userId, 'admin');
    expect(listExpenses(db).rows).toHaveLength(0);
    const audit = db
      .prepare("SELECT action FROM audit_log WHERE entity = 'expense' ORDER BY id")
      .all() as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
  });

  it('מזין אינו רשאי למחוק הוצאה', () => {
    const id = spend('2026-01-05', 100_000);
    expect(() => deleteExpense(db, id, userId, 'clerk')).toThrow(/מנהל/);
  });

  it('מצרפת קובץ לארכיון ולא מסתמכת על המקור', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nedarim-att-'));
    try {
      const source = join(dir, 'invoice.pdf');
      writeFileSync(source, 'PDF');
      const id = createExpense(
        db,
        {
          expenseDate: '2026-01-05',
          amountAgorot: 100_000,
          categoryId: salary,
          description: 'ציוד',
          attachmentSourcePath: source,
        },
        userId,
        { userDataDir: dir },
      );
      const row = listExpenses(db).rows.find((r) => r.id === id)!;
      expect(row.attachmentPath).toContain('attachments');
      expect(readFileSync(row.attachmentPath!, 'utf8')).toBe('PDF');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- מאזן

describe('מאזן (F-80)', () => {
  const setupMonths = () => {
    const m = member();
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2025-09-10', amountAgorot: 100_000, paymentMethodId: cash },
      userId,
    );
    donate('2025-09-15', 20_000);
    spend('2025-09-20', 50_000);
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2025-10-10', amountAgorot: 30_000, paymentMethodId: cash },
      userId,
    );
    spend('2025-10-20', 80_000);
    return m;
  };

  it('מחשב הכנסות, הוצאות, יתרה ויתרה מצטברת', () => {
    setupMonths();
    const { rows, totals } = monthlyBalance(db, { kind: 'all' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ym: '2025-09',
      donationsAgorot: 20_000,
      vowPaymentsAgorot: 100_000,
      incomeAgorot: 120_000,
      expensesAgorot: 50_000,
      netAgorot: 70_000,
      cumulativeAgorot: 70_000,
    });
    expect(rows[1]).toMatchObject({ ym: '2025-10', netAgorot: -50_000, cumulativeAgorot: 20_000 });
    expect(totals.closingCumulativeAgorot).toBe(20_000);
  });

  it('היתרה המצטברת ממשיכה מהתקופה הקודמת גם בטווח מסונן', () => {
    setupMonths();
    const { rows, openingCumulativeAgorot } = monthlyBalance(db, {
      kind: 'custom',
      from: '2025-10-01',
    });
    expect(openingCumulativeAgorot).toBe(70_000);
    expect(rows[0]!.cumulativeAgorot).toBe(20_000);
  });

  it('שנה כספית לפי חודש ההתחלה שבהגדרות (B-07)', () => {
    expect(resolveRange(db, { kind: 'fiscal', year: 2025 })).toMatchObject({
      from: '2025-09-01',
      to: '2026-08-31',
    });
    saveSettings(db, { fiscal_year_start_month: '1' }, userId, 'admin');
    expect(resolveRange(db, { kind: 'fiscal', year: 2025 })).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('שנה עברית מתורגמת לטווח לועזי נכון', () => {
    // תשפ"ו: א' תשרי = 23/09/2025, כ"ט אלול = 11/09/2026
    const r = hebrewYearRange(5786);
    expect(r.from).toBe('2025-09-23');
    expect(r.to).toBe('2026-09-11');
  });

  it('שנה אזרחית', () => {
    expect(resolveRange(db, { kind: 'civil', year: 2025 })).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('fiscalYearOf', () => {
    expect(fiscalYearOf('2025-09-01', 9)).toBe(2025);
    expect(fiscalYearOf('2025-08-31', 9)).toBe(2024);
    expect(fiscalYearOf('2025-08-31', 1)).toBe(2025);
  });

  it('מציע רק שנים שיש עבורן נתונים', () => {
    setupMonths();
    const years = availableYears(db);
    expect(years.civil).toEqual([2025]);
    expect(years.fiscal).toEqual([2025]);
  });

  it('דוח צבירה מציג את פער הגבייה', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2025-09-01', occasionId: 1, amountAgorot: 100_000 },
      userId,
    );
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2025-09-10', amountAgorot: 40_000, paymentMethodId: cash },
      userId,
    );
    const { rows, totals } = accrualByMonth(db, { kind: 'all' });
    expect(rows[0]).toMatchObject({
      ym: '2025-09',
      chargedAgorot: 100_000,
      collectedAgorot: 40_000,
      gapAgorot: 60_000,
    });
    expect(totals.gapAgorot).toBe(60_000);
  });
});

// ---------------------------------------------------------------- דוחות

describe('דוחות (F-81..F-86)', () => {
  const setupData = () => {
    const a = member('אהרון', 'אוחנה');
    const b = member('משה', 'כהן');
    createVow(
      db,
      { memberId: a.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 100_000 },
      userId,
    );
    createVow(
      db,
      { memberId: b.id, chargeDate: '2026-01-01', occasionId: 2, amountAgorot: 30_000 },
      userId,
    );
    createPayment(
      db,
      { memberId: a.id, paymentDate: '2026-01-10', amountAgorot: 40_000, paymentMethodId: cash },
      userId,
    );
    createPayment(
      db,
      { memberId: b.id, paymentDate: '2026-01-11', amountAgorot: 10_000, paymentMethodId: cheque },
      userId,
    );
    donate('2026-01-12', 25_000);
    spend('2026-01-15', 70_000);
    return { a, b };
  };

  it('F-81 יתרות חוב ממוין לפי גובה', () => {
    setupData();
    const r = runReport(db, 'debtors');
    expect(r.rows.map((x) => x['balance_agorot'])).toEqual([60_000, 20_000]);
    expect(r.totals?.['balance_agorot']).toBe(80_000);
    expect(r.kpis.find((k) => k.key === 'count')?.value).toBe(2);
  });

  it('F-82 נדרים לפי פרשה', () => {
    setupData();
    const r = runReport(db, 'byOccasion');
    expect(r.rows).toHaveLength(2);
    expect(r.totals?.['charged']).toBe(130_000);
  });

  it('F-83 תרומות', () => {
    setupData();
    const r = runReport(db, 'donations');
    expect(r.totals?.['amount']).toBe(25_000);
  });

  it('F-84 הוצאות לפי קטגוריה', () => {
    setupData();
    const r = runReport(db, 'expenses');
    expect(r.totals?.['amount']).toBe(70_000);
  });

  it('F-85 תקבולים לפי אמצעי תשלום – התאמת קופה', () => {
    setupData();
    const r = runReport(db, 'byPaymentMethod');
    const cashRow = r.rows.find((x) => x['method'] === 'מזומן')!;
    expect(cashRow['vow_payments']).toBe(40_000);
    expect(cashRow['donations']).toBe(25_000);
    expect(cashRow['total']).toBe(65_000);
    const chequeRow = r.rows.find((x) => x['method'] === 'המחאה')!;
    expect(chequeRow['total']).toBe(10_000);
    expect(r.totals?.['total']).toBe(75_000);
  });

  it('F-86 דף חשבון לחבר', () => {
    const { a } = setupData();
    const r = runReport(db, 'memberStatement', { memberId: a.id });
    expect(r.title).toContain('אהרון אוחנה');
    expect(r.rows).toHaveLength(2);
    expect(r.totals?.['debit_agorot']).toBe(100_000);
    expect(r.totals?.['credit_agorot']).toBe(40_000);
  });

  it('דף חשבון בלי חבר נכשל בהודעה ברורה', () => {
    expect(() => runReport(db, 'memberStatement')).toThrow(/חבר/);
  });

  it('הטווח הנבחר מופיע בכותרת המשנה של כל דוח', () => {
    setupData();
    const r = runReport(db, 'donations', { range: { kind: 'civil', year: 2026 } });
    expect(r.subtitle).toContain('2026');
  });

  it('סינון תקופה משפיע על הדוח', () => {
    setupData();
    expect(runReport(db, 'donations', { range: { kind: 'civil', year: 2025 } }).rows).toHaveLength(
      0,
    );
    expect(runReport(db, 'donations', { range: { kind: 'civil', year: 2026 } }).rows).toHaveLength(
      1,
    );
  });
});

// ---------------------------------------------------------------- ייצוא

describe('ייצוא (F-87)', () => {
  const report = () => {
    const m = member('אהרון', 'אוחנה');
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 123_456 },
      userId,
    );
    return runReport(db, 'debtors');
  };

  it('מטריצה עם כותרות, שורות ושורת סיכום', () => {
    const matrix = reportToMatrix(report());
    expect(matrix[0]).toContain('יתרת חוב');
    expect(matrix).toHaveLength(3); // כותרת + שורה + סיכום
  });

  it('סכומים מיוצאים כשקלים, לא כאגורות', () => {
    const matrix = reportToMatrix(report());
    expect(matrix[1]).toContain(1234.56);
  });

  it('תאריכים מיוצאים בפורמט ישראלי', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 100 },
      userId,
    );
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-03-15', amountAgorot: 50, paymentMethodId: cash },
      userId,
    );
    const matrix = reportToMatrix(runReport(db, 'memberStatement', { memberId: m.id }));
    expect(matrix.some((row) => row.includes('15/03/2026'))).toBe(true);
  });

  it('CSV מתחיל ב-BOM כדי ש-Excel בעברית יקרא נכון', () => {
    const csv = toCsv(report());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('אוחנה');
  });

  it('CSV מגן על פסיקים ועל מרכאות בתוך שם', () => {
    const withComma = createMember(db, { firstName: 'משה', lastName: 'כהן, לוי' }, userId);
    const withQuote = createMember(db, { firstName: 'א"ב', lastName: 'שמעוני' }, userId);
    for (const m of [withComma, withQuote]) {
      createVow(
        db,
        { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 100 },
        userId,
      );
    }
    const csv = toCsv(runReport(db, 'debtors'));
    expect(csv).toContain('"משה כהן, לוי"');
    expect(csv).toContain('a""b'.replace(/a/g, 'א').replace(/b/g, 'ב'));
  });

  it('כותב קבצי CSV ו-Excel לדיסק', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nedarim-export-'));
    try {
      const r = report();
      const csvPath = writeCsv(r, join(dir, 'debtors.csv'));
      expect(readFileSync(csvPath, 'utf8')).toContain('אוחנה');

      const xlsxPath = await writeXlsx(r, join(dir, 'debtors.xlsx'));
      const buffer = readFileSync(xlsxPath);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 2).toString()).toBe('PK'); // ZIP – פורמט xlsx
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('שם גיליון חוקי ב-Excel', () => {
    expect(sheetName('דוח יתרות חוב')).toBe('דוח יתרות חוב');
    expect(sheetName('א/ב:ג')).not.toMatch(/[:/]/);
    expect(sheetName('x'.repeat(50)).length).toBeLessThanOrEqual(31);
  });
});

// ---------------------------------------------------------------- מסך ראשי

describe('מסך ראשי (F-01..F-06)', () => {
  it('מחזיר תמונת מצב מלאה', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 100_000 },
      userId,
    );
    const summary = dashboardSummary(db);
    expect(summary.today.hebrew).toMatch(/תשפ|תשפ״/);
    expect(summary.cards.openDebtAgorot).toBe(100_000);
    expect(summary.cards.membersWithDebt).toBe(1);
    expect(summary.topDebtors).toHaveLength(1);
  });

  it('סופר תשלומים שממתינים לקבלה (F-03)', () => {
    const m = member();
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-10', amountAgorot: 5_000, paymentMethodId: cash },
      userId,
    );
    const summary = dashboardSummary(db);
    expect(summary.pendingReceipts.count).toBe(1);
    expect(summary.pendingReceipts.totalAgorot).toBe(5_000);
  });

  it('סופר רשומות שממתינות לסקירה אחרי ייבוא', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: 100 },
      userId,
    );
    db.prepare('UPDATE vow_charge SET needs_review = 1').run();
    expect(dashboardSummary(db).needsReview.charges).toBe(1);
  });
});
