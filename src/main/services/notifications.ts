import type { Database } from 'better-sqlite3';
import { getSetting, setSetting } from './settings';
import { writeAudit } from './audit';
import { buildCampaignContext, membersForMessaging, type MemberForMessaging } from './templates';
import { renderTemplate, type EventContext } from '../whatsapp/TemplateRenderer';
import {
  NOTIFY_EVENTS,
  decideNotify,
  notifyEvent,
  parseNotifyMode,
  skipText,
  triggerRef,
  type NotifyEventKind,
  type NotifyMode,
  type NotifySkipReason,
} from '../whatsapp/notifyEvents';

/**
 * W-80..W-89 – בניית ההודעה שנלווית לאירוע כספי.
 *
 * **הפונקציות כאן רצות אחרי ה-commit ולעולם לא בתוכו.** נדר חייב להישמר
 * גם כשוואטסאפ מנותק, כשאין לחבר נייד וכשהתבנית נמחקה; לכן אף כישלון כאן
 * אינו מחזיר שגיאה למסלול הכספי אלא `ok: false` עם סיבה.
 *
 * ההחלטה עצמה (`decideNotify`) טהורה ויושבת ב-`whatsapp/notifyEvents.ts`.
 * כאן רק שליפת העובדות מה-DB והרכבת הטקסט.
 */

// ------------------------------------------------------------- הגדרות

export function notifyModeFor(db: Database, kind: NotifyEventKind): NotifyMode {
  return parseNotifyMode(getSetting(db, notifyEvent(kind).settingKey));
}

export type NotifySettings = Record<NotifyEventKind, NotifyMode>;

export function notifySettings(db: Database): NotifySettings {
  const out = {} as NotifySettings;
  for (const def of NOTIFY_EVENTS) out[def.kind] = notifyModeFor(db, def.kind);
  return out;
}

export function setNotifyMode(
  db: Database,
  kind: NotifyEventKind,
  mode: NotifyMode,
  userId: number,
): void {
  const def = notifyEvent(kind);
  const before = notifyModeFor(db, kind);
  setSetting(db, def.settingKey, mode);
  // שינוי במדיניות שליחה אוטומטית לחברים הוא שינוי מהותי – נרשם ביומן.
  writeAudit(db, {
    userId,
    entity: 'setting',
    entityId: 0,
    action: 'update',
    before: { key: def.settingKey, value: before },
    after: { key: def.settingKey, value: mode },
  });
}

// -------------------------------------------------------- עובדות האירוע

/** מה שנשלף מה-DB על האירוע, לפני שמחליטים אם לשלוח. */
interface EventFacts {
  memberId: number | null;
  amountAgorot: number;
  eventDate: string | null;
  occasion: string | null;
  paymentMethod: string | null;
  receiptNumber: string | null;
  /**
   * WB-12 – רשומה נוספת שהודעה עליה מכסה גם את האירוע הזה.
   *
   * קבלה שהופקה יחד עם התשלום: הודעת התשלום כבר מכילה את מספר הקבלה,
   * ולכן הודעת "קבלה הופקה" עליה תהיה כפילות. `trigger_ref` של הקבלה
   * שונה מזה של התשלום, ובלי הקישור הזה שתיהן היו נחשבות אירועים נפרדים.
   */
  coveredByRef?: string | null;
}

type Loader = (db: Database, refId: number) => EventFacts | null;

const RECEIPT_FOR = `SELECT receipt_number FROM receipt
  WHERE source_type = ? AND source_id = ? AND cancelled_at IS NULL`;

function receiptNumberFor(db: Database, sourceType: string, sourceId: number): string | null {
  const row = db.prepare(RECEIPT_FOR).get(sourceType, sourceId) as
    | { receipt_number: number }
    | undefined;
  return row === undefined ? null : String(row.receipt_number);
}

function loadCharge(db: Database, id: number): EventFacts | null {
  const row = db
    .prepare(
      `SELECT c.member_id, c.amount_agorot, c.charge_date, c.occasion_note,
              o.name AS occasion
       FROM vow_charge c LEFT JOIN occasion o ON o.id = c.occasion_id
       WHERE c.id = ? AND c.deleted_at IS NULL`,
    )
    .get(id) as
    | {
        member_id: number;
        amount_agorot: number;
        charge_date: string;
        occasion_note: string | null;
        occasion: string | null;
      }
    | undefined;
  if (row === undefined) return null;
  return {
    memberId: row.member_id,
    amountAgorot: row.amount_agorot,
    eventDate: row.charge_date,
    occasion: row.occasion ?? row.occasion_note,
    paymentMethod: null,
    receiptNumber: null,
  };
}

const LOADERS: Record<NotifyEventKind, Loader> = {
  vow: (db, id) => loadCharge(db, id),
  credit: (db, id) => loadCharge(db, id),

  payment: (db, id) => {
    const row = db
      .prepare(
        `SELECT p.member_id, p.amount_agorot, p.payment_date, pm.name AS method
         FROM vow_payment p JOIN payment_method pm ON pm.id = p.payment_method_id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
      )
      .get(id) as
      | { member_id: number; amount_agorot: number; payment_date: string; method: string }
      | undefined;
    if (row === undefined) return null;
    return {
      memberId: row.member_id,
      amountAgorot: row.amount_agorot,
      eventDate: row.payment_date,
      occasion: null,
      paymentMethod: row.method,
      // WB-12 – כשהקבלה הופקה באותה פעולה, מספרה נכנס להודעת התשלום
      // במקום להישלח כהודעה שנייה.
      receiptNumber: receiptNumberFor(db, 'vow_payment', id),
    };
  },

  donation: (db, id) => {
    const row = db
      .prepare(
        `SELECT d.member_id, d.amount_agorot, d.donation_date, pm.name AS method
         FROM donation d JOIN payment_method pm ON pm.id = d.payment_method_id
         WHERE d.id = ? AND d.deleted_at IS NULL`,
      )
      .get(id) as
      | {
          member_id: number | null;
          amount_agorot: number;
          donation_date: string;
          method: string;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      memberId: row.member_id,
      amountAgorot: row.amount_agorot,
      eventDate: row.donation_date,
      occasion: null,
      paymentMethod: row.method,
      receiptNumber: receiptNumberFor(db, 'donation', id),
    };
  },

  receipt: (db, id) => {
    const row = db
      .prepare(
        `SELECT receipt_number, source_type, source_id, amount_agorot, payment_date,
                payment_method_text, cancelled_at
         FROM receipt WHERE id = ?`,
      )
      .get(id) as
      | {
          receipt_number: number;
          source_type: 'vow_payment' | 'donation';
          source_id: number;
          amount_agorot: number;
          payment_date: string;
          payment_method_text: string;
          cancelled_at: string | null;
        }
      | undefined;
    // קבלה מבוטלת אינה מפיקה הודעה: ההודעה על ביטול אינה "קבלה הופקה".
    if (row === undefined || row.cancelled_at !== null) return null;

    // הקבלה אינה מחזיקה member_id (היא נושאת שם משלם חופשי), ולכן החבר
    // נשלף מהרשומה שעליה היא הופקה.
    const table = row.source_type === 'vow_payment' ? 'vow_payment' : 'donation';
    const source = db.prepare(`SELECT member_id FROM ${table} WHERE id = ?`).get(row.source_id) as
      | { member_id: number | null }
      | undefined;

    return {
      memberId: source?.member_id ?? null,
      amountAgorot: row.amount_agorot,
      eventDate: row.payment_date,
      occasion: null,
      paymentMethod: row.payment_method_text,
      receiptNumber: String(row.receipt_number),
      coveredByRef: `${table}:${row.source_id}`,
    };
  },
};

// -------------------------------------------------------------- הטיוטה

export interface NotificationDraft {
  eventKind: NotifyEventKind;
  eventLabel: string;
  memberId: number;
  memberName: string;
  mobileE164: string | null;
  templateId: number | null;
  /** גוף התבנית, כדי שהגבאי יוכל לערוך לפני השליחה. */
  body: string;
  /** הטקסט המרונדר – התצוגה המקדימה. */
  text: string;
  triggerRef: string;
  /** `auto` – שליחה ללא אישור (W3). `ask` – נפתח דיאלוג. */
  mode: NotifyMode;
}

export type NotificationResult =
  | { ok: true; draft: NotificationDraft }
  | { ok: false; reason: NotifySkipReason; message: string };

function activeEventTemplate(
  db: Database,
  kind: NotifyEventKind,
): { id: number; body: string } | null {
  const row = db
    .prepare(
      `SELECT id, body FROM message_template
       WHERE event_kind = ? AND deleted_at IS NULL AND is_active = 1`,
    )
    .get(kind) as { id: number; body: string } | undefined;
  return row ?? null;
}

function alreadySent(db: Database, refs: readonly (string | null | undefined)[]): boolean {
  const stmt = db.prepare('SELECT 1 FROM message_campaign WHERE trigger_ref = ? LIMIT 1');
  return refs.some((ref) => ref != null && ref !== '' && stmt.get(ref) !== undefined);
}

/**
 * W-86 – בונה את ההודעה לאירוע, או מסביר למה אין הודעה.
 *
 * מוחזר `ok: false` גם במצבים תקינים לחלוטין (האירוע כבוי, לחבר אין נייד).
 * המתקשר מתעלם מהם בשקט – הם אינם שגיאות של הפעולה הכספית.
 */
export function buildNotification(
  db: Database,
  kind: NotifyEventKind,
  refId: number,
  options: { force?: boolean } = {},
): NotificationResult {
  const force = options.force === true;
  const mode = notifyModeFor(db, kind);
  const ref = triggerRef(kind, refId);

  // כשהאירוע כבוי לא נוגעים ב-DB בכלל: זו הדרך הנפוצה ביותר, והיא רצה
  // אחרי כל שמירה של נדר או תשלום. בשליחה יזומה כן טוענים – הגבאי ביקש.
  const skipLoad = mode === 'off' && !force;
  const facts = skipLoad ? null : LOADERS[kind](db, refId);
  const template = skipLoad ? null : activeEventTemplate(db, kind);

  const member: MemberForMessaging | undefined =
    facts === null || facts.memberId === null
      ? undefined
      : membersForMessaging(db, [facts.memberId])[0];

  const decision = decideNotify({
    mode,
    force,
    hasMember: member !== undefined,
    hasValidMobile: member?.mobileStatus === 'valid',
    alreadySent: skipLoad ? false : alreadySent(db, [ref, facts?.coveredByRef]),
    hasTemplate: template !== null,
  });

  if (decision.kind === 'skip') {
    return { ok: false, reason: decision.reason, message: skipText(decision.reason) };
  }

  // אחרי החלטת ask/auto שלושת אלה קיימים בהכרח; הבדיקה לטובת המהדר בלבד.
  if (facts === null || template === null || member === undefined) {
    return { ok: false, reason: 'off', message: skipText('off') };
  }

  const event: EventContext = {
    amountAgorot: facts.amountAgorot,
    eventDate: facts.eventDate,
    occasion: facts.occasion,
    paymentMethod: facts.paymentMethod,
    receiptNumber: facts.receiptNumber,
    // היתרה הנוכחית **היא** היתרה אחרי הפעולה: הרשומה כבר נשמרה.
    balanceAfterAgorot: member.balanceAgorot,
  };

  return {
    ok: true,
    draft: {
      eventKind: kind,
      eventLabel: notifyEvent(kind).label,
      memberId: member.id,
      memberName: `${member.firstName} ${member.lastName}`.trim(),
      mobileE164: member.mobileE164,
      templateId: template.id,
      body: template.body,
      text: renderTemplate(template.body, member, buildCampaignContext(db), event),
      triggerRef: ref,
      mode: force ? 'ask' : mode,
    },
  };
}

/**
 * W-88 – החברים בעלי יתרת חוב, לשליחה המונית בלחיצה אחת.
 *
 * מוחזרים מזהים בלבד ולא הודעות: אשף הקמפיין הקיים כבר יודע לרנדר, להזהיר
 * על מספרים חסרים ולהציג תצוגה מקדימה. הפער היחיד היה נקודת כניסה מהירה,
 * ולא מנוע נוסף.
 *
 * חברים ללא נייד תקין אינם מסוננים כאן: אשף הקמפיין מציג אותם כמדולגים,
 * וזו אינפורמציה שהגבאי צריך – "לחמישה חייבים אין נייד" הוא ממצא, לא רעש.
 */
export function debtorIds(db: Database, minAgorot = 1): number[] {
  const rows = db
    .prepare(
      `SELECT member_id FROM v_member_balance
       WHERE status = 'active' AND balance_agorot >= ?
       ORDER BY balance_agorot DESC`,
    )
    .all(Math.max(1, minAgorot)) as { member_id: number }[];
  return rows.map((r) => r.member_id);
}
