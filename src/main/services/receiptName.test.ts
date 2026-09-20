import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { createPayment, issueReceiptForPayment, receiptPayerName } from './payments';
import { createDonation, issueReceiptForDonation } from './donations';
import { paymentsWithoutReceipt } from './ledger';
import { cancelReceipt } from './receipts';

/**
 * F-76 – קבלה על שם אחר.
 *
 * הבדיקה החשובה כאן היא **ההפקה החוזרת**: הקבלה מקפיאה את שם המשלם
 * בהפקה (B-04), וקבלה שבוטלה והופקה מחדש חייבת לחזור לאותו שם ולא לשם
 * החבר. זה בדיוק המקום שבו שם של חברה בע"מ היה נעלם בשקט.
 */

let dir: string;
let db: Database;

const methodId = (): number =>
  (db.prepare("SELECT id FROM payment_method WHERE name = 'מזומן'").get() as { id: number }).id;

const typeId = (): number =>
  (db.prepare('SELECT id FROM donation_type LIMIT 1').get() as { id: number }).id;

function addMember(): number {
  const info = db
    .prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (1, 'ישראל', 'ישראלי', '2026-01-01T09:00:00', '2026-01-01T09:00:00')`,
    )
    .run();
  return Number(info.lastInsertRowid);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-recname-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('receiptPayerName', () => {
  it('שם אחר גובר', () => {
    expect(receiptPayerName('כהן ובניו בע"מ', 'ישראל ישראלי')).toBe('כהן ובניו בע"מ');
  });

  it('ריק נופל חזרה לשם החבר', () => {
    // שדה שנפתח ונשאר ריק אינו בקשה לקבלה בלי שם.
    expect(receiptPayerName('', 'ישראל ישראלי')).toBe('ישראל ישראלי');
    expect(receiptPayerName('   ', 'ישראל ישראלי')).toBe('ישראל ישראלי');
    expect(receiptPayerName(null, 'ישראל ישראלי')).toBe('ישראל ישראלי');
    expect(receiptPayerName(undefined, 'ישראל ישראלי')).toBe('ישראל ישראלי');
  });

  it('רווחים מסביב נחתכים', () => {
    expect(receiptPayerName('  עמותת אור  ', 'ישראל')).toBe('עמותת אור');
  });
});

describe('תשלום', () => {
  it('הקבלה יוצאת על השם האחר', () => {
    const member = addMember();
    const { receipt } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
        receiptName: 'כהן ובניו בע"מ',
      },
      1,
      { issueReceipt: true },
    );
    expect(receipt?.payerName).toBe('כהן ובניו בע"מ');
  });

  it('בלי שם אחר – על שם החבר', () => {
    const member = addMember();
    const { receipt } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
      },
      1,
      { issueReceipt: true },
    );
    expect(receipt?.payerName).toBe('ישראל ישראלי');
  });

  it('הפקה חוזרת שומרת על השם האחר', () => {
    // זו הבדיקה שבגללה השם יושב על התשלום ולא רק על הקבלה.
    const member = addMember();
    const { paymentId, receipt } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
        receiptName: 'כהן ובניו בע"מ',
      },
      1,
      { issueReceipt: true },
    );

    cancelReceipt(db, receipt!.id, 'טעות בסכום', 1, 'admin');
    const again = issueReceiptForPayment(db, paymentId, 1);
    expect(again.payerName).toBe('כהן ובניו בע"מ');
  });

  it('תשלום שנרשם בלי קבלה ובלי שם אחר – הפקה מאוחרת על שם החבר', () => {
    const member = addMember();
    const { paymentId } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
      },
      1,
      { issueReceipt: false },
    );
    expect(issueReceiptForPayment(db, paymentId, 1).payerName).toBe('ישראל ישראלי');
  });

  it('שם אחר נשמר על התשלום גם כשלא הופקה קבלה', () => {
    const member = addMember();
    const { paymentId } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
        receiptName: 'עמותת אור',
      },
      1,
      { issueReceipt: false },
    );
    expect(issueReceiptForPayment(db, paymentId, 1).payerName).toBe('עמותת אור');
  });
});

describe('תרומה', () => {
  it('הקבלה יוצאת על השם האחר', () => {
    const { receipt } = createDonation(
      db,
      {
        donationDate: '2026-09-15',
        donorName: 'משה כהן',
        donationTypeId: typeId(),
        paymentMethodId: methodId(),
        amountAgorot: 100000,
        receiptName: 'כהן ובניו בע"מ',
      },
      1,
      { issueReceipt: true },
    );
    expect(receipt?.payerName).toBe('כהן ובניו בע"מ');
  });

  it('בלי שם אחר – על שם התורם', () => {
    const { receipt } = createDonation(
      db,
      {
        donationDate: '2026-09-15',
        donorName: 'משה כהן',
        donationTypeId: typeId(),
        paymentMethodId: methodId(),
        amountAgorot: 100000,
      },
      1,
      { issueReceipt: true },
    );
    expect(receipt?.payerName).toBe('משה כהן');
  });

  it('הפקה חוזרת לתרומה שומרת על השם האחר', () => {
    const { donationId, receipt } = createDonation(
      db,
      {
        donationDate: '2026-09-15',
        donorName: 'משה כהן',
        donationTypeId: typeId(),
        paymentMethodId: methodId(),
        amountAgorot: 100000,
        receiptName: 'עמותת אור',
      },
      1,
      { issueReceipt: true },
    );

    cancelReceipt(db, receipt!.id, 'טעות', 1, 'admin');
    expect(issueReceiptForDonation(db, donationId, 1).payerName).toBe('עמותת אור');
  });
});

/**
 * F-76 – קביעת השם **ברגע ההפקה**, לא ברגע השמירה.
 *
 * המסלול הנפוץ אצל הגבאי: הוא רושם תשלום במהירות ב"שמור בלי
 * קבלה", ורק כשהתורם מבקש את הקבלה מתברר שהיא צריכה לצאת על שם
 * חברה. בלי הפרמטר הזה הוא היה צריך למחוק את התשלום ולהזין מחדש.
 */
describe('קביעת השם ברגע ההפקה', () => {
  const pending = () => {
    const member = addMember();
    return createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
      },
      1,
      { issueReceipt: false },
    ).paymentId;
  };

  it('שם שנמסר בהפקה נכנס לקבלה', () => {
    expect(issueReceiptForPayment(db, pending(), 1, 'עמותת אור בע"מ').payerName).toBe(
      'עמותת אור בע"מ',
    );
  });

  it('השם נשמר על התשלום, ולכן גם הפקה חוזרת יודעת עליו', () => {
    const paymentId = pending();
    const first = issueReceiptForPayment(db, paymentId, 1, 'עמותת אור');
    cancelReceipt(db, first.id, 'טעות', 1, 'admin');
    // הפעם בלי פרמטר כלל – הערך שנשמר הוא שקובע.
    expect(issueReceiptForPayment(db, paymentId, 1).payerName).toBe('עמותת אור');
  });

  it('מחרוזת ריקה מבטלת שם אחר שנשמר קודם', () => {
    // זו ההבחנה שבגללה הפרמטר הוא `string | null` ולא רק "אופציונלי":
    // הסרת הסימון בדיאלוג חייבת להיות ניתנת לביטוי, ולא להיראות כ"אל תגע".
    const member = addMember();
    const { paymentId } = createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
        receiptName: 'עמותת אור',
      },
      1,
      { issueReceipt: false },
    );
    expect(issueReceiptForPayment(db, paymentId, 1, '').payerName).toBe('ישראל ישראלי');
  });

  it('רשימת "ממתינים לקבלה" מחזירה את השם שנשמר', () => {
    // המסך מסמן את התיבה לפי זה; בלי זה ההפקה הייתה מוחקת את השם בשתיקה.
    const member = addMember();
    createPayment(
      db,
      {
        memberId: member,
        paymentDate: '2026-09-15',
        amountAgorot: 50000,
        paymentMethodId: methodId(),
        receiptName: 'עמותת אור',
      },
      1,
      { issueReceipt: false },
    );
    expect(paymentsWithoutReceipt(db)[0]?.receiptName).toBe('עמותת אור');
  });

  it('תרומה – שם שנמסר בהפקה נכנס לקבלה ונשמר', () => {
    const { donationId } = createDonation(
      db,
      {
        donationDate: '2026-09-15',
        donorName: 'משה כהן',
        donationTypeId: typeId(),
        paymentMethodId: methodId(),
        amountAgorot: 100000,
      },
      1,
      { issueReceipt: false },
    );

    const first = issueReceiptForDonation(db, donationId, 1, 'כהן ובניו בע"מ');
    expect(first.payerName).toBe('כהן ובניו בע"מ');

    cancelReceipt(db, first.id, 'טעות', 1, 'admin');
    expect(issueReceiptForDonation(db, donationId, 1).payerName).toBe('כהן ובניו בע"מ');
  });
});
