import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { NOTIFY_EVENTS } from '../whatsapp/notifyEvents';
import {
  COMBINED_PARASHIOT,
  CREDIT_REASONS,
  DEFAULT_SEQUENCES,
  DEFAULT_SETTINGS,
  DONATION_TYPES,
  EVENTS,
  EXPENSE_CATEGORIES,
  FALLBACK_OCCASION_NAME,
  HOLIDAYS,
  MESSAGE_TEMPLATES,
  OPENING_OCCASION_NAME,
  PARASHIOT,
  PAYMENT_METHODS,
} from './seed-data';

export interface SeedResult {
  occasions: number;
  messageTemplates: number;
  paymentMethods: number;
  donationTypes: number;
  expenseCategories: number;
  settings: number;
  sequences: number;
  users: number;
}

/**
 * מזריע את רשימות הערך. אידמפוטנטי לחלוטין – `INSERT OR IGNORE` לפי המפתח הטבעי (שם),
 * כך שהרצה חוזרת בשדרוג גרסה לא משכפלת ולא דורסת שינויים שהגבאי עשה ידנית.
 */
export function seed(db: Database): SeedResult {
  const result: SeedResult = {
    occasions: 0,
    messageTemplates: 0,
    paymentMethods: 0,
    donationTypes: 0,
    expenseCategories: 0,
    settings: 0,
    sequences: 0,
    users: 0,
  };

  const insOccasion = db.prepare(
    `INSERT OR IGNORE INTO occasion (name, type, hebcal_key, sort_order, is_active)
     VALUES (@name, @type, @hebcalKey, @sortOrder, 1)`,
  );
  const insLookup = (table: 'donation_type' | 'expense_category') =>
    db.prepare(`INSERT OR IGNORE INTO ${table} (name, is_active) VALUES (?, 1)`);
  const insPaymentMethod = db.prepare(
    'INSERT OR IGNORE INTO payment_method (name, requires_reference, is_active) VALUES (?, ?, 1)',
  );
  const insSetting = db.prepare('INSERT OR IGNORE INTO setting (key, value) VALUES (?, ?)');
  const insSequence = db.prepare('INSERT OR IGNORE INTO sequence (name, next_value) VALUES (?, ?)');

  const run = db.transaction(() => {
    let order = 0;

    for (const p of PARASHIOT) {
      result.occasions += insOccasion.run({
        name: p.he,
        type: 'parasha',
        hebcalKey: p.key,
        sortOrder: (order += 10),
      }).changes;
    }
    for (const p of COMBINED_PARASHIOT) {
      result.occasions += insOccasion.run({
        name: p.he,
        type: 'parasha',
        hebcalKey: p.key,
        sortOrder: (order += 10),
      }).changes;
    }
    for (const h of HOLIDAYS) {
      result.occasions += insOccasion.run({
        name: h.he,
        type: 'holiday',
        hebcalKey: h.key ?? null,
        sortOrder: (order += 10),
      }).changes;
    }
    for (const e of EVENTS) {
      result.occasions += insOccasion.run({
        name: e,
        type: 'event',
        hebcalKey: null,
        sortOrder: (order += 10),
      }).changes;
    }
    for (const c of CREDIT_REASONS) {
      result.occasions += insOccasion.run({
        name: c,
        type: 'credit',
        hebcalKey: null,
        sortOrder: (order += 10),
      }).changes;
    }
    result.occasions += insOccasion.run({
      name: OPENING_OCCASION_NAME,
      type: 'opening',
      hebcalKey: null,
      sortOrder: (order += 10),
    }).changes;
    // 'אחר' כבר קיים כאירוע; מוודאים שהוא קיים גם אם רשימת האירועים תשתנה.
    result.occasions += insOccasion.run({
      name: FALLBACK_OCCASION_NAME,
      type: 'other',
      hebcalKey: null,
      sortOrder: (order += 10),
    }).changes;

    for (const pm of PAYMENT_METHODS) {
      result.paymentMethods += insPaymentMethod.run(pm.name, pm.requiresReference ? 1 : 0).changes;
    }
    const insDonationType = insLookup('donation_type');
    for (const d of DONATION_TYPES) result.donationTypes += insDonationType.run(d).changes;
    const insExpenseCategory = insLookup('expense_category');
    for (const c of EXPENSE_CATEGORIES)
      result.expenseCategories += insExpenseCategory.run(c).changes;

    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      result.settings += insSetting.run(k, v).changes;
    }
    for (const [k, v] of Object.entries(DEFAULT_SEQUENCES)) {
      result.sequences += insSequence.run(k, v).changes;
    }

    // W-15 – תבניות פתיחה. `INSERT OR IGNORE` על השם: גבאי שערך או מחק
    // תבנית לא יקבל אותה בחזרה בהפעלה הבאה.
    const insTemplate = db.prepare(
      `INSERT OR IGNORE INTO message_template (name, body, is_active, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    );
    for (const t of MESSAGE_TEMPLATES) {
      result.messageTemplates += insTemplate.run(t.name, t.body, nowIso(), nowIso()).changes;
    }

    // W-81 – תבנית לכל אירוע כספי. אותה מוסכמה: `INSERT OR IGNORE` נופל גם
    // על השם וגם על האינדקס החד-ערכי של `event_kind`, ולכן תבנית שהגבאי
    // ערך או מחק לא חוזרת בהפעלה הבאה.
    //
    // ההודעות עצמן כבויות כברירת מחדל (`whatsapp_notify_*` = `off`,
    // מיגרציה 007): התבנית מוכנה, השליחה מופעלת בהחלטת הגבאי.
    const insEventTemplate = db.prepare(
      `INSERT OR IGNORE INTO message_template (name, body, event_kind, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    );
    for (const e of NOTIFY_EVENTS) {
      result.messageTemplates += insEventTemplate.run(
        e.label,
        e.defaultBody,
        e.kind,
        nowIso(),
        nowIso(),
      ).changes;
    }

    // משתמש admin ראשוני ללא סיסמה שמישה – הסיסמה נקבעת באשף ההפעלה הראשונה (שלב 4).
    result.users += db
      .prepare(
        `INSERT OR IGNORE INTO user (username, display_name, password_hash, role, is_active, created_at, updated_at)
         VALUES ('admin', 'גבאי', '', 'admin', 1, ?, ?)`,
      )
      .run(nowIso(), nowIso()).changes;
  });

  run();
  return result;
}

/** מזהה המשתמש שבשמו נרשמות פעולות מערכת (ייבוא, מיגרציה). */
export function systemUserId(db: Database): number {
  const row = db.prepare("SELECT id FROM user WHERE username = 'admin'").get() as
    { id: number } | undefined;
  if (!row) throw new Error('משתמש admin לא קיים – יש להריץ seed לפני הפעולה');
  return row.id;
}
