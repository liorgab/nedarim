/**
 * הוכחת שחזור על נתוני האמת (שלב 4, F-100/F-101).
 *
 * הבדיקה ב-`stage4.test.ts` מוכיחה את המנגנון על נתונים סינתטיים. הסקריפט
 * הזה מריץ בדיוק את אותן פונקציות שה-IPC מפעיל, אבל על **עותק של בסיס
 * הנתונים האמיתי** שיובא מהקובץ הישן – 451 קבלות, סך יתרות 44,952 ₪ – כדי
 * שהגבאי יראה את המספרים שלו חוזרים, ולא מספרים של מעבדה.
 *
 * הרצה:
 *   npm run proof:restore -- "<נתיב לתיקייה שמכילה nedarim.db>"
 *
 * הסקריפט אינו נוגע ב-DB המקורי: הוא מעתיק אותו לתיקייה זמנית ועובד עליה.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import {
  applyRestore,
  createBackup,
  listBackups,
  prepareRestore,
  totalBalance,
} from '../../src/main/services/backup';
import { LATEST_SCHEMA_VERSION } from '../../src/main/db/migrations';
import { formatAgorot } from '../../src/shared/money';

const APP_VERSION = '0.1.0';

interface Snapshot {
  balanceAgorot: number;
  members: number;
  receipts: number;
  payments: number;
  donations: number;
  expenses: number;
  nextReceipt: number;
}

function snapshot(dbPath: string): Snapshot {
  const db = openDatabase({ file: dbPath });
  try {
    const one = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
    return {
      balanceAgorot: totalBalance(db),
      members: one('SELECT COUNT(*) c FROM member WHERE deleted_at IS NULL'),
      receipts: one('SELECT COUNT(*) c FROM receipt'),
      payments: one('SELECT COUNT(*) c FROM vow_payment WHERE deleted_at IS NULL'),
      donations: one('SELECT COUNT(*) c FROM donation WHERE deleted_at IS NULL'),
      expenses: one('SELECT COUNT(*) c FROM expense WHERE deleted_at IS NULL'),
      nextReceipt: (
        db.prepare("SELECT next_value c FROM sequence WHERE name = 'receipt'").get() as {
          c: number;
        }
      ).c,
    };
  } finally {
    db.close();
  }
}

function row(label: string, before: unknown, after: unknown): string {
  const same = String(before) === String(after);
  return `${same ? '  ✓' : '  ✗'} ${label.padEnd(22)} ${String(before).padStart(14)} → ${String(after).padStart(14)}`;
}

async function main(): Promise<void> {
  const sourceDir = process.argv[2];
  if (!sourceDir || !existsSync(join(sourceDir, 'nedarim.db'))) {
    console.error('שימוש: npm run proof:restore -- "<תיקייה שמכילה nedarim.db>"');
    process.exit(1);
  }

  // עותק עבודה – ה-DB המקורי לא נפתח ולא משתנה.
  const work = mkdtempSync(join(tmpdir(), 'nedarim-proof-'));
  const dbPath = join(work, 'nedarim.db');
  copyFileSync(join(sourceDir, 'nedarim.db'), dbPath);
  mkdirSync(join(work, 'receipts'), { recursive: true });
  const backupDir = join(work, 'backups');

  console.log(`\nתיקיית עבודה: ${work}\n`);

  const before = snapshot(dbPath);
  console.log('1. מצב פתיחה');
  console.log(
    `   סך יתרות: ${formatAgorot(before.balanceAgorot)} · ${before.members} חברים · ${before.receipts} קבלות\n`,
  );

  // ------------------------------------------------------------ גיבוי
  let db = openDatabase({ file: dbPath });
  const backup = await createBackup(db, {
    userDataDir: work,
    targetDir: backupDir,
    appVersion: APP_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION,
  });
  db.close();
  console.log('2. גיבוי');
  console.log(`   ${backup.name}`);
  console.log(`   SHA-256: ${backup.manifest!.dbSha256}`);
  console.log(
    `   מניפסט: ${formatAgorot(backup.manifest!.totalBalanceAgorot)} · ${backup.manifest!.counts.members} חברים · ${backup.manifest!.counts.receipts} קבלות\n`,
  );

  // ------------------------------------------------- שינוי הרסני אחרי הגיבוי
  db = openDatabase({ file: dbPath });
  db.prepare(
    `INSERT INTO member (member_number, first_name, last_name, status, opening_balance_agorot, created_at, updated_at)
     VALUES (99999, 'חבר', 'שנוסף אחרי הגיבוי', 'active', 1234500, datetime('now'), datetime('now'))`,
  ).run();
  db.prepare('DELETE FROM vow_payment WHERE id IN (SELECT id FROM vow_payment LIMIT 20)').run();
  const damaged = totalBalance(db);
  db.close();
  console.log('3. שינוי הרסני אחרי הגיבוי');
  console.log(`   נוסף חבר עם יתרת פתיחה 12,345 ₪, נמחקו 20 תשלומים`);
  console.log(`   סך יתרות עכשיו: ${formatAgorot(damaged)}\n`);

  // ------------------------------------------------------------ שחזור
  db = openDatabase({ file: dbPath });
  const plan = await prepareRestore(db, {
    backupPath: backup.path,
    userDataDir: work,
    appVersion: APP_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION,
  });
  db.close();

  // מחיקה מלאה מהדיסק – כולל ה-WAL, אחרת SQLite היה משחזר ממנו.
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  if (existsSync(dbPath)) throw new Error('קובץ ה-DB עדיין קיים');
  console.log('4. מחיקת בסיס הנתונים מהדיסק');
  console.log(
    `   nedarim.db / -wal / -shm נמחקו. גיבוי בטיחות נוצר: ${plan.safetyBackupPath.split(/[\\/]/).pop()}\n`,
  );

  applyRestore(backup.path, work);
  const after = snapshot(dbPath);

  console.log('5. אחרי השחזור');
  console.log(row('סך יתרות (אגורות)', before.balanceAgorot, after.balanceAgorot));
  console.log(row('חברים', before.members, after.members));
  console.log(row('קבלות', before.receipts, after.receipts));
  console.log(row('תשלומי נדר', before.payments, after.payments));
  console.log(row('תרומות', before.donations, after.donations));
  console.log(row('הוצאות', before.expenses, after.expenses));
  console.log(row('מונה הקבלה הבא', before.nextReceipt, after.nextReceipt));

  const restoredDb = openDatabase({ file: dbPath });
  const ghost = restoredDb
    .prepare('SELECT COUNT(*) c FROM member WHERE member_number = 99999')
    .get() as { c: number };
  restoredDb.close();
  console.log(row('החבר שנוסף אחרי הגיבוי', 'לא קיים', ghost.c === 0 ? 'לא קיים' : 'קיים!'));

  const identical =
    before.balanceAgorot === after.balanceAgorot &&
    before.members === after.members &&
    before.receipts === after.receipts &&
    before.payments === after.payments &&
    before.donations === after.donations &&
    before.expenses === after.expenses &&
    before.nextReceipt === after.nextReceipt &&
    ghost.c === 0;

  const safetyDir = join(work, 'backups', 'before-restore');
  console.log(
    `\n   גיבויים בתיקיית הגיבוי: ${listBackups(backupDir).length} · ` +
      `גיבוי בטיחות ב-backups/before-restore: ${listBackups(safetyDir).length}`,
  );
  console.log(
    `\n${identical ? '✅ השחזור החזיר את המערכת בדיוק למצב שגובה.' : '❌ נמצא הבדל אחרי השחזור.'}\n`,
  );

  rmSync(work, { recursive: true, force: true });
  if (!identical) process.exit(1);
}

void main();
