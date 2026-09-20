import type { Database } from 'better-sqlite3';
import type { IsoDate, LedgerRow } from '@shared/types';
import { toHebrewDate } from './hebrewCalendar';

/** F-21..F-23 – כרטיסיית החבר: תנועות משולבות עם יתרה מצטברת. */

export interface LedgerFilter {
  from?: IsoDate;
  to?: IsoDate;
  /** 'charge' / 'payment' / undefined = הכול */
  rowType?: 'charge' | 'payment';
  /** חיפוש חופשי בפרשה ובפירוט. */
  search?: string;
  occasionId?: number;
  /** רק תנועות ללא קבלה (F-03). */
  onlyWithoutReceipt?: boolean;
}

export interface LedgerKpis {
  openingBalanceAgorot: number;
  debitAgorot: number;
  creditAgorot: number;
  closingBalanceAgorot: number;
  rowCount: number;
  chargeCount: number;
  paymentCount: number;
}

interface RawLedgerRow {
  row_type: 'charge' | 'payment';
  id: number;
  member_id: number;
  d: IsoDate;
  occasion: string | null;
  note: string | null;
  debit_agorot: number;
  credit_agorot: number;
  payment_method: string | null;
  receipt_number: number | null;
  status: LedgerRow['status'];
}

/**
 * מחזיר את תנועות החבר בסדר כרונולוגי עם יתרה מצטברת.
 *
 * היתרה המצטברת מתחילה מ"יתרת פתיחה" = יתרת הפתיחה של החבר + כל התנועות שלפני `from`.
 * כך שורה בטווח מסונן תמיד מציגה את היתרה האמיתית ולא יתרה מקומית (F-23).
 */
export function getLedger(
  db: Database,
  memberId: number,
  filter: LedgerFilter = {},
): { rows: LedgerRow[]; kpis: LedgerKpis } {
  const opening = openingBalanceBefore(db, memberId, filter.from);

  const where: string[] = ['member_id = @memberId'];
  const params: Record<string, unknown> = { memberId };
  if (filter.from) {
    where.push('d >= @from');
    params['from'] = filter.from;
  }
  if (filter.to) {
    where.push('d <= @to');
    params['to'] = filter.to;
  }
  if (filter.rowType) {
    where.push('row_type = @rowType');
    params['rowType'] = filter.rowType;
  }
  if (filter.search && filter.search.trim() !== '') {
    where.push("(COALESCE(occasion,'') LIKE @q OR COALESCE(note,'') LIKE @q)");
    params['q'] = `%${filter.search.trim()}%`;
  }
  if (filter.onlyWithoutReceipt) {
    where.push("row_type = 'payment' AND receipt_number IS NULL");
  }

  const raw = db
    .prepare(
      `SELECT * FROM v_ledger WHERE ${where.join(' AND ')}
       ORDER BY d, CASE row_type WHEN 'charge' THEN 0 ELSE 1 END, id`,
    )
    .all(params) as RawLedgerRow[];

  let running = opening;
  const rows: LedgerRow[] = raw.map((r) => {
    running += r.debit_agorot - r.credit_agorot;
    return {
      rowType: r.row_type,
      id: r.id,
      memberId: r.member_id,
      date: r.d,
      hebrewDate: safeHebrewDate(r.d),
      occasion: r.occasion,
      note: r.note,
      debitAgorot: r.debit_agorot,
      creditAgorot: r.credit_agorot,
      paymentMethod: r.payment_method,
      receiptNumber: r.receipt_number,
      status: r.status,
      runningBalanceAgorot: running,
    };
  });

  const kpis: LedgerKpis = {
    openingBalanceAgorot: opening,
    debitAgorot: rows.reduce((s, r) => s + r.debitAgorot, 0),
    creditAgorot: rows.reduce((s, r) => s + r.creditAgorot, 0),
    closingBalanceAgorot: running,
    rowCount: rows.length,
    chargeCount: rows.filter((r) => r.rowType === 'charge').length,
    paymentCount: rows.filter((r) => r.rowType === 'payment').length,
  };

  return { rows, kpis };
}

/** תאריך עברי לתצוגה; תאריך פגום לא יפיל את המסך. */
function safeHebrewDate(iso: IsoDate): string {
  try {
    return toHebrewDate(iso);
  } catch {
    return '';
  }
}

/** יתרת הפתיחה של החבר + כל התנועות שלפני התאריך הנתון. */
export function openingBalanceBefore(db: Database, memberId: number, before?: IsoDate): number {
  const base = db
    .prepare('SELECT opening_balance_agorot AS v FROM member WHERE id = ?')
    .get(memberId) as { v: number } | undefined;
  if (!base) throw new Error(`חבר ${memberId} לא נמצא`);
  if (!before) return base.v;

  const prior = db
    .prepare(
      `SELECT COALESCE(SUM(debit_agorot - credit_agorot), 0) AS v
       FROM v_ledger WHERE member_id = ? AND d < ?`,
    )
    .get(memberId, before) as { v: number };
  return base.v + prior.v;
}

/** F-40 – חמשת החיובים האחרונים, להצגה בטופס קבלת תשלום. */
export function recentCharges(db: Database, memberId: number, limit = 5): LedgerRow[] {
  const { rows } = getLedger(db, memberId, { rowType: 'charge' });
  return rows.slice(-limit).reverse();
}

/** F-03 – תשלומים שנרשמו ללא קבלה, בכל המערכת. */
export function paymentsWithoutReceipt(
  db: Database,
  limit = 50,
): Array<{
  id: number;
  memberId: number;
  memberName: string;
  memberNumber: number;
  date: IsoDate;
  amountAgorot: number;
  paymentMethod: string;
  /** F-76 – שם אחר שכבר נשמר על התשלום. `null` = על שם החבר. */
  receiptName: string | null;
}> {
  return db
    .prepare(
      `SELECT p.id AS id, p.member_id AS memberId, m.member_number AS memberNumber,
              -- F-13 – במצב "שם מלא" שם המשפחה ריק, ובלי TRIM נוצר רווח עוקב.
              TRIM(m.first_name || ' ' || m.last_name) AS memberName,
              p.payment_date AS date, p.amount_agorot AS amountAgorot, pm.name AS paymentMethod,
              p.receipt_name AS receiptName
       FROM vow_payment p
       JOIN member m ON m.id = p.member_id
       JOIN payment_method pm ON pm.id = p.payment_method_id
       WHERE p.deleted_at IS NULL AND p.receipt_id IS NULL
       ORDER BY p.payment_date DESC, p.id DESC LIMIT ?`,
    )
    .all(limit) as ReturnType<typeof paymentsWithoutReceipt>;
}
