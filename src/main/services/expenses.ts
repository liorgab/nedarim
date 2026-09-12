import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { IsoDate } from '@shared/types';
import { snapshot, writeAudit } from './audit';
import { localDateToIso } from './hebrewCalendar';
import { MAX_AMOUNT_AGOROT, MAX_FUTURE_DAYS, type ValidationIssue } from './vows';
import { nowIso } from '@shared/datetime';

/** F-60..F-62 – יומן ההוצאות. */

export interface Expense {
  id: number;
  expenseNumber: number;
  expenseDate: IsoDate;
  amountAgorot: number;
  isRefund: boolean;
  categoryId: number;
  category: string;
  description: string;
  supplier: string | null;
  reference: string | null;
  paymentMethodId: number | null;
  paymentMethod: string | null;
  attachmentPath: string | null;
  notes: string | null;
  needsReview: boolean;
}

export interface ExpenseFilter {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  categoryId?: number;
  supplier?: string;
  paymentMethodId?: number;
  minAmountAgorot?: number;
  maxAmountAgorot?: number;
}

export interface ExpenseKpis {
  count: number;
  totalAgorot: number;
  averageAgorot: number;
  largestAgorot: number;
  refundsAgorot: number;
  byCategory: Array<{ category: string; totalAgorot: number; count: number }>;
}

interface Row {
  id: number;
  expense_number: number;
  expense_date: IsoDate;
  amount_agorot: number;
  is_refund: number;
  category_id: number;
  category: string;
  description: string;
  supplier: string | null;
  reference: string | null;
  payment_method_id: number | null;
  payment_method: string | null;
  attachment_path: string | null;
  notes: string | null;
  needs_review: number;
}

const SELECT = `
  SELECT e.id, e.expense_number, e.expense_date, e.amount_agorot, e.is_refund,
         e.category_id, c.name AS category, e.description, e.supplier, e.reference,
         e.payment_method_id, pm.name AS payment_method, e.attachment_path,
         e.notes, e.needs_review
  FROM expense e
  JOIN expense_category c ON c.id = e.category_id
  LEFT JOIN payment_method pm ON pm.id = e.payment_method_id
  WHERE e.deleted_at IS NULL`;

function toExpense(r: Row): Expense {
  return {
    id: r.id,
    expenseNumber: r.expense_number,
    expenseDate: r.expense_date,
    amountAgorot: r.amount_agorot,
    isRefund: r.is_refund === 1,
    categoryId: r.category_id,
    category: r.category,
    description: r.description,
    supplier: r.supplier,
    reference: r.reference,
    paymentMethodId: r.payment_method_id,
    paymentMethod: r.payment_method,
    attachmentPath: r.attachment_path,
    notes: r.notes,
    needsReview: r.needs_review === 1,
  };
}

export function listExpenses(
  db: Database,
  filter: ExpenseFilter = {},
): { rows: Expense[]; total: number; kpis: ExpenseKpis } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    where.push('e.expense_date >= @from');
    params['from'] = filter.from;
  }
  if (filter.to) {
    where.push('e.expense_date <= @to');
    params['to'] = filter.to;
  }
  if (filter.categoryId !== undefined) {
    where.push('e.category_id = @categoryId');
    params['categoryId'] = filter.categoryId;
  }
  if (filter.paymentMethodId !== undefined) {
    where.push('e.payment_method_id = @methodId');
    params['methodId'] = filter.paymentMethodId;
  }
  if (filter.supplier && filter.supplier.trim() !== '') {
    where.push("COALESCE(e.supplier, '') LIKE @supplier");
    params['supplier'] = `%${filter.supplier.trim()}%`;
  }
  if (filter.minAmountAgorot !== undefined) {
    where.push('e.amount_agorot >= @minAmount');
    params['minAmount'] = filter.minAmountAgorot;
  }
  if (filter.maxAmountAgorot !== undefined) {
    where.push('e.amount_agorot <= @maxAmount');
    params['maxAmount'] = filter.maxAmountAgorot;
  }
  if (filter.search && filter.search.trim() !== '') {
    where.push(
      `(e.description LIKE @q OR COALESCE(e.supplier,'') LIKE @q
        OR COALESCE(e.reference,'') LIKE @q OR COALESCE(e.notes,'') LIKE @q
        OR CAST(e.expense_number AS TEXT) LIKE @q)`,
    );
    params['q'] = `%${filter.search.trim()}%`;
  }

  const rows = (
    db
      .prepare(
        `${SELECT} ${where.length ? `AND ${where.join(' AND ')}` : ''}
         ORDER BY e.expense_date DESC, e.expense_number DESC`,
      )
      .all(params) as Row[]
  ).map(toExpense);

  const total = (
    db.prepare('SELECT COUNT(*) c FROM expense WHERE deleted_at IS NULL').get() as { c: number }
  ).c;

  const totalAgorot = rows.reduce((s, r) => s + r.amountAgorot, 0);
  const byCategory = new Map<string, { totalAgorot: number; count: number }>();
  for (const r of rows) {
    const b = byCategory.get(r.category) ?? { totalAgorot: 0, count: 0 };
    b.totalAgorot += r.amountAgorot;
    b.count += 1;
    byCategory.set(r.category, b);
  }

  return {
    rows,
    total,
    kpis: {
      count: rows.length,
      totalAgorot,
      averageAgorot: rows.length === 0 ? 0 : Math.round(totalAgorot / rows.length),
      largestAgorot: rows.reduce((max, r) => Math.max(max, r.amountAgorot), 0),
      refundsAgorot: rows.filter((r) => r.amountAgorot < 0).reduce((s, r) => s + r.amountAgorot, 0),
      byCategory: [...byCategory.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.totalAgorot - a.totalAgorot),
    },
  };
}

export function getExpense(db: Database, id: number): Expense | null {
  const row = db.prepare(`${SELECT} AND e.id = ?`).get(id) as Row | undefined;
  return row ? toExpense(row) : null;
}

export interface ExpenseInput {
  expenseDate: IsoDate;
  amountAgorot: number;
  isRefund?: boolean;
  categoryId: number;
  description: string;
  supplier?: string | null;
  reference?: string | null;
  paymentMethodId?: number | null;
  notes?: string | null;
  /** קובץ מקורי לצירוף; יועתק לארכיון (F-61). */
  attachmentSourcePath?: string | null;
}

export function validateExpense(db: Database, input: ExpenseInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot === 0) {
    issues.push({ field: 'amount', message: 'הסכום חייב להיות מספר שאינו אפס', severity: 'error' });
  } else if (Math.abs(input.amountAgorot) > MAX_AMOUNT_AGOROT) {
    issues.push({ field: 'amount', message: 'הסכום חורג מהמקסימום המותר', severity: 'error' });
  } else if (input.amountAgorot < 0 && !input.isRefund) {
    issues.push({
      field: 'amount',
      message: 'סכום שלילי מותר רק בסימון "החזר / תיקון"',
      severity: 'error',
    });
  }
  if (input.amountAgorot < 0 && !input.notes?.trim()) {
    issues.push({ field: 'notes', message: 'החזר מחייב הערה', severity: 'error' });
  }

  if (input.description.trim() === '') {
    issues.push({ field: 'description', message: 'פירוט ההוצאה הוא שדה חובה', severity: 'error' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) {
    issues.push({ field: 'expenseDate', message: 'תאריך לא תקין', severity: 'error' });
  } else {
    const limit = new Date();
    limit.setDate(limit.getDate() + MAX_FUTURE_DAYS);
    if (input.expenseDate > localDateToIso(limit)) {
      issues.push({
        field: 'expenseDate',
        message: `לא ניתן להזין תאריך יותר מ-${MAX_FUTURE_DAYS} ימים בעתיד`,
        severity: 'error',
      });
    }
  }

  if (!db.prepare('SELECT id FROM expense_category WHERE id = ?').get(input.categoryId)) {
    issues.push({ field: 'categoryId', message: 'יש לבחור קטגוריה', severity: 'error' });
  }

  return issues;
}

/** מעתיק את הקובץ המצורף לארכיון, כדי שהוא לא ייעלם אם המקור יימחק. */
export function storeAttachment(
  userDataDir: string,
  sourcePath: string,
  expenseNumber: number,
): string {
  if (!existsSync(sourcePath)) throw new Error(`הקובץ לא נמצא: ${sourcePath}`);
  const dir = join(userDataDir, 'attachments');
  mkdirSync(dir, { recursive: true });
  const ext = extname(sourcePath) || '';
  const target = join(dir, `expense-${String(expenseNumber).padStart(5, '0')}${ext}`);
  copyFileSync(sourcePath, target);
  return target;
}

export function createExpense(
  db: Database,
  input: ExpenseInput,
  userId: number,
  options: { userDataDir?: string } = {},
): number {
  const errors = validateExpense(db, input).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const ts = nowIso();
  return db.transaction(() => {
    const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'expense'").get() as {
      next_value: number;
    };
    db.prepare("UPDATE sequence SET next_value = next_value + 1 WHERE name = 'expense'").run();

    let attachment: string | null = null;
    if (input.attachmentSourcePath && options.userDataDir) {
      attachment = storeAttachment(options.userDataDir, input.attachmentSourcePath, seq.next_value);
    }

    const info = db
      .prepare(
        `INSERT INTO expense (expense_number, expense_date, amount_agorot, is_refund, category_id,
           description, supplier, reference, payment_method_id, attachment_path, notes,
           created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq.next_value,
        input.expenseDate,
        input.amountAgorot,
        input.amountAgorot < 0 || input.isRefund ? 1 : 0,
        input.categoryId,
        input.description.trim(),
        input.supplier?.trim() || null,
        input.reference?.trim() || null,
        input.paymentMethodId ?? null,
        attachment,
        input.notes?.trim() || null,
        ts,
        ts,
        userId,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'expense',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'expense', id),
    });
    return id;
  })();
}

/** F-62 – עריכה עם רישום ביומן ביקורת. */
export function updateExpense(
  db: Database,
  id: number,
  input: ExpenseInput,
  userId: number,
  options: { userDataDir?: string } = {},
): Expense {
  const current = getExpense(db, id);
  if (!current) throw new Error('ההוצאה לא נמצאה');
  const errors = validateExpense(db, input).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const before = snapshot(db, 'expense', id);
  let attachment = current.attachmentPath;
  if (input.attachmentSourcePath && options.userDataDir) {
    attachment = storeAttachment(
      options.userDataDir,
      input.attachmentSourcePath,
      current.expenseNumber,
    );
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE expense SET expense_date = ?, amount_agorot = ?, is_refund = ?, category_id = ?,
         description = ?, supplier = ?, reference = ?, payment_method_id = ?,
         attachment_path = ?, notes = ?, needs_review = 0, updated_at = ? WHERE id = ?`,
    ).run(
      input.expenseDate,
      input.amountAgorot,
      input.amountAgorot < 0 || input.isRefund ? 1 : 0,
      input.categoryId,
      input.description.trim(),
      input.supplier?.trim() || null,
      input.reference?.trim() || null,
      input.paymentMethodId ?? null,
      attachment,
      input.notes?.trim() || null,
      nowIso(),
      id,
    );
    writeAudit(db, {
      userId,
      entity: 'expense',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(db, 'expense', id),
    });
  })();
  return getExpense(db, id)!;
}

export function deleteExpense(
  db: Database,
  id: number,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): void {
  if (userRole !== 'admin') throw new Error('מחיקת הוצאה מותרת למנהל בלבד');
  const before = snapshot(db, 'expense', id);
  if (!before) throw new Error('ההוצאה לא נמצאה');
  const ts = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE expense SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id);
    writeAudit(db, { userId, entity: 'expense', entityId: id, action: 'delete', before });
  })();
}

/** רשימת הספקים שכבר הוזנו, להשלמה אוטומטית בטופס. */
export function knownSuppliers(db: Database): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT supplier FROM expense
         WHERE deleted_at IS NULL AND supplier IS NOT NULL AND supplier <> ''
         ORDER BY supplier`,
      )
      .all() as Array<{ supplier: string }>
  ).map((r) => r.supplier);
}
