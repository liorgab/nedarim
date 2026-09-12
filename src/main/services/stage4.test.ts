import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import {
  changeOwnPassword,
  createUser,
  hashPassword,
  listUsers,
  login,
  setPassword,
  updateUser,
  validatePassword,
  verifyPassword,
} from './auth';
import {
  applyRestore,
  createBackup,
  externalBackupReminder,
  listBackups,
  prepareRestore,
  pruneBackups,
  restoreReceiptsTo,
  totalBalance,
} from './backup';
import { auditEntities, listAudit } from './auditLog';
import { buildExportTables, exportEverything } from './fullExport';
import { createMember } from './members';
import { createPayment } from './payments';
import { createVow } from './vows';
import { createDonation } from './donations';
import { createExpense } from './expenses';

let dir: string;
let dbPath: string;
let db: Database;
let userId: number;

function openFresh(): Database {
  const d = openDatabase({ file: dbPath });
  seed(d);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-s4-'));
  dbPath = join(dir, 'nedarim.db');
  db = openFresh();
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

/** יוצר נתונים אמיתיים כדי שהגיבוי יהיה משמעותי. */
function seedData(): void {
  const cash = (
    db.prepare("SELECT id FROM payment_method WHERE name='מזומן'").get() as { id: number }
  ).id;
  const type = (db.prepare('SELECT id FROM donation_type LIMIT 1').get() as { id: number }).id;
  const category = (db.prepare('SELECT id FROM expense_category LIMIT 1').get() as { id: number })
    .id;

  for (let i = 1; i <= 5; i++) {
    const m = createMember(db, { firstName: `חבר${i}`, lastName: 'ישראלי' }, userId);
    createVow(
      db,
      { memberId: m.id, chargeDate: '2026-01-01', occasionId: 1, amountAgorot: i * 10_000 },
      userId,
    );
    if (i % 2 === 0) {
      createPayment(
        db,
        { memberId: m.id, paymentDate: '2026-01-10', amountAgorot: 5_000, paymentMethodId: cash },
        userId,
        { issueReceipt: true },
      );
    }
  }
  createDonation(
    db,
    {
      donationDate: '2026-01-15',
      donorName: 'תורם',
      donationTypeId: type,
      paymentMethodId: cash,
      amountAgorot: 25_000,
    },
    userId,
  );
  createExpense(
    db,
    { expenseDate: '2026-01-20', amountAgorot: 70_000, categoryId: category, description: 'חשמל' },
    userId,
  );
}

// ---------------------------------------------------------------- סיסמאות

describe('סיסמאות ומשתמשים (SPEC 6.3)', () => {
  it('גיבוב ואימות סיסמה', () => {
    const hash = hashPassword('סיסמה-חזקה-123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('סיסמה-חזקה-123', hash)).toBe(true);
    expect(verifyPassword('סיסמה אחרת', hash)).toBe(false);
  });

  it('כל גיבוב שונה גם לאותה סיסמה (salt אקראי)', () => {
    expect(hashPassword('abcdef')).not.toBe(hashPassword('abcdef'));
  });

  it('גיבוב פגום נדחה ולא מפיל', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$1$2$3$bad$bad')).toBe(false);
  });

  it('דורש סיסמה באורך סביר', () => {
    expect(validatePassword('12345')).toHaveLength(1);
    expect(validatePassword('123456')).toHaveLength(0);
    expect(validatePassword('      ')).not.toHaveLength(0);
  });

  it('התקנה חדשה: admin ללא סיסמה נכנס ומתבקש לקבוע אחת', () => {
    const res = login(db, 'admin', '');
    expect(res.ok).toBe(true);
    expect(res.needsPassword).toBe(true);
  });

  it('אחרי קביעת סיסמה נדרשת התחברות תקינה', () => {
    setPassword(db, userId, 'סיסמת-הגבאי', userId);
    expect(login(db, 'admin', '').ok).toBe(false);
    expect(login(db, 'admin', 'שגוי').ok).toBe(false);
    const ok = login(db, 'admin', 'סיסמת-הגבאי');
    expect(ok.ok).toBe(true);
    expect(ok.needsPassword).toBe(false);
    expect(ok.user?.role).toBe('admin');
  });

  it('כל ניסיון התחברות נרשם ביומן, מוצלח או לא', () => {
    setPassword(db, userId, 'סיסמת-הגבאי', userId);
    login(db, 'admin', 'שגוי');
    login(db, 'admin', 'סיסמת-הגבאי');
    const rows = listAudit(db, { action: 'login' }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => JSON.parse(r.afterJson!).success).sort()).toEqual([false, true]);
  });

  it('משתמש שאינו קיים או מושבת אינו נכנס', () => {
    expect(login(db, 'nobody', 'x').ok).toBe(false);
    setPassword(db, userId, 'סיסמת-הגבאי', userId);
    const clerk = createUser(
      db,
      { username: 'clerk', displayName: 'מזין', role: 'clerk', password: 'clerk-123' },
      userId,
      'admin',
    );
    updateUser(db, clerk.id, { isActive: false }, userId, 'admin');
    expect(login(db, 'clerk', 'clerk-123').ok).toBe(false);
  });

  it('שינוי סיסמה עצמי מחייב את הסיסמה הנוכחית', () => {
    setPassword(db, userId, 'ישנה-123', userId);
    expect(() => changeOwnPassword(db, userId, 'לא-נכונה', 'חדשה-123')).toThrow(/נוכחית/);
    changeOwnPassword(db, userId, 'ישנה-123', 'חדשה-123');
    expect(login(db, 'admin', 'חדשה-123').ok).toBe(true);
  });

  it('ניהול משתמשים מותר למנהל בלבד', () => {
    expect(() =>
      createUser(
        db,
        { username: 'x', displayName: 'x', role: 'clerk', password: '123456' },
        userId,
        'clerk',
      ),
    ).toThrow(/מנהל/);
  });

  it('חוסם שם משתמש כפול', () => {
    createUser(
      db,
      { username: 'clerk', displayName: 'מזין', role: 'clerk', password: '123456' },
      userId,
      'admin',
    );
    expect(() =>
      createUser(
        db,
        { username: 'clerk', displayName: 'אחר', role: 'clerk', password: '123456' },
        userId,
        'admin',
      ),
    ).toThrow(/כבר קיים/);
  });

  it('לא ניתן להישאר בלי מנהל פעיל', () => {
    expect(() => updateUser(db, userId, { role: 'clerk' }, userId, 'admin')).toThrow(/מנהל/);
    expect(() => updateUser(db, userId, { isActive: false }, userId, 'admin')).toThrow(/מנהל/);

    const second = createUser(
      db,
      { username: 'admin2', displayName: 'מנהל שני', role: 'admin', password: '123456' },
      userId,
      'admin',
    );
    expect(() => updateUser(db, second.id, { role: 'clerk' }, userId, 'admin')).not.toThrow();
  });

  it('רשימת המשתמשים מסמנת מי עדיין בלי סיסמה', () => {
    expect(listUsers(db)[0]!.needsPassword).toBe(true);
    setPassword(db, userId, '123456', userId);
    expect(listUsers(db)[0]!.needsPassword).toBe(false);
  });
});

// ---------------------------------------------------------------- גיבוי ושחזור

describe('גיבוי ושחזור (F-100..F-102)', () => {
  const backupDir = () => join(dir, 'backups');

  const backup = (external = false) =>
    createBackup(db, {
      userDataDir: dir,
      targetDir: backupDir(),
      appVersion: '1.0.0',
      schemaVersion: 2,
      external,
      userId,
    });

  it('יוצר גיבוי עם מניפסט, checksum וספירות', async () => {
    seedData();
    const info = await backup();
    expect(existsSync(join(info.path, 'nedarim.db'))).toBe(true);
    expect(info.manifest).not.toBeNull();
    expect(info.manifest!.counts.members).toBe(5);
    expect(info.manifest!.counts.receipts).toBe(2);
    expect(info.manifest!.totalBalanceAgorot).toBe(totalBalance(db));
    expect(info.valid).toBe(true);
  });

  it('מגבה גם את ארכיון הקבלות והקבצים המצורפים', async () => {
    seedData();
    const receipts = join(dir, 'receipts', '2026');
    writeFileSync(join(dir, 'attachments-marker'), 'x'); // לא אמור להיכלל
    mkdirSync(receipts, { recursive: true });
    writeFileSync(join(receipts, '0001.pdf'), 'PDF-CONTENT');
    mkdirSync(join(dir, 'attachments'), { recursive: true });
    writeFileSync(join(dir, 'attachments', 'expense-1.pdf'), 'ATT');

    const info = await backup();
    expect(readFileSync(join(info.path, 'receipts', '2026', '0001.pdf'), 'utf8')).toBe(
      'PDF-CONTENT',
    );
    expect(readFileSync(join(info.path, 'attachments', 'expense-1.pdf'), 'utf8')).toBe('ATT');
    expect(existsSync(join(info.path, 'attachments-marker'))).toBe(false);
  });

  it('מזהה גיבוי פגום לפי checksum', async () => {
    seedData();
    const info = await backup();
    writeFileSync(join(info.path, 'nedarim.db'), 'GARBAGE');
    expect(listBackups(backupDir())[0]!.valid).toBe(false);
  });

  it('שומר רק את N הגיבויים האחרונים', async () => {
    seedData();
    for (let i = 0; i < 4; i++) {
      // שמות הגיבויים כוללים שנייה; יוצרים ידנית כדי לא לחכות
      await createBackup(db, {
        userDataDir: dir,
        targetDir: backupDir(),
        appVersion: '1.0.0',
        schemaVersion: 2,
        keep: 100,
        userId,
      });
      await new Promise((r) => setTimeout(r, 1100));
    }
    expect(listBackups(backupDir()).length).toBeGreaterThanOrEqual(2);
    pruneBackups(backupDir(), 2);
    expect(listBackups(backupDir())).toHaveLength(2);
  });

  it('תזכורת גיבוי חיצוני (F-102)', async () => {
    expect(externalBackupReminder(db).due).toBe(true);
    await backup(true);
    const after = externalBackupReminder(db);
    expect(after.due).toBe(false);
    expect(after.daysSince).toBe(0);
  });

  /**
   * ההוכחה שהתבקשה: גבה → מחק את ה-DB → שחזר → היתרות זהות.
   */
  it('שחזור מלא מחזיר את המערכת בדיוק למצב שגובה', async () => {
    seedData();
    const before = {
      balance: totalBalance(db),
      members: (db.prepare('SELECT COUNT(*) c FROM member').get() as { c: number }).c,
      receipts: (db.prepare('SELECT COUNT(*) c FROM receipt').get() as { c: number }).c,
      nextReceipt: (
        db.prepare("SELECT next_value v FROM sequence WHERE name='receipt'").get() as { v: number }
      ).v,
    };
    expect(before.balance).toBeGreaterThan(0);

    const info = await backup();

    // משנים את המצב אחרי הגיבוי, כדי שהשחזור יהיה מורגש
    const extra = createMember(db, { firstName: 'אחרי', lastName: 'הגיבוי' }, userId);
    createVow(
      db,
      { memberId: extra.id, chargeDate: '2026-02-01', occasionId: 1, amountAgorot: 999_00 },
      userId,
    );
    expect(totalBalance(db)).not.toBe(before.balance);

    // שחזור: מכינים (כולל גיבוי-לפני-שחזור), סוגרים, מוחקים ומחליפים
    const plan = await prepareRestore(db, {
      backupPath: info.path,
      userDataDir: dir,
      appVersion: '1.0.0',
      schemaVersion: 2,
      userId,
    });
    expect(existsSync(join(plan.safetyBackupPath, 'nedarim.db'))).toBe(true);

    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    expect(existsSync(dbPath)).toBe(false);

    applyRestore(info.path, dir);
    db = openDatabase({ file: dbPath });

    expect(totalBalance(db)).toBe(before.balance);
    expect((db.prepare('SELECT COUNT(*) c FROM member').get() as { c: number }).c).toBe(
      before.members,
    );
    expect((db.prepare('SELECT COUNT(*) c FROM receipt').get() as { c: number }).c).toBe(
      before.receipts,
    );
    expect(
      (db.prepare("SELECT next_value v FROM sequence WHERE name='receipt'").get() as { v: number })
        .v,
    ).toBe(before.nextReceipt);
    // החבר שנוסף אחרי הגיבוי אינו קיים יותר
    expect(db.prepare("SELECT id FROM member WHERE last_name = 'הגיבוי'").get()).toBeUndefined();
  });

  it('שחזור מגיבוי פגום נחסם לפני שנוגעים בנתונים', async () => {
    seedData();
    const info = await backup();
    writeFileSync(join(info.path, 'nedarim.db'), 'GARBAGE');
    await expect(
      prepareRestore(db, {
        backupPath: info.path,
        userDataDir: dir,
        appVersion: '1.0.0',
        schemaVersion: 2,
        userId,
      }),
    ).rejects.toThrow(/checksum/);
  });

  it('גיבוי ושחזור נרשמים ביומן הביקורת', async () => {
    seedData();
    const info = await backup();
    await prepareRestore(db, {
      backupPath: info.path,
      userDataDir: dir,
      appVersion: '1.0.0',
      schemaVersion: 2,
      userId,
    });
    const actions = listAudit(db, { entity: 'backup' }).rows.map((r) => r.action);
    expect(actions).toContain('backup');
    expect(actions).toContain('restore');
  });
});

// ---------------------------------------------------------------- יומן ביקורת

describe('יומן ביקורת (F-93)', () => {
  it('סינון לפי ישות, פעולה וטווח', () => {
    seedData();
    expect(listAudit(db, { entity: 'member' }).rows).toHaveLength(5);
    expect(listAudit(db, { entity: 'vow_charge', action: 'create' }).rows).toHaveLength(5);
    expect(listAudit(db, { from: '2000-01-01' }).rows.length).toBeGreaterThan(0);
    expect(listAudit(db, { from: '2099-01-01' }).rows).toHaveLength(0);
  });

  it('KPIs לפי הסינון', () => {
    seedData();
    const { kpis } = listAudit(db);
    expect(kpis.count).toBeGreaterThan(0);
    expect(kpis.byAction.some((a) => a.action === 'create')).toBe(true);
    expect(kpis.lastAt).not.toBeNull();
  });

  it('מחזיר את שם המשתמש שביצע', () => {
    seedData();
    expect(listAudit(db, { entity: 'member' }).rows[0]!.userName).toBe('גבאי');
  });

  it('מציג את הישויות שקיימות בפועל', () => {
    seedData();
    const entities = auditEntities(db);
    expect(entities).toContain('member');
    expect(entities).toContain('vow_charge');
  });

  it('חיפוש חופשי בתוכן הרשומה', () => {
    seedData();
    expect(listAudit(db, { search: 'חבר3' }).rows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- ייצוא מלא

describe('ייצוא מלא (F-104)', () => {
  it('גיליון לכל ישות, עם כותרות בעברית', () => {
    seedData();
    const tables = buildExportTables(db);
    const names = tables.map((t) => t.name);
    expect(names).toEqual([
      'חברים',
      'חיובי נדר',
      'תשלומי נדר',
      'תרומות',
      'הוצאות',
      'קבלות',
      'מאזן חודשי',
      'רשימות ערכים',
      'הגדרות',
      'יומן ביקורת',
    ]);
    const members = tables.find((t) => t.name === 'חברים')!;
    expect(members.matrix[0]).toContain('שם פרטי');
    expect(members.matrix).toHaveLength(6); // כותרת + 5 חברים
  });

  it('סכומים מיוצאים כשקלים', () => {
    seedData();
    const charges = buildExportTables(db).find((t) => t.name === 'חיובי נדר')!;
    const amountIndex = charges.matrix[0]!.indexOf('סכום');
    expect(charges.matrix[1]![amountIndex]).toBe(100); // 10,000 אגורות
  });

  it('כותב קובץ Excel אמיתי ורושם ביומן', async () => {
    seedData();
    const path = join(dir, 'full-export.xlsx');
    await exportEverything(db, path, userId);
    const buffer = readFileSync(path);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.length).toBeGreaterThan(5000);
    expect(listAudit(db, { entity: 'export' }).rows).toHaveLength(1);
  });
});

describe('ארכיון הקבלות בתיקייה מוגדרת', () => {
  /**
   * המלכודת: אם הגבאי מזיז את תיקיית הקבלות (למשל לתיקיית ענן) והגיבוי ממשיך
   * להעתיק מ-`<userData>/receipts`, הגיבוי ייצא **בשקט** בלי אף PDF – והתקלה
   * תתגלה רק ביום שבו יצטרכו לשחזר.
   */
  it('גיבוי מעתיק את הקבלות מהתיקייה המוגדרת, לא מברירת המחדל', async () => {
    const custom = join(dir, 'ענן', 'קבלות');
    mkdirSync(join(custom, '2026'), { recursive: true });
    writeFileSync(join(custom, '2026', '0453.pdf'), 'PDF-בתיקייה-המוגדרת');
    // בברירת המחדל שמים קובץ אחר, כדי שהבדיקה תיכשל אם הגיבוי לוקח משם.
    mkdirSync(join(dir, 'receipts', '2026'), { recursive: true });
    writeFileSync(join(dir, 'receipts', '2026', '9999.pdf'), 'לא-אמור-להיות-בגיבוי');

    const backup = await createBackup(db, {
      userDataDir: dir,
      targetDir: join(dir, 'backups'),
      appVersion: '1.0.0',
      schemaVersion: 2,
      receiptsDir: custom,
      userId,
    });

    expect(existsSync(join(backup.path, 'receipts', '2026', '0453.pdf'))).toBe(true);
    expect(existsSync(join(backup.path, 'receipts', '2026', '9999.pdf'))).toBe(false);
    expect(backup.manifest?.receiptFiles).toBe(1);
  });

  it('שחזור מחזיר את הקבלות לתיקייה המוגדרת', async () => {
    const custom = join(dir, 'ענן', 'קבלות');
    mkdirSync(join(custom, '2026'), { recursive: true });
    writeFileSync(join(custom, '2026', '0453.pdf'), 'המקור');

    const backup = await createBackup(db, {
      userDataDir: dir,
      targetDir: join(dir, 'backups'),
      appVersion: '1.0.0',
      schemaVersion: 2,
      receiptsDir: custom,
      userId,
    });

    rmSync(custom, { recursive: true, force: true });
    expect(existsSync(join(custom, '2026', '0453.pdf'))).toBe(false);

    const copied = restoreReceiptsTo(backup.path, custom);
    expect(copied).toBe(1);
    expect(readFileSync(join(custom, '2026', '0453.pdf'), 'utf8')).toBe('המקור');
  });
});
