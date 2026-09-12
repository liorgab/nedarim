/** עזר בדיקה ידנית: מדפיס את ה-HTML של קבלה, כדי לבדוק את התצוגה המקדימה
 *  בלי לפתוח את היישום. לא חלק מהיישום. */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { openDatabase } from '../../src/main/db/connection';
import { getReceiptByNumber } from '../../src/main/services/receipts';
import { renderReceiptHtml } from '../../src/main/services/receiptTemplate';
import { synagogueDetails } from '../../src/main/services/receiptPdf';

const [dir, numberText, out] = process.argv.slice(2);
if (!dir || !numberText) {
  console.error('שימוש: receipt-html.ts <תיקיית DB> <מספר קבלה> [קובץ פלט]');
  process.exit(1);
}
const db = openDatabase({ file: join(dir, 'nedarim.db') });
const receipt = getReceiptByNumber(db, Number(numberText));
if (!receipt) throw new Error(`קבלה ${numberText} לא נמצאה`);
const html = renderReceiptHtml({
  receipt,
  synagogue: synagogueDetails(db),
  isCopy: receipt.printCount > 0,
  paperSize: 'A5',
});
db.close();
if (out) {
  writeFileSync(out, html, 'utf8');
  console.log(`${html.length} תווים → ${out}`);
} else {
  console.log(html);
}
