import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { formatAgorot } from '@shared/money';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { createMember } from './members';
import { backfillMobileE164 } from './mobileBackfill';
import { createVow, createCredit } from './vows';
import { createPayment, issueReceiptForPayment } from './payments';
import { createDonation } from './donations';
import { setSetting } from './settings';
import { saveTemplate } from './templates';
import {
  buildNotification,
  notifyModeFor,
  notifySendability,
  notifySettings,
  setNotifyMode,
} from './notifications';

/**
 * W-80..W-89 – ההודעה שנלווית לאירוע כספי.
 *
 * הדגש בבדיקות: **הפעולה הכספית לא נפגעת**. בכל תרחיש כאן הנדר/התשלום
 * נשמר, וההודעה היא תוצר צדדי שעשוי להתבטל בשקט.
 */

let dir: string;
let db: Database;
let userId: number;
let memberId: number;
let occasionId: number;
let cashMethodId: number;
let donationTypeId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-notify-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  userId = systemUserId(db);

  memberId = createMember(db, { firstName: 'ישראל', lastName: 'ישראלי', mobile: '050-1234567' }, userId)
    .id;
  backfillMobileE164(db);

  occasionId = (db.prepare('SELECT id FROM occasion LIMIT 1').get() as { id: number }).id;
  cashMethodId = (
    db.prepare("SELECT id FROM payment_method WHERE name LIKE '%מזומן%' LIMIT 1").get() as {
      id: number;
    }
  ).id;
  donationTypeId = (db.prepare('SELECT id FROM donation_type LIMIT 1').get() as { id: number }).id;
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

function newVow(amount = 36000): number {
  return createVow(db, { memberId, chargeDate: '2026-09-06', occasionId, amountAgorot: amount }, userId);
}

describe('הגדרות – ברירת מחדל', () => {
  it('כל האירועים כבויים בהתקנה חדשה', () => {
    // CLAUDE.md כלל 12: מערכת שהורדה מ-GitHub לא שולחת דבר עד החלטת הגבאי.
    expect(notifySettings(db)).toEqual({
      vow: 'off',
      credit: 'off',
      payment: 'off',
      donation: 'off',
      receipt: 'off',
    });
  });

  it('שינוי מצב נשמר ונרשם ביומן הביקורת', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    expect(notifyModeFor(db, 'vow')).toBe('ask');

    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'setting'")
      .get() as { n: number };
    expect(audit.n).toBeGreaterThan(0);
  });

  it('ערך פגום בהגדרה נקרא כ-off', () => {
    setSetting(db, 'whatsapp_notify_vow', 'maybe');
    expect(notifyModeFor(db, 'vow')).toBe('off');
  });
});

describe('תבניות האירועים נזרעות', () => {
  it('יש תבנית פעילה לכל אחד מחמשת האירועים', () => {
    const rows = db
      .prepare('SELECT event_kind FROM message_template WHERE event_kind IS NOT NULL')
      .all() as { event_kind: string }[];
    expect(rows.map((r) => r.event_kind).sort()).toEqual([
      'credit',
      'donation',
      'payment',
      'receipt',
      'vow',
    ]);
  });

  it('אי אפשר לשמור שתי תבניות פעילות לאותו אירוע', () => {
    // האינדקס החד-ערכי החלקי במיגרציה 007 הוא מה שמונע הודעה כפולה.
    expect(() =>
      db
        .prepare(
          `INSERT INTO message_template (name, body, event_kind, is_active, created_at, updated_at)
           VALUES ('שני', 'טקסט', 'vow', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')`,
        )
        .run(),
    ).toThrow();
  });
});

describe('buildNotification – דילוגים', () => {
  it('אירוע כבוי מדולג', () => {
    const vowId = newVow();
    const result = buildNotification(db, 'vow', vowId);
    expect(result).toMatchObject({ ok: false, reason: 'off' });
  });

  it('חבר ללא נייד מדולג – והנדר עדיין נשמר', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    const noPhone = createMember(db, { firstName: 'משה', lastName: 'כהן' }, userId).id;
    const vowId = createVow(
      db,
      { memberId: noPhone, chargeDate: '2026-09-06', occasionId, amountAgorot: 10000 },
      userId,
    );

    expect(buildNotification(db, 'vow', vowId)).toMatchObject({ ok: false, reason: 'no_mobile' });
    // הנדר קיים בכל מקרה – זו הנקודה.
    const row = db.prepare('SELECT amount_agorot FROM vow_charge WHERE id = ?').get(vowId);
    expect(row).toEqual({ amount_agorot: 10000 });
  });

  it('רשומה שאינה קיימת מדולגת ולא זורקת', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    expect(buildNotification(db, 'vow', 99999).ok).toBe(false);
  });

  it('נדר שנמחק לוגית מדולג', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    const vowId = newVow();
    db.prepare("UPDATE vow_charge SET deleted_at = '2026-09-06T10:00:00' WHERE id = ?").run(vowId);
    expect(buildNotification(db, 'vow', vowId).ok).toBe(false);
  });

  it('תבנית שנמחקה – אין הודעה', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    db.prepare("UPDATE message_template SET is_active = 0 WHERE event_kind = 'vow'").run();
    expect(buildNotification(db, 'vow', newVow())).toMatchObject({
      ok: false,
      reason: 'no_template',
    });
  });
});

describe('buildNotification – נדר', () => {
  beforeEach(() => setNotifyMode(db, 'vow', 'ask', userId));

  it('מחזיר טיוטה עם הסכום, התאריך והיתרה אחרי הפעולה', () => {
    const result = buildNotification(db, 'vow', newVow(36000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.memberName).toBe('ישראל ישראלי');
    expect(result.draft.mobileE164).toBe('972501234567');
    expect(result.draft.triggerRef).toMatch(/^vow_charge:\d+$/);
    // 360 ₪ נדר על יתרה 0 → היתרה אחרי הפעולה 360 ₪.
    expect(result.draft.text).toContain('360');
    expect(result.draft.text).toContain('06/09/2026');
  });

  it('אין מצייני מקום שלא הוחלפו', () => {
    const result = buildNotification(db, 'vow', newVow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.text).not.toContain('{{');
  });

  it('היתרה בהודעה היא היתרה אחרי הנדר, לא לפניו', () => {
    newVow(10000);
    const second = newVow(25000);
    const result = buildNotification(db, 'vow', second);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 + 250 = 350 ₪
    expect(result.draft.text).toContain('350');
  });
});

describe('buildNotification – זיכוי', () => {
  it('זיכוי מציג סכום חיובי ויתרה שהוקטנה', () => {
    setNotifyMode(db, 'credit', 'ask', userId);
    newVow(50000);
    const creditId = createCredit(
      db,
      {
        memberId,
        chargeDate: '2026-09-06',
        occasionId,
        amountAgorot: 20000,
        creditReason: 'טעות רישום',
        note: 'תיקון',
      },
      userId,
      'admin',
    );

    const result = buildNotification(db, 'credit', creditId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // הסכום מוצג בערך מוחלט; היתרה 500 − 200 = 300 ₪.
    expect(result.draft.text).toContain('200');
    expect(result.draft.text).toContain('300');
  });
});

describe('buildNotification – תשלום וקבלה (WB-12)', () => {
  beforeEach(() => {
    setNotifyMode(db, 'payment', 'ask', userId);
    setNotifyMode(db, 'receipt', 'ask', userId);
  });

  it('תשלום בלי קבלה', () => {
    newVow(36000);
    const { paymentId } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
    );
    const result = buildNotification(db, 'payment', paymentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.text).toContain('360');
    // יתרה 0 אחרי התשלום.
    expect(result.draft.text).toContain('0');
  });

  it('תשלום עם קבלה – מספר הקבלה נכנס להודעת התשלום', () => {
    // זה הלב של WB-12: פעולה אחת של הגבאי, הודעה אחת לחבר.
    newVow(36000);
    const { paymentId, receipt } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
      { issueReceipt: true },
    );
    expect(receipt).not.toBeNull();

    const result = buildNotification(db, 'payment', paymentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.text).toContain(String(receipt!.receiptNumber));
  });

  it('אחרי הודעת התשלום אין הודעה שנייה על הקבלה שהופקה איתו', () => {
    // WB-12 נאכף בקוד ולא רק בזרימת המסכים: `trigger_ref` של הקבלה שונה
    // מזה של התשלום, ובלי הקישור ביניהן החבר היה מקבל שתי הודעות על
    // אותו כסף.
    newVow(36000);
    const { paymentId, receipt } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
      { issueReceipt: true },
    );

    const payment = buildNotification(db, 'payment', paymentId);
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    db.prepare(
      `INSERT INTO message_campaign
         (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
       VALUES ('תשלום', 'טקסט', 'completed', 'payment', ?, '2026-09-06T10:00:00', '2026-09-06T10:00:00')`,
    ).run(payment.draft.triggerRef);

    expect(buildNotification(db, 'receipt', receipt!.id)).toMatchObject({
      ok: false,
      reason: 'already_sent',
    });
  });

  it('קבלה שהופקה בנפרד מתשלום שלא נשלחה עליו הודעה – כן מפיקה הודעה', () => {
    newVow(36000);
    const { paymentId } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
    );
    const receipt = db
      .prepare('SELECT id FROM receipt WHERE source_id = ?')
      .get(paymentId) as { id: number } | undefined;
    expect(receipt).toBeUndefined();

    const issued = issueReceiptForPayment(db, paymentId, userId);
    expect(buildNotification(db, 'receipt', issued.id).ok).toBe(true);
  });

  it('קבלה מבוטלת אינה מפיקה הודעה', () => {
    newVow(36000);
    const { receipt } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
      { issueReceipt: true },
    );
    db.prepare("UPDATE receipt SET cancelled_at = '2026-09-06T12:00:00' WHERE id = ?").run(
      receipt!.id,
    );
    expect(buildNotification(db, 'receipt', receipt!.id).ok).toBe(false);
  });
});

describe('buildNotification – תרומה', () => {
  beforeEach(() => setNotifyMode(db, 'donation', 'ask', userId));

  it('תרומה של חבר מפיקה הודעה', () => {
    const { donationId } = createDonation(
      db,
      {
        donationDate: '2026-09-06',
        memberId,
        donorName: 'ישראל ישראלי',
        donationTypeId,
        paymentMethodId: cashMethodId,
        amountAgorot: 50000,
      },
      userId,
    );
    const result = buildNotification(db, 'donation', donationId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.text).toContain('500');
  });

  it('תרומה של תורם חופשי ללא חבר מדולגת', () => {
    const { donationId } = createDonation(
      db,
      {
        donationDate: '2026-09-06',
        memberId: null,
        donorName: 'אלמוני',
        donationTypeId,
        paymentMethodId: cashMethodId,
        amountAgorot: 50000,
      },
      userId,
    );
    expect(buildNotification(db, 'donation', donationId)).toMatchObject({
      ok: false,
      reason: 'no_member',
    });
  });
});

describe('אי-כפילות לפי trigger_ref', () => {
  it('אחרי שנוצר קמפיין לאותה רשומה, אין טיוטה שנייה', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    const vowId = newVow();

    const first = buildNotification(db, 'vow', vowId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    db.prepare(
      `INSERT INTO message_campaign
         (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
       VALUES ('נדר', 'טקסט', 'completed', 'vow', ?, '2026-09-06T10:00:00', '2026-09-06T10:00:00')`,
    ).run(first.draft.triggerRef);

    expect(buildNotification(db, 'vow', vowId)).toMatchObject({
      ok: false,
      reason: 'already_sent',
    });
  });

  it('נדר ותשלום עם אותו מזהה אינם מתנגשים', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    setNotifyMode(db, 'payment', 'ask', userId);
    const vowId = newVow(36000);
    const { paymentId } = createPayment(
      db,
      { memberId, paymentDate: '2026-09-06', amountAgorot: 36000, paymentMethodId: cashMethodId },
      userId,
    );

    db.prepare(
      `INSERT INTO message_campaign
         (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
       VALUES ('נדר', 'טקסט', 'completed', 'vow', ?, '2026-09-06T10:00:00', '2026-09-06T10:00:00')`,
    ).run(`vow_charge:${vowId}`);

    // התשלום עדיין זכאי להודעה גם אם המזהה המספרי מקרי זהה.
    expect(buildNotification(db, 'payment', paymentId).ok).toBe(true);
  });
});

describe('W-90 – שליחה יזומה משורה בטבלה', () => {
  it('בונה הודעה גם כשהאירוע כבוי בהגדרות', () => {
    // זו בדיוק התקלה שדווחה: תרומה נשמרה, אף הודעה לא הוצעה, ולא הייתה
    // דרך לשלוח אותה ידנית.
    const vowId = newVow(36000);
    expect(buildNotification(db, 'vow', vowId).ok).toBe(false);

    const forced = buildNotification(db, 'vow', vowId, { force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.draft.text).toContain('360');
    expect(forced.draft.mode).toBe('ask');
  });

  it('חבר ללא נייד מדווח סיבה גם בשליחה יזומה', () => {
    // התרומה שדווחה הייתה על חבר בלי נייד. הגבאי חייב לקבל תשובה.
    const noPhone = createMember(db, { firstName: 'שלומי', lastName: 'פרז' }, userId).id;
    const { donationId } = createDonation(
      db,
      {
        donationDate: '2026-09-06',
        memberId: noPhone,
        donorName: 'דוד מזרחי',
        donationTypeId,
        paymentMethodId: cashMethodId,
        amountAgorot: 20000,
      },
      userId,
    );
    const result = buildNotification(db, 'donation', donationId, { force: true });
    expect(result).toMatchObject({ ok: false, reason: 'no_mobile' });
    if (result.ok) return;
    expect(result.message).toContain('נייד');
  });

  it('אפשר לשלוח שוב על רשומה שכבר נשלחה עליה הודעה', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    const vowId = newVow();
    const first = buildNotification(db, 'vow', vowId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    db.prepare(
      `INSERT INTO message_campaign
         (name, template_body_snapshot, status, trigger_kind, trigger_ref, created_at, updated_at)
       VALUES ('נדר', 'טקסט', 'failed', 'vow', ?, '2026-09-06T10:00:00', '2026-09-06T10:00:00')`,
    ).run(first.draft.triggerRef);

    expect(buildNotification(db, 'vow', vowId).ok).toBe(false);
    expect(buildNotification(db, 'vow', vowId, { force: true }).ok).toBe(true);
  });
});

describe('תבנית ערוכה על ידי הגבאי', () => {
  it('הטיוטה משתמשת בגוף שהגבאי שמר, לא בברירת המחדל', () => {
    setNotifyMode(db, 'vow', 'ask', userId);
    const template = db
      .prepare("SELECT id, name FROM message_template WHERE event_kind = 'vow'")
      .get() as { id: number; name: string };

    saveTemplate(
      db,
      { id: template.id, name: template.name, body: 'שלום {{first_name}}, נדר {{amount}}.', isActive: true },
      userId,
      'admin',
    );

    const result = buildNotification(db, 'vow', newVow(36000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // מושווה מול formatAgorot עצמו: הוא מוסיף סימני כיווניות ורווח מיוחד
    // סביב המספר, והבדיקה כאן היא שהגוף של הגבאי שימש – לא איך מעוצב סכום.
    expect(result.draft.text).toBe(`שלום ישראל, נדר ${formatAgorot(36000)}.`);
  });
});

/**
 * W-91 – האם האייקון בשורה יהיה ירוק.
 *
 * התקלה שבגללה זה נכתב: אייקון הוואטסאפ בשורה היה ירוק ולחיץ תמיד, וגם
 * על חבר בלי נייד תקין. הגבאי לחץ, וקיבל הודעת מערכת שמסבירה שאי אפשר.
 * ההחלטה כאן עוברת דרך אותה `decideNotify` של השליחה עצמה, כדי שלא
 * ייווצר פער בין מה שהאייקון מבטיח לבין מה שקורה בלחיצה.
 */
describe('notifySendability', () => {
  it('חבר עם נייד תקין – אפשר לשלוח', () => {
    const vowId = newVow();
    expect(notifySendability(db, [{ kind: 'vow', refId: vowId }])).toEqual([
      { kind: 'vow', refId: vowId, ok: true },
    ]);
  });

  it('אירוע כבוי אינו חוסם – הגבאי לחץ בכוונה', () => {
    // זה ההבדל מ-buildNotification הרגיל: השליחה מהשורה היא `force`.
    const vowId = newVow();
    expect(notifySendability(db, [{ kind: 'vow', refId: vowId }])[0]?.ok).toBe(true);
  });

  it('חבר בלי נייד – חסום, עם הסבר', () => {
    const noPhone = createMember(db, { firstName: 'משה', lastName: 'כהן' }, userId).id;
    const vowId = createVow(
      db,
      { memberId: noPhone, chargeDate: '2026-09-06', occasionId, amountAgorot: 10000 },
      userId,
    );
    const [state] = notifySendability(db, [{ kind: 'vow', refId: vowId }]);
    expect(state?.ok).toBe(false);
    expect(state?.message).toContain('נייד');
  });

  it('נייד פסול – מוחזר גם קוד הסיבה, לניסוח מדויק במסך', () => {
    // "מספר קווי" אומר לגבאי מה לתקן; "אין נייד תקין" אינו אומר דבר.
    const landline = createMember(
      db,
      { firstName: 'דוד', lastName: 'לוי', mobile: '02-6543210' },
      userId,
    ).id;
    backfillMobileE164(db);
    const vowId = createVow(
      db,
      { memberId: landline, chargeDate: '2026-09-06', occasionId, amountAgorot: 10000 },
      userId,
    );
    const [state] = notifySendability(db, [{ kind: 'vow', refId: vowId }]);
    expect(state?.ok).toBe(false);
    expect(state?.mobileReason).toBe('landline');
  });

  it('תרומה בלי חבר משויך – חסומה', () => {
    const { donationId } = createDonation(
      db,
      {
        donationDate: '2026-09-06',
        donorName: 'אורח',
        donationTypeId,
        paymentMethodId: cashMethodId,
        amountAgorot: 5000,
      },
      userId,
      { issueReceipt: false },
    );
    const [state] = notifySendability(db, [{ kind: 'donation', refId: donationId }]);
    expect(state?.ok).toBe(false);
    expect(state?.message).toContain('חבר');
  });

  it('אין תבנית פעילה – חסום', () => {
    db.prepare("UPDATE message_template SET is_active = 0 WHERE event_kind = 'vow'").run();
    const [state] = notifySendability(db, [{ kind: 'vow', refId: newVow() }]);
    expect(state?.ok).toBe(false);
    expect(state?.message).toContain('תבנית');
  });

  it('רשומה שאינה קיימת – חסומה ולא זורקת', () => {
    expect(notifySendability(db, [{ kind: 'vow', refId: 99999 }])[0]?.ok).toBe(false);
  });

  it('רשימה מעורבת נענית בשאילתה אחת, בסדר שנשלח', () => {
    const noPhone = createMember(db, { firstName: 'משה', lastName: 'כהן' }, userId).id;
    const bad = createVow(
      db,
      { memberId: noPhone, chargeDate: '2026-09-06', occasionId, amountAgorot: 10000 },
      userId,
    );
    const good = newVow();
    const out = notifySendability(db, [
      { kind: 'vow', refId: bad },
      { kind: 'vow', refId: good },
    ]);
    expect(out.map((s) => s.ok)).toEqual([false, true]);
    expect(out.map((s) => s.refId)).toEqual([bad, good]);
  });
});
