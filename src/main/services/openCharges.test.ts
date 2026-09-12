import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { createMember } from './members';
import { openChargesFor } from './openCharges';
import { renderForMember } from './templates';

/**
 * הגזירה של "מה עוד לא שולם".
 *
 * המערכת אינה מקצה תשלום לחיוב, ולכן הפירוט נגזר ב-FIFO. הבדיקה החשובה
 * ביותר כאן היא "סכום השורות שווה ליתרה": כל סטייה ממנה פירושה שהגבאי
 * שולח לחבר פירוט שלא מסתכם למספר שמופיע בשורה התחתונה.
 */

let dir: string;
let db: Database;
let userId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-oc-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  userId = systemUserId(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

const addMember = () => createMember(db, { firstName: 'ישראל', lastName: 'ישראלי' }, userId);

const occasionId = (name: string) =>
  (db.prepare('SELECT id FROM occasion WHERE name = ?').get(name) as { id: number }).id;

function charge(
  memberId: number,
  date: string,
  occasion: string,
  agorot: number,
  note?: string,
): void {
  db.prepare(
    `INSERT INTO vow_charge (member_id, charge_date, occasion_id, occasion_note,
       amount_agorot, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'vow', '', '')`,
  ).run(memberId, date, occasionId(occasion), note ?? null, agorot);
}

function payment(memberId: number, date: string, agorot: number): void {
  const method = (
    db.prepare("SELECT id FROM payment_method WHERE name='מזומן'").get() as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO vow_payment (member_id, payment_date, amount_agorot, payment_method_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '')`,
  ).run(memberId, date, agorot, method);
}

const balanceOf = (memberId: number) =>
  (
    db
      .prepare('SELECT balance_agorot b FROM v_member_balance WHERE member_id = ?')
      .get(memberId) as { b: number }
  ).b;

const openOf = (memberId: number) => openChargesFor(db, [memberId]).get(memberId)!;

describe('openChargesFor – הקצאת FIFO', () => {
  it('בלי תשלומים – כל החיובים פתוחים, מהישן לחדש', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    charge(m.id, '2025-10-25', 'נח', 36000);

    const open = openOf(m.id);
    expect(open).toHaveLength(2);
    expect(open[0]!.occasion).toBe('בראשית');
    expect(open[0]!.remainingAgorot).toBe(50000);
    expect(open[1]!.occasion).toBe('נח');
  });

  it('תשלום סוגר את החיוב הישן ביותר', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    charge(m.id, '2025-10-25', 'נח', 36000);
    payment(m.id, '2025-11-01', 50000);

    const open = openOf(m.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.occasion).toBe('נח');
  });

  it('תשלום חלקי משאיר את היתרה של אותו חיוב, עם הסכום המקורי לצידה', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    payment(m.id, '2025-11-01', 20000);

    const open = openOf(m.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.amountAgorot).toBe(50000);
    expect(open[0]!.remainingAgorot).toBe(30000);
  });

  it('חבר ששילם הכול – אין חוב פתוח', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    payment(m.id, '2025-11-01', 50000);
    expect(openOf(m.id)).toEqual([]);
  });

  it('תשלום יתר לא יוצר שורות שליליות', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    payment(m.id, '2025-11-01', 80000);
    expect(openOf(m.id)).toEqual([]);
    expect(balanceOf(m.id)).toBe(-30000);
  });

  it('יתרת פתיחה היא הפריט הישן ביותר', () => {
    const m = addMember();
    db.prepare('UPDATE member SET opening_balance_agorot = 40000 WHERE id = ?').run(m.id);
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    payment(m.id, '2025-11-01', 40000);

    // 40,000 סגרו בדיוק את יתרת הפתיחה; נשאר החיוב.
    const open = openOf(m.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.occasion).toBe('בראשית');
  });

  it('יתרת פתיחה שלא כוסתה מוצגת בשם שלה ובלי תאריך', () => {
    const m = addMember();
    db.prepare('UPDATE member SET opening_balance_agorot = 40000 WHERE id = ?').run(m.id);

    const open = openOf(m.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.occasion).toBe('יתרת פתיחה');
    expect(open[0]!.date).toBeNull();
  });

  it('יתרת פתיחה שלילית מתפקדת כזכות ומקטינה חוב', () => {
    const m = addMember();
    db.prepare('UPDATE member SET opening_balance_agorot = -20000 WHERE id = ?').run(m.id);
    charge(m.id, '2025-10-18', 'בראשית', 50000);

    const open = openOf(m.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.remainingAgorot).toBe(30000);
  });

  it('זיכוי מקטין את החוב כמו תשלום', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    const creditOcc = (
      db.prepare("SELECT id FROM occasion WHERE type='credit' LIMIT 1").get() as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO vow_charge (member_id, charge_date, occasion_id, amount_agorot, kind,
         credit_reason, created_at, updated_at)
       VALUES (?, '2025-10-20', ?, 50000, 'credit', 'חיוב בטעות', '', '')`,
    ).run(m.id, creditOcc);

    expect(openOf(m.id)).toEqual([]);
    expect(balanceOf(m.id)).toBe(0);
  });

  it('סכום השורות הפתוחות שווה תמיד ליתרה – זו כל הנקודה', () => {
    const m = addMember();
    db.prepare('UPDATE member SET opening_balance_agorot = 12300 WHERE id = ?').run(m.id);
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    charge(m.id, '2025-10-25', 'נח', 36000);
    charge(m.id, '2025-11-01', 'לך לך', 17700);
    payment(m.id, '2025-11-05', 60000);
    payment(m.id, '2025-11-20', 15000);

    const sum = openOf(m.id).reduce((s, l) => s + l.remainingAgorot, 0);
    expect(sum).toBe(balanceOf(m.id));
  });

  it('חיוב שנמחק לוגית אינו נספר', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    db.prepare("UPDATE vow_charge SET deleted_at = '2026-01-01T00:00:00' WHERE member_id = ?").run(
      m.id,
    );
    expect(openOf(m.id)).toEqual([]);
  });

  it('מחזיר מפתח גם לחבר בלי חוב, ולא undefined', () => {
    const m = addMember();
    expect(openChargesFor(db, [m.id]).get(m.id)).toEqual([]);
  });

  it('רשימה ריקה של מזהים אינה פונה ל-DB', () => {
    expect(openChargesFor(db, []).size).toBe(0);
  });

  it('מחשב כמה חברים בקריאה אחת בלי לערבב ביניהם', () => {
    const a = createMember(db, { firstName: 'אחד', lastName: 'א' }, userId);
    const b = createMember(db, { firstName: 'שתיים', lastName: 'ב' }, userId);
    charge(a.id, '2025-10-18', 'בראשית', 50000);
    charge(b.id, '2025-10-18', 'נח', 36000);

    const map = openChargesFor(db, [a.id, b.id]);
    expect(map.get(a.id)![0]!.occasion).toBe('בראשית');
    expect(map.get(b.id)![0]!.occasion).toBe('נח');
  });
});

describe('השדות {{open_charges}} ו-{{open_charges_count}}', () => {
  it('מרונדר כרשימת שורות: תאריך · פרשה · סכום', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    charge(m.id, '2025-10-25', 'נח', 36000, 'הבן');

    const lines = renderForMember(db, '{{open_charges}}', m.id).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('18/10/2025');
    expect(lines[0]).toContain('בראשית');
    expect(lines[1]).toContain('נח (הבן)');
  });

  it('חבר בלי חוב מקבל מקף, לא רשימה ריקה', () => {
    const m = addMember();
    expect(renderForMember(db, '{{open_charges}}', m.id)).toBe('—');
    expect(renderForMember(db, '{{open_charges_count}}', m.id)).toBe('0');
  });

  it('הספירה תואמת למספר השורות', () => {
    const m = addMember();
    charge(m.id, '2025-10-18', 'בראשית', 50000);
    charge(m.id, '2025-10-25', 'נח', 36000);
    payment(m.id, '2025-11-01', 50000);

    expect(renderForMember(db, '{{open_charges_count}}', m.id)).toBe('1');
  });

  it('יתרת פתיחה מוצגת בלי תאריך ובלי מקף מוביל', () => {
    const m = addMember();
    db.prepare('UPDATE member SET opening_balance_agorot = 40000 WHERE id = ?').run(m.id);
    const out = renderForMember(db, '{{open_charges}}', m.id);
    expect(out.startsWith('יתרת פתיחה')).toBe(true);
  });
});
