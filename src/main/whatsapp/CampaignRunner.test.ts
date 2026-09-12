import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { setSetting } from '../services/settings';
import type { MessageSenderPort } from '../services/sendMessage';
import type { SendOutcome } from './sendOutcome';
import { CampaignRunner, type RunnerProgress } from './CampaignRunner';

/**
 * W3 – מנוע הקמפיין מול DB אמיתי ושולח מדומה.
 *
 * השולח מדומה כי אין WhatsApp בבדיקה; ה-DB אמיתי כי כל הבאגים המעניינים
 * כאן הם מעברי מצב בטבלאות.
 */

let dir: string;
let db: Database;
let progress: RunnerProgress[];

/** שולח שמחזיר תוצאות לפי תסריט, ואחר כך מצליח. */
function scriptedSender(script: SendOutcome[]): MessageSenderPort & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    send: (request) => {
      calls.push(request.phoneE164);
      const outcome = script[index] ?? { ok: true };
      index += 1;
      return Promise.resolve(outcome);
    },
  };
}

function makeCampaign(memberCount: number): number {
  const ts = '2026-09-12T10:00:00';
  const info = db
    .prepare(
      `INSERT INTO message_campaign
         (name, template_body_snapshot, status, total_count, created_at, updated_at)
       VALUES ('בדיקה', 'שלום {שם}', 'draft', ?, ?, ?)`,
    )
    .run(memberCount, ts, ts);
  const campaignId = Number(info.lastInsertRowid);

  for (let i = 1; i <= memberCount; i++) {
    const member = db
      .prepare(
        `INSERT INTO member (member_number, first_name, last_name, mobile_e164, created_at, updated_at)
         VALUES (?, ?, 'ישראלי', ?, ?, ?)`,
      )
      .run(i, `חבר${i}`, `+9725000000${i}`, ts, ts);
    db.prepare(
      `INSERT INTO message_campaign_item
         (campaign_id, member_id, phone_e164, rendered_text, status, sort_order)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(campaignId, Number(member.lastInsertRowid), `+9725000000${i}`, `שלום חבר${i}`, i);
  }
  return campaignId;
}

function makeRunner(
  campaignId: number,
  sender: MessageSenderPort,
  overrides: { isConnected?: () => boolean } = {},
): CampaignRunner {
  return new CampaignRunner(campaignId, {
    db,
    sender,
    isConnected: overrides.isConnected ?? (() => true),
    userId: 1,
    onProgress: (p) => progress.push(p),
    // ההמתנות מדומות: בדיקה שממתינה 14 שניות אמיתיות אינה בדיקה.
    sleep: () => Promise.resolve(),
    random: () => 0,
  });
}

const itemStatuses = (campaignId: number): string[] =>
  (
    db
      .prepare(
        `SELECT status FROM message_campaign_item WHERE campaign_id = ? ORDER BY sort_order`,
      )
      .all(campaignId) as Array<{ status: string }>
  ).map((r) => r.status);

const campaignStatus = (campaignId: number): string =>
  (db.prepare('SELECT status FROM message_campaign WHERE id = ?').get(campaignId) as {
    status: string;
  }).status;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-runner-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  setSetting(db, 'whatsapp_min_delay_sec', '1');
  setSetting(db, 'whatsapp_max_delay_sec', '1');
  progress = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ריצה מלאה', () => {
  it('חמישה חברים – כולם נשלחים והקמפיין מסתיים', async () => {
    const id = makeCampaign(5);
    const sender = scriptedSender([]);

    const final = await makeRunner(id, sender).run();

    expect(sender.calls).toHaveLength(5);
    expect(itemStatuses(id)).toEqual(['sent', 'sent', 'sent', 'sent', 'sent']);
    expect(campaignStatus(id)).toBe('completed');
    expect(final.phase).toBe('completed');
    expect(final.sent).toBe(5);
    expect(final.pending).toBe(0);
  });

  it('השליחה בסדר sort_order', async () => {
    const id = makeCampaign(3);
    const sender = scriptedSender([]);
    await makeRunner(id, sender).run();
    expect(sender.calls).toEqual(['+97250000001', '+97250000002', '+97250000003']);
  });

  it('הקמפיין מסומן running בזמן הריצה ו-completed בסוף', async () => {
    const id = makeCampaign(2);
    await makeRunner(id, scriptedSender([])).run();
    expect(progress.some((p) => p.phase === 'running')).toBe(true);
    expect(progress.at(-1)?.phase).toBe('completed');
  });

  it('קמפיין בלי פריטים ממתינים מסתיים מיד', async () => {
    const id = makeCampaign(0);
    const final = await makeRunner(id, scriptedSender([])).run();
    expect(final.phase).toBe('completed');
  });
});

describe('כשלים', () => {
  const failure = (): SendOutcome => ({
    ok: false,
    errorCode: 'timeout',
    errorMessage: 'לא נמצאה תיבת כתיבה',
  });

  it('שלושה כשלים רצופים עוצרים את הקמפיין', async () => {
    const id = makeCampaign(5);
    const final = await makeRunner(id, scriptedSender([failure(), failure(), failure()])).run();

    expect(final.stopReason).toBe('consecutive_failures');
    expect(campaignStatus(id)).toBe('paused');
    // שני הפריטים האחרונים לא נשלחו כלל.
    expect(itemStatuses(id).filter((s) => s === 'pending')).toHaveLength(2);
  });

  it('כשל בודד אינו עוצר, והרצף מתאפס אחרי הצלחה', async () => {
    const id = makeCampaign(5);
    // כשל, הצלחה, כשל, כשל – הרצף לא מגיע ל-3.
    const script = [failure(), { ok: true } as SendOutcome, failure(), failure()];
    const final = await makeRunner(id, scriptedSender(script)).run();

    expect(final.phase).toBe('completed');
    expect(itemStatuses(id)).toEqual(['failed', 'sent', 'failed', 'failed', 'sent']);
  });

  it('מספר שאינו בוואטסאפ אינו נספר ברצף הכשלים', async () => {
    // שלושה כאלה ברצף אינם תקלה במנגנון, והקמפיין ממשיך.
    const id = makeCampaign(4);
    const notOnWa: SendOutcome = {
      ok: false,
      errorCode: 'not_on_whatsapp',
      errorMessage: 'המספר אינו בוואטסאפ',
    };
    const final = await makeRunner(id, scriptedSender([notOnWa, notOnWa, notOnWa])).run();

    expect(final.phase).toBe('completed');
    expect(itemStatuses(id)).toEqual(['failed', 'failed', 'failed', 'sent']);
  });

  it('הסף נלקח מההגדרה', async () => {
    setSetting(db, 'whatsapp_stop_after_consecutive_failures', '2');
    const id = makeCampaign(5);
    const final = await makeRunner(id, scriptedSender([failure(), failure()])).run();
    expect(final.stopReason).toBe('consecutive_failures');
    expect(itemStatuses(id).filter((s) => s === 'pending')).toHaveLength(3);
  });
});

describe('מכסה יומית (WB-07)', () => {
  it('המכסה עוצרת את הקמפיין', async () => {
    setSetting(db, 'whatsapp_daily_cap', '2');
    const id = makeCampaign(5);
    const final = await makeRunner(id, scriptedSender([])).run();

    expect(final.stopReason).toBe('daily_cap');
    expect(final.sent).toBe(2);
    expect(campaignStatus(id)).toBe('paused');
  });

  it('המכסה נשמרת בין הרצות', async () => {
    // זו הנקודה: מונה בזיכרון היה מתאפס והגבאי היה שולח 100 ביום.
    setSetting(db, 'whatsapp_daily_cap', '2');
    const id = makeCampaign(5);
    await makeRunner(id, scriptedSender([])).run();

    const second = await makeRunner(id, scriptedSender([])).run();
    expect(second.stopReason).toBe('daily_cap');
    expect(second.sent).toBe(2);
  });
});

describe('ניתוק (W-45)', () => {
  it('ניתוק באמצע מעביר ל-paused עם הודעה', async () => {
    const id = makeCampaign(5);
    let connected = true;
    const sender: MessageSenderPort = {
      send: () => {
        connected = false; // אחרי ההודעה הראשונה הטלפון מתנתק
        return Promise.resolve({ ok: true });
      },
    };

    const final = await makeRunner(id, sender, { isConnected: () => connected }).run();

    expect(final.stopReason).toBe('disconnected');
    expect(final.message).toContain('נותק');
    expect(campaignStatus(id)).toBe('paused');
  });

  it('אחרי חיבור מחדש אפשר להמשיך מאותה נקודה', async () => {
    const id = makeCampaign(4);
    let connected = true;
    let sent = 0;
    const sender: MessageSenderPort = {
      send: () => {
        sent += 1;
        if (sent === 2) connected = false;
        return Promise.resolve({ ok: true });
      },
    };
    await makeRunner(id, sender, { isConnected: () => connected }).run();
    expect(itemStatuses(id).filter((s) => s === 'sent')).toHaveLength(2);

    connected = true;
    const resumed = await makeRunner(id, scriptedSender([])).run();
    expect(resumed.phase).toBe('completed');
    expect(itemStatuses(id)).toEqual(['sent', 'sent', 'sent', 'sent']);
  });
});

describe('השהיה וביטול', () => {
  it('השהיה עוצרת אחרי ההודעה הנוכחית ולא באמצעה', async () => {
    const id = makeCampaign(5);
    const holder: { runner?: CampaignRunner } = {};
    const sender: MessageSenderPort = {
      send: () => {
        holder.runner!.pause();
        return Promise.resolve({ ok: true });
      },
    };
    holder.runner = makeRunner(id, sender);

    const final = await holder.runner.run();
    expect(final.stopReason).toBe('user_pause');
    expect(campaignStatus(id)).toBe('paused');
    // ההודעה שכבר יצאה נרשמה כ-sent; השאר נשארו ממתינים.
    expect(itemStatuses(id)).toEqual(['sent', 'pending', 'pending', 'pending', 'pending']);
  });

  it('המשך אחרי השהיה מסיים את הקמפיין', async () => {
    const id = makeCampaign(3);
    const holder: { runner?: CampaignRunner } = {};
    const pauser: MessageSenderPort = {
      send: () => {
        holder.runner!.pause();
        return Promise.resolve({ ok: true });
      },
    };
    holder.runner = makeRunner(id, pauser);
    await holder.runner.run();

    const final = await makeRunner(id, scriptedSender([])).run();
    expect(final.phase).toBe('completed');
    expect(itemStatuses(id)).toEqual(['sent', 'sent', 'sent']);
  });

  it('ביטול מסמן את היתר כמבוטלים ולא משאיר אותם ממתינים', async () => {
    // אחרת באנר "קמפיין שלא הסתיים" היה מציע להמשיך קמפיין שבוטל.
    const id = makeCampaign(5);
    const holder: { runner?: CampaignRunner } = {};
    const sender: MessageSenderPort = {
      send: () => {
        holder.runner!.cancel();
        return Promise.resolve({ ok: true });
      },
    };
    holder.runner = makeRunner(id, sender);

    const final = await holder.runner.run();
    expect(final.phase).toBe('cancelled');
    expect(campaignStatus(id)).toBe('cancelled');
    expect(itemStatuses(id)).toEqual(['sent', 'failed', 'failed', 'failed', 'failed']);

    const codes = db
      .prepare(
        `SELECT DISTINCT error_code FROM message_campaign_item
         WHERE campaign_id = ? AND status = 'failed'`,
      )
      .all(id) as Array<{ error_code: string }>;
    expect(codes).toEqual([{ error_code: 'cancelled' }]);
  });
});

describe('דיווח התקדמות (W-41, W-44)', () => {
  it('שורת הסטאטוס כוללת את שם החבר הנוכחי', async () => {
    const id = makeCampaign(2);
    await makeRunner(id, scriptedSender([])).run();
    expect(progress.some((p) => p.currentName === 'חבר1 ישראלי')).toBe(true);
  });

  it('ספירה לאחור מדווחת שנייה-שנייה', async () => {
    setSetting(db, 'whatsapp_min_delay_sec', '3');
    setSetting(db, 'whatsapp_max_delay_sec', '3');
    const id = makeCampaign(2);
    await makeRunner(id, scriptedSender([])).run();

    const counts = progress.filter((p) => p.waitSeconds > 0).map((p) => p.waitSeconds);
    expect(counts).toEqual([3, 2, 1]);
  });

  it('המונים בדיווח תואמים ל-DB', async () => {
    const id = makeCampaign(3);
    const final = await makeRunner(id, scriptedSender([])).run();
    expect(final).toMatchObject({ total: 3, sent: 3, failed: 0, pending: 0 });
  });
});

describe('יומן ביקורת', () => {
  it('כל מעבר מצב נרשם', async () => {
    const id = makeCampaign(2);
    await makeRunner(id, scriptedSender([])).run();

    const rows = db
      .prepare(
        `SELECT after_json FROM audit_log WHERE entity = 'message_campaign' AND entity_id = ?`,
      )
      .all(id) as Array<{ after_json: string }>;
    const events = rows.map((r) => (JSON.parse(r.after_json) as { event: string }).event);
    expect(events).toContain('start');
    expect(events).toContain('complete');
  });
});
