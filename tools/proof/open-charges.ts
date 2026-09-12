/** עזר בדיקה: מציג את פירוט החוב שייכנס להודעה, ומאמת שהוא מסתכם ליתרה. */
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { openChargesFor } from '../../src/main/services/openCharges';
import { formatAgorot } from '../../src/shared/money';

const db = openDatabase({ file: join(process.argv[2]!, 'nedarim.db') });

const debtors = db
  .prepare(
    `SELECT member_id, first_name, last_name, balance_agorot FROM v_member_balance
     WHERE balance_agorot > 0 ORDER BY balance_agorot DESC LIMIT 3`,
  )
  .all() as Array<{
  member_id: number;
  first_name: string;
  last_name: string;
  balance_agorot: number;
}>;

const map = openChargesFor(
  db,
  debtors.map((d) => d.member_id),
);

let allMatch = true;
for (const d of debtors) {
  const lines = map.get(d.member_id)!;
  const sum = lines.reduce((s, l) => s + l.remainingAgorot, 0);
  const match = sum === d.balance_agorot;
  if (!match) allMatch = false;
  console.log(
    `\n${d.first_name} ${d.last_name} · יתרה ${formatAgorot(d.balance_agorot)} · ${lines.length} חיובים פתוחים · סכום ${match ? 'תואם' : 'לא תואם!'}`,
  );
  for (const l of lines.slice(0, 5)) {
    const date = l.date === null ? 'יתרת פתיחה' : l.date.split('-').reverse().join('/');
    const partial =
      l.remainingAgorot !== l.amountAgorot ? ` (מתוך ${formatAgorot(l.amountAgorot)})` : '';
    console.log(`   ${date} · ${l.occasion} · ${formatAgorot(l.remainingAgorot)}${partial}`);
  }
  if (lines.length > 5) console.log(`   … ועוד ${lines.length - 5}`);
}

// אימות על כל 90 החברים
const all = db.prepare('SELECT member_id, balance_agorot FROM v_member_balance').all() as Array<{
  member_id: number;
  balance_agorot: number;
}>;
const allMap = openChargesFor(
  db,
  all.map((a) => a.member_id),
);
let mismatches = 0;
for (const a of all) {
  const sum = allMap.get(a.member_id)!.reduce((s, l) => s + l.remainingAgorot, 0);
  const expected = Math.max(0, a.balance_agorot);
  if (sum !== expected) mismatches += 1;
}
console.log(
  `\nאימות על כל ${all.length} החברים: ${mismatches === 0 ? '✅ כל הפירוטים מסתכמים ליתרה' : `❌ ${mismatches} אי-התאמות`}`,
);
db.close();
if (!allMatch || mismatches > 0) process.exit(1);
