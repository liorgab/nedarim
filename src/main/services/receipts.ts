import type { Database } from 'better-sqlite3';
import type { IsoDate, ReceiptSourceType } from '@shared/types';
import { hebrewYearForIssue } from './hebrewCalendar';
import { snapshot, writeAudit } from './audit';
import { nowIso } from '@shared/datetime';

/** F-70..F-74 – שירות הקבלות. */

export interface Receipt {
  id: number;
  receiptNumber: number;
  sourceType: ReceiptSourceType;
  sourceId: number;
  payerName: string;
  amountAgorot: number;
  paymentMethodText: string;
  paymentReference: string | null;
  paymentDate: IsoDate;
  purposeText: string;
  hebrewYear: string;
  issuedAt: string;
  pdfPath: string | null;
  printCount: number;
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface Row {
  id: number;
  receipt_number: number;
  source_type: ReceiptSourceType;
  source_id: number;
  payer_name: string;
  amount_agorot: number;
  payment_method_text: string;
  payment_reference: string | null;
  payment_date: IsoDate;
  purpose_text: string;
  hebrew_year: string;
  issued_at: string;
  pdf_path: string | null;
  print_count: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

function toReceipt(r: Row): Receipt {
  return {
    id: r.id,
    receiptNumber: r.receipt_number,
    sourceType: r.source_type,
    sourceId: r.source_id,
    payerName: r.payer_name,
    amountAgorot: r.amount_agorot,
    paymentMethodText: r.payment_method_text,
    paymentReference: r.payment_reference,
    paymentDate: r.payment_date,
    purposeText: r.purpose_text,
    hebrewYear: r.hebrew_year,
    issuedAt: r.issued_at,
    pdfPath: r.pdf_path,
    printCount: r.print_count,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

export interface IssueReceiptInput {
  sourceType: ReceiptSourceType;
  sourceId: number;
  payerName: string;
  amountAgorot: number;
  paymentMethodText: string;
  paymentReference?: string | null;
  paymentDate: IsoDate;
  purposeText: string;
}

/**
 * B-03 / DATA-MODEL – הקצאת מספר קבלה.
 *
 * הכול בטרנזקציה `BEGIN IMMEDIATE` אחת: קריאת המונה, קידומו, יצירת הקבלה וקישורה
 * למקור. `BEGIN IMMEDIATE` תופס נעילת כתיבה מיד, ולכן שני תהליכים שמפיקים קבלה
 * באותו רגע לא יכולים לקבל את אותו מספר. המספר לעולם אינו משוחרר ואינו נערך.
 *
 * ה-PDF נוצר **אחרי** ה-COMMIT: אם יצירתו נכשלת, הקבלה קיימת עם `print_count = 0`
 * וניתן להדפיס אותה שוב – בלי להקצות מספר חדש.
 */
export function issueReceipt(db: Database, input: IssueReceiptInput, userId: number): Receipt {
  if (input.amountAgorot === 0) throw new Error('לא ניתן להפיק קבלה על סכום אפס');

  const existing = db
    .prepare(
      'SELECT * FROM receipt WHERE source_type = ? AND source_id = ? AND cancelled_at IS NULL',
    )
    .get(input.sourceType, input.sourceId) as Row | undefined;
  if (existing) {
    throw new Error(`כבר הופקה קבלה מס' ${existing.receipt_number} לתנועה זו`);
  }

  const issuedAt = nowIso();

  // better-sqlite3: `.immediate` מריץ את הטרנזקציה כ-BEGIN IMMEDIATE.
  const allocate = db.transaction((): number => {
    const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'receipt'").get() as
      { next_value: number } | undefined;
    if (!seq) throw new Error('מונה הקבלות חסר בטבלת sequence – יש להריץ seed');
    const number = seq.next_value;
    db.prepare("UPDATE sequence SET next_value = next_value + 1 WHERE name = 'receipt'").run();

    const info = db
      .prepare(
        `INSERT INTO receipt (receipt_number, source_type, source_id, payer_name, amount_agorot,
           payment_method_text, payment_reference, payment_date, purpose_text, hebrew_year,
           issued_at, issued_by, print_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        number,
        input.sourceType,
        input.sourceId,
        input.payerName,
        input.amountAgorot,
        input.paymentMethodText,
        input.paymentReference ?? null,
        input.paymentDate,
        input.purposeText,
        hebrewYearForIssue(issuedAt),
        issuedAt,
        userId,
      );
    const receiptId = Number(info.lastInsertRowid);

    const table = input.sourceType === 'vow_payment' ? 'vow_payment' : 'donation';
    const updated = db
      .prepare(`UPDATE ${table} SET receipt_id = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(receiptId, input.sourceId);
    if (updated.changes !== 1) {
      throw new Error('התנועה שאליה מקושרת הקבלה לא נמצאה');
    }

    writeAudit(db, {
      userId,
      entity: 'receipt',
      entityId: receiptId,
      action: 'create',
      after: snapshot(db, 'receipt', receiptId),
    });
    return receiptId;
  });

  const id = allocate.immediate();
  return getReceipt(db, id)!;
}

export function getReceipt(db: Database, id: number): Receipt | null {
  const row = db.prepare('SELECT * FROM receipt WHERE id = ?').get(id) as Row | undefined;
  return row ? toReceipt(row) : null;
}

export function getReceiptByNumber(db: Database, receiptNumber: number): Receipt | null {
  const row = db.prepare('SELECT * FROM receipt WHERE receipt_number = ?').get(receiptNumber) as
    Row | undefined;
  return row ? toReceipt(row) : null;
}

/** F-72 – רישום הדפסה. ההדפסה השנייה ואילך מסומנת "העתק". */
export function registerPrint(
  db: Database,
  id: number,
  pdfPath: string | null,
  userId: number,
): Receipt {
  const before = snapshot(db, 'receipt', id);
  const run = db.transaction(() => {
    db.prepare(
      'UPDATE receipt SET print_count = print_count + 1, pdf_path = COALESCE(?, pdf_path) WHERE id = ?',
    ).run(pdfPath, id);
    writeAudit(db, {
      userId,
      entity: 'receipt',
      entityId: id,
      action: 'print',
      before,
      after: snapshot(db, 'receipt', id),
    });
  });
  run();
  return getReceipt(db, id)!;
}

/** מעדכן את נתיב ה-PDF בלי לספור הדפסה (שמירה בארכיון בעת ההפקה). */
export function setPdfPath(db: Database, id: number, pdfPath: string): void {
  db.prepare('UPDATE receipt SET pdf_path = ? WHERE id = ?').run(pdfPath, id);
}

export type CancelSourceAction = 'keep' | 'delete';

/**
 * F-73 – ביטול קבלה (מנהל בלבד, סיבה חובה). המספר נשאר תפוס לנצח.
 * `sourceAction`: להשאיר את התשלום/התרומה (חוזרים לסטאטוס "שולם") או למחוק לוגית גם אותם.
 */
export function cancelReceipt(
  db: Database,
  id: number,
  reason: string,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
  sourceAction: CancelSourceAction = 'keep',
): Receipt {
  if (userRole !== 'admin') throw new Error('ביטול קבלה מותר למנהל בלבד');
  if (reason.trim() === '') throw new Error('סיבת ביטול היא שדה חובה');

  const receipt = getReceipt(db, id);
  if (!receipt) throw new Error('קבלה לא נמצאה');
  if (receipt.cancelledAt) throw new Error('הקבלה כבר בוטלה');

  const before = snapshot(db, 'receipt', id);
  const ts = nowIso();
  const table = receipt.sourceType === 'vow_payment' ? 'vow_payment' : 'donation';

  const run = db.transaction(() => {
    db.prepare(
      'UPDATE receipt SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?',
    ).run(ts, userId, reason.trim(), id);
    db.prepare(`UPDATE ${table} SET receipt_id = NULL, updated_at = ? WHERE id = ?`).run(
      ts,
      receipt.sourceId,
    );
    if (sourceAction === 'delete') {
      const sourceBefore = snapshot(db, table, receipt.sourceId);
      db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(
        ts,
        ts,
        receipt.sourceId,
      );
      writeAudit(db, {
        userId,
        entity: table,
        entityId: receipt.sourceId,
        action: 'delete',
        before: sourceBefore,
      });
    }
    writeAudit(db, {
      userId,
      entity: 'receipt',
      entityId: id,
      action: 'cancel',
      before,
      after: snapshot(db, 'receipt', id),
    });
  });
  run();
  return getReceipt(db, id)!;
}

export interface ReceiptFilter {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  sourceType?: ReceiptSourceType;
  /** 'all' | 'active' | 'cancelled' */
  state?: 'all' | 'active' | 'cancelled';
  minNumber?: number;
  maxNumber?: number;
}

export interface ReceiptBookKpis {
  count: number;
  totalAgorot: number;
  cancelledCount: number;
  cancelledAgorot: number;
  vowPaymentAgorot: number;
  donationAgorot: number;
  firstNumber: number | null;
  lastNumber: number | null;
}

/** F-74 – ספר הקבלות. */
export function listReceipts(
  db: Database,
  filter: ReceiptFilter = {},
): { rows: Receipt[]; total: number; kpis: ReceiptBookKpis } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.from) {
    where.push('payment_date >= @from');
    params['from'] = filter.from;
  }
  if (filter.to) {
    where.push('payment_date <= @to');
    params['to'] = filter.to;
  }
  if (filter.sourceType) {
    where.push('source_type = @sourceType');
    params['sourceType'] = filter.sourceType;
  }
  if (filter.state === 'active') where.push('cancelled_at IS NULL');
  if (filter.state === 'cancelled') where.push('cancelled_at IS NOT NULL');
  if (filter.minNumber !== undefined) {
    where.push('receipt_number >= @minNumber');
    params['minNumber'] = filter.minNumber;
  }
  if (filter.maxNumber !== undefined) {
    where.push('receipt_number <= @maxNumber');
    params['maxNumber'] = filter.maxNumber;
  }
  if (filter.search && filter.search.trim() !== '') {
    where.push(
      '(payer_name LIKE @q OR purpose_text LIKE @q OR CAST(receipt_number AS TEXT) LIKE @q)',
    );
    params['q'] = `%${filter.search.trim()}%`;
  }

  const rows = (
    db
      .prepare(
        `SELECT * FROM receipt ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY receipt_number`,
      )
      .all(params) as Row[]
  ).map(toReceipt);

  const total = (db.prepare('SELECT COUNT(*) c FROM receipt').get() as { c: number }).c;
  const active = rows.filter((r) => r.cancelledAt === null);
  const cancelled = rows.filter((r) => r.cancelledAt !== null);

  return {
    rows,
    total,
    kpis: {
      count: rows.length,
      totalAgorot: active.reduce((s, r) => s + r.amountAgorot, 0),
      cancelledCount: cancelled.length,
      cancelledAgorot: cancelled.reduce((s, r) => s + r.amountAgorot, 0),
      vowPaymentAgorot: active
        .filter((r) => r.sourceType === 'vow_payment')
        .reduce((s, r) => s + r.amountAgorot, 0),
      donationAgorot: active
        .filter((r) => r.sourceType === 'donation')
        .reduce((s, r) => s + r.amountAgorot, 0),
      firstNumber: rows[0]?.receiptNumber ?? null,
      lastNumber: rows[rows.length - 1]?.receiptNumber ?? null,
    },
  };
}

/** F-74 – בדיקת רציפות: אילו מספרים בין 1 למונה הנוכחי אינם קיימים. */
export function receiptContinuity(db: Database): {
  nextNumber: number;
  issued: number;
  missing: number[];
  duplicates: number[];
} {
  const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'receipt'").get() as {
    next_value: number;
  };
  const numbers = (
    db.prepare('SELECT receipt_number FROM receipt ORDER BY receipt_number').all() as Array<{
      receipt_number: number;
    }>
  ).map((r) => r.receipt_number);

  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const n of numbers) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }
  const missing: number[] = [];
  for (let n = 1; n < seq.next_value; n++) if (!seen.has(n)) missing.push(n);

  return { nextNumber: seq.next_value, issued: numbers.length, missing, duplicates };
}

/** המספר הבא שיוקצה – להצגה בטופס לפני ההפקה. */
export function peekNextReceiptNumber(db: Database): number {
  const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'receipt'").get() as {
    next_value: number;
  };
  return seq.next_value;
}
