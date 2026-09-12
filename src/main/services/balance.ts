import { HDate, months as hebMonths } from '@hebcal/core';
import type { Database } from 'better-sqlite3';
import type { IsoDate, MonthlyBalanceRow } from '@shared/types';
import { localDateToIso } from './hebrewCalendar';
import { getNumberSetting } from './settings';

/**
 * F-80 – מאזן חודשי/שנתי דינמי.
 *
 * מחליף את המאקרו `MaazanSheet` שהיה מקודד ל-37 חודשים קבועים (09/2023–09/2026)
 * ולכן הפסיק לספור כסף מאוקטובר 2026 (ממצא #1 ב-SPEC). כאן אין שנים בקוד:
 * הטווח מגיע מהמשתמש, והחודשים נגזרים מהנתונים עצמם.
 *
 * בסיס מזומן, כמו בקובץ הישן: עמודת "נדרים" סופרת **תשלומים בפועל**, לא חיובים.
 * דוח הצבירה (`accrualByMonth`) מציג את החיובים לצד הגבייה כדי לראות את הפער.
 */

export type RangeKind = 'fiscal' | 'hebrew' | 'civil' | 'custom' | 'all';

export interface BalanceRange {
  kind: RangeKind;
  /** שנה אזרחית/כספית מתחילה, או שנה עברית (5786) לפי `kind`. */
  year?: number;
  from?: IsoDate;
  to?: IsoDate;
}

export interface ResolvedRange {
  from: IsoDate | null;
  to: IsoDate | null;
  label: string;
}

/** גבולות שנה עברית: א' תשרי עד כ"ט אלול. */
export function hebrewYearRange(hebrewYear: number): { from: IsoDate; to: IsoDate } {
  const start = new HDate(1, hebMonths.TISHREI, hebrewYear).greg();
  const end = new HDate(1, hebMonths.TISHREI, hebrewYear + 1).greg();
  end.setDate(end.getDate() - 1);
  return { from: localDateToIso(start), to: localDateToIso(end) };
}

/** מתרגם בחירת טווח לתאריכי התחלה וסיום. חודש תחילת השנה הכספית מגיע מההגדרות (B-07). */
export function resolveRange(db: Database, range: BalanceRange): ResolvedRange {
  const startMonth = getNumberSetting(db, 'fiscal_year_start_month', 9);

  switch (range.kind) {
    case 'all':
      return { from: null, to: null, label: 'כל התקופות' };

    case 'custom':
      return {
        from: range.from ?? null,
        to: range.to ?? null,
        label: `${range.from ?? ''} – ${range.to ?? ''}`,
      };

    case 'civil': {
      const y = range.year ?? new Date().getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `שנת ${y}` };
    }

    case 'hebrew': {
      const y = range.year ?? new HDate(new Date()).getFullYear();
      const r = hebrewYearRange(y);
      return { ...r, label: `שנה עברית ${y}` };
    }

    case 'fiscal':
    default: {
      const y = range.year ?? fiscalYearOf(localDateToIso(new Date()), startMonth);
      const from = `${y}-${String(startMonth).padStart(2, '0')}-01` as IsoDate;
      const endDate = new Date(y + 1, startMonth - 1, 0);
      return {
        from,
        to: localDateToIso(endDate),
        label: `שנה כספית ${y}/${y + 1}`,
      };
    }
  }
}

/** לאיזו שנה כספית שייך תאריך, לפי חודש ההתחלה. */
export function fiscalYearOf(date: IsoDate, startMonth: number): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= startMonth ? year : year - 1;
}

interface RawMonth {
  ym: string;
  donations_agorot: number;
  vow_payments_agorot: number;
  expenses_agorot: number;
}

export interface MonthlyBalanceResult {
  rows: MonthlyBalanceRow[];
  /** היתרה המצטברת שנצברה לפני תחילת הטווח. */
  openingCumulativeAgorot: number;
  totals: {
    donationsAgorot: number;
    vowPaymentsAgorot: number;
    incomeAgorot: number;
    expensesAgorot: number;
    netAgorot: number;
    closingCumulativeAgorot: number;
  };
  label: string;
}

/**
 * מחזיר שורה לכל חודש שיש בו תנועה בטווח, עם יתרה חודשית ומצטברת.
 * המצטברת ממשיכה מהיתרה שנצברה לפני תחילת הטווח, כמו עמודה G בקובץ הישן.
 */
export function monthlyBalance(
  db: Database,
  range: BalanceRange = { kind: 'all' },
): MonthlyBalanceResult {
  const resolved = resolveRange(db, range);
  const all = db.prepare('SELECT * FROM v_monthly_balance').all() as RawMonth[];

  const inRange = (ym: string) => {
    if (resolved.from && ym < resolved.from.slice(0, 7)) return false;
    if (resolved.to && ym > resolved.to.slice(0, 7)) return false;
    return true;
  };

  let openingCumulative = 0;
  for (const m of all) {
    if (resolved.from && m.ym < resolved.from.slice(0, 7)) {
      openingCumulative += m.donations_agorot + m.vow_payments_agorot - m.expenses_agorot;
    }
  }

  let cumulative = openingCumulative;
  const rows: MonthlyBalanceRow[] = all
    .filter((m) => inRange(m.ym))
    .map((m) => {
      const income = m.donations_agorot + m.vow_payments_agorot;
      const net = income - m.expenses_agorot;
      cumulative += net;
      return {
        ym: m.ym,
        donationsAgorot: m.donations_agorot,
        vowPaymentsAgorot: m.vow_payments_agorot,
        incomeAgorot: income,
        expensesAgorot: m.expenses_agorot,
        netAgorot: net,
        cumulativeAgorot: cumulative,
      };
    });

  return {
    rows,
    openingCumulativeAgorot: openingCumulative,
    totals: {
      donationsAgorot: rows.reduce((s, r) => s + r.donationsAgorot, 0),
      vowPaymentsAgorot: rows.reduce((s, r) => s + r.vowPaymentsAgorot, 0),
      incomeAgorot: rows.reduce((s, r) => s + r.incomeAgorot, 0),
      expensesAgorot: rows.reduce((s, r) => s + r.expensesAgorot, 0),
      netAgorot: rows.reduce((s, r) => s + r.netAgorot, 0),
      closingCumulativeAgorot: cumulative,
    },
    label: resolved.label,
  };
}

export interface AccrualRow {
  ym: string;
  /** חיובי נדר שנרשמו בחודש (בסיס צבירה). */
  chargedAgorot: number;
  /** תשלומי נדר שהתקבלו בחודש (בסיס מזומן). */
  collectedAgorot: number;
  gapAgorot: number;
}

/**
 * F-80 (ההערה בסוף הסעיף) – דוח צבירה מול מזומן: כמה נדרו מול כמה נגבה.
 * זה הפער שהקובץ הישן לא הראה בכלל.
 */
export function accrualByMonth(
  db: Database,
  range: BalanceRange = { kind: 'all' },
): {
  rows: AccrualRow[];
  totals: AccrualRow;
} {
  const resolved = resolveRange(db, range);
  const where = (col: string) => {
    const parts: string[] = [`${col} IS NOT NULL`];
    if (resolved.from) parts.push(`${col} >= @from`);
    if (resolved.to) parts.push(`${col} <= @to`);
    return parts.join(' AND ');
  };
  const params = {
    ...(resolved.from ? { from: resolved.from } : {}),
    ...(resolved.to ? { to: resolved.to } : {}),
  };

  const charged = db
    .prepare(
      `SELECT substr(charge_date,1,7) ym,
              SUM(CASE kind WHEN 'credit' THEN -amount_agorot ELSE amount_agorot END) v
       FROM vow_charge WHERE deleted_at IS NULL AND ${where('charge_date')}
       GROUP BY ym`,
    )
    .all(params) as Array<{ ym: string; v: number }>;

  const collected = db
    .prepare(
      `SELECT substr(payment_date,1,7) ym, SUM(amount_agorot) v
       FROM vow_payment WHERE deleted_at IS NULL AND ${where('payment_date')}
       GROUP BY ym`,
    )
    .all(params) as Array<{ ym: string; v: number }>;

  const byMonth = new Map<string, AccrualRow>();
  const bucket = (ym: string) => {
    let r = byMonth.get(ym);
    if (!r) {
      r = { ym, chargedAgorot: 0, collectedAgorot: 0, gapAgorot: 0 };
      byMonth.set(ym, r);
    }
    return r;
  };
  for (const c of charged) bucket(c.ym).chargedAgorot = c.v;
  for (const c of collected) bucket(c.ym).collectedAgorot = c.v;

  const rows = [...byMonth.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  for (const r of rows) r.gapAgorot = r.chargedAgorot - r.collectedAgorot;

  const totals: AccrualRow = {
    ym: 'סה״כ',
    chargedAgorot: rows.reduce((s, r) => s + r.chargedAgorot, 0),
    collectedAgorot: rows.reduce((s, r) => s + r.collectedAgorot, 0),
    gapAgorot: 0,
  };
  totals.gapAgorot = totals.chargedAgorot - totals.collectedAgorot;

  return { rows, totals };
}

/** השנים שיש עבורן נתונים, לבורר הטווח במסך. */
export function availableYears(db: Database): {
  civil: number[];
  fiscal: number[];
  hebrew: number[];
} {
  const startMonth = getNumberSetting(db, 'fiscal_year_start_month', 9);
  const months = (
    db.prepare('SELECT ym FROM v_monthly_balance').all() as Array<{ ym: string }>
  ).map((r) => r.ym);
  if (months.length === 0) return { civil: [], fiscal: [], hebrew: [] };

  const civil = new Set<number>();
  const fiscal = new Set<number>();
  const hebrew = new Set<number>();
  for (const ym of months) {
    const date = `${ym}-01` as IsoDate;
    civil.add(Number(ym.slice(0, 4)));
    fiscal.add(fiscalYearOf(date, startMonth));
    hebrew.add(
      new HDate(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).getFullYear(),
    );
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => b - a);
  return { civil: sorted(civil), fiscal: sorted(fiscal), hebrew: sorted(hebrew) };
}
