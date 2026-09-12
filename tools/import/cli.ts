import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '@main/db/connection';
import { seed, systemUserId } from '@main/db/seed';
import { importWorkbook } from './importer';
import { reconcile } from './reconcile';
import { renderReport } from './report';
import type { ImportResult } from './types';
import { readLegacyWorkbook } from './workbook';
import { nowIso } from '../../src/shared/datetime';

/**
 * כלי הייבוא החד-פעמי מהקובץ הישן (F-103, ROADMAP שלב 1).
 *
 *   npm run import -- <path-to.xlsm> [--db <path>] [--report <path>]
 *
 * ברירות מחדל: DB ב-`data/nedarim-import.db`, דוח ב-`data/import-report.md`.
 * הריצה אידמפוטנטית לחלוטין – אפשר להריץ שוב ושוב על אותו DB.
 */

interface Args {
  source: string;
  db: string;
  report: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let db = resolve('data/nedarim-import.db');
  let report = resolve('data/import-report.md');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--db') db = resolve(argv[++i] ?? '');
    else if (a === '--report') report = resolve(argv[++i] ?? '');
    else positional.push(a);
  }

  const source = positional[0];
  if (!source) {
    throw new Error('שימוש: npm run import -- <path-to.xlsm> [--db <path>] [--report <path>]');
  }
  return { source: resolve(source), db, report };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.source)) {
    throw new Error(`קובץ המקור לא נמצא: ${args.source}`);
  }

  const startedAt = nowIso();
  console.log(`קורא את ${args.source} …`);
  const wb = readLegacyWorkbook(args.source);
  console.log(
    `נקראו: ${wb.members.length} חברים · ${wb.charges.length} שורות חיוב · ` +
      `${wb.payments.length} תשלומים · ${wb.donations.length} תרומות · ${wb.expenses.length} הוצאות`,
  );

  mkdirSync(dirname(args.db), { recursive: true });
  const db = openDatabase({ file: args.db });
  seed(db);

  console.log('מייבא …');
  const outcome = importWorkbook(db, wb, systemUserId(db));
  console.log('מריץ בדיקות התאמה …');
  const rec = reconcile(db, wb);

  const result: ImportResult = {
    sourceFile: args.source,
    startedAt,
    finishedAt: nowIso(),
    counts: outcome.counts,
    issues: outcome.issues,
    reconcile: rec,
    dataRange: outcome.dataRange,
  };

  mkdirSync(dirname(args.report), { recursive: true });
  writeFileSync(args.report, renderReport(result), 'utf8');
  db.close();

  const c = outcome.counts;
  console.log('');
  console.log('--- סיכום ---');
  console.log(
    `חברים ${c.members} · יתרות פתיחה ${c.openingBalances} · חיובים ${c.charges} · ` +
      `זיכויים ${c.credits} · תשלומים ${c.payments} · תרומות ${c.donations} · ` +
      `הוצאות ${c.expenses} · קבלות ${c.receipts}`,
  );
  console.log(`דולגו ${c.skipped} · דגלים ${c.flagged}`);
  console.log('');
  console.log(
    `התאמת יתרות: ${rec.balances.diffs.length === 0 ? 'תקין' : `${rec.balances.diffs.length} סטיות`}`,
  );
  console.log(
    `התאמת מאזן חודשי: ${rec.months.diffs.length === 0 ? 'תקין' : `${rec.months.diffs.length} סטיות`}`,
  );
  console.log(
    `קבלות: ${rec.receipts.imported} יובאו, מונה עד ${rec.receipts.counterMax}, ` +
      `כפילויות ${rec.receipts.duplicates.length}, לא בשימוש ${rec.receipts.missing.length}`,
  );
  console.log('');
  console.log(`DB:   ${args.db}`);
  console.log(`דוח:  ${args.report}`);

  const failed = rec.balances.diffs.length > 0 || rec.receipts.duplicates.length > 0;
  process.exitCode = failed ? 1 : 0;
}

main();
