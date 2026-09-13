import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { createMember, listMembers, mergeMembers, setMemberStatus, topDebtors } from './members';
import { getLedger, paymentsWithoutReceipt, recentCharges } from './ledger';
import { createCredit, createVow, createVowsBulk, deleteVowCharge, validateVow } from './vows';
import { listVowItems } from './vowItems';
import { createPayment, createPaymentsBulk, deletePayment, validatePayment } from './payments';
import {
  cancelReceipt,
  issueReceipt,
  listReceipts,
  peekNextReceiptNumber,
  receiptContinuity,
} from './receipts';
import { renderReceiptHtml } from './receiptTemplate';
import { localDateToIso, todayIso } from './hebrewCalendar';

let db: Database;
let userId: number;
let occasionId: number;
let creditOccasionId: number;
let cashId: number;
let chequeId: number;

function setup(file = ':memory:'): void {
  db = openDatabase({ file });
  seed(db);
  userId = systemUserId(db);
  occasionId = (db.prepare("SELECT id FROM occasion WHERE name = 'בראשית'").get() as { id: number })
    .id;
  creditOccasionId = (
    db.prepare("SELECT id FROM occasion WHERE type = 'credit' LIMIT 1").get() as { id: number }
  ).id;
  cashId = (
    db.prepare("SELECT id FROM payment_method WHERE name = 'מזומן'").get() as {
      id: number;
    }
  ).id;
  chequeId = (
    db.prepare("SELECT id FROM payment_method WHERE name = 'המחאה'").get() as {
      id: number;
    }
  ).id;
}

beforeEach(() => setup());
afterEach(() => db.close());

const member = (first = 'ישראל', last = 'ישראלי') =>
  createMember(db, { firstName: first, lastName: last }, userId);

describe('חברים (F-10..F-14)', () => {
  it('מקצה מספר חבר רץ מהמונה', () => {
    expect(member().memberNumber).toBe(1);
    expect(member('משה', 'כהן').memberNumber).toBe(2);
  });

  it('מספר חבר אינו חוזר לשימוש גם אחרי השבתה (B-08)', () => {
    const a = member();
    setMemberStatus(db, a.id, 'inactive', userId);
    expect(member('משה', 'כהן').memberNumber).toBe(2);
  });

  it('דורש שם פרטי ושם משפחה', () => {
    expect(() => createMember(db, { firstName: '  ', lastName: 'כהן' }, userId)).toThrow();
  });

  it('חוסם השבתה של חבר עם יתרה בלי אישור (F-13)', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: todayIso(), occasionId, amountAgorot: 5000 },
      userId,
    );
    expect(() => setMemberStatus(db, m.id, 'inactive', userId)).toThrow(/יתרה/);
    expect(() =>
      setMemberStatus(db, m.id, 'inactive', userId, { confirmedWithBalance: true }),
    ).not.toThrow();
  });

  it('סינון ברירת מחדל מציג רק פעילים', () => {
    const a = member();
    member('משה', 'כהן');
    setMemberStatus(db, a.id, 'inactive', userId);
    expect(listMembers(db).rows).toHaveLength(1);
    expect(listMembers(db, { status: 'all' }).rows).toHaveLength(2);
  });

  it('חיפוש חופשי בשם, כינוי, נייד ומספר (F-10)', () => {
    createMember(
      db,
      { firstName: 'שרלי', lastName: 'שרעבי', nickname: 'שרל', mobile: '0509999999' },
      userId,
    );
    member('משה', 'כהן');
    expect(listMembers(db, { search: 'שרעבי' }).rows).toHaveLength(1);
    expect(listMembers(db, { search: 'שרל' }).rows).toHaveLength(1);
    expect(listMembers(db, { search: '050999' }).rows).toHaveLength(1);
    expect(listMembers(db, { search: '2' }).rows).toHaveLength(1); // מספר חבר 2
  });

  it('KPIs מחושבים לפי הסינון הפעיל (כלל-על 16)', () => {
    const a = member();
    const b = member('משה', 'כהן');
    createVow(
      db,
      { memberId: a.id, chargeDate: todayIso(), occasionId, amountAgorot: 30_000 },
      userId,
    );
    createVow(
      db,
      { memberId: b.id, chargeDate: todayIso(), occasionId, amountAgorot: 10_000 },
      userId,
    );

    const all = listMembers(db);
    expect(all.kpis).toMatchObject({
      count: 2,
      totalDebtAgorot: 40_000,
      withDebt: 2,
      maxDebtAgorot: 30_000,
    });

    const filtered = listMembers(db, { search: 'ישראלי' });
    expect(filtered.kpis).toMatchObject({ count: 1, totalDebtAgorot: 30_000 });
  });

  it('מיזוג מעביר תנועות ויתרת פתיחה ומשבית את המקור (F-14)', () => {
    const a = member('חי', 'דדון');
    const b = member('חיים', 'דדון');
    createVow(
      db,
      { memberId: a.id, chargeDate: todayIso(), occasionId, amountAgorot: 5_000 },
      userId,
    );
    createPayment(
      db,
      { memberId: a.id, paymentDate: todayIso(), amountAgorot: 2_000, paymentMethodId: cashId },
      userId,
    );

    const merged = mergeMembers(db, a.id, b.id, userId);
    expect(merged.balanceAgorot).toBe(3_000);
    expect(getLedger(db, a.id).rows).toHaveLength(0);
    expect(getLedger(db, b.id).rows).toHaveLength(2);
    const src = listMembers(db, { status: 'all' }).rows.find((m) => m.id === a.id)!;
    expect(src.status).toBe('inactive');
  });

  it('עשרת החייבים הגדולים ממוינים יורד (F-02)', () => {
    const a = member('א', 'א');
    const b = member('ב', 'ב');
    createVow(
      db,
      { memberId: a.id, chargeDate: todayIso(), occasionId, amountAgorot: 1_000 },
      userId,
    );
    createVow(
      db,
      { memberId: b.id, chargeDate: todayIso(), occasionId, amountAgorot: 9_000 },
      userId,
    );
    expect(topDebtors(db).map((m) => m.balanceAgorot)).toEqual([9_000, 1_000]);
  });
});

describe('הזנת נדר (F-30..F-34)', () => {
  it('רושמת חיוב ומעדכנת יתרה', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-10', occasionId, amountAgorot: 10_000 },
      userId,
    );
    expect(listMembers(db).rows[0]!.balanceAgorot).toBe(10_000);
  });

  it.each([0, -100])('חוסמת סכום %i', (amount) => {
    const m = member();
    const issues = validateVow(db, {
      memberId: m.id,
      chargeDate: todayIso(),
      occasionId,
      amountAgorot: amount,
    });
    expect(issues.some((i) => i.field === 'amount' && i.severity === 'error')).toBe(true);
  });

  it('חוסמת תאריך יותר מ-7 ימים בעתיד (SPEC 6.2)', () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const m = member();
    expect(() =>
      createVow(
        db,
        { memberId: m.id, chargeDate: localDateToIso(future), occasionId, amountAgorot: 100 },
        userId,
      ),
    ).toThrow(/עתיד/);
  });

  it('מזהירה על תאריך ישן מכשנה בלי לחסום', () => {
    const m = member();
    const issues = validateVow(db, {
      memberId: m.id,
      chargeDate: '2020-01-01',
      occasionId,
      amountAgorot: 100,
    });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('הזנה מרובה נשמרת בטרנזקציה אחת (F-33)', () => {
    const a = member('א', 'א');
    const b = member('ב', 'ב');
    const res = createVowsBulk(
      db,
      {
        chargeDate: '2026-01-10',
        occasionId,
        lines: [
          { memberId: a.id, amountAgorot: 5_000, occasionNote: 'הבן' },
          { memberId: b.id, amountAgorot: 3_600 },
        ],
      },
      userId,
    );
    expect(res.ids).toHaveLength(2);
    expect(res.totalAgorot).toBe(8_600);
    expect(getLedger(db, a.id).rows[0]!.note).toBe('הבן');
  });

  it('הזנה מרובה שומרת את הכיבוד שנבחר בכל שורה (F-142)', () => {
    // בלי זה דוח הכיבודים היה מציג את כל ההזנה המרובה כ"ללא שיוך",
    // וזו בדיוק ההזנה שבה נמכרים רוב הכיבודים – מוצאי שבת.
    const a = member('א', 'א');
    const b = member('ב', 'ב');
    const items = listVowItems(db, { occasionId });
    const first = items[0]!;
    const second = items[1]!;

    const res = createVowsBulk(
      db,
      {
        chargeDate: '2026-01-10',
        occasionId,
        lines: [
          { memberId: a.id, amountAgorot: 5_000, vowItemId: first.id },
          { memberId: b.id, amountAgorot: 3_600, vowItemId: second.id },
        ],
      },
      userId,
    );

    const saved = res.ids.map(
      (id) =>
        (db.prepare('SELECT vow_item_id AS v FROM vow_charge WHERE id = ?').get(id) as {
          v: number | null;
        }).v,
    );
    expect(saved).toEqual([first.id, second.id]);
  });

  it('הזנה מרובה בלי כיבוד נשמרת כרגיל', () => {
    const a = member('א', 'א');
    const res = createVowsBulk(
      db,
      { chargeDate: '2026-01-10', occasionId, lines: [{ memberId: a.id, amountAgorot: 1_000 }] },
      userId,
    );
    const row = db
      .prepare('SELECT vow_item_id AS v FROM vow_charge WHERE id = ?')
      .get(res.ids[0]) as { v: number | null };
    expect(row.v).toBeNull();
  });

  it('הזנה מרובה עם שורה פסולה לא שומרת כלום', () => {
    const a = member('א', 'א');
    expect(() =>
      createVowsBulk(
        db,
        {
          chargeDate: '2026-01-10',
          occasionId,
          lines: [
            { memberId: a.id, amountAgorot: 5_000 },
            { memberId: 9999, amountAgorot: 100 },
          ],
        },
        userId,
      ),
    ).toThrow();
    expect(getLedger(db, a.id).rows).toHaveLength(0);
  });
});

describe('זיכוי ומחיקה (F-35, F-36)', () => {
  it('זיכוי מקטין את היתרה (B-01)', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId, amountAgorot: 10_000 },
      userId,
    );
    createCredit(
      db,
      {
        memberId: m.id,
        chargeDate: '2026-01-05',
        occasionId: creditOccasionId,
        amountAgorot: 4_000,
        creditReason: 'זיכוי – חיוב בטעות',
        note: 'חויב פעמיים',
      },
      userId,
      'admin',
    );
    expect(listMembers(db).rows[0]!.balanceAgorot).toBe(6_000);
  });

  it('דורש הערה וסיבה', () => {
    const m = member();
    const base = {
      memberId: m.id,
      chargeDate: '2026-01-05',
      occasionId: creditOccasionId,
      amountAgorot: 100,
    };
    expect(() =>
      createCredit(db, { ...base, creditReason: 'זיכוי – אחר', note: '  ' }, userId, 'admin'),
    ).toThrow(/הערה/);
    expect(() =>
      createCredit(db, { ...base, creditReason: '', note: 'משהו' }, userId, 'admin'),
    ).toThrow(/סיבת/);
  });

  it('זיכוי מעל הסף דורש הרשאת מנהל', () => {
    const m = member();
    const input = {
      memberId: m.id,
      chargeDate: '2026-01-05',
      occasionId: creditOccasionId,
      amountAgorot: 60_000, // מעל 500 ₪
      creditReason: 'זיכוי – הנחה',
      note: 'הנחה',
    };
    expect(() => createCredit(db, input, userId, 'clerk')).toThrow(/מנהל/);
    expect(() => createCredit(db, input, userId, 'admin')).not.toThrow();
  });

  it('הסף נלקח מההגדרות ולא מקוד קשיח (כלל 12)', () => {
    db.prepare(
      "UPDATE setting SET value = '1000' WHERE key = 'credit_approval_threshold_agorot'",
    ).run();
    const m = member();
    expect(() =>
      createCredit(
        db,
        {
          memberId: m.id,
          chargeDate: '2026-01-05',
          occasionId: creditOccasionId,
          amountAgorot: 2_000,
          creditReason: 'זיכוי – אחר',
          note: 'x',
        },
        userId,
        'clerk',
      ),
    ).toThrow(/מנהל/);
  });

  it('מחיקה לוגית בלבד, עם רישום ביומן (B-09)', () => {
    const m = member();
    const id = createVow(
      db,
      { memberId: m.id, chargeDate: todayIso(), occasionId, amountAgorot: 10_000 },
      userId,
    );
    deleteVowCharge(db, id, userId, 'admin');
    expect(listMembers(db).rows[0]!.balanceAgorot).toBe(0);
    const still = db.prepare('SELECT deleted_at FROM vow_charge WHERE id = ?').get(id) as {
      deleted_at: string | null;
    };
    expect(still.deleted_at).not.toBeNull();
    const audit = db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE entity='vow_charge' AND action='delete'")
      .get() as { c: number };
    expect(audit.c).toBe(1);
  });

  it('מזין לא יכול למחוק תנועה של מישהו אחר', () => {
    const m = member();
    const id = createVow(
      db,
      { memberId: m.id, chargeDate: todayIso(), occasionId, amountAgorot: 100 },
      userId,
    );
    expect(() => deleteVowCharge(db, id, userId + 999, 'clerk')).toThrow(/מזין/);
  });
});

describe('תשלומים (F-40..F-44)', () => {
  it('רושם תשלום ומחזיר יתרה מעודכנת', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId, amountAgorot: 10_000 },
      userId,
    );
    const res = createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-02', amountAgorot: 4_000, paymentMethodId: cashId },
      userId,
    );
    expect(res.balanceAfterAgorot).toBe(6_000);
    expect(res.receipt).toBeNull();
  });

  it('"שמור והדפס" מפיק קבלה באותה פעולה (F-43)', () => {
    const m = member();
    const res = createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-02', amountAgorot: 4_000, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    expect(res.receipt).not.toBeNull();
    expect(res.receipt!.receiptNumber).toBe(1);
    expect(res.receipt!.purposeText).toBe('תשלום נדרים');
  });

  it('מזהיר על תשלום מעל היתרה אך מאפשר (F-42)', () => {
    const m = member();
    const issues = validatePayment(db, {
      memberId: m.id,
      paymentDate: todayIso(),
      amountAgorot: 5_000,
      paymentMethodId: cashId,
    });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.some((i) => i.severity === 'warning' && /זכות/.test(i.message))).toBe(true);
  });

  it('מזהיר על המחאה ללא אסמכתא', () => {
    const m = member();
    const issues = validatePayment(db, {
      memberId: m.id,
      paymentDate: todayIso(),
      amountAgorot: 100,
      paymentMethodId: chequeId,
    });
    expect(issues.some((i) => i.field === 'reference' && i.severity === 'warning')).toBe(true);
  });

  it('תשלום עבור כמה חברים – קבלה נפרדת לכל אחד (F-44)', () => {
    const a = member('א', 'א');
    const b = member('ב', 'ב');
    const results = createPaymentsBulk(
      db,
      {
        paymentDate: '2026-01-02',
        paymentMethodId: cashId,
        lines: [
          { memberId: a.id, amountAgorot: 1_000 },
          { memberId: b.id, amountAgorot: 2_000 },
        ],
      },
      userId,
      { issueReceipts: true },
    );
    expect(results.map((r) => r.receipt!.receiptNumber)).toEqual([1, 2]);
    expect(results[0]!.receipt!.payerName).toBe('א א');
  });

  it('לא ניתן למחוק תשלום שהופקה לו קבלה (B-05)', () => {
    const m = member();
    const res = createPayment(
      db,
      { memberId: m.id, paymentDate: todayIso(), amountAgorot: 1_000, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    expect(() => deletePayment(db, res.paymentId, userId, 'admin')).toThrow(/קבלה/);
  });
});

describe('כרטיסייה (F-20..F-23)', () => {
  it('יתרה מצטברת נכונה בסדר כרונולוגי', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId, amountAgorot: 10_000 },
      userId,
    );
    createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-05', amountAgorot: 3_000, paymentMethodId: cashId },
      userId,
    );
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-10', occasionId, amountAgorot: 2_000 },
      userId,
    );

    const { rows, kpis } = getLedger(db, m.id);
    expect(rows.map((r) => r.runningBalanceAgorot)).toEqual([10_000, 7_000, 9_000]);
    expect(kpis).toMatchObject({
      openingBalanceAgorot: 0,
      debitAgorot: 12_000,
      creditAgorot: 3_000,
      closingBalanceAgorot: 9_000,
    });
  });

  it('כולל יתרת פתיחה של החבר', () => {
    const m = member();
    db.prepare('UPDATE member SET opening_balance_agorot = 5_000 WHERE id = ?').run(m.id);
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId, amountAgorot: 1_000 },
      userId,
    );
    const { rows, kpis } = getLedger(db, m.id);
    expect(kpis.openingBalanceAgorot).toBe(5_000);
    expect(rows[0]!.runningBalanceAgorot).toBe(6_000);
  });

  it('סינון תקופה שומר על יתרה אמיתית ולא מקומית (F-23)', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2025-12-01', occasionId, amountAgorot: 10_000 },
      userId,
    );
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-10', occasionId, amountAgorot: 2_000 },
      userId,
    );
    const { rows, kpis } = getLedger(db, m.id, { from: '2026-01-01' });
    expect(rows).toHaveLength(1);
    expect(kpis.openingBalanceAgorot).toBe(10_000);
    expect(rows[0]!.runningBalanceAgorot).toBe(12_000);
  });

  it('זיכוי מוצג בצד הזיכוי', () => {
    const m = member();
    createCredit(
      db,
      {
        memberId: m.id,
        chargeDate: '2026-01-05',
        occasionId: creditOccasionId,
        amountAgorot: 4_000,
        creditReason: 'זיכוי – אחר',
        note: 'בדיקה',
      },
      userId,
      'admin',
    );
    const row = getLedger(db, m.id).rows[0]!;
    expect(row.debitAgorot).toBe(0);
    expect(row.creditAgorot).toBe(4_000);
    expect(row.status).toBe('credit');
  });

  it('כל שורה כוללת תאריך עברי', () => {
    const m = member();
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-10', occasionId, amountAgorot: 100 },
      userId,
    );
    expect(getLedger(db, m.id).rows[0]!.hebrewDate).toMatch(/תשפ/);
  });

  it('חמשת החיובים האחרונים (F-40)', () => {
    const m = member();
    for (let i = 1; i <= 7; i++) {
      createVow(
        db,
        { memberId: m.id, chargeDate: `2026-01-0${i}`, occasionId, amountAgorot: i * 100 },
        userId,
      );
    }
    const recent = recentCharges(db, m.id);
    expect(recent).toHaveLength(5);
    expect(recent[0]!.debitAgorot).toBe(700);
  });

  it('תשלומים ללא קבלה (F-03)', () => {
    const m = member();
    createPayment(
      db,
      { memberId: m.id, paymentDate: todayIso(), amountAgorot: 1_000, paymentMethodId: cashId },
      userId,
    );
    createPayment(
      db,
      { memberId: m.id, paymentDate: todayIso(), amountAgorot: 2_000, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    const pending = paymentsWithoutReceipt(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.amountAgorot).toBe(1_000);
  });
});

describe('קבלות (F-70..F-74)', () => {
  const pay = (amount = 1_000) => {
    const m = member();
    return createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-02', amountAgorot: amount, paymentMethodId: cashId },
      userId,
    );
  };

  it('מספר רץ ללא חורים (B-03)', () => {
    const numbers = [pay(), pay(), pay()].map(
      (p) => require0(p.paymentId, db, userId).receiptNumber,
    );
    expect(numbers).toEqual([1, 2, 3]);
    expect(peekNextReceiptNumber(db)).toBe(4);
  });

  it('המונה מתחיל מהערך שבטבלת sequence, לא מקוד קשיח', () => {
    db.prepare("UPDATE sequence SET next_value = 453 WHERE name = 'receipt'").run();
    const p = pay();
    expect(require0(p.paymentId, db, userId).receiptNumber).toBe(453);
  });

  it('לא מפיקה קבלה שנייה לאותה תנועה', () => {
    const p = pay();
    require0(p.paymentId, db, userId);
    expect(() => require0(p.paymentId, db, userId)).toThrow(/כבר הופקה/);
  });

  it('קבלה מוקפיאה את השם – שינוי שם החבר לא משנה אותה (F-12)', () => {
    const m = member('ישראל', 'ישראלי');
    const p = createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-01-02', amountAgorot: 1_000, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    db.prepare("UPDATE member SET last_name = 'כהן' WHERE id = ?").run(m.id);
    expect(p.receipt!.payerName).toBe('ישראל ישראלי');
  });

  it('שנה עברית מחושבת ממועד ההפקה, לא קבועה (ממצא #4)', () => {
    const p = pay();
    const r = require0(p.paymentId, db, userId);
    expect(r.hebrewYear).toMatch(/^ת/);
    expect(r.hebrewYear).not.toBe('תשפ״ב');
  });

  it('ביטול: מנהל בלבד, סיבה חובה, המספר לא משוחרר (F-73)', () => {
    const p = pay();
    const r = require0(p.paymentId, db, userId);
    expect(() => cancelReceipt(db, r.id, 'טעות', userId, 'clerk')).toThrow(/מנהל/);
    expect(() => cancelReceipt(db, r.id, '  ', userId, 'admin')).toThrow(/סיבת/);

    const cancelled = cancelReceipt(db, r.id, 'הודפסה בטעות', userId, 'admin');
    expect(cancelled.cancelledAt).not.toBeNull();
    // המספר נשאר תפוס
    expect(peekNextReceiptNumber(db)).toBe(2);
    // התשלום חזר לסטאטוס "שולם" וניתן להפיק לו קבלה חדשה
    const again = require0(p.paymentId, db, userId);
    expect(again.receiptNumber).toBe(2);
  });

  it('ביטול עם מחיקת המקור מוחק גם את התשלום', () => {
    const p = pay();
    const r = require0(p.paymentId, db, userId);
    cancelReceipt(db, r.id, 'תשלום שלא היה', userId, 'admin', 'delete');
    const row = db.prepare('SELECT deleted_at FROM vow_payment WHERE id = ?').get(p.paymentId) as {
      deleted_at: string | null;
    };
    expect(row.deleted_at).not.toBeNull();
  });

  it('ספר קבלות עם סינון ו-KPIs (F-74)', () => {
    const a = pay(1_000);
    const b = pay(2_500);
    require0(a.paymentId, db, userId);
    const rb = require0(b.paymentId, db, userId);
    cancelReceipt(db, rb.id, 'ביטול', userId, 'admin');

    const all = listReceipts(db);
    expect(all.rows).toHaveLength(2);
    expect(all.kpis).toMatchObject({
      count: 2,
      totalAgorot: 1_000,
      cancelledCount: 1,
      cancelledAgorot: 2_500,
      firstNumber: 1,
      lastNumber: 2,
    });

    expect(listReceipts(db, { state: 'active' }).rows).toHaveLength(1);
    expect(listReceipts(db, { state: 'cancelled' }).rows).toHaveLength(1);
  });

  it('בדיקת רציפות מזהה מספר חסר (F-74)', () => {
    const p = pay();
    require0(p.paymentId, db, userId);
    db.prepare("UPDATE sequence SET next_value = 5 WHERE name = 'receipt'").run();
    const c = receiptContinuity(db);
    expect(c.missing).toEqual([2, 3, 4]);
    expect(c.duplicates).toEqual([]);
  });
});

describe('הקצאת מספר קבלה במקביליות (B-03)', () => {
  let dir: string;

  beforeEach(() => {
    db.close();
    dir = mkdtempSync(join(tmpdir(), 'nedarim-'));
    setup(join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close(); // חייבים לשחרר את הקובץ לפני המחיקה ב-Windows
    rmSync(dir, { recursive: true, force: true });
    setup(); // כדי שה-afterEach החיצוני יסגור חיבור תקין
  });

  it('שני חיבורים נפרדים לא מקבלים את אותו מספר', () => {
    const m = member();
    const ids = [1, 2, 3, 4, 5].map(
      (i) =>
        createPayment(
          db,
          {
            memberId: m.id,
            paymentDate: '2026-01-02',
            amountAgorot: i * 100,
            paymentMethodId: cashId,
          },
          userId,
        ).paymentId,
    );

    const other = openDatabase({ file: join(dir, 'test.db'), migrateOnOpen: false });
    try {
      // הקצאות לסירוגין משני חיבורים – חייבות לתת חמישה מספרים שונים ורצופים
      const numbers = ids.map(
        (id, i) => require0(id, i % 2 === 0 ? db : other, userId).receiptNumber,
      );
      expect(new Set(numbers).size).toBe(5);
      expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      other.close();
    }
  });
});

describe("תבנית הקבלה (F-71, נספח ב')", () => {
  it('כוללת את כל שדות החובה', () => {
    const p = (() => {
      const m = member('אהרון', 'אוחנה');
      return createPayment(
        db,
        {
          memberId: m.id,
          paymentDate: '2026-08-30',
          amountAgorot: 100_000,
          paymentMethodId: chequeId,
          reference: '12345',
        },
        userId,
        { issueReceipt: true },
      );
    })();

    const html = renderReceiptHtml({
      receipt: p.receipt!,
      synagogue: {
        name: 'בית הכנסת "דוגמה"',
        city: 'מושב שדות מיכה',
        address: '',
        phone: '',
        associationNumber: '',
        logoDataUri: '',
        signatureDataUri: '',
        footerText: 'בתודה, ועד בית הכנסת',
      },
      isCopy: false,
      paperSize: 'A5',
    });

    expect(html).toContain('dir="rtl"');
    expect(html).toContain('דוגמה');
    expect(html).toContain('אהרון אוחנה');
    expect(html).toContain('אלף שקלים חדשים'); // סכום במילים
    expect(html).toContain('30/08/2026');
    expect(html).toContain('תשלום נדרים');
    expect(html).toContain('אסמכתא: 12345');
    expect(html).toContain(p.receipt!.hebrewYear);
    expect(html).not.toContain('העתק');
    expect(html).not.toContain('מבוטלת');
  });

  it('מסמנת "העתק" בהדפסה חוזרת (F-72)', () => {
    const m = member();
    const p = createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-08-30', amountAgorot: 100, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    const html = renderReceiptHtml({
      receipt: p.receipt!,
      synagogue: emptySynagogue(),
      isCopy: true,
      paperSize: 'A5',
    });
    expect(html).toContain('stamp copy');
  });

  it('מסמנת "מבוטלת" לקבלה שבוטלה (F-73)', () => {
    const m = member();
    const p = createPayment(
      db,
      { memberId: m.id, paymentDate: '2026-08-30', amountAgorot: 100, paymentMethodId: cashId },
      userId,
      { issueReceipt: true },
    );
    const cancelled = cancelReceipt(db, p.receipt!.id, 'טעות', userId, 'admin');
    const html = renderReceiptHtml({
      receipt: cancelled,
      synagogue: emptySynagogue(),
      isCopy: false,
      paperSize: 'A5',
    });
    expect(html).toContain('stamp cancelled');
    expect(html).toContain('טעות');
  });
});

function emptySynagogue() {
  return {
    name: 'בית כנסת',
    city: '',
    address: '',
    phone: '',
    associationNumber: '',
    logoDataUri: '',
    signatureDataUri: '',
    footerText: '',
  };
}

/** קיצור: מפיק קבלה לתשלום קיים. */
function require0(paymentId: number, database: Database, uid: number) {
  const row = database
    .prepare(
      `SELECT p.amount_agorot, p.payment_date, p.reference, pm.name AS method,
              m.first_name, m.last_name
       FROM vow_payment p JOIN payment_method pm ON pm.id = p.payment_method_id
       JOIN member m ON m.id = p.member_id WHERE p.id = ?`,
    )
    .get(paymentId) as {
    amount_agorot: number;
    payment_date: string;
    reference: string | null;
    method: string;
    first_name: string;
    last_name: string;
  };
  return issueReceipt(
    database,
    {
      sourceType: 'vow_payment',
      sourceId: paymentId,
      payerName: `${row.first_name} ${row.last_name}`,
      amountAgorot: row.amount_agorot,
      paymentMethodText: row.method,
      paymentReference: row.reference,
      paymentDate: row.payment_date,
      purposeText: 'תשלום נדרים',
    },
    uid,
  );
}
