import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { MESSAGE_TEMPLATES } from '../db/seed-data';
import { createMember, updateMember } from './members';
import { setSetting } from './settings';
import { backfillMobileE164, mobileStatusBreakdown } from './mobileBackfill';
import {
  buildCampaignContext,
  listTemplates,
  membersForMessaging,
  removeTemplate,
  renderForMember,
  saveTemplate,
} from './templates';
import {
  createCampaign,
  getCampaign,
  getUnfinishedCampaign,
  listCampaigns,
  prepareCampaign,
} from './campaigns';
import { acceptWhatsAppConsent, whatsappModuleState } from './whatsappModule';

let dir: string;
let db: Database;
let userId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-wa-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  userId = systemUserId(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

const addMember = (firstName: string, lastName: string, mobile: string | null) =>
  createMember(db, { firstName, lastName, mobile }, userId);

describe('repository של חבר – אין מסלול כתיבה שעוקף את הנרמול (WB-11)', () => {
  it('createMember מחשב mobile_e164 ו-mobile_status', () => {
    const m = addMember('ישראל', 'ישראלי', '050-123-4567');
    const row = db
      .prepare('SELECT mobile, mobile_e164, mobile_status FROM member WHERE id = ?')
      .get(m.id) as { mobile: string; mobile_e164: string; mobile_status: string };
    // המספר כפי שהוזן נשמר כמו שהוא, והגזירה נוספת לצידו.
    expect(row.mobile).toBe('050-123-4567');
    expect(row.mobile_e164).toBe('972501234567');
    expect(row.mobile_status).toBe('valid');
  });

  it('חבר בלי נייד מקבל missing', () => {
    const m = addMember('שרה', 'כהן', null);
    const row = db
      .prepare('SELECT mobile_e164, mobile_status FROM member WHERE id = ?')
      .get(m.id) as { mobile_e164: string | null; mobile_status: string };
    expect(row.mobile_e164).toBeNull();
    expect(row.mobile_status).toBe('missing');
  });

  it('קווי נשמר כ-invalid עם סיבה', () => {
    const m = addMember('דוד', 'לוי', '02-6543210');
    const row = db
      .prepare('SELECT mobile_e164, mobile_status, mobile_reason FROM member WHERE id = ?')
      .get(m.id) as { mobile_e164: string | null; mobile_status: string; mobile_reason: string };
    expect(row.mobile_e164).toBeNull();
    expect(row.mobile_status).toBe('invalid');
    expect(row.mobile_reason).toBe('landline');
  });

  it('עדכון נייד מעדכן גם את הגזירה – לא נשאר המספר הישן', () => {
    const m = addMember('ישראל', 'ישראלי', '0501234567');
    updateMember(
      db,
      m.id,
      { firstName: 'ישראל', lastName: 'ישראלי', mobile: '0541112222' },
      userId,
    );
    const row = db.prepare('SELECT mobile_e164 FROM member WHERE id = ?').get(m.id) as {
      mobile_e164: string;
    };
    expect(row.mobile_e164).toBe('972541112222');
  });

  it('קידומת המדינה מההגדרות מכובדת', () => {
    setSetting(db, 'default_country_code', '44');
    const m = addMember('John', 'Smith', '0501234567');
    const row = db.prepare('SELECT mobile_e164 FROM member WHERE id = ?').get(m.id) as {
      mobile_e164: string;
    };
    expect(row.mobile_e164).toBe('44501234567');
  });
});

describe('backfill (WB-11)', () => {
  /** מדמה חבר שנוצר לפני מיגרציה 005: mobile מלא, הגזירה ריקה. */
  const legacyMember = (number: number, mobile: string) => {
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, mobile, created_at, updated_at)
       VALUES (?, 'חבר', 'ותיק', ?, '2026-01-01T00:00:00', '2026-01-01T00:00:00')`,
    ).run(number, mobile);
  };

  it('ממלא חברים קיימים ומדווח פילוח', () => {
    legacyMember(101, '0501234567');
    legacyMember(102, '02-6543210');
    legacyMember(103, '0541112222');

    const summary = backfillMobileE164(db, userId);
    expect(summary.processed).toBe(3);
    expect(summary.valid).toBe(2);
    expect(summary.invalid).toBe(1);

    const breakdown = mobileStatusBreakdown(db);
    expect(breakdown.valid).toBe(2);
    expect(breakdown.invalid).toBe(1);
  });

  it('אידמפוטנטי – הרצה שנייה לא נוגעת באיש', () => {
    legacyMember(101, '0501234567');
    expect(backfillMobileE164(db, userId).processed).toBe(1);
    expect(backfillMobileE164(db, userId).processed).toBe(0);
  });

  it('לא דורס את mobile המקורי', () => {
    legacyMember(101, '050-123-4567 של הבן');
    backfillMobileE164(db, userId);
    const row = db
      .prepare('SELECT mobile, mobile_e164 FROM member WHERE member_number = 101')
      .get() as {
      mobile: string;
      mobile_e164: string;
    };
    expect(row.mobile).toBe('050-123-4567 של הבן');
    expect(row.mobile_e164).toBe('972501234567');
  });

  it('רושם סיכום ביומן הביקורת רק כשנעשתה עבודה', () => {
    const auditCount = () =>
      (
        db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'backfill_mobile'").get() as {
          c: number;
        }
      ).c;
    legacyMember(101, '0501234567');
    backfillMobileE164(db, userId);
    expect(auditCount()).toBe(1);
    backfillMobileE164(db, userId);
    expect(auditCount()).toBe(1);
  });

  it('סופר מספרים כפולים', () => {
    legacyMember(101, '0501234567');
    legacyMember(102, '050-123-4567');
    const summary = backfillMobileE164(db, userId);
    expect(summary.duplicates).toBe(1);
  });
});

describe('תבניות (W-10..W-16)', () => {
  it('seed מזריע את שלוש התבניות', () => {
    const list = listTemplates(db);
    expect(list).toHaveLength(MESSAGE_TEMPLATES.length);
    expect(list.map((t) => t.name).sort()).toEqual(MESSAGE_TEMPLATES.map((t) => t.name).sort());
  });

  it('כל תבנית seed עוברת ולידציה ומרונדרת בלי שדות שנשארו', () => {
    const member = addMember('ישראל', 'ישראלי', '0501234567');
    for (const t of listTemplates(db)) {
      const out = renderForMember(db, t.body, member.id);
      expect(out, `התבנית "${t.name}" השאירה שדה לא מרונדר`).not.toContain('{{');
    }
  });

  it('שמירה דוחה שדה לא מוכר', () => {
    expect(() =>
      saveTemplate(db, { name: 'שגויה', body: 'שלום {{xyz}}' }, userId, 'admin'),
    ).toThrow(/xyz/);
  });

  it('שמירה דוחה גוף ריק ושם ריק', () => {
    expect(() => saveTemplate(db, { name: 'ריקה', body: '  ' }, userId, 'admin')).toThrow();
    expect(() => saveTemplate(db, { name: ' ', body: 'טקסט' }, userId, 'admin')).toThrow();
  });

  it('ניהול תבניות מותר למנהל בלבד (WB-10)', () => {
    expect(() => saveTemplate(db, { name: 'חדשה', body: 'שלום' }, userId, 'clerk')).toThrow(/מנהל/);
  });

  it('מחיקה היא לוגית – קמפיין ישן לא נשאר בלי תבנית', () => {
    const t = saveTemplate(db, { name: 'זמנית', body: 'שלום' }, userId, 'admin');
    removeTemplate(db, t.id, userId, 'admin');
    expect(listTemplates(db).some((x) => x.id === t.id)).toBe(false);
    const row = db.prepare('SELECT deleted_at FROM message_template WHERE id = ?').get(t.id) as {
      deleted_at: string | null;
    };
    expect(row.deleted_at).not.toBeNull();
  });

  it('הקשר הקמפיין מביא שם פרשה בעברית ולא מזהה של hebcal', () => {
    setSetting(db, 'synagogue_name', 'בית הכנסת');
    const ctx = buildCampaignContext(db, '2026-09-06');
    expect(ctx.synagogueName).toBe('בית הכנסת');
    expect(ctx.hebrewYear).toContain('תשפ');
    // שם הפרשה עברי, לא 'Nitzavim'
    expect(ctx.parasha).not.toMatch(/[a-zA-Z]/);
  });
});

describe('הכנת קמפיין (W-30, W-23, W-24)', () => {
  it('מרנדר לכל נמען את היתרה שלו', () => {
    const a = addMember('אברהם', 'א', '0521111111');
    const b = addMember('בנימין', 'ב', '0522222222');
    db.prepare('UPDATE member SET opening_balance_agorot = 10000 WHERE id = ?').run(a.id);
    db.prepare('UPDATE member SET opening_balance_agorot = 25000 WHERE id = ?').run(b.id);

    const prepared = prepareCampaign(db, {
      memberIds: [a.id, b.id],
      body: '{{first_name}}: {{balance}}',
    });
    expect(prepared.items).toHaveLength(2);
    expect(prepared.items[0]!.renderedText).toContain('אברהם');
    expect(prepared.items[0]!.renderedText).toContain('100');
    expect(prepared.items[1]!.renderedText).toContain('250');
  });

  it('חבר בלי מספר תקין מסומן skipped ואינו חוסם את הקמפיין (W-23)', () => {
    const ok = addMember('תקין', 'א', '0521111111');
    const none = addMember('בלי', 'נייד', null);
    const landline = addMember('קווי', 'ב', '02-6543210');

    const prepared = prepareCampaign(db, {
      memberIds: [ok.id, none.id, landline.id],
      body: 'שלום {{first_name}}',
    });
    expect(prepared.sendableCount).toBe(1);
    expect(prepared.skippedCount).toBe(2);
    expect(prepared.items.find((i) => i.memberId === none.id)!.mobileStatus).toBe('missing');
    expect(prepared.items.find((i) => i.memberId === landline.id)!.mobileReason).toBe('landline');
  });

  it('שני חברים עם אותו מספר מזוהים ככפילות (W-24)', () => {
    const a = addMember('ראובן', 'לוי', '0507654321');
    const b = addMember('שמעון', 'לוי', '0507654321');
    const prepared = prepareCampaign(db, {
      memberIds: [a.id, b.id],
      body: 'שלום',
    });
    expect(prepared.duplicates).toHaveLength(1);
    expect(prepared.duplicates[0]!.members.map((m) => m.fullName).sort()).toEqual([
      'ראובן לוי',
      'שמעון לוי',
    ]);
  });

  it('סדר הבחירה של הגבאי נשמר', () => {
    const a = addMember('אחד', 'א', '0521111111');
    const b = addMember('שתיים', 'ב', '0522222222');
    const c = addMember('שלוש', 'ג', '0523333333');
    const prepared = prepareCampaign(db, {
      memberIds: [c.id, a.id, b.id],
      body: '{{first_name}}',
    });
    expect(prepared.items.map((i) => i.renderedText)).toEqual(['שלוש', 'אחד', 'שתיים']);
  });

  it('שם ברירת מחדל נגזר מהתבנית ומהתאריך', () => {
    const t = saveTemplate(db, { name: 'תזכורת', body: 'שלום' }, userId, 'admin');
    const m = addMember('א', 'ב', '0521111111');
    const prepared = prepareCampaign(db, {
      memberIds: [m.id],
      body: 'שלום',
      templateId: t.id,
    });
    expect(prepared.name).toContain('תזכורת');
  });
});

describe('שמירת קמפיין (W-37)', () => {
  const twoMembers = () => [
    addMember('אחד', 'א', '0521111111').id,
    addMember('שתיים', 'ב', null).id,
  ];

  it('שומר קמפיין ופריטים בטרנזקציה אחת', () => {
    const ids = twoMembers();
    const prepared = prepareCampaign(db, { memberIds: ids, body: 'שלום {{first_name}}' });
    const campaignId = createCampaign(db, prepared, userId);

    const detail = getCampaign(db, campaignId)!;
    expect(detail.status).toBe('draft');
    expect(detail.totalCount).toBe(2);
    expect(detail.skippedCount).toBe(1);
    expect(detail.items).toHaveLength(2);
    expect(detail.items[0]!.status).toBe('pending');
    expect(detail.items[1]!.status).toBe('skipped');
  });

  it('שומר את גוף התבנית כפי שהיה בזמן היצירה', () => {
    const t = saveTemplate(db, { name: 'מקורית', body: 'גרסה א' }, userId, 'admin');
    const m = addMember('א', 'ב', '0521111111');
    const prepared = prepareCampaign(db, { memberIds: [m.id], body: t.body, templateId: t.id });
    const id = createCampaign(db, prepared, userId);

    saveTemplate(db, { id: t.id, name: 'מקורית', body: 'גרסה ב' }, userId, 'admin');
    // הקמפיין ממשיך להציג את מה שנשלח בפועל, לא את התבנית המעודכנת.
    expect(getCampaign(db, id)!.body).toBe('גרסה א');
  });

  it('קמפיין בלי נמענים נדחה', () => {
    const prepared = prepareCampaign(db, { memberIds: [], body: 'שלום' });
    expect(() => createCampaign(db, prepared, userId)).toThrow(/נמענים/);
  });

  it('נרשם ביומן הביקורת', () => {
    const prepared = prepareCampaign(db, { memberIds: twoMembers(), body: 'שלום' });
    createCampaign(db, prepared, userId);
    const rows = db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE entity = 'message_campaign'")
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('list ו-getUnfinished', () => {
    const prepared = prepareCampaign(db, { memberIds: twoMembers(), body: 'שלום' });
    const id = createCampaign(db, prepared, userId);
    expect(listCampaigns(db)).toHaveLength(1);

    // draft אינו "לא הסתיים" – רק running/paused (W-47).
    expect(getUnfinishedCampaign(db)).toBeNull();
    db.prepare("UPDATE message_campaign SET status = 'paused' WHERE id = ?").run(id);
    expect(getUnfinishedCampaign(db)?.id).toBe(id);
  });
});

describe('מודול וואטסאפ (W-53, W-54)', () => {
  it('כבוי כברירת מחדל וללא אישור', () => {
    const state = whatsappModuleState(db);
    expect(state.enabled).toBe(false);
    expect(state.consentAcceptedAt).toBeNull();
    expect(state.sentToday).toBe(0);
  });

  it('אישור ההסכמה מדליק את המודול ונרשם ביומן', () => {
    const state = acceptWhatsAppConsent(db, userId, 'admin');
    expect(state.enabled).toBe(true);
    expect(state.consentAcceptedAt).not.toBeNull();
    const rows = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity = 'setting'").get() as {
      c: number;
    };
    expect(rows.c).toBeGreaterThan(0);
  });

  it('אישור מותר למנהל בלבד', () => {
    expect(() => acceptWhatsAppConsent(db, userId, 'clerk')).toThrow(/מנהל/);
  });

  it('ההגדרות נקראות מ-setting', () => {
    setSetting(db, 'whatsapp_daily_cap', '120');
    setSetting(db, 'whatsapp_min_delay_sec', '15');
    const state = whatsappModuleState(db);
    expect(state.dailyCap).toBe(120);
    expect(state.minDelaySec).toBe(15);
  });

  it('מונה יומי נקרא מהטבלה', () => {
    db.prepare(
      "INSERT INTO whatsapp_daily_counter (day, sent_count) VALUES (date('now','localtime'), 7)",
    ).run();
    expect(whatsappModuleState(db).sentToday).toBe(7);
  });
});

describe('membersForMessaging', () => {
  it('מחזיר רשימה ריקה בלי לפנות ל-DB כשאין מזהים', () => {
    expect(membersForMessaging(db, [])).toEqual([]);
  });

  it('מזהה שאינו קיים פשוט נעדר מהתוצאה', () => {
    const m = addMember('א', 'ב', '0521111111');
    expect(membersForMessaging(db, [m.id, 99999])).toHaveLength(1);
  });
});
