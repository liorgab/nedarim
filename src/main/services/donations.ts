import type { Database } from 'better-sqlite3';
import { receiptPayerName } from './payments';
import type { IsoDate } from '@shared/types';
import { snapshot, writeAudit } from './audit';
import { localDateToIso } from './hebrewCalendar';
import { issueReceipt, type Receipt } from './receipts';
import { MAX_AMOUNT_AGOROT, MAX_FUTURE_DAYS, type ValidationIssue } from './vows';
import { nowIso } from '@shared/datetime';

/** F-50..F-52 – יומן התרומות. */

export interface Donation {
  id: number;
  donationNumber: number;
  donationDate: IsoDate;
  memberId: number | null;
  memberName: string | null;
  donorName: string;
  donationTypeId: number;
  donationType: string;
  paymentMethodId: number;
  paymentMethod: string;
  reference: string | null;
  amountAgorot: number;
  isReversal: boolean;
  purpose: string | null;
  /** F-76 – שם אחר על הקבלה. `null` = על שם התורם. */
  receiptName: string | null;
  receiptId: number | null;
  receiptNumber: number | null;
  needsReview: boolean;
}

export interface DonationFilter {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  donationTypeId?: number;
  paymentMethodId?: number;
  memberId?: number;
  /** 'all' | 'with' | 'without' – עם קבלה או בלי (F-50). */
  receiptState?: 'all' | 'with' | 'without';
}

export interface DonationKpis {
  count: number;
  totalAgorot: number;
  averageAgorot: number;
  withReceipt: number;
  withoutReceiptAgorot: number;
  linkedToMembers: number;
  largestAgorot: number;
}

interface Row {
  id: number;
  donation_number: number;
  donation_date: IsoDate;
  member_id: number | null;
  member_name: string | null;
  donor_name: string;
  donation_type_id: number;
  donation_type: string;
  payment_method_id: number;
  payment_method: string;
  reference: string | null;
  amount_agorot: number;
  is_reversal: number;
  purpose: string | null;
  receipt_name: string | null;
  receipt_id: number | null;
  receipt_number: number | null;
  needs_review: number;
}

const SELECT = `
  SELECT d.id, d.donation_number, d.donation_date, d.member_id,
         CASE WHEN m.id IS NULL THEN NULL ELSE m.first_name || ' ' || m.last_name END AS member_name,
         d.donor_name, d.donation_type_id, dt.name AS donation_type,
         d.payment_method_id, pm.name AS payment_method, d.reference,
         d.amount_agorot, d.is_reversal, d.purpose, d.receipt_name, d.receipt_id,
         r.receipt_number, d.needs_review
  FROM donation d
  JOIN donation_type dt ON dt.id = d.donation_type_id
  JOIN payment_method pm ON pm.id = d.payment_method_id
  LEFT JOIN member m ON m.id = d.member_id
  LEFT JOIN receipt r ON r.id = d.receipt_id
  WHERE d.deleted_at IS NULL`;

function toDonation(r: Row): Donation {
  return {
    id: r.id,
    donationNumber: r.donation_number,
    donationDate: r.donation_date,
    memberId: r.member_id,
    memberName: r.member_name,
    donorName: r.donor_name,
    donationTypeId: r.donation_type_id,
    donationType: r.donation_type,
    paymentMethodId: r.payment_method_id,
    paymentMethod: r.payment_method,
    reference: r.reference,
    amountAgorot: r.amount_agorot,
    isReversal: r.is_reversal === 1,
    purpose: r.purpose,
    receiptName: r.receipt_name,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number,
    needsReview: r.needs_review === 1,
  };
}

export function listDonations(
  db: Database,
  filter: DonationFilter = {},
): { rows: Donation[]; total: number; kpis: DonationKpis } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    where.push('d.donation_date >= @from');
    params['from'] = filter.from;
  }
  if (filter.to) {
    where.push('d.donation_date <= @to');
    params['to'] = filter.to;
  }
  if (filter.donationTypeId !== undefined) {
    where.push('d.donation_type_id = @typeId');
    params['typeId'] = filter.donationTypeId;
  }
  if (filter.paymentMethodId !== undefined) {
    where.push('d.payment_method_id = @methodId');
    params['methodId'] = filter.paymentMethodId;
  }
  if (filter.memberId !== undefined) {
    where.push('d.member_id = @memberId');
    params['memberId'] = filter.memberId;
  }
  if (filter.receiptState === 'with') where.push('d.receipt_id IS NOT NULL');
  if (filter.receiptState === 'without') where.push('d.receipt_id IS NULL');
  if (filter.search && filter.search.trim() !== '') {
    where.push(
      `(d.donor_name LIKE @q OR COALESCE(d.purpose,'') LIKE @q
        OR CAST(d.donation_number AS TEXT) LIKE @q)`,
    );
    params['q'] = `%${filter.search.trim()}%`;
  }

  const rows = (
    db
      .prepare(
        `${SELECT} ${where.length ? `AND ${where.join(' AND ')}` : ''}
         ORDER BY d.donation_date DESC, d.donation_number DESC`,
      )
      .all(params) as Row[]
  ).map(toDonation);

  const total = (
    db.prepare('SELECT COUNT(*) c FROM donation WHERE deleted_at IS NULL').get() as { c: number }
  ).c;

  const totalAgorot = rows.reduce((s, r) => s + r.amountAgorot, 0);
  return {
    rows,
    total,
    kpis: {
      count: rows.length,
      totalAgorot,
      averageAgorot: rows.length === 0 ? 0 : Math.round(totalAgorot / rows.length),
      withReceipt: rows.filter((r) => r.receiptId !== null).length,
      withoutReceiptAgorot: rows
        .filter((r) => r.receiptId === null)
        .reduce((s, r) => s + r.amountAgorot, 0),
      linkedToMembers: rows.filter((r) => r.memberId !== null).length,
      largestAgorot: rows.reduce((max, r) => Math.max(max, r.amountAgorot), 0),
    },
  };
}

export function getDonation(db: Database, id: number): Donation | null {
  const row = db.prepare(`${SELECT} AND d.id = ?`).get(id) as Row | undefined;
  return row ? toDonation(row) : null;
}

export interface DonationInput {
  donationDate: IsoDate;
  memberId?: number | null;
  donorName: string;
  donationTypeId: number;
  paymentMethodId: number;
  reference?: string | null;
  amountAgorot: number;
  purpose?: string | null;
  /**
   * F-76 – שם אחר על הקבלה. ריק = הקבלה על שם התורם.
   */
  receiptName?: string | null;
}

export function validateDonation(db: Database, input: DonationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) {
    issues.push({ field: 'amount', message: 'הסכום חייב להיות מספר חיובי', severity: 'error' });
  } else if (input.amountAgorot > MAX_AMOUNT_AGOROT) {
    issues.push({ field: 'amount', message: 'הסכום חורג מהמקסימום המותר', severity: 'error' });
  }

  if (input.donorName.trim() === '') {
    issues.push({ field: 'donorName', message: 'שם התורם הוא שדה חובה', severity: 'error' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.donationDate)) {
    issues.push({ field: 'donationDate', message: 'תאריך לא תקין', severity: 'error' });
  } else {
    const limit = new Date();
    limit.setDate(limit.getDate() + MAX_FUTURE_DAYS);
    if (input.donationDate > localDateToIso(limit)) {
      issues.push({
        field: 'donationDate',
        message: `לא ניתן להזין תאריך יותר מ-${MAX_FUTURE_DAYS} ימים בעתיד`,
        severity: 'error',
      });
    }
  }

  if (!db.prepare('SELECT id FROM donation_type WHERE id = ?').get(input.donationTypeId)) {
    issues.push({ field: 'donationTypeId', message: 'יש לבחור סוג תרומה', severity: 'error' });
  }
  const method = db
    .prepare('SELECT name, requires_reference FROM payment_method WHERE id = ?')
    .get(input.paymentMethodId) as { name: string; requires_reference: number } | undefined;
  if (!method) {
    issues.push({ field: 'paymentMethodId', message: 'יש לבחור אמצעי תשלום', severity: 'error' });
  } else if (method.requires_reference === 1 && !input.reference?.trim()) {
    issues.push({
      field: 'reference',
      message: `מומלץ למלא אסמכתא עבור ${method.name}`,
      severity: 'warning',
    });
  }

  return issues;
}

export interface DonationResult {
  donationId: number;
  receipt: Receipt | null;
}

/** F-51 – הזנת תרומה, ואופציונלית הפקת קבלה באותה פעולה. */
export function createDonation(
  db: Database,
  input: DonationInput,
  userId: number,
  options: { issueReceipt?: boolean } = {},
): DonationResult {
  const errors = validateDonation(db, input).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const ts = nowIso();
  const donationId = db.transaction(() => {
    const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'donation'").get() as {
      next_value: number;
    };
    db.prepare("UPDATE sequence SET next_value = next_value + 1 WHERE name = 'donation'").run();

    const info = db
      .prepare(
        `INSERT INTO donation (donation_number, donation_date, member_id, donor_name,
           donation_type_id, payment_method_id, reference, amount_agorot, purpose,
           receipt_name, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq.next_value,
        input.donationDate,
        input.memberId ?? null,
        input.donorName.trim(),
        input.donationTypeId,
        input.paymentMethodId,
        input.reference?.trim() || null,
        input.amountAgorot,
        input.purpose?.trim() || null,
        // נשמר על התרומה כדי שהפקה חוזרת של הקבלה תדע שוב על שם מי.
        input.receiptName?.trim() || null,
        ts,
        ts,
        userId,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'donation',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'donation', id),
    });
    return id;
  })();

  let receipt: Receipt | null = null;
  if (options.issueReceipt) {
    const d = getDonation(db, donationId)!;
    receipt = issueReceipt(
      db,
      {
        sourceType: 'donation',
        sourceId: donationId,
        payerName: receiptPayerName(d.receiptName, d.donorName),
        amountAgorot: d.amountAgorot,
        paymentMethodText: d.paymentMethod,
        paymentReference: d.reference,
        paymentDate: d.donationDate,
        purposeText: `תרומה – ${d.donationType}`,
      },
      userId,
    );
  }

  return { donationId, receipt };
}

/** F-52 – עריכה מותרת עד להפקת קבלה; אחריה רק ביטול הקבלה (B-05). */
export function updateDonation(
  db: Database,
  id: number,
  input: DonationInput,
  userId: number,
): Donation {
  const current = getDonation(db, id);
  if (!current) throw new Error('התרומה לא נמצאה');
  if (current.receiptId !== null) {
    throw new Error('לתרומה הופקה קבלה – יש לבטל את הקבלה תחילה (F-73)');
  }
  const errors = validateDonation(db, input).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const before = snapshot(db, 'donation', id);
  db.transaction(() => {
    db.prepare(
      `UPDATE donation SET donation_date = ?, member_id = ?, donor_name = ?,
         donation_type_id = ?, payment_method_id = ?, reference = ?, amount_agorot = ?,
         purpose = ?, needs_review = 0, updated_at = ? WHERE id = ?`,
    ).run(
      input.donationDate,
      input.memberId ?? null,
      input.donorName.trim(),
      input.donationTypeId,
      input.paymentMethodId,
      input.reference?.trim() || null,
      input.amountAgorot,
      input.purpose?.trim() || null,
      nowIso(),
      id,
    );
    writeAudit(db, {
      userId,
      entity: 'donation',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(db, 'donation', id),
    });
  })();
  return getDonation(db, id)!;
}

export function deleteDonation(
  db: Database,
  id: number,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): void {
  if (userRole !== 'admin') throw new Error('מחיקת תרומה מותרת למנהל בלבד');
  const current = getDonation(db, id);
  if (!current) throw new Error('התרומה לא נמצאה');
  if (current.receiptId !== null) {
    throw new Error('לתרומה הופקה קבלה – יש לבטל את הקבלה תחילה (F-73)');
  }

  const before = snapshot(db, 'donation', id);
  const ts = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE donation SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id);
    writeAudit(db, { userId, entity: 'donation', entityId: id, action: 'delete', before });
  })();
}

/** F-70 – הפקת קבלה לתרומה קיימת. */
export function issueReceiptForDonation(db: Database, id: number, userId: number): Receipt {
  const d = getDonation(db, id);
  if (!d) throw new Error('התרומה לא נמצאה');
  return issueReceipt(
    db,
    {
      sourceType: 'donation',
      sourceId: id,
      payerName: receiptPayerName(d.receiptName, d.donorName),
      amountAgorot: d.amountAgorot,
      paymentMethodText: d.paymentMethod,
      paymentReference: d.reference,
      paymentDate: d.donationDate,
      purposeText: `תרומה – ${d.donationType}`,
    },
    userId,
  );
}

/** F-22 – תרומות שקושרו לחבר, ללשונית בכרטיסייה (אינן משפיעות על יתרת הנדרים). */
export function donationsForMember(db: Database, memberId: number): Donation[] {
  return listDonations(db, { memberId }).rows;
}
