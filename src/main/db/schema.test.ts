import { describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './connection';
import { LATEST_SCHEMA_VERSION, currentSchemaVersion, migrate } from './migrate';
import { seed } from './seed';
import { COMBINED_PARASHIOT, PARASHIOT } from './seed-data';

function freshDb(): Database {
  const db = openDatabase({ file: ':memory:' });
  seed(db);
  return db;
}

function tableNames(db: Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

describe('מיגרציות', () => {
  it('יוצרות את כל הטבלאות והתצוגות מ-DATA-MODEL', () => {
    const db = openDatabase({ file: ':memory:' });
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'audit_log',
        'donation',
        'donation_type',
        'expense',
        'expense_category',
        'member',
        'occasion',
        'payment_method',
        'receipt',
        'schema_version',
        'sequence',
        'setting',
        'user',
        'vow_charge',
        'vow_payment',
        // מיגרציה 005 – מודול WhatsApp
        'message_template',
        'message_campaign',
        'message_campaign_item',
        'whatsapp_daily_counter',
      ]),
    );
    const views = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(views).toEqual([
      'v_ledger',
      'v_member_balance',
      'v_member_duplicate_mobile',
      'v_monthly_balance',
    ]);
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('אידמפוטנטיות – הרצה חוזרת לא מחילה דבר', () => {
    const db = openDatabase({ file: ':memory:' });
    const again = migrate(db);
    expect(again.applied).toEqual([]);
    expect(again.to).toBe(LATEST_SCHEMA_VERSION);
  });

  it('foreign_keys דלוקים', () => {
    const db = openDatabase({ file: ':memory:' });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('seed', () => {
  it('מזריע 54 פרשות + 7 מחוברות', () => {
    const db = freshDb();
    const n = db.prepare("SELECT COUNT(*) c FROM occasion WHERE type='parasha'").get() as {
      c: number;
    };
    expect(n.c).toBe(PARASHIOT.length + COMBINED_PARASHIOT.length);
    expect(PARASHIOT.length).toBe(54);
  });

  it('לכל פרשה יש hebcal_key ייחודי', () => {
    const db = freshDb();
    const rows = db.prepare("SELECT hebcal_key FROM occasion WHERE type='parasha'").all() as Array<{
      hebcal_key: string;
    }>;
    const keys = rows.map((r) => r.hebcal_key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('מזריע רשימות ערך והגדרות', () => {
    const db = freshDb();
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    expect(count('payment_method')).toBe(6);
    expect(count('donation_type')).toBe(4);
    expect(count('expense_category')).toBe(7);
    expect(count('user')).toBe(1);
    expect(count('sequence')).toBe(4);
  });

  it('אידמפוטנטי – הרצה שנייה לא מוסיפה כלום', () => {
    const db = freshDb();
    const second = seed(db);
    expect(second).toEqual({
      occasions: 0,
      messageTemplates: 0,
      paymentMethods: 0,
      donationTypes: 0,
      expenseCategories: 0,
      settings: 0,
      sequences: 0,
      users: 0,
    });
  });

  it('לא מכיל שום ערך ספציפי לבית כנסת (כלל 12)', () => {
    const db = freshDb();
    const rows = db.prepare('SELECT key, value FROM setting').all() as Array<{
      key: string;
      value: string;
    }>;
    const identity = rows.filter(
      (r) => r.key.startsWith('synagogue_') || r.key === 'association_number',
    );
    expect(identity.every((r) => r.value === '')).toBe(true);
    const seq = db.prepare("SELECT next_value v FROM sequence WHERE name='receipt'").get() as {
      v: number;
    };
    expect(seq.v).toBe(1);
  });
});

describe('אילוצי שלמות', () => {
  const setup = () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (1, 'ישראל', 'ישראלי', '2026-01-01T00:00:00', '2026-01-01T00:00:00')`,
    ).run();
    return db;
  };

  it('חוסם סכום חיוב אפס או שלילי (סכומים שליליים = זיכוי נפרד)', () => {
    const db = setup();
    const insert = (amount: number) =>
      db
        .prepare(
          `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind, created_at, updated_at)
           VALUES (1, '2026-01-01', 1, ?, 'vow', '', '')`,
        )
        .run(amount);
    expect(() => insert(-100)).toThrow();
    expect(() => insert(0)).toThrow();
    expect(() => insert(100)).not.toThrow();
  });

  it('דורש סיבה לזיכוי', () => {
    const db = setup();
    expect(() =>
      db
        .prepare(
          `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind, created_at, updated_at)
           VALUES (1, '2026-01-01', 1, 100, 'credit', '', '')`,
        )
        .run(),
    ).toThrow();
  });

  it('חוסם הוצאה שלילית שאינה מסומנת כהחזר', () => {
    const db = setup();
    const insert = (amount: number, isRefund: number) =>
      db
        .prepare(
          `INSERT INTO expense (expense_number, expense_date, amount_agorot, is_refund, category_id, description, created_at, updated_at)
           VALUES (?, '2026-01-01', ?, ?, 1, 'בדיקה', '', '')`,
        )
        .run(Math.abs(amount) + isRefund, amount, isRefund);
    expect(() => insert(-300_000, 0)).toThrow();
    expect(() => insert(-300_000, 1)).not.toThrow();
  });

  it('מספר קבלה ייחודי', () => {
    const db = setup();
    const ins = () =>
      db
        .prepare(
          `INSERT INTO receipt (receipt_number, source_type, source_id, payer_name, amount_agorot,
             payment_method_text, payment_date, purpose_text, hebrew_year, issued_at)
           VALUES (453, 'vow_payment', 1, 'ישראל ישראלי', 10000, 'מזומן', '2026-01-01',
                   'תשלום נדרים', 'תשפ״ו', '2026-01-01T10:00:00')`,
        )
        .run();
    ins();
    expect(() => ins()).toThrow(/UNIQUE/);
  });
});

describe('v_member_balance', () => {
  it('יתרה = פתיחה + חיובים − זיכויים − תשלומים (B-01)', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, opening_balance_agorot, created_at, updated_at)
       VALUES (1, 'ישראל', 'ישראלי', 139200, '', '')`,
    ).run();
    const occ = (db.prepare("SELECT id FROM occasion WHERE name='בראשית'").get() as { id: number })
      .id;
    const creditOcc = (
      db.prepare("SELECT id FROM occasion WHERE type='credit' LIMIT 1").get() as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind, created_at, updated_at)
       VALUES (1, '2025-10-18', ?, 50000, 'vow', '', '')`,
    ).run(occ);
    db.prepare(
      `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind, credit_reason, created_at, updated_at)
       VALUES (1, '2025-10-25', ?, 10000, 'credit', 'חיוב בטעות', '', '')`,
    ).run(creditOcc);
    db.prepare(
      `INSERT INTO vow_payment (member_id, payment_date, amount_agorot, payment_method_id, created_at, updated_at)
       VALUES (1, '2025-11-01', 60000, 1, '', '')`,
    ).run();

    const row = db.prepare('SELECT * FROM v_member_balance WHERE member_id = 1').get() as {
      balance_agorot: number;
      last_payment_date: string;
    };
    expect(row.balance_agorot).toBe(139200 + 50000 - 10000 - 60000);
    expect(row.last_payment_date).toBe('2025-11-01');
  });

  it('מתעלם מרשומות שנמחקו לוגית (B-09)', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (1, 'א', 'ב', '', '')`,
    ).run();
    db.prepare(
      `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind, deleted_at, created_at, updated_at)
       VALUES (1, '2025-10-18', 1, 50000, 'vow', '2025-10-19T00:00:00', '', '')`,
    ).run();
    const row = db
      .prepare('SELECT balance_agorot FROM v_member_balance WHERE member_id=1')
      .get() as {
      balance_agorot: number;
    };
    expect(row.balance_agorot).toBe(0);
  });
});
