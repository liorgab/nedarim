import type { Database } from 'better-sqlite3';
import type { IsoDate } from '@shared/types';
import { snapshot, writeAudit } from './audit';
import { localDateToIso, todayIso } from './hebrewCalendar';
import { getMember } from './members';
import { issueReceipt, type Receipt } from './receipts';
import { MAX_AMOUNT_AGOROT, MAX_FUTURE_DAYS, type ValidationIssue } from './vows';
import { nowIso } from '@shared/datetime';

/** F-40..F-44 – קבלת תשלום על חשבון נדרים. */

export interface PaymentInput {
  memberId: number;
  paymentDate: IsoDate;
  amountAgorot: number;
  paymentMethodId: number;
  reference?: string | null;
  notes?: string | null;
}

/** SPEC 6.2 – אימות. תשלום מעל היתרה מותר, עם אזהרה (יוצר יתרת זכות). */
export function validatePayment(db: Database, input: PaymentInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) {
    issues.push({ field: 'amount', message: 'הסכום חייב להיות מספר חיובי', severity: 'error' });
  } else if (input.amountAgorot > MAX_AMOUNT_AGOROT) {
    issues.push({ field: 'amount', message: 'הסכום חורג מהמקסימום המותר', severity: 'error' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
    issues.push({ field: 'paymentDate', message: 'תאריך לא תקין', severity: 'error' });
  } else {
    const limit = new Date();
    limit.setDate(limit.getDate() + MAX_FUTURE_DAYS);
    if (input.paymentDate > localDateToIso(limit)) {
      issues.push({
        field: 'paymentDate',
        message: `לא ניתן להזין תאריך יותר מ-${MAX_FUTURE_DAYS} ימים בעתיד`,
        severity: 'error',
      });
    }
  }

  const method = db
    .prepare('SELECT id, name, requires_reference FROM payment_method WHERE id = ?')
    .get(input.paymentMethodId) as
    { id: number; name: string; requires_reference: number } | undefined;
  if (!method) {
    issues.push({ field: 'paymentMethodId', message: 'יש לבחור אמצעי תשלום', severity: 'error' });
  } else if (method.requires_reference === 1 && !input.reference?.trim()) {
    issues.push({
      field: 'reference',
      message: `מומלץ למלא אסמכתא עבור ${method.name}`,
      severity: 'warning',
    });
  }

  const member = getMember(db, input.memberId);
  if (!member) {
    issues.push({ field: 'memberId', message: 'חבר לא נמצא', severity: 'error' });
  } else if (input.amountAgorot > member.balanceAgorot) {
    const credit = input.amountAgorot - member.balanceAgorot;
    issues.push({
      field: 'amount',
      message: `הסכום גדול מיתרת החוב – תיווצר יתרת זכות של ${(credit / 100).toLocaleString('he-IL')} ₪`,
      severity: 'warning',
    });
  }

  return issues;
}

export interface PaymentResult {
  paymentId: number;
  receipt: Receipt | null;
  balanceAfterAgorot: number;
}

/**
 * F-41..F-43 – רישום תשלום, ואופציונלית הפקת קבלה באותה פעולה.
 * זה מקצר את הזרימה הישנה (3 מסכים) לפעולה אחת.
 */
export function createPayment(
  db: Database,
  input: PaymentInput,
  userId: number,
  options: { issueReceipt?: boolean } = {},
): PaymentResult {
  const errors = validatePayment(db, input).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const ts = nowIso();
  const paymentId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vow_payment (member_id, payment_date, amount_agorot, payment_method_id,
           reference, notes, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.memberId,
        input.paymentDate,
        input.amountAgorot,
        input.paymentMethodId,
        input.reference?.trim() || null,
        input.notes?.trim() || null,
        ts,
        ts,
        userId,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'vow_payment',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'vow_payment', id),
    });
    return id;
  })();

  let receipt: Receipt | null = null;
  if (options.issueReceipt) {
    const member = getMember(db, input.memberId)!;
    const method = db
      .prepare('SELECT name FROM payment_method WHERE id = ?')
      .get(input.paymentMethodId) as { name: string };
    receipt = issueReceipt(
      db,
      {
        sourceType: 'vow_payment',
        sourceId: paymentId,
        payerName: `${member.firstName} ${member.lastName}`.trim(),
        amountAgorot: input.amountAgorot,
        paymentMethodText: method.name,
        paymentReference: input.reference?.trim() || null,
        paymentDate: input.paymentDate,
        purposeText: 'תשלום נדרים',
      },
      userId,
    );
  }

  return {
    paymentId,
    receipt,
    balanceAfterAgorot: getMember(db, input.memberId)!.balanceAgorot,
  };
}

/**
 * F-44 – תשלום עבור כמה חברים באותו אמצעי (אב שמשלם עבור בניו).
 * קבלה נפרדת לכל חבר, כי הקבלה נושאת שם משלם אחד.
 */
export function createPaymentsBulk(
  db: Database,
  input: {
    paymentDate: IsoDate;
    paymentMethodId: number;
    reference?: string | null;
    lines: Array<{ memberId: number; amountAgorot: number; notes?: string | null }>;
  },
  userId: number,
  options: { issueReceipts?: boolean } = {},
): PaymentResult[] {
  if (input.lines.length === 0) throw new Error('אין שורות לתשלום');

  for (const line of input.lines) {
    const errors = validatePayment(db, {
      memberId: line.memberId,
      paymentDate: input.paymentDate,
      amountAgorot: line.amountAgorot,
      paymentMethodId: input.paymentMethodId,
      reference: input.reference ?? null,
    }).filter((i) => i.severity === 'error');
    if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));
  }

  return input.lines.map((line) =>
    createPayment(
      db,
      {
        memberId: line.memberId,
        paymentDate: input.paymentDate,
        amountAgorot: line.amountAgorot,
        paymentMethodId: input.paymentMethodId,
        reference: input.reference ?? null,
        notes: line.notes ?? null,
      },
      userId,
      { issueReceipt: options.issueReceipts ?? false },
    ),
  );
}

/**
 * B-05 – תשלום שהופקה לו קבלה אינו ניתן לעריכה. תיקון = ביטול קבלה + רישום חדש.
 */
export function deletePayment(
  db: Database,
  id: number,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): void {
  const row = db
    .prepare('SELECT * FROM vow_payment WHERE id = ? AND deleted_at IS NULL')
    .get(id) as
    { receipt_id: number | null; created_by: number | null; created_at: string } | undefined;
  if (!row) throw new Error('התשלום לא נמצא או כבר נמחק');
  if (row.receipt_id !== null) {
    throw new Error('לתשלום הופקה קבלה – יש לבטל את הקבלה תחילה (F-73)');
  }
  if (userRole !== 'admin') {
    const sameUser = row.created_by === userId;
    const sameDay = row.created_at.slice(0, 10) === todayIso();
    if (!sameUser || !sameDay) throw new Error('מזין יכול למחוק רק תנועה שהוא עצמו רשם היום');
  }

  const before = snapshot(db, 'vow_payment', id);
  const ts = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE vow_payment SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      ts,
      ts,
      id,
    );
    writeAudit(db, { userId, entity: 'vow_payment', entityId: id, action: 'delete', before });
  })();
}

/** F-70 – הפקת קבלה לתשלום קיים שנרשם בלי קבלה. */
export function issueReceiptForPayment(db: Database, paymentId: number, userId: number): Receipt {
  const row = db
    .prepare(
      `SELECT p.*, pm.name AS method_name, m.first_name, m.last_name
       FROM vow_payment p
       JOIN payment_method pm ON pm.id = p.payment_method_id
       JOIN member m ON m.id = p.member_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(paymentId) as
    | {
        amount_agorot: number;
        payment_date: IsoDate;
        reference: string | null;
        method_name: string;
        first_name: string;
        last_name: string;
      }
    | undefined;
  if (!row) throw new Error('התשלום לא נמצא');

  return issueReceipt(
    db,
    {
      sourceType: 'vow_payment',
      sourceId: paymentId,
      payerName: `${row.first_name} ${row.last_name}`.trim(),
      amountAgorot: row.amount_agorot,
      paymentMethodText: row.method_name,
      paymentReference: row.reference,
      paymentDate: row.payment_date,
      purposeText: 'תשלום נדרים',
    },
    userId,
  );
}
