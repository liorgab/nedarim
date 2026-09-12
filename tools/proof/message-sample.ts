/** עזר בדיקה: מדפיס את ההודעה המלאה שחבר יקבל, כולל פירוט החוב. */
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { renderForMember } from '../../src/main/services/templates';

const db = openDatabase({ file: join(process.argv[2]!, 'nedarim.db') });
const body =
  'שלום {{nickname_or_first}},\n\n' +
  'יתרת הנדרים שלך ב{{synagogue_name}} עומדת על {{balance}}, מתוך {{open_charges_count}} חיובים:\n\n' +
  '{{open_charges}}\n\n' +
  'נשמח להסדרה בהזדמנות הקרובה.\nשבת שלום, פרשת {{parasha}}.';

const top = db
  .prepare(
    `SELECT member_id, first_name, last_name FROM v_member_balance
     WHERE balance_agorot > 0 ORDER BY balance_agorot DESC LIMIT 1`,
  )
  .get() as { member_id: number; first_name: string; last_name: string };

console.log(`\n${'─'.repeat(50)}\nההודעה ל${top.first_name} ${top.last_name}:\n${'─'.repeat(50)}`);
console.log(renderForMember(db, body, top.member_id));
console.log('─'.repeat(50));
db.close();
