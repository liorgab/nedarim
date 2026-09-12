import type { Database } from 'better-sqlite3';
import type { Lookup, Occasion, PaymentMethod } from '@shared/types';

const activeFilter = (includeInactive: boolean) => (includeInactive ? '' : 'WHERE is_active = 1');

export function listOccasions(db: Database, includeInactive = false): Occasion[] {
  const rows = db
    .prepare(
      `SELECT id, name, type, hebcal_key, sort_order, is_active
       FROM occasion ${activeFilter(includeInactive)} ORDER BY sort_order, name`,
    )
    .all() as Array<{
    id: number;
    name: string;
    type: Occasion['type'];
    hebcal_key: string | null;
    sort_order: number;
    is_active: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    hebcalKey: r.hebcal_key,
    sortOrder: r.sort_order,
    isActive: r.is_active === 1,
  }));
}

export function listPaymentMethods(db: Database, includeInactive = false): PaymentMethod[] {
  const rows = db
    .prepare(
      `SELECT id, name, requires_reference, is_active
       FROM payment_method ${activeFilter(includeInactive)} ORDER BY id`,
    )
    .all() as Array<{ id: number; name: string; requires_reference: number; is_active: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    requiresReference: r.requires_reference === 1,
    isActive: r.is_active === 1,
  }));
}

function listSimpleLookup(
  db: Database,
  table: 'donation_type' | 'expense_category',
  includeInactive: boolean,
): Lookup[] {
  const rows = db
    .prepare(
      `SELECT id, name, is_active FROM ${table} ${activeFilter(includeInactive)} ORDER BY id`,
    )
    .all() as Array<{ id: number; name: string; is_active: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active === 1 }));
}

export function listDonationTypes(db: Database, includeInactive = false): Lookup[] {
  return listSimpleLookup(db, 'donation_type', includeInactive);
}

export function listExpenseCategories(db: Database, includeInactive = false): Lookup[] {
  return listSimpleLookup(db, 'expense_category', includeInactive);
}

/** מוצא occasion לפי מפתח hebcal (משמש לברירת המחדל בהזנת נדר, F-31). */
export function findOccasionByHebcalKey(
  db: Database,
  key: string,
): { id: number; name: string } | null {
  const row = db
    .prepare('SELECT id, name FROM occasion WHERE hebcal_key = ? AND is_active = 1')
    .get(key) as { id: number; name: string } | undefined;
  return row ?? null;
}

export function findOccasionByName(
  db: Database,
  name: string,
): { id: number; name: string } | null {
  const row = db.prepare('SELECT id, name FROM occasion WHERE name = ?').get(name) as
    { id: number; name: string } | undefined;
  return row ?? null;
}
