/**
 * עזר בדיקה ידנית: מייצר קובץ אקסל לדוגמה לאשף הייבוא.
 *
 * הקובץ בנוי בכוונה כמו קובץ שגבאי הכין בעצמו ולא כמו התבנית: כותרות
 * שאינן זהות לשמות השדות, עמודה מיותרת, שורה עם שדה חובה ריק ותרומה
 * לחבר שאינו קיים. זה מה שצריך להיראות במסכי המיפוי והבדיקה.
 *
 * לא חלק מהיישום.
 */
import { importEntity } from '../../src/main/import/catalog';

const [target] = process.argv.slice(2);
if (!target) {
  console.error('שימוש: import-sample.ts <נתיב קובץ .xlsx>');
  process.exit(1);
}

const donation = importEntity('donation').fields.map((f) => f.label);

const members: string[][] = [
  // כותרות "כמעט" נכונות – כדי שמסך המיפוי יראה גם ודאות וגם ניחוש.
  ['מספר חבר', 'שם פרטי', 'שם משפחה', 'נייד', 'הערת גבאי'],
  ['1', 'אברהם', 'כהן', '0501111111', 'ותיק'],
  ['2', 'יצחק', 'לוי', '0502222222', ''],
  ['3', '', 'ישראלי', '0503333333', 'שורה עם שדה חובה ריק'],
  ['4', 'יעקב', 'מזרחי', '', ''],
];

const donations: string[][] = [
  donation,
  ['', '01/09/2026', '1', 'אברהם כהן', 'כללי', 'מזומן', '180', '', '', ''],
  ['', '02/09/2026', '2', 'יצחק לוי', 'כללי', 'מזומן', '360', '', '', ''],
  // חבר שאינו קיים – זו השגיאה שהאשף אמור לדווח בשמה.
  ['', '03/09/2026', '47', 'מישהו אחר', 'כללי', 'מזומן', '100', '', '', ''],
];

async function main(): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  const sheets = [
    { sheet: 'חברים', data: members.map((r) => r.map((value) => ({ value, type: String }))) },
    { sheet: 'תרומות', data: donations.map((r) => r.map((value) => ({ value, type: String }))) },
  ];
  await writeXlsxFile(sheets as never).toFile(target!);
  console.log(target);
}

void main();
