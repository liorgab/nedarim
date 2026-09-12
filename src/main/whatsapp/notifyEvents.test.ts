import { describe, expect, it } from 'vitest';
import {
  NOTIFY_EVENTS,
  NOTIFY_EVENT_KINDS,
  decideNotify,
  mergeEvents,
  notifyEvent,
  parseNotifyMode,
  skipText,
  triggerRef,
  type NotifyInput,
  type NotifySkipReason,
} from './notifyEvents';

/** ברירת מחדל "הכול תקין" – כל בדיקה משנה שדה אחד. */
function input(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    mode: 'ask',
    hasMember: true,
    hasValidMobile: true,
    alreadySent: false,
    hasTemplate: true,
    ...overrides,
  };
}

describe('parseNotifyMode', () => {
  it('שלושת המצבים המוכרים', () => {
    expect(parseNotifyMode('off')).toBe('off');
    expect(parseNotifyMode('ask')).toBe('ask');
    expect(parseNotifyMode('auto')).toBe('auto');
  });

  it('ערך לא מוכר, ריק או חסר נקרא כ-off', () => {
    // הכיוון הבטוח: הגדרה פגומה לא תגרום לשליחה לא מכוונת לחברים.
    for (const value of ['', 'ASK', 'yes', '1', null, undefined, 'אוטומטי']) {
      expect(parseNotifyMode(value)).toBe('off');
    }
  });
});

describe('decideNotify', () => {
  it('מצב תקין במצב ask פותח דיאלוג', () => {
    expect(decideNotify(input())).toEqual({ kind: 'ask' });
  });

  it('מצב תקין במצב auto נשלח ללא אישור', () => {
    expect(decideNotify(input({ mode: 'auto' }))).toEqual({ kind: 'auto' });
  });

  it('off עוצר לפני כל בדיקה אחרת', () => {
    // גם כשהכול שבור, הסיבה שמדווחת היא שהאירוע כבוי – ואין טעם להטריד
    // את הגבאי ב"אין נייד" על הודעה שממילא לא הייתה נשלחת.
    const decision = decideNotify(
      input({ mode: 'off', hasMember: false, hasValidMobile: false, hasTemplate: false }),
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'off' });
  });

  it('תרומה ללא חבר משויך מדולגת', () => {
    expect(decideNotify(input({ hasMember: false }))).toEqual({
      kind: 'skip',
      reason: 'no_member',
    });
  });

  it('חבר ללא נייד תקין מדולג', () => {
    expect(decideNotify(input({ hasValidMobile: false }))).toEqual({
      kind: 'skip',
      reason: 'no_mobile',
    });
  });

  it('רשומה שכבר נשלחה עליה הודעה לא נשלחת שוב', () => {
    expect(decideNotify(input({ alreadySent: true }))).toEqual({
      kind: 'skip',
      reason: 'already_sent',
    });
  });

  it('already_sent גובר על no_template', () => {
    // מחיקת התבנית לא "פותחת מחדש" אירוע שכבר טופל: אחרת כל שינוי תבנית
    // היה משנה את הסיבה שמוצגת על רשומות ישנות.
    expect(decideNotify(input({ alreadySent: true, hasTemplate: false })).kind).toBe('skip');
    expect(
      (decideNotify(input({ alreadySent: true, hasTemplate: false })) as { reason: string })
        .reason,
    ).toBe('already_sent');
  });

  it('אין תבנית פעילה לאירוע', () => {
    expect(decideNotify(input({ hasTemplate: false }))).toEqual({
      kind: 'skip',
      reason: 'no_template',
    });
  });

  it('force – שליחה יזומה עוקפת אירוע כבוי', () => {
    // הגבאי לחץ "שלח הודעה" על השורה. הכוונה שלו גוברת על ההגדרה.
    expect(decideNotify(input({ mode: 'off', force: true }))).toEqual({ kind: 'ask' });
  });

  it('force – עוקף גם "כבר נשלח"', () => {
    // ייתכן שההודעה הראשונה נכשלה, או שהוא פשוט רוצה לשלוח שוב.
    expect(decideNotify(input({ alreadySent: true, force: true }))).toEqual({ kind: 'ask' });
  });

  it('force אינו עוקף חוסר נייד', () => {
    // כאן באמת אין למי לשלוח – זו לא מדיניות אלא מציאות.
    expect(decideNotify(input({ mode: 'off', force: true, hasValidMobile: false }))).toEqual({
      kind: 'skip',
      reason: 'no_mobile',
    });
  });

  it('force אינו עוקף חוסר תבנית או חוסר חבר', () => {
    expect(decideNotify(input({ force: true, hasTemplate: false })).kind).toBe('skip');
    expect(decideNotify(input({ force: true, hasMember: false })).kind).toBe('skip');
  });

  it('force על אירוע auto מחזיר ask ולא שליחה בלי אישור', () => {
    // הגבאי פתח מסך כדי לראות מה נשלח; לא הזמן לשלוח מאחורי גבו.
    expect(decideNotify(input({ mode: 'auto', force: true }))).toEqual({ kind: 'ask' });
  });

  it('לכל סיבת דילוג יש טקסט עברי', () => {
    const reasons: NotifySkipReason[] = [
      'off',
      'no_member',
      'no_mobile',
      'already_sent',
      'no_template',
    ];
    for (const reason of reasons) {
      expect(skipText(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('קטלוג האירועים', () => {
  it('לכל אירוע ברשימה יש הגדרה מלאה', () => {
    for (const kind of NOTIFY_EVENT_KINDS) {
      const def = notifyEvent(kind);
      expect(def.label).not.toBe('');
      expect(def.settingKey).toMatch(/^whatsapp_notify_/);
      expect(def.entity).not.toBe('');
      expect(def.defaultBody).not.toBe('');
    }
  });

  it('מפתחות ההגדרות ייחודיים', () => {
    const keys = NOTIFY_EVENTS.map((e) => e.settingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('אירוע לא מוכר זורק ולא מחזיר undefined בשקט', () => {
    // ערך פגום שהגיע מ-DB חייב להתפוצץ ולא לייצר הודעה ריקה.
    expect(() => notifyEvent('nope' as never)).toThrow();
  });
});

describe('triggerRef', () => {
  it('כולל את שם הישות ולא רק מזהה', () => {
    expect(triggerRef('payment', 42)).toBe('vow_payment:42');
    expect(triggerRef('vow', 42)).toBe('vow_charge:42');
  });

  it('אותו מזהה בישויות שונות אינו מתנגש', () => {
    // בלי שם הישות, נדר 42 היה "מסמן כנשלח" גם את תשלום 42.
    expect(triggerRef('vow', 42)).not.toBe(triggerRef('payment', 42));
  });

  it('נדר וזיכוי חולקים ישות – שניהם ב-vow_charge', () => {
    // מזהה ב-vow_charge הוא ייחודי בלי קשר ל-kind, ולכן אין התנגשות.
    expect(triggerRef('credit', 7)).toBe('vow_charge:7');
  });
});

describe('mergeEvents – WB-12', () => {
  it('תשלום עם קבלה מפיק הודעת תשלום אחת בלבד', () => {
    expect(mergeEvents({ paymentCreated: true, receiptIssued: true })).toBe('payment');
  });

  it('תשלום בלי קבלה', () => {
    expect(mergeEvents({ paymentCreated: true, receiptIssued: false })).toBe('payment');
  });

  it('קבלה שהופקה בנפרד מפיקה הודעת קבלה', () => {
    expect(mergeEvents({ paymentCreated: false, receiptIssued: true })).toBe('receipt');
  });

  it('פעולה שאינה אף אחד מהם', () => {
    expect(mergeEvents({ paymentCreated: false, receiptIssued: false })).toBeNull();
  });
});
