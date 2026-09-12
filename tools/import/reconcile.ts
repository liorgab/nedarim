import type { Database } from 'better-sqlite3';
import { shekelToAgorot } from '@shared/money';
import { explainDiff, simulateLegacyMacro } from './legacySim';
import type { LegacyWorkbook } from './workbook';
import type { BalanceDiff, MonthDiff, ReceiptCheck, ReconcileResult } from './types';

/**
 * בדיקות ההתאמה שאחרי הייבוא (SPEC 7.3).
 *
 * סובלנות בעמודת ההוצאות: המאקרו הישן `MaazanSheet` מגדיר
 * `Dim SumTruma(37), SumNeder(37), SumHotzaa(37) As Long` – ב-VBA רק המשתנה האחרון
 * מקבל את הטיפוס, ולכן **רק** סכום ההוצאות נחתך למספר שלם. הפער מול הסכום המדויק
 * הוא לכל היותר שקל אחד לחודש, ואינו מעיד על שגיאת נתונים.
 */
const EXPENSE_TOLERANCE_AGOROT = 100;

export function reconcile(db: Database, wb: LegacyWorkbook): ReconcileResult {
  return {
    balances: reconcileBalances(db, wb),
    months: reconcileMonths(db, wb),
    receipts: reconcileReceipts(db, wb),
    outOfWindow: findOutOfWindow(db, wb),
    totals: reconcileTotals(db, wb),
  };
}

/** (1) יתרה לכל חבר = E3 בבלוק שלו = D202 − F202. */
function reconcileBalances(db: Database, wb: LegacyWorkbook): ReconcileResult['balances'] {
  const rows = db
    .prepare(
      `SELECT member_number, first_name, last_name, balance_agorot
       FROM v_member_balance ORDER BY member_number`,
    )
    .all() as Array<{
    member_number: number;
    first_name: string;
    last_name: string;
    balance_agorot: number;
  }>;

  const diffs: BalanceDiff[] = [];
  for (const r of rows) {
    const totals = wb.ledgerTotals.get(r.member_number);
    if (!totals) continue;
    const legacy = shekelToAgorot(totals.charges) - shekelToAgorot(totals.payments);
    if (legacy !== r.balance_agorot) {
      diffs.push({
        memberNumber: r.member_number,
        name: `${r.first_name} ${r.last_name}`.trim(),
        legacyBalance: legacy,
        importedBalance: r.balance_agorot,
        diff: r.balance_agorot - legacy,
      });
    }
  }
  return { checked: rows.length, diffs };
}

/** (2)(3) Σ חודשי מול עמודות B/C/E בגיליון 'מאזן שנתי'. */
function reconcileMonths(db: Database, wb: LegacyWorkbook): ReconcileResult['months'] {
  const rows = db.prepare('SELECT * FROM v_monthly_balance').all() as Array<{
    ym: string;
    donations_agorot: number;
    vow_payments_agorot: number;
    expenses_agorot: number;
  }>;
  const byMonth = new Map(rows.map((r) => [r.ym, r]));
  const simulated = simulateLegacyMacro(wb);

  const diffs: MonthDiff[] = [];
  for (const legacy of wb.legacyBalance) {
    const imported = byMonth.get(legacy.ym);
    const sim = simulated.get(legacy.ym);
    const check = (
      field: MonthDiff['field'],
      legacyValue: number,
      simulatedValue: number,
      importedAgorot: number,
      tolerance: number,
    ) => {
      const legacyAgorot = shekelToAgorot(legacyValue);
      const simulatedAgorot = shekelToAgorot(simulatedValue);
      if (Math.abs(legacyAgorot - importedAgorot) > tolerance) {
        diffs.push({
          ym: legacy.ym,
          field,
          legacy: legacyAgorot,
          simulated: simulatedAgorot,
          imported: importedAgorot,
          diff: importedAgorot - legacyAgorot,
          cause: explainDiff(field, legacyAgorot, simulatedAgorot, importedAgorot),
        });
      }
    };
    check('donations', legacy.donations, sim?.donations ?? 0, imported?.donations_agorot ?? 0, 0);
    check(
      'vowPayments',
      legacy.vowPayments,
      sim?.vowPayments ?? 0,
      imported?.vow_payments_agorot ?? 0,
      0,
    );
    check(
      'expenses',
      legacy.expenses,
      sim?.expenses ?? 0,
      imported?.expenses_agorot ?? 0,
      EXPENSE_TOLERANCE_AGOROT,
    );
  }
  return {
    checked: wb.legacyBalance.length * 3,
    diffs,
    toleranceAgorot: EXPENSE_TOLERANCE_AGOROT,
  };
}

/** (4) קבלות: כמות, ייחודיות, רציפות ומקור יחיד לכל קבלה. */
function reconcileReceipts(db: Database, wb: LegacyWorkbook): ReceiptCheck {
  const imported = db
    .prepare('SELECT receipt_number FROM receipt ORDER BY receipt_number')
    .all() as Array<{ receipt_number: number }>;
  const numbers = imported.map((r) => r.receipt_number);
  const counterMax = wb.receiptCounter.length === 0 ? 0 : Math.max(...wb.receiptCounter);

  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const n of numbers) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }

  const missing: number[] = [];
  for (let n = 1; n <= counterMax; n++) {
    if (!seen.has(n)) missing.push(n);
  }

  const ambiguous = (
    db
      .prepare(
        `SELECT receipt_number FROM receipt r
         WHERE (SELECT COUNT(*) FROM vow_payment p WHERE p.receipt_id = r.id)
             + (SELECT COUNT(*) FROM donation d WHERE d.receipt_id = r.id) <> 1`,
      )
      .all() as Array<{ receipt_number: number }>
  ).map((r) => r.receipt_number);

  return { counterMax, imported: numbers.length, duplicates, missing, ambiguous };
}

/** תנועות מחוץ לחלון 37 החודשים של המאזן הישן – הכסף שהמאקרו הישן לא סופר (ממצא #1). */
function findOutOfWindow(db: Database, wb: LegacyWorkbook): ReconcileResult['outOfWindow'] {
  const window = new Set(wb.legacyBalance.map((b) => b.ym));
  const rows = db.prepare('SELECT * FROM v_monthly_balance').all() as Array<{
    ym: string;
    donations_agorot: number;
    vow_payments_agorot: number;
    expenses_agorot: number;
  }>;
  return rows
    .filter((r) => !window.has(r.ym))
    .map((r) => ({
      ym: r.ym,
      donations: r.donations_agorot,
      vowPayments: r.vow_payments_agorot,
      expenses: r.expenses_agorot,
    }));
}

/** סה"כ חיובים ותשלומים: הסכום מהקובץ (D202/F202) מול מה שנכנס ל-DB. */
function reconcileTotals(db: Database, wb: LegacyWorkbook): ReconcileResult['totals'] {
  let legacyCharges = 0;
  let legacyPayments = 0;
  for (const t of wb.ledgerTotals.values()) {
    legacyCharges += shekelToAgorot(t.charges);
    legacyPayments += shekelToAgorot(t.payments);
  }
  const imported = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(opening_balance_agorot), 0) FROM member WHERE deleted_at IS NULL)
       + (SELECT COALESCE(SUM(CASE kind WHEN 'credit' THEN -amount_agorot ELSE amount_agorot END), 0)
          FROM vow_charge WHERE deleted_at IS NULL) AS charges,
         (SELECT COALESCE(SUM(amount_agorot), 0) FROM vow_payment WHERE deleted_at IS NULL) AS payments`,
    )
    .get() as { charges: number; payments: number };

  return {
    legacyCharges,
    importedCharges: imported.charges,
    legacyPayments,
    importedPayments: imported.payments,
  };
}
