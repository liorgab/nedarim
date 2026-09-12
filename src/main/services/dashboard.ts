import type { Database } from 'better-sqlite3';
import type { IsoDate, MemberWithBalance } from '@shared/types';
import { monthlyBalance } from './balance';
import { hebrewInfo, localDateToIso, parashaKeyForVowDate, todayIso } from './hebrewCalendar';
import { paymentsWithoutReceipt } from './ledger';
import { findOccasionByHebcalKey } from './lookups';
import { topDebtors } from './members';
import { getNumberSetting } from './settings';

/** F-01..F-06 – המסך הראשי. מחליף את תפריט הכפתורים בקובץ הישן בתמונת מצב. */

export interface DashboardSummary {
  /** F-06 – תאריך עברי ולועזי ופרשת השבוע. */
  today: {
    gregorian: IsoDate;
    hebrew: string;
    hebrewYear: string;
    parasha: string | null;
  };
  /** F-01 – כרטיסי הסיכום. */
  cards: {
    openDebtAgorot: number;
    membersWithDebt: number;
    incomeThisMonthAgorot: number;
    vowPaymentsThisMonthAgorot: number;
    donationsThisMonthAgorot: number;
    expensesThisMonthAgorot: number;
    netThisMonthAgorot: number;
    cumulativeBalanceAgorot: number;
    fiscalYearIncomeAgorot: number;
    fiscalYearExpensesAgorot: number;
  };
  /** F-02 – עשרת החייבים הגדולים. */
  topDebtors: MemberWithBalance[];
  /** F-03 – תשלומים שנרשמו ללא קבלה. */
  pendingReceipts: {
    count: number;
    totalAgorot: number;
    rows: ReturnType<typeof paymentsWithoutReceipt>;
  };
  /** רשומות שיובאו עם ניחוש וממתינות לסקירה. */
  needsReview: { charges: number; payments: number; donations: number; expenses: number };
  /** מגמת 12 החודשים האחרונים, לגרף במסך. */
  trend: Array<{ ym: string; incomeAgorot: number; expensesAgorot: number }>;
}

export function dashboardSummary(db: Database): DashboardSummary {
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const startMonth = getNumberSetting(db, 'fiscal_year_start_month', 9);

  const balance = monthlyBalance(db, { kind: 'all' });
  const current = balance.rows.find((r) => r.ym === thisMonth);

  const fiscalYear =
    Number(today.slice(5, 7)) >= startMonth
      ? Number(today.slice(0, 4))
      : Number(today.slice(0, 4)) - 1;
  const fiscal = monthlyBalance(db, { kind: 'fiscal', year: fiscalYear });

  const debtors = topDebtors(db, 10);
  const withDebt = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(balance_agorot), 0) s
       FROM v_member_balance WHERE status = 'active' AND balance_agorot > 0`,
    )
    .get() as { c: number; s: number };

  const pending = paymentsWithoutReceipt(db, 200);

  const reviewCount = (table: string) =>
    (
      db
        .prepare(`SELECT COUNT(*) c FROM ${table} WHERE needs_review = 1 AND deleted_at IS NULL`)
        .get() as { c: number }
    ).c;

  const info = hebrewInfo(today);
  const parashaKey = parashaKeyForVowDate(today);
  const parasha = parashaKey ? (findOccasionByHebcalKey(db, parashaKey)?.name ?? null) : null;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 11);
  const trendFrom = localDateToIso(cutoff).slice(0, 7);

  return {
    today: {
      gregorian: today,
      hebrew: info.hebrew,
      hebrewYear: info.hebrewYear,
      parasha,
    },
    cards: {
      openDebtAgorot: withDebt.s,
      membersWithDebt: withDebt.c,
      incomeThisMonthAgorot: current?.incomeAgorot ?? 0,
      vowPaymentsThisMonthAgorot: current?.vowPaymentsAgorot ?? 0,
      donationsThisMonthAgorot: current?.donationsAgorot ?? 0,
      expensesThisMonthAgorot: current?.expensesAgorot ?? 0,
      netThisMonthAgorot: current?.netAgorot ?? 0,
      cumulativeBalanceAgorot: balance.totals.closingCumulativeAgorot,
      fiscalYearIncomeAgorot: fiscal.totals.incomeAgorot,
      fiscalYearExpensesAgorot: fiscal.totals.expensesAgorot,
    },
    topDebtors: debtors,
    pendingReceipts: {
      count: pending.length,
      totalAgorot: pending.reduce((s, p) => s + p.amountAgorot, 0),
      rows: pending.slice(0, 10),
    },
    needsReview: {
      charges: reviewCount('vow_charge'),
      payments: reviewCount('vow_payment'),
      donations: reviewCount('donation'),
      expenses: reviewCount('expense'),
    },
    trend: balance.rows
      .filter((r) => r.ym >= trendFrom)
      .map((r) => ({ ym: r.ym, incomeAgorot: r.incomeAgorot, expensesAgorot: r.expensesAgorot })),
  };
}
