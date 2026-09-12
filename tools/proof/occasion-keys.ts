/**
 * הוכחה למיגרציה 008: מצב ה-`hebcal_key` לפני ואחרי, על עותק של נתוני האמת.
 *
 *   npm run proof:occasions -- <תיקיית-DB>
 */
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/main/db/connection';
import { localDateToIso, parashaKeyForDate } from '../../src/main/services/hebrewCalendar';
import { defaultOccasionFor } from '../../src/main/services/vows';

const source = join(process.argv[2] ?? '', 'nedarim.db');
const work = join(mkdtempSync(join(tmpdir(), 'nedarim-occ-proof-')), 'nedarim.db');
copyFileSync(source, work);
for (const ext of ['-wal', '-shm']) {
  if (existsSync(source + ext)) copyFileSync(source + ext, work + ext);
}

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(72));

/** השבתות שבהן אין אירוע מתאים, לאורך 12 שנים. */
function brokenShabbatot(db: Database.Database): Array<{ iso: string; key: string }> {
  const stmt = db.prepare(
    'SELECT 1 FROM occasion WHERE hebcal_key = ? AND is_active = 1 LIMIT 1',
  );
  const out: Array<{ iso: string; key: string }> = [];
  const seen = new Set<string>();
  const start = new Date(2025, 0, 1);
  for (let i = 0; i < 365 * 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getDay() !== 6) continue;
    const iso = localDateToIso(d);
    const key = parashaKeyForDate(iso);
    if (key === null || seen.has(key)) continue;
    if (stmt.get(key) === undefined) {
      seen.add(key);
      out.push({ iso, key });
    }
  }
  return out;
}

// ------------------------------------------------------------------ לפני
//
// נפתח בלי מיגרציות, כדי לראות את המצב כפי שהוא אצל הגבאי עכשיו.
const before = new Database(work);
line();
rule();
line('לפני מיגרציה 008 – מצב בסיס הנתונים הקיים');
rule();
const v = before.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
line(`גרסת סכימה: ${v.v}`);
const beforeKeys = before
  .prepare("SELECT name, hebcal_key FROM occasion WHERE name IN ('פסח','סוכות','שבת חול המועד פסח','שבת חול המועד סוכות') ORDER BY name")
  .all() as { name: string; hebcal_key: string | null }[];
for (const r of beforeKeys) line(`  ${r.name.padEnd(22)} → ${r.hebcal_key ?? '(ריק)'}`);

const broken = brokenShabbatot(before);
line();
line(`שבתות ללא ברירת מחדל: ${broken.length}`);
for (const b of broken) line(`  ${b.iso}   ${b.key}`);
before.close();

// ----------------------------------------------------------------- אחרי

const db = openDatabase({ file: work });
line();
rule();
line('אחרי מיגרציה 008');
rule();
const v2 = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
line(`גרסת סכימה: ${v2.v}`);
const afterKeys = db
  .prepare("SELECT name, hebcal_key FROM occasion WHERE name IN ('פסח','סוכות','שבת חול המועד פסח','שבת חול המועד סוכות') ORDER BY name")
  .all() as { name: string; hebcal_key: string | null }[];
for (const r of afterKeys) line(`  ${r.name.padEnd(22)} → ${r.hebcal_key ?? '(ריק)'}`);

const stillBroken = brokenShabbatot(db);
line();
line(stillBroken.length === 0 ? '✔ אין שבתות ללא ברירת מחדל' : `❌ נותרו ${stillBroken.length}`);
for (const b of stillBroken) line(`  ${b.iso}   ${b.key}`);

line();
rule();
line('ברירת המחדל בארבע השבתות שהיו שבורות');
rule();
for (const iso of ['2027-04-24', '2025-10-11', '2029-03-31', '2026-09-26']) {
  line(`  ${iso}   ${defaultOccasionFor(db, iso)?.name ?? '⚠ לא נמצא'}`);
}

// ------------------------------------------ חג גובר ביום חול (F-31)

line();
rule();
line('חג באמצע שבוע – ברירת המחדל החדשה');
rule();
const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const weekdayCases: Array<[string, string]> = [
  ['2026-09-21', 'יום כיפור'],
  ['2027-04-22', 'יום א׳ של פסח'],
  ['2026-05-22', 'שבועות'],
  ['2026-10-02', 'הושענא רבה'],
  ['2026-04-08', 'שביעי של פסח'],
  ['2026-12-07', 'חנוכה'],
  ['2026-10-22', 'יום זיכרון רבין – לא אמור לחטוף'],
  ['2026-02-16', 'יום כיפור קטן – לא אמור לחטוף'],
  ['2026-10-13', 'יום חול רגיל'],
];
for (const [iso, note] of weekdayCases) {
  const d = new Date(iso + 'T00:00:00');
  line(
    `  ${iso}  ${DOW[d.getDay()]!.padEnd(7)} ${(defaultOccasionFor(db, iso)?.name ?? '⚠ אין').padEnd(22)} ${note}`,
  );
}

line();
line('בשבת הקריאה עדיין מנצחת:');
for (const iso of ['2027-04-24', '2025-10-11', '2026-10-10']) {
  line(`  ${iso}  ${defaultOccasionFor(db, iso)?.name ?? '⚠ אין'}`);
}

// ------------------------------------------------- שהנתונים הקיימים שלמים

line();
rule();
line('שלמות הנתונים');
rule();
const counts = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM member WHERE deleted_at IS NULL) members,
            (SELECT COUNT(*) FROM vow_charge WHERE deleted_at IS NULL) charges,
            (SELECT COUNT(*) FROM receipt) receipts,
            (SELECT COUNT(*) FROM occasion) occasions`,
  )
  .get() as Record<string, number>;
line(`חברים ${counts['members']} · חיובים ${counts['charges']} · קבלות ${counts['receipts']} · אירועים ${counts['occasions']}`);

// אף חיוב קיים לא איבד את האירוע שלו.
const orphans = db
  .prepare(
    `SELECT COUNT(*) n FROM vow_charge c
     LEFT JOIN occasion o ON o.id = c.occasion_id
     WHERE c.deleted_at IS NULL AND o.id IS NULL`,
  )
  .get() as { n: number };
line(orphans.n === 0 ? '✔ כל החיובים עדיין מקושרים לאירוע' : `❌ ${orphans.n} חיובים יתומים`);

line();
rule();
db.close();
