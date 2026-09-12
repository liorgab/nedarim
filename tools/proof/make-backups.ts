/** עזר בדיקה ידנית: יוצר כמה גיבויים בתיקייה הפנימית של DB נתון, כדי שאפשר
 *  יהיה לראות את מסך הגיבוי מלא. משמש רק להדגמה, לא חלק מהיישום. */
import { openDatabase } from '../../src/main/db/connection';
import { createBackup, defaultBackupDir } from '../../src/main/services/backup';
import { LATEST_SCHEMA_VERSION } from '../../src/main/db/migrations';
import { join } from 'node:path';

const dir = process.argv[2]!;
const db = openDatabase({ file: join(dir, 'nedarim.db') });
const target = defaultBackupDir(dir);
for (let i = 0; i < 3; i += 1) {
  const info = await createBackup(db, {
    userDataDir: dir,
    targetDir: target,
    appVersion: '0.1.0',
    schemaVersion: LATEST_SCHEMA_VERSION,
    external: i === 2,
  });
  console.log(
    `${info.name}  ${info.manifest!.counts.members} חברים  ${info.manifest!.counts.receipts} קבלות`,
  );
}
db.close();
