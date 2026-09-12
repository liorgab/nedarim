import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { writeAudit } from './audit';
import { getSetting, setSetting } from './settings';
import { nowIso } from '@shared/datetime';

/**
 * F-100..F-102 – גיבוי ושחזור.
 *
 * גיבוי = תיקייה עם חותמת זמן שמכילה עותק של ה-DB, ארכיון הקבלות, הקבצים
 * המצורפים ומניפסט עם checksum. הכול בפורמט פתוח: אפשר לשחזר גם בלי המערכת,
 * פשוט להעתיק את `nedarim.db` חזרה למקומו.
 *
 * העתקת ה-DB נעשית ב-`db.backup()` – ה-Online Backup API של SQLite – ולא
 * בהעתקת קובץ. העתקת קובץ תוך כדי כתיבה ב-WAL עלולה לתת עותק לא עקבי.
 */

export const BACKUP_PREFIX = 'nedarim-backup-';
export const MANIFEST_NAME = 'manifest.json';
const DEFAULT_KEEP = 30;

export interface BackupManifest {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  /** SHA-256 של קובץ ה-DB, לאימות שלמות בשחזור. */
  dbSha256: string;
  dbBytes: number;
  counts: {
    members: number;
    charges: number;
    payments: number;
    donations: number;
    expenses: number;
    receipts: number;
  };
  /** סכום היתרות בזמן הגיבוי – הבדיקה המהירה ביותר ששחזור הצליח. */
  totalBalanceAgorot: number;
  receiptFiles: number;
  attachmentFiles: number;
}

export interface BackupInfo {
  path: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  manifest: BackupManifest | null;
  /** האם ה-DB בגיבוי תואם ל-checksum שבמניפסט. */
  valid: boolean;
}

function timestampName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${BACKUP_PREFIX}${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * שם ייחודי בתיקיית היעד.
 *
 * הרזולוציה של השם היא שנייה, ושחזור יוצר גיבוי בטיחות מייד אחרי גיבוי רגיל –
 * כלומר שני גיבויים באותה שנייה. בלי הסיומת המונה, השני היה נכתב לתוך התיקייה
 * של הראשון ודורס גיבוי תקין.
 */
function uniqueBackupDir(targetDir: string, date = new Date()): string {
  const base = timestampName(date);
  let candidate = join(targetDir, base);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(targetDir, `${base}-${n}`);
    n += 1;
  }
  return candidate;
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** מעתיק תיקייה רקורסיבית, ומדלג על קבצים שכבר קיימים ביעד באותו גודל. */
function copyTree(source: string, target: string): number {
  if (!existsSync(source)) return 0;
  mkdirSync(target, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(from, to);
    } else if (entry.isFile()) {
      if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
      copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) bytes += dirSize(p);
    else bytes += statSync(p).size;
  }
  return bytes;
}

function snapshotCounts(db: Database): BackupManifest['counts'] {
  const c = (t: string, where = 'deleted_at IS NULL') =>
    (db.prepare(`SELECT COUNT(*) v FROM ${t} WHERE ${where}`).get() as { v: number }).v;
  return {
    members: c('member'),
    charges: c('vow_charge'),
    payments: c('vow_payment'),
    donations: c('donation'),
    expenses: c('expense'),
    receipts: (db.prepare('SELECT COUNT(*) v FROM receipt').get() as { v: number }).v,
  };
}

export function totalBalance(db: Database): number {
  return (
    db.prepare('SELECT COALESCE(SUM(balance_agorot), 0) v FROM v_member_balance').get() as {
      v: number;
    }
  ).v;
}

export interface CreateBackupOptions {
  userDataDir: string;
  targetDir: string;
  appVersion: string;
  schemaVersion: number;
  /** כמה גיבויים לשמור בתיקיית היעד. */
  keep?: number;
  /** true = גיבוי לתיקייה חיצונית (USB/ענן), מאפס את תזכורת ה-7 ימים. */
  external?: boolean;
  /**
   * תיקיית ארכיון הקבלות. ברירת המחדל היא `<userDataDir>/receipts`, אבל היא
   * ניתנת להגדרה – ובלי להעביר אותה לכאן, גיבוי של התקנה שהזיזה את התיקייה
   * היה יוצא בשקט בלי אף קובץ PDF.
   */
  receiptsDir?: string;
  userId?: number | null;
}

/** F-100 – יצירת גיבוי. */
export async function createBackup(
  db: Database,
  options: CreateBackupOptions,
): Promise<BackupInfo> {
  mkdirSync(options.targetDir, { recursive: true });
  const dir = uniqueBackupDir(options.targetDir);
  mkdirSync(dir, { recursive: true });

  const dbTarget = join(dir, 'nedarim.db');
  // Online Backup API – עותק עקבי גם בזמן שהיישום פועל.
  await db.backup(dbTarget);

  const receipts = copyTree(
    options.receiptsDir ?? join(options.userDataDir, 'receipts'),
    join(dir, 'receipts'),
  );
  const attachments = copyTree(join(options.userDataDir, 'attachments'), join(dir, 'attachments'));

  // WB-05 – סשן ה-WhatsApp (`userData/Partitions/whatsapp`) **אינו** מגובה
  // בכוונה: הוא מכיל אסימוני התחברות של המכשיר, אין בו נתונים של בית הכנסת,
  // ושחזור שלו למחשב אחר לא היה עובד ממילא. אחרי שחזור סורקים QR מחדש.
  // הדבר מתקיים מעצם המבנה – מגבים רק db, receipts ו-attachments – והתגובה
  // הזו קיימת כדי שלא יתווסף `copyTree` על התיקייה הזו בטעות.

  const manifest: BackupManifest = {
    createdAt: nowIso(),
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    dbSha256: sha256(dbTarget),
    dbBytes: statSync(dbTarget).size,
    counts: snapshotCounts(db),
    totalBalanceAgorot: totalBalance(db),
    receiptFiles: receipts,
    attachmentFiles: attachments,
  };
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');

  setSetting(db, 'last_backup_at', manifest.createdAt);
  if (options.external) setSetting(db, 'last_external_backup_at', manifest.createdAt);
  writeAudit(db, {
    userId: options.userId ?? null,
    entity: 'backup',
    entityId: null,
    action: 'backup',
    after: { path: dir, ...manifest.counts },
  });

  pruneBackups(options.targetDir, options.keep ?? DEFAULT_KEEP);

  return {
    path: dir,
    name: basename(dir),
    createdAt: manifest.createdAt,
    sizeBytes: dirSize(dir),
    manifest,
    valid: true,
  };
}

/** משאיר רק את N הגיבויים האחרונים בתיקייה. */
export function pruneBackups(targetDir: string, keep: number): string[] {
  if (!existsSync(targetDir)) return [];
  const backups = readdirSync(targetDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(BACKUP_PREFIX))
    .map((e) => e.name)
    .sort();
  const remove = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of remove) rmSync(join(targetDir, name), { recursive: true, force: true });
  return remove;
}

/** רשימת הגיבויים בתיקייה, החדש ביותר ראשון, עם אימות checksum. */
export function listBackups(targetDir: string): BackupInfo[] {
  if (!existsSync(targetDir)) return [];
  return readdirSync(targetDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(BACKUP_PREFIX))
    .map((e) => {
      const path = join(targetDir, e.name);
      let manifest: BackupManifest | null = null;
      try {
        manifest = JSON.parse(readFileSync(join(path, MANIFEST_NAME), 'utf8')) as BackupManifest;
      } catch {
        manifest = null;
      }
      const dbPath = join(path, 'nedarim.db');
      const valid = manifest !== null && existsSync(dbPath) && sha256(dbPath) === manifest.dbSha256;
      return {
        path,
        name: e.name,
        createdAt: manifest?.createdAt ?? nowIso(statSync(path).mtime),
        sizeBytes: dirSize(path),
        manifest,
        valid,
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export interface RestorePlan {
  backup: BackupInfo;
  /** הגיבוי של המצב הנוכחי, שנוצר לפני השחזור. */
  safetyBackupPath: string;
}

/**
 * F-101 – שחזור מגיבוי.
 *
 * לפני שנוגעים במשהו נוצר גיבוי של המצב הנוכחי, כדי ששחזור בטעות יהיה הפיך.
 * ה-DB הפעיל נסגר על ידי המתקשר, הקבצים מוחלפים, והיישום נפתח מחדש.
 * מחזיר את הנתיבים; פתיחת ה-DB מחדש היא באחריות המתקשר.
 */
export async function prepareRestore(
  db: Database,
  options: {
    backupPath: string;
    userDataDir: string;
    appVersion: string;
    schemaVersion: number;
    userId?: number | null;
  },
): Promise<RestorePlan> {
  const manifestPath = join(options.backupPath, MANIFEST_NAME);
  const dbPath = join(options.backupPath, 'nedarim.db');
  if (!existsSync(dbPath)) throw new Error('הגיבוי אינו מכיל קובץ בסיס נתונים');

  let manifest: BackupManifest | null = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
    if (sha256(dbPath) !== manifest.dbSha256) {
      throw new Error('קובץ הגיבוי פגום – ה-checksum אינו תואם למניפסט');
    }
  }

  // גיבוי-לפני-שחזור (F-101)
  const safetyDir = join(options.userDataDir, 'backups', 'before-restore');
  mkdirSync(safetyDir, { recursive: true });
  const safety = await createBackup(db, {
    userDataDir: options.userDataDir,
    targetDir: safetyDir,
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    keep: 5,
    userId: options.userId ?? null,
  });

  writeAudit(db, {
    userId: options.userId ?? null,
    entity: 'backup',
    entityId: null,
    action: 'restore',
    before: { safetyBackup: safety.path },
    after: { restoredFrom: options.backupPath, manifest },
  });

  return {
    backup: {
      path: options.backupPath,
      name: basename(options.backupPath),
      createdAt: manifest?.createdAt ?? '',
      sizeBytes: dirSize(options.backupPath),
      manifest,
      valid: true,
    },
    safetyBackupPath: safety.path,
  };
}

/**
 * מבצע את החלפת הקבצים בפועל. חייב לרוץ **אחרי** שה-DB נסגר.
 */
export function applyRestore(
  backupPath: string,
  userDataDir: string,
  dbFileName = 'nedarim.db',
): void {
  const source = join(backupPath, dbFileName);
  if (!existsSync(source)) throw new Error('הגיבוי אינו מכיל קובץ בסיס נתונים');

  const target = join(userDataDir, dbFileName);
  // קבצי ה-WAL של ה-DB הישן חייבים להיעלם, אחרת SQLite ינסה לשחזר מהם.
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${target}${suffix}`;
    if (existsSync(p)) rmSync(p, { force: true });
  }
  copyFileSync(source, target);

  copyTree(join(backupPath, 'receipts'), join(userDataDir, 'receipts'));
  copyTree(join(backupPath, 'attachments'), join(userDataDir, 'attachments'));
}

/**
 * מעתיק את ארכיון הקבלות מהגיבוי לתיקייה שהוגדרה.
 *
 * נקרא **אחרי** ש-`applyRestore` החליף את ה-DB ושה-DB נפתח מחדש: ההגדרה
 * `receipts_dir` יושבת בתוך בסיס הנתונים ששוחזר, ולכן אי אפשר לדעת לאן
 * הקבלות שייכות לפני שקוראים אותה משם.
 */
export function restoreReceiptsTo(backupPath: string, receiptsDir: string): number {
  return copyTree(join(backupPath, 'receipts'), receiptsDir);
}

/** F-102 – האם הגיע הזמן להזכיר גיבוי לתיקייה חיצונית. */
export function externalBackupReminder(db: Database): {
  due: boolean;
  daysSince: number | null;
  thresholdDays: number;
} {
  const threshold = Number(getSetting(db, 'external_backup_reminder_days') ?? '7') || 7;
  const last = getSetting(db, 'last_external_backup_at');
  if (!last) return { due: true, daysSince: null, thresholdDays: threshold };
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  return { due: days >= threshold, daysSince: days, thresholdDays: threshold };
}

/** תיקיית הגיבוי הפנימית, שאליה נשמר גיבוי אוטומטי בכל סגירה. */
export function defaultBackupDir(userDataDir: string): string {
  return join(userDataDir, 'backups', 'auto');
}
