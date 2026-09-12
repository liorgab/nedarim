/**
 * W-80..W-84 – קטלוג האירועים הכספיים שמפיקים הודעה.
 *
 * המטרה (בקשת הגבאי): ההתכתבות בוואטסאפ תהווה יומן של כל ההתחשבנות מול
 * בית הכנסת – נדר, זיכוי, תשלום, תרומה וקבלה.
 *
 * **טהור בכוונה**, כמו `sessionState` ו-`sendOutcome`: ההחלטה "האם לשלוח
 * ועל מה" היא פונקציה של ההגדרות ושל מצב החבר, ולכן היא נבדקת בלי DB
 * ובלי Electron. הלקח מ-W-56 – לוגיקה שיושבת בתוך מסלול אינטגרציה אינה
 * נבדקת – חוזר גם כאן.
 */

/** האירועים שמפיקים הודעה. `receipt` נפרד כי אפשר להפיק קבלה בלי תשלום חדש. */
export type NotifyEventKind = 'vow' | 'credit' | 'payment' | 'donation' | 'receipt';

export const NOTIFY_EVENT_KINDS: readonly NotifyEventKind[] = [
  'vow',
  'credit',
  'payment',
  'donation',
  'receipt',
];

/**
 * `off` – אין הודעה.
 * `ask` – הודעה מוכנה נפתחת לאישור הגבאי אחרי שמירת הרשומה.
 * `auto` – שליחה ללא אישור (דורש את מנוע הקמפיינים, W3).
 */
export type NotifyMode = 'off' | 'ask' | 'auto';

export function isNotifyMode(value: string): value is NotifyMode {
  return value === 'off' || value === 'ask' || value === 'auto';
}

/** ערך לא מוכר בהגדרה נקרא כ-`off`: עדיף לא לשלוח מאשר לשלוח בטעות. */
export function parseNotifyMode(value: string | null | undefined): NotifyMode {
  return value !== null && value !== undefined && isNotifyMode(value) ? value : 'off';
}

export interface NotifyEventDef {
  kind: NotifyEventKind;
  label: string;
  /** מפתח ב-`setting`. */
  settingKey: string;
  /** שם הישות ב-`trigger_ref` (`entity:id`). */
  entity: string;
  /** גוף התבנית שנזרעת בהתקנה חדשה. הגבאי רשאי לשנות. */
  defaultBody: string;
}

/**
 * ברירות המחדל מנוסחות כהודעת יומן ולא כתזכורת גבייה: הן נשלחות מיד אחרי
 * הפעולה, וההקשר ברור. היתרה בסוף כל הודעה היא מה שהופך את השרשור ליומן.
 */
export const NOTIFY_EVENTS: readonly NotifyEventDef[] = [
  {
    kind: 'vow',
    label: 'נדר חדש',
    settingKey: 'whatsapp_notify_vow',
    entity: 'vow_charge',
    defaultBody:
      '{{nickname_or_first}} שלום,\nנרשם נדר בסך *{{amount}}* בתאריך {{event_date}}.\n? אירוע: {{occasion}}.\nהיתרה שלך כעת: *{{balance_after}}*.\n\n{{synagogue_name}}',
  },
  {
    kind: 'credit',
    label: 'זיכוי',
    settingKey: 'whatsapp_notify_credit',
    entity: 'vow_charge',
    defaultBody:
      '{{nickname_or_first}} שלום,\nנרשם זיכוי בסך *{{amount}}* בתאריך {{event_date}}.\nהיתרה שלך כעת: *{{balance_after}}*.\n\n{{synagogue_name}}',
  },
  {
    kind: 'payment',
    label: 'תשלום התקבל',
    settingKey: 'whatsapp_notify_payment',
    entity: 'vow_payment',
    // השורה המותנית (`? `) נכללת רק כשהופקה קבלה באותה פעולה – WB-12.
    defaultBody:
      '{{nickname_or_first}} שלום,\nהתקבל תשלום בסך *{{amount}}* בתאריך {{event_date}} ({{payment_method}}).\n? קבלה מספר {{receipt_number}}.\nהיתרה שלך כעת: *{{balance_after}}*.\n\nתודה רבה,\n{{synagogue_name}}',
  },
  {
    kind: 'donation',
    label: 'תרומה',
    settingKey: 'whatsapp_notify_donation',
    entity: 'donation',
    defaultBody:
      '{{nickname_or_first}} שלום,\nהתקבלה תרומה בסך *{{amount}}* בתאריך {{event_date}}.\n\nתודה רבה,\n{{synagogue_name}}',
  },
  {
    kind: 'receipt',
    label: 'קבלה הופקה',
    settingKey: 'whatsapp_notify_receipt',
    entity: 'receipt',
    defaultBody:
      '{{nickname_or_first}} שלום,\nהופקה עבורך קבלה מספר *{{receipt_number}}* על סך *{{amount}}*.\n\nתודה רבה,\n{{synagogue_name}}',
  },
];

export function notifyEvent(kind: NotifyEventKind): NotifyEventDef {
  const def = NOTIFY_EVENTS.find((e) => e.kind === kind);
  // הטיפוס מונע את זה בזמן קומפילציה; הבדיקה כאן היא נגד ערך שהגיע מ-DB.
  if (def === undefined) throw new Error(`אירוע לא מוכר: ${kind}`);
  return def;
}

/** `entity:id` – ראו ההסבר במיגרציה 007. */
export function triggerRef(kind: NotifyEventKind, refId: number): string {
  return `${notifyEvent(kind).entity}:${refId}`;
}

// ------------------------------------------------------------- ההחלטה

export type NotifySkipReason =
  | 'off'
  | 'no_member'
  | 'no_mobile'
  | 'already_sent'
  | 'no_template';

export type NotifyDecision =
  | { kind: 'ask' }
  | { kind: 'auto' }
  | { kind: 'skip'; reason: NotifySkipReason };

export interface NotifyInput {
  mode: NotifyMode;
  /**
   * הגבאי לחץ במפורש "שלח הודעה" על הרשומה.
   *
   * הכוונה גוברת על ההגדרה: אם הוא ביקש, לא מעניין ש`whatsapp_notify_*`
   * כבוי, ולא מעניין שכבר נשלחה הודעה (ייתכן שהראשונה נכשלה, או שהוא רוצה
   * לשלוח שוב). מה שלא נעקף הוא חוסר נייד וחוסר תבנית – שם באמת אין מה
   * לשלוח.
   */
  force?: boolean;
  /** `false` כשהתרומה נרשמה על שם תורם חופשי ואין חבר לשלוח אליו. */
  hasMember: boolean;
  /** `member.mobile_status === 'valid'`. */
  hasValidMobile: boolean;
  /** כבר קיים קמפיין עם אותו `trigger_ref`. */
  alreadySent: boolean;
  hasTemplate: boolean;
}

/**
 * סדר הבדיקות: `off` ראשון – כשהאירוע כבוי אין טעם לבדוק כלום, וגם אין
 * טעם לספר לגבאי שלחבר אין נייד על הודעה שממילא לא הייתה נשלחת.
 * `alreadySent` לפני `hasTemplate` כדי שמחיקת תבנית לא "תפתח מחדש"
 * אירוע שכבר טופל.
 */
export function decideNotify(input: NotifyInput): NotifyDecision {
  const forced = input.force === true;
  if (!forced && input.mode === 'off') return { kind: 'skip', reason: 'off' };
  if (!input.hasMember) return { kind: 'skip', reason: 'no_member' };
  if (!forced && input.alreadySent) return { kind: 'skip', reason: 'already_sent' };
  if (!input.hasTemplate) return { kind: 'skip', reason: 'no_template' };
  if (!input.hasValidMobile) return { kind: 'skip', reason: 'no_mobile' };
  // שליחה יזומה תמיד עוברת דרך אישור, גם כשהאירוע מוגדר `auto`: הגבאי
  // פתח את המסך כדי לראות מה נשלח.
  return !forced && input.mode === 'auto' ? { kind: 'auto' } : { kind: 'ask' };
}

const SKIP_TEXT: Record<NotifySkipReason, string> = {
  off: 'שליחת הודעה באירוע זה כבויה בהגדרות',
  no_member: 'לרשומה אין חבר משויך',
  no_mobile: 'לחבר אין מספר נייד תקין',
  already_sent: 'כבר נשלחה הודעה על רשומה זו',
  no_template: 'אין תבנית פעילה לאירוע זה',
};

export function skipText(reason: NotifySkipReason): string {
  return SKIP_TEXT[reason];
}

// -------------------------------------------------- מיזוג תשלום + קבלה

export interface ActionEvents {
  /** נרשם תשלום חדש. */
  paymentCreated: boolean;
  /** הופקה קבלה. */
  receiptIssued: boolean;
}

/**
 * WB-12 – פעולה אחת = הודעה אחת.
 *
 * "רישום תשלום + הפקת קבלה" הוא כפתור אחד במסך התשלומים, אבל שתי רשומות
 * ב-DB. בלי המיזוג הזה החבר היה מקבל שתי הודעות רצופות על אותו כסף, וגם
 * המכסה היומית (WB-07) הייתה נאכלת בקצב כפול. במקרה המשולב מדווח אירוע
 * `payment` בלבד, ו-`{{receipt_number}}` בתבנית שלו מציג את מספר הקבלה.
 */
export function mergeEvents(action: ActionEvents): NotifyEventKind | null {
  if (action.paymentCreated) return 'payment';
  if (action.receiptIssued) return 'receipt';
  return null;
}
