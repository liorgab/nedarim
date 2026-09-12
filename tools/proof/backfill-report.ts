/**
 * עזר בדיקה: מריץ את מיגרציה 005 ואת `backfillMobileE164` על **עותק** של DB
 * נתון, ומדפיס את הפילוח. משמש לאימות ה-DoD של W0 בלי לגעת בנתונים האמיתיים.
 *
 *   npm run proof:backfill -- "<תיקייה שמכילה nedarim.db>"
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { backfillMobileE164, mobileStatusBreakdown } from '../../src/main/services/mobileBackfill';
import { normalizeMobile } from '../../src/main/services/PhoneNormalizer';

const sourceDir = process.argv[2];
if (!sourceDir || !existsSync(join(sourceDir, 'nedarim.db'))) {
  console.error('שימוש: npm run proof:backfill -- "<תיקייה שמכילה nedarim.db>"');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'nedarim-backfill-'));
const dbPath = join(work, 'nedarim.db');
copyFileSync(join(sourceDir, 'nedarim.db'), dbPath);

// openDatabase מריץ את המיגרציות, כולל 005.
const db = openDatabase({ file: dbPath });

const summary = backfillMobileE164(db);
const breakdown = mobileStatusBreakdown(db);

console.log('\nbackfill – חברים שעודכנו בהרצה הזו:');
console.log(
  `  נבדקו ${summary.processed} · valid ${summary.valid} · invalid ${summary.invalid} · missing ${summary.missing}`,
);

console.log('\nפילוח כל טבלת החברים:');
console.log(
  `  valid ${breakdown.valid} · invalid ${breakdown.invalid} · missing ${breakdown.missing} · סה"כ ${breakdown.total}`,
);

const dups = db.prepare('SELECT * FROM v_member_duplicate_mobile').all() as Array<{
  mobile_e164: string;
  cnt: number;
  member_numbers: string;
}>;
console.log(`\nמספרים כפולים: ${dups.length}`);
for (const d of dups) console.log(`  ${d.mobile_e164} → חברים ${d.member_numbers}`);

const problems = db
  .prepare(
    `SELECT member_number, first_name, last_name, mobile, mobile_status, mobile_reason
     FROM member WHERE deleted_at IS NULL AND mobile_status <> 'valid'
       AND mobile IS NOT NULL AND TRIM(mobile) <> '' ORDER BY member_number`,
  )
  .all() as Array<Record<string, string>>;
console.log(`\nמספרים שהוזנו ולא נפרסו: ${problems.length}`);
for (const p of problems) {
  console.log(
    `  ${p['member_number']} ${p['first_name']} ${p['last_name']}: "${p['mobile']}" → ${p['mobile_status']} (${p['mobile_reason'] ?? '—'})`,
  );
}

const withReason = db
  .prepare(
    `SELECT member_number, mobile, mobile_e164, mobile_reason FROM member
     WHERE mobile_status = 'valid' AND mobile_reason IS NOT NULL ORDER BY member_number`,
  )
  .all() as Array<Record<string, string>>;
console.log(`\nתקינים עם אזהרה: ${withReason.length}`);
for (const r of withReason) {
  console.log(
    `  ${r['member_number']}: "${r['mobile']}" → ${r['mobile_e164']} (${r['mobile_reason']})`,
  );
}

// אידמפוטנטיות: הרצה שנייה לא אמורה לגעת באיש.
const second = backfillMobileE164(db);
console.log(`\nהרצה שנייה (אידמפוטנטיות): נבדקו ${second.processed} חברים`);

const sample = db
  .prepare(
    `SELECT mobile, mobile_e164 FROM member WHERE mobile_status='valid' ORDER BY member_number LIMIT 5`,
  )
  .all() as Array<{ mobile: string; mobile_e164: string }>;
console.log('\nדוגמאות:');
for (const s of sample) {
  const check = normalizeMobile(s.mobile).e164;
  console.log(
    `  "${s.mobile}" → ${s.mobile_e164}${check === s.mobile_e164 ? '' : '  ← אי-התאמה!'}`,
  );
}

db.close();
rmSync(work, { recursive: true, force: true });
