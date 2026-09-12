/** עזר בדיקה ידנית: קובע ערך הגדרה ב-DB נתון, כדי לבדוק מסכים במצבים שונים
 *  (למשל להדליק `require_login` ולראות את מסך הכניסה). לא חלק מהיישום. */
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { setSetting } from '../../src/main/services/settings';

const [dir, key, value] = process.argv.slice(2);
if (!dir || !key) {
  console.error('שימוש: set-setting.ts <תיקיית DB> <מפתח> <ערך>');
  process.exit(1);
}
const db = openDatabase({ file: join(dir, 'nedarim.db') });
setSetting(db, key, value ?? null);
db.close();
console.log(`${key} = ${value}`);
