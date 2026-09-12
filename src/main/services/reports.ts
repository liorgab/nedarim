import type { Database } from 'better-sqlite3';
import type { IsoDate } from '@shared/types';
import { resolveRange, type BalanceRange } from './balance';
import { nowIso } from '@shared/datetime';

/**
 * F-81..F-86 – הדוחות.
 *
 * כל דוח מחזיר מבנה אחיד (`ReportResult`) עם עמודות, שורות וסיכומים, כדי
 * שהמסך, ההדפסה והייצוא ל-Excel/CSV יעבדו עליו בלי קוד ייעודי לכל דוח (F-87).
 */

export type ColumnFormat = 'text' | 'money' | 'date' | 'number' | 'hebrewDate';

export interface ReportColumn {
  key: string;
  label: string;
  format: ColumnFormat;
  align?: 'start' | 'end';
}

export type ReportCell = string | number | null;

export interface ReportResult {
  id: ReportId;
  title: string;
  subtitle: string;
  columns: readonly ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  /** שורת סיכום, אם רלוונטי. */
  totals: Record<string, ReportCell> | null;
  kpis: Array<{ key: string; label: string; value: number; format: ColumnFormat }>;
  generatedAt: string;
}

export type ReportId =
  'debtors' | 'byOccasion' | 'donations' | 'expenses' | 'byPaymentMethod' | 'memberStatement';

export interface ReportParams {
  range?: BalanceRange;
  memberId?: number;
  /** רק חברים עם חוב מעל הסכום הזה. */
  minBalanceAgorot?: number;
}

export const REPORTS: ReadonlyArray<{ id: ReportId; title: string; needsMember?: boolean }> = [
  { id: 'debtors', title: 'יתרות חוב' },
  { id: 'byOccasion', title: 'נדרים לפי פרשה ואירוע' },
  { id: 'donations', title: 'תרומות' },
  { id: 'expenses', title: 'הוצאות' },
  { id: 'byPaymentMethod', title: 'תקבולים לפי אמצעי תשלום' },
  { id: 'memberStatement', title: 'דף חשבון לחבר', needsMember: true },
];

function rangeClause(
  column: string,
  from: IsoDate | null,
  to: IsoDate | null,
): { sql: string; params: Record<string, unknown> } {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (from) {
    parts.push(`${column} >= @from`);
    params['from'] = from;
  }
  if (to) {
    parts.push(`${column} <= @to`);
    params['to'] = to;
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

const now = () => nowIso();

/** F-81 – יתרות חוב, ממוין לפי גובה החוב, עם גיל החוב. */
function debtorsReport(db: Database, params: ReportParams): ReportResult {
  const min = params.minBalanceAgorot ?? 1;
  const rows = db
    .prepare(
      `SELECT member_number, first_name || ' ' || last_name AS name, balance_agorot,
              last_payment_date,
              CASE WHEN last_payment_date IS NULL THEN NULL
                   ELSE CAST(julianday('now') - julianday(last_payment_date) AS INTEGER) END AS days
       FROM v_member_balance
       WHERE status = 'active' AND balance_agorot >= @min
       ORDER BY balance_agorot DESC`,
    )
    .all({ min }) as Array<{
    member_number: number;
    name: string;
    balance_agorot: number;
    last_payment_date: string | null;
    days: number | null;
  }>;

  const total = rows.reduce((s, r) => s + r.balance_agorot, 0);
  return {
    id: 'debtors',
    title: 'דוח יתרות חוב',
    subtitle: `חברים פעילים עם יתרה מעל ${(min / 100).toLocaleString('he-IL')} ₪`,
    columns: [
      { key: 'member_number', label: 'מס׳ חבר', format: 'number' },
      { key: 'name', label: 'שם', format: 'text' },
      { key: 'balance_agorot', label: 'יתרת חוב', format: 'money', align: 'end' },
      { key: 'last_payment_date', label: 'תשלום אחרון', format: 'date' },
      { key: 'days', label: 'ימים מאז', format: 'number', align: 'end' },
    ],
    rows: rows as unknown as Array<Record<string, ReportCell>>,
    totals: { name: 'סה״כ', balance_agorot: total },
    kpis: [
      { key: 'count', label: 'חייבים', value: rows.length, format: 'number' },
      { key: 'total', label: 'סה״כ חוב', value: total, format: 'money' },
      {
        key: 'avg',
        label: 'חוב ממוצע',
        value: rows.length === 0 ? 0 : Math.round(total / rows.length),
        format: 'money',
      },
      {
        key: 'stale',
        label: 'לא שילמו מעל שנה',
        value: rows.filter((r) => r.days === null || r.days > 365).length,
        format: 'number',
      },
    ],
    generatedAt: now(),
  };
}

/** F-82 – כמה נדרו וכמה נגבה בכל פרשה/אירוע. */
function byOccasionReport(db: Database, from: IsoDate | null, to: IsoDate | null): ReportResult {
  const clause = rangeClause('c.charge_date', from, to);
  const rows = db
    .prepare(
      `SELECT o.name AS occasion, o.type AS type,
              COUNT(*) AS count,
              SUM(CASE c.kind WHEN 'credit' THEN -c.amount_agorot ELSE c.amount_agorot END) AS charged
       FROM vow_charge c JOIN occasion o ON o.id = c.occasion_id
       WHERE c.deleted_at IS NULL${clause.sql}
       GROUP BY o.id ORDER BY charged DESC`,
    )
    .all(clause.params) as Array<{
    occasion: string;
    type: string;
    count: number;
    charged: number;
  }>;

  const total = rows.reduce((s, r) => s + r.charged, 0);
  return {
    id: 'byOccasion',
    title: 'נדרים לפי פרשה ואירוע',
    subtitle: 'בסיס צבירה – מה נרשם כחיוב, ללא קשר למועד הגבייה',
    columns: [
      { key: 'occasion', label: 'פרשה / אירוע', format: 'text' },
      { key: 'count', label: 'מספר נדרים', format: 'number', align: 'end' },
      { key: 'charged', label: 'סה״כ נדר', format: 'money', align: 'end' },
    ],
    rows: rows as unknown as Array<Record<string, ReportCell>>,
    totals: { occasion: 'סה״כ', count: rows.reduce((s, r) => s + r.count, 0), charged: total },
    kpis: [
      { key: 'occasions', label: 'פרשות ואירועים', value: rows.length, format: 'number' },
      { key: 'total', label: 'סה״כ נדרים', value: total, format: 'money' },
      { key: 'top', label: 'הגבוה ביותר', value: rows[0]?.charged ?? 0, format: 'money' },
    ],
    generatedAt: now(),
  };
}

/** F-83 – תרומות לפי סוג ותורם. */
function donationsReport(db: Database, from: IsoDate | null, to: IsoDate | null): ReportResult {
  const clause = rangeClause('d.donation_date', from, to);
  const rows = db
    .prepare(
      `SELECT d.donation_date AS date, d.donor_name AS donor, dt.name AS type,
              pm.name AS method, d.amount_agorot AS amount, d.purpose AS purpose,
              r.receipt_number AS receipt
       FROM donation d
       JOIN donation_type dt ON dt.id = d.donation_type_id
       JOIN payment_method pm ON pm.id = d.payment_method_id
       LEFT JOIN receipt r ON r.id = d.receipt_id
       WHERE d.deleted_at IS NULL${clause.sql}
       ORDER BY d.donation_date DESC`,
    )
    .all(clause.params) as Array<{ amount: number; type: string }>;

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + r.amount);

  return {
    id: 'donations',
    title: 'דוח תרומות',
    subtitle: '',
    columns: [
      { key: 'date', label: 'תאריך', format: 'date' },
      { key: 'donor', label: 'תורם', format: 'text' },
      { key: 'type', label: 'סוג', format: 'text' },
      { key: 'method', label: 'אמצעי', format: 'text' },
      { key: 'purpose', label: 'ייעוד', format: 'text' },
      { key: 'receipt', label: 'קבלה', format: 'number' },
      { key: 'amount', label: 'סכום', format: 'money', align: 'end' },
    ],
    rows: rows as unknown as Array<Record<string, ReportCell>>,
    totals: { donor: 'סה״כ', amount: total },
    kpis: [
      { key: 'count', label: 'תרומות', value: rows.length, format: 'number' },
      { key: 'total', label: 'סה״כ', value: total, format: 'money' },
      ...[...byType.entries()].map(([type, v]) => ({
        key: `type-${type}`,
        label: type,
        value: v,
        format: 'money' as const,
      })),
    ],
    generatedAt: now(),
  };
}

/** F-84 – הוצאות לפי קטגוריה וספק. */
function expensesReport(db: Database, from: IsoDate | null, to: IsoDate | null): ReportResult {
  const clause = rangeClause('e.expense_date', from, to);
  const rows = db
    .prepare(
      `SELECT c.name AS category, COUNT(*) AS count, SUM(e.amount_agorot) AS amount
       FROM expense e JOIN expense_category c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL${clause.sql}
       GROUP BY c.id ORDER BY amount DESC`,
    )
    .all(clause.params) as Array<{ category: string; count: number; amount: number }>;

  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    id: 'expenses',
    title: 'דוח הוצאות לפי קטגוריה',
    subtitle: '',
    columns: [
      { key: 'category', label: 'קטגוריה', format: 'text' },
      { key: 'count', label: 'מספר הוצאות', format: 'number', align: 'end' },
      { key: 'amount', label: 'סה״כ', format: 'money', align: 'end' },
    ],
    rows: rows as unknown as Array<Record<string, ReportCell>>,
    totals: { category: 'סה״כ', count: rows.reduce((s, r) => s + r.count, 0), amount: total },
    kpis: [
      { key: 'total', label: 'סה״כ הוצאות', value: total, format: 'money' },
      { key: 'categories', label: 'קטגוריות', value: rows.length, format: 'number' },
      { key: 'top', label: 'הקטגוריה הגדולה', value: rows[0]?.amount ?? 0, format: 'money' },
    ],
    generatedAt: now(),
  };
}

/** F-85 – התאמת קופה: כמה התקבל בכל אמצעי תשלום. */
function byPaymentMethodReport(
  db: Database,
  from: IsoDate | null,
  to: IsoDate | null,
): ReportResult {
  const pay = rangeClause('p.payment_date', from, to);
  const don = rangeClause('d.donation_date', from, to);
  const rows = db
    .prepare(
      `SELECT pm.name AS method,
        COALESCE((SELECT SUM(p.amount_agorot) FROM vow_payment p
                  WHERE p.payment_method_id = pm.id AND p.deleted_at IS NULL${pay.sql}), 0) AS vow_payments,
        COALESCE((SELECT SUM(d.amount_agorot) FROM donation d
                  WHERE d.payment_method_id = pm.id AND d.deleted_at IS NULL${don.sql}), 0) AS donations
       FROM payment_method pm ORDER BY pm.id`,
    )
    .all({ ...pay.params, ...don.params }) as Array<{
    method: string;
    vow_payments: number;
    donations: number;
  }>;

  const withTotal = rows
    .map((r) => ({ ...r, total: r.vow_payments + r.donations }))
    .filter((r) => r.total !== 0);
  const total = withTotal.reduce((s, r) => s + r.total, 0);

  return {
    id: 'byPaymentMethod',
    title: 'תקבולים לפי אמצעי תשלום',
    subtitle: 'להתאמת קופה: כמה מזומן וכמה המחאות התקבלו בתקופה',
    columns: [
      { key: 'method', label: 'אמצעי תשלום', format: 'text' },
      { key: 'vow_payments', label: 'תשלומי נדרים', format: 'money', align: 'end' },
      { key: 'donations', label: 'תרומות', format: 'money', align: 'end' },
      { key: 'total', label: 'סה״כ', format: 'money', align: 'end' },
    ],
    rows: withTotal as unknown as Array<Record<string, ReportCell>>,
    totals: {
      method: 'סה״כ',
      vow_payments: withTotal.reduce((s, r) => s + r.vow_payments, 0),
      donations: withTotal.reduce((s, r) => s + r.donations, 0),
      total,
    },
    kpis: [
      { key: 'total', label: 'סה״כ תקבולים', value: total, format: 'money' },
      {
        key: 'cash',
        label: 'מזומן',
        value: withTotal.find((r) => r.method === 'מזומן')?.total ?? 0,
        format: 'money',
      },
    ],
    generatedAt: now(),
  };
}

/** F-86 – דף חשבון לחבר: כל התנועות בתקופה ויתרה. */
function memberStatementReport(
  db: Database,
  memberId: number,
  from: IsoDate | null,
  to: IsoDate | null,
): ReportResult {
  const member = db
    .prepare(
      `SELECT member_number, first_name || ' ' || last_name AS name, balance_agorot
       FROM v_member_balance WHERE member_id = ?`,
    )
    .get(memberId) as { member_number: number; name: string; balance_agorot: number } | undefined;
  if (!member) throw new Error('חבר לא נמצא');

  const clause = rangeClause('d', from, to);
  const rows = db
    .prepare(
      `SELECT d AS date, occasion, note, debit_agorot, credit_agorot, payment_method, receipt_number
       FROM v_ledger WHERE member_id = @memberId${clause.sql}
       ORDER BY d, CASE row_type WHEN 'charge' THEN 0 ELSE 1 END, id`,
    )
    .all({ memberId, ...clause.params }) as Array<{
    debit_agorot: number;
    credit_agorot: number;
  }>;

  const debit = rows.reduce((s, r) => s + r.debit_agorot, 0);
  const credit = rows.reduce((s, r) => s + r.credit_agorot, 0);

  return {
    id: 'memberStatement',
    title: `דף חשבון – ${member.name}`,
    subtitle: `חבר מס׳ ${member.member_number}`,
    columns: [
      { key: 'date', label: 'תאריך', format: 'date' },
      { key: 'occasion', label: 'פרשה / אירוע', format: 'text' },
      { key: 'note', label: 'פירוט', format: 'text' },
      { key: 'payment_method', label: 'אמצעי', format: 'text' },
      { key: 'receipt_number', label: 'קבלה', format: 'number' },
      { key: 'debit_agorot', label: 'חיוב', format: 'money', align: 'end' },
      { key: 'credit_agorot', label: 'זיכוי', format: 'money', align: 'end' },
    ],
    rows: rows as unknown as Array<Record<string, ReportCell>>,
    totals: { occasion: 'סה״כ', debit_agorot: debit, credit_agorot: credit },
    kpis: [
      { key: 'debit', label: 'סה״כ חיובים', value: debit, format: 'money' },
      { key: 'credit', label: 'סה״כ תשלומים', value: credit, format: 'money' },
      { key: 'balance', label: 'יתרה נוכחית', value: member.balance_agorot, format: 'money' },
    ],
    generatedAt: now(),
  };
}

export function runReport(db: Database, id: ReportId, params: ReportParams = {}): ReportResult {
  const resolved = resolveRange(db, params.range ?? { kind: 'all' });
  const withRange = (r: ReportResult): ReportResult => ({
    ...r,
    subtitle: [r.subtitle, resolved.label].filter((x) => x !== '').join(' · '),
  });

  switch (id) {
    case 'debtors':
      return withRange(debtorsReport(db, params));
    case 'byOccasion':
      return withRange(byOccasionReport(db, resolved.from, resolved.to));
    case 'donations':
      return withRange(donationsReport(db, resolved.from, resolved.to));
    case 'expenses':
      return withRange(expensesReport(db, resolved.from, resolved.to));
    case 'byPaymentMethod':
      return withRange(byPaymentMethodReport(db, resolved.from, resolved.to));
    case 'memberStatement': {
      if (params.memberId === undefined) throw new Error('יש לבחור חבר לדוח דף החשבון');
      return withRange(memberStatementReport(db, params.memberId, resolved.from, resolved.to));
    }
    default:
      throw new Error(`דוח לא מוכר: ${String(id)}`);
  }
}
