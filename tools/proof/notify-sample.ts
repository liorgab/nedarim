/**
 * עזר בדיקה (W-80..W-89): מוכיח על נתוני האמת שהודעת האירוע נבנית נכון.
 *
 * רץ על **עותק** של בסיס הנתונים: הוא מפעיל אירועים, יוצר נדר ותשלום
 * ומשנה הגדרות. לא לכוון אותו לתיקיית העבודה של הגבאי.
 *
 *   npx tsx tools/proof/notify-sample.ts <תיקיית-DB>
 */
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { seed, systemUserId } from '../../src/main/db/seed';
import { buildNotification, debtorIds, setNotifyMode } from '../../src/main/services/notifications';
import { createVow } from '../../src/main/services/vows';
import { createPayment } from '../../src/main/services/payments';
import { NOTIFY_EVENT_KINDS } from '../../src/main/whatsapp/notifyEvents';
import { formatAgorot } from '../../src/shared/money';
import { todayIso } from '../../src/shared/datetime';

const source = join(process.argv[2] ?? '', 'nedarim.db');
const work = join(mkdtempSync(join(tmpdir(), 'nedarim-notify-proof-')), 'nedarim.db');

// **חובה להעתיק גם את ה-WAL.** בסיס הנתונים במצב WAL, והכתיבות האחרונות
// יושבות ב-`nedarim.db-wal` ולא בקובץ הראשי. העתקה של הקובץ הראשי בלבד
// מייצרת עותק ישן בשקט – בדיוק מה שקרה כשרשומה שנוצרה זה עתה לא הופיעה.
copyFileSync(source, work);
for (const ext of ['-wal', '-shm']) {
  if (existsSync(source + ext)) copyFileSync(source + ext, work + ext);
}

const db = openDatabase({ file: work });
seed(db);
const userId = systemUserId(db);

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(62));

// ---------------------------------------------------------------- מצב פתיחה

line();
rule();
line('מיגרציה 007 על נתוני האמת');
rule();
const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
const members = db.prepare('SELECT COUNT(*) AS n FROM v_member_balance').get() as { n: number };
const eventTemplates = db
  .prepare('SELECT event_kind, name FROM message_template WHERE event_kind IS NOT NULL')
  .all() as { event_kind: string; name: string }[];

line(`גרסת סכימה: ${version.v}`);
line(`חברים: ${members.n}`);
line(`תבניות אירוע: ${eventTemplates.length} / ${NOTIFY_EVENT_KINDS.length}`);
for (const t of eventTemplates) line(`  ${t.event_kind.padEnd(9)} → ${t.name}`);

// -------------------------------------------------------------- חייבים (W-88)

line();
rule();
line('W-88 – שליחה לכל החייבים');
rule();
const debtors = debtorIds(db);
const withoutMobile = debtors.filter((id) => {
  const row = db.prepare('SELECT mobile_status FROM member WHERE id = ?').get(id) as {
    mobile_status: string;
  };
  return row.mobile_status !== 'valid';
});
line(`חברים עם יתרת חוב: ${debtors.length}`);
line(`מתוכם ללא נייד תקין: ${withoutMobile.length} (יוצגו כמדולגים באשף)`);

// ------------------------------------------------- אירוע אמיתי על חבר אמיתי

const target = db
  .prepare(
    `SELECT member_id, first_name, last_name, balance_agorot FROM v_member_balance
     WHERE mobile_status = 'valid' AND balance_agorot > 0
     ORDER BY balance_agorot DESC LIMIT 1`,
  )
  .get() as { member_id: number; first_name: string; last_name: string; balance_agorot: number };

const occasionId = (db.prepare('SELECT id FROM occasion LIMIT 1').get() as { id: number }).id;
const methodId = (
  db.prepare("SELECT id FROM payment_method WHERE name LIKE '%מזומן%' LIMIT 1").get() as {
    id: number;
  }
).id;

line();
rule();
line(`אירועים על ${target.first_name} ${target.last_name} (יתרה ${formatAgorot(target.balance_agorot)})`);
rule();

for (const kind of NOTIFY_EVENT_KINDS) setNotifyMode(db, kind, 'ask', userId);

const vowId = createVow(
  db,
  { memberId: target.member_id, chargeDate: todayIso(), occasionId, amountAgorot: 36000 },
  userId,
);
const vow = buildNotification(db, 'vow', vowId);
line();
line('■ נדר 360 ₪:');
line(vow.ok ? vow.draft.text : `(אין הודעה: ${vow.message})`);

const { paymentId, receipt } = createPayment(
  db,
  {
    memberId: target.member_id,
    paymentDate: todayIso(),
    amountAgorot: 36000,
    paymentMethodId: methodId,
  },
  userId,
  { issueReceipt: true },
);
const payment = buildNotification(db, 'payment', paymentId);
line();
line(`■ תשלום 360 ₪ + קבלה ${receipt?.receiptNumber} (WB-12 – הודעה אחת):`);
line(payment.ok ? payment.draft.text : `(אין הודעה: ${payment.message})`);

// WB-12 – אחרי שנשלחה הודעת התשלום, אותה קבלה אינה מפיקה הודעה שנייה.
line();
line('■ אותה קבלה כאירוע "קבלה הופקה", לפני שנשלחה הודעת התשלום:');
line(
  buildNotification(db, 'receipt', receipt!.id).ok
    ? '  נבנית הודעה (הגיוני – הודעת התשלום עוד לא נשלחה)'
    : '  אין הודעה',
);

db.prepare(
  `INSERT INTO message_campaign
     (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
   VALUES ('תשלום', 'x', 'completed', 'payment', ?, ?, ?)`,
).run(payment.ok ? payment.draft.triggerRef : '', todayIso(), todayIso());

line();
line('■ אותה קבלה אחרי שנשלחה הודעת התשלום:');
const receiptDraft = buildNotification(db, 'receipt', receipt!.id);
line(receiptDraft.ok ? '  ❌ נבנתה הודעה כפולה!' : `  ✔ ${receiptDraft.message}`);

// ------------------------------------------------------------ אי-כפילות

line();
rule();
line('אי-כפילות: אחרי שנשלחה הודעה על הנדר');
rule();
db.prepare(
  `INSERT INTO message_campaign
     (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
   VALUES ('נדר', 'x', 'completed', 'vow', ?, ?, ?)`,
).run(vow.ok ? vow.draft.triggerRef : '', todayIso(), todayIso());
const again = buildNotification(db, 'vow', vowId);
line(again.ok ? '❌ נבנתה הודעה שנייה!' : `✔ ${again.message}`);

// -------------------------------------------------------- חבר ללא נייד

const noMobile = db
  .prepare(
    `SELECT member_id, first_name, last_name FROM v_member_balance
     WHERE mobile_status <> 'valid' LIMIT 1`,
  )
  .get() as { member_id: number; first_name: string; last_name: string } | undefined;

if (noMobile) {
  line();
  rule();
  line(`חבר ללא נייד: ${noMobile.first_name} ${noMobile.last_name}`);
  rule();
  const id = createVow(
    db,
    { memberId: noMobile.member_id, chargeDate: todayIso(), occasionId, amountAgorot: 10000 },
    userId,
  );
  const result = buildNotification(db, 'vow', id);
  const saved = db.prepare('SELECT amount_agorot FROM vow_charge WHERE id = ?').get(id) as {
    amount_agorot: number;
  };
  line(result.ok ? '❌ נבנתה הודעה בלי נייד!' : `✔ ${result.message}`);
  line(`✔ הנדר נשמר בכל מקרה: ${formatAgorot(saved.amount_agorot)}`);
}

line();
rule();
db.close();
