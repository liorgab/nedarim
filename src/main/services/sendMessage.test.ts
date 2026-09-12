import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { createMember } from './members';
import { setSetting } from './settings';
import { createCampaign, getCampaign, prepareCampaign } from './campaigns';
import { capStatus, recordSent, sentToday } from './dailyCounter';
import {
  firstPendingItem,
  reconcileStuckSending,
  sendCampaignItem,
  type MessageSenderPort,
} from './sendMessage';
import type { SendOutcome } from '../whatsapp/sendOutcome';

/**
 * כל מעברי המצב של שליחה, עם שולח מדומה. אין כאן Electron, אין WhatsApp,
 * ואין המתנות – בדיוק כפי שהאיפיון דורש מ-`CampaignRunner` (W3), ואותה
 * תשתית תשמש אותו.
 */

let dir: string;
let db: Database;
let userId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-send-'));
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

/** שולח מדומה שמחזיר תוצאה קבועה ומתעד את מה שנשלח אליו. */
function stubSender(outcome: SendOutcome): MessageSenderPort & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    send: (request) => {
      calls.push(request);
      return Promise.resolve(outcome);
    },
  };
}

const OK: SendOutcome = { ok: true };
const FAILED: SendOutcome = {
  ok: false,
  errorCode: 'not_on_whatsapp',
  errorMessage: 'המספר אינו רשום ב-WhatsApp',
};

/** בונה קמפיין עם חבר יחיד ומחזיר את מזהה הפריט. */
function oneItemCampaign(mobile: string | null = '0521111111'): number {
  const member = createMember(db, { firstName: 'ישראל', lastName: 'ישראלי', mobile }, userId);
  const prepared = prepareCampaign(db, {
    memberIds: [member.id],
    body: 'שלום {{first_name}}',
  });
  const campaignId = createCampaign(db, prepared, userId);
  const itemId = firstPendingItem(db, campaignId);
  return itemId ?? -1;
}

const itemStatus = (itemId: number) =>
  db.prepare('SELECT * FROM message_campaign_item WHERE id = ?').get(itemId) as {
    status: string;
    error_code: string | null;
    error_message: string | null;
    attempts: number;
    sent_at: string | null;
  };

describe('שליחה מוצלחת', () => {
  it('הפריט הופך ל-sent עם חותמת זמן', () => {
    const itemId = oneItemCampaign();
    return sendCampaignItem(db, itemId, stubSender(OK), userId).then(() => {
      const row = itemStatus(itemId);
      expect(row.status).toBe('sent');
      expect(row.sent_at).not.toBeNull();
      expect(row.error_code).toBeNull();
      expect(row.attempts).toBe(1);
    });
  });

  it('הטקסט המרונדר והמספר המנורמל הם מה שנשלח בפועל', async () => {
    const itemId = oneItemCampaign('052-111-1111');
    const sender = stubSender(OK);
    await sendCampaignItem(db, itemId, sender, userId);
    expect(sender.calls[0]).toEqual({
      phoneE164: '972521111111',
      text: 'שלום ישראל',
    });
  });

  it('המונה היומי עולה באחד', async () => {
    const itemId = oneItemCampaign();
    expect(sentToday(db)).toBe(0);
    await sendCampaignItem(db, itemId, stubSender(OK), userId);
    expect(sentToday(db)).toBe(1);
  });

  it('מוני הקמפיין מתעדכנים', async () => {
    const itemId = oneItemCampaign();
    const campaignId = (
      db.prepare('SELECT campaign_id c FROM message_campaign_item WHERE id = ?').get(itemId) as {
        c: number;
      }
    ).c;
    await sendCampaignItem(db, itemId, stubSender(OK), userId);
    expect(getCampaign(db, campaignId)!.sentCount).toBe(1);
  });

  it('נרשם ביומן הביקורת', async () => {
    const itemId = oneItemCampaign();
    await sendCampaignItem(db, itemId, stubSender(OK), userId);
    const n = (
      db
        .prepare("SELECT COUNT(*) c FROM audit_log WHERE entity = 'message_campaign_item'")
        .get() as { c: number }
    ).c;
    expect(n).toBe(1);
  });
});

describe('שליחה שנכשלה', () => {
  it('הפריט failed עם קוד וסיבה בעברית', async () => {
    const itemId = oneItemCampaign();
    await sendCampaignItem(db, itemId, stubSender(FAILED), userId);
    const row = itemStatus(itemId);
    expect(row.status).toBe('failed');
    expect(row.error_code).toBe('not_on_whatsapp');
    expect(row.error_message).toMatch(/[֐-׿]/);
  });

  it('כישלון אינו גוזל מהמכסה היומית', async () => {
    const itemId = oneItemCampaign();
    await sendCampaignItem(db, itemId, stubSender(FAILED), userId);
    expect(sentToday(db)).toBe(0);
  });

  it('מונה הניסיונות עולה גם בכישלון', async () => {
    const itemId = oneItemCampaign();
    await sendCampaignItem(db, itemId, stubSender(FAILED), userId);
    expect(itemStatus(itemId).attempts).toBe(1);
  });

  it('ניסיון חוזר מגדיל את המונה ומצליח', async () => {
    const itemId = oneItemCampaign();
    await sendCampaignItem(db, itemId, stubSender(FAILED), userId);
    await sendCampaignItem(db, itemId, stubSender(OK), userId);
    const row = itemStatus(itemId);
    expect(row.status).toBe('sent');
    expect(row.attempts).toBe(2);
    expect(row.error_code).toBeNull();
  });
});

describe('הגנות לפני השליחה', () => {
  it('פריט בלי מספר נכשל בלי לפנות לשולח בכלל', async () => {
    // חבר בלי נייד מסומן `skipped` בהכנה, אבל אם הגיע לכאן – לא שולחים.
    const member = createMember(db, { firstName: 'בלי', lastName: 'נייד' }, userId);
    const prepared = prepareCampaign(db, { memberIds: [member.id], body: 'שלום' });
    const campaignId = createCampaign(db, prepared, userId);
    const itemId = (
      db.prepare('SELECT id FROM message_campaign_item WHERE campaign_id = ?').get(campaignId) as {
        id: number;
      }
    ).id;

    const sender = stubSender(OK);
    const result = await sendCampaignItem(db, itemId, sender, userId);
    expect(sender.calls).toHaveLength(0);
    expect(result.outcome.ok).toBe(false);
    expect(itemStatus(itemId).error_code).toBe('invalid_number');
  });

  it('מכסה שמוצתה עוצרת לפני השליחה', async () => {
    setSetting(db, 'whatsapp_daily_cap', '2');
    recordSent(db);
    recordSent(db);

    const itemId = oneItemCampaign();
    const sender = stubSender(OK);
    const result = await sendCampaignItem(db, itemId, sender, userId);

    expect(sender.calls).toHaveLength(0);
    expect(result.outcome.ok).toBe(false);
    expect(itemStatus(itemId).error_code).toBe('daily_cap');
  });

  it('הפריט מסומן sending לפני השליחה (WB-08)', async () => {
    const itemId = oneItemCampaign();
    let statusDuringSend = '';
    const sender: MessageSenderPort = {
      send: () => {
        statusDuringSend = itemStatus(itemId).status;
        return Promise.resolve(OK);
      },
    };
    await sendCampaignItem(db, itemId, sender, userId);
    // אם הפריט לא היה `sending` בזמן השליחה, קריסה באמצע הייתה משאירה
    // אותו `pending` – והוא היה נשלח שוב.
    expect(statusDuringSend).toBe('sending');
  });
});

describe('שחזור אחרי קריסה (W-47)', () => {
  it('פריט שנשאר sending הופך ל-unknown ולא ל-pending', async () => {
    const itemId = oneItemCampaign();
    db.prepare("UPDATE message_campaign_item SET status = 'sending' WHERE id = ?").run(itemId);

    expect(reconcileStuckSending(db)).toBe(1);
    const row = itemStatus(itemId);
    // `pending` היה גורם לשליחה חוזרת אוטומטית לאותו אדם.
    expect(row.status).toBe('unknown');
    expect(row.error_message).toMatch(/[֐-׿]/);
  });

  it('פריטים אחרים אינם מושפעים', () => {
    const itemId = oneItemCampaign();
    expect(reconcileStuckSending(db)).toBe(0);
    expect(itemStatus(itemId).status).toBe('pending');
  });
});

describe('מכסה יומית (WB-07)', () => {
  it('ברירת מחדל 50', () => {
    expect(capStatus(db).cap).toBe(50);
    expect(capStatus(db).remaining).toBe(50);
  });

  it('המונה נשמר ב-DB ולכן שורד הפעלה מחדש', () => {
    recordSent(db);
    recordSent(db);
    const path = db.name;
    db.close();
    // פתיחה מחדש = הפעלה מחדש של היישום.
    db = openDatabase({ file: path });
    expect(sentToday(db)).toBe(2);
  });

  it('היום נספר לפי השעון המקומי', () => {
    // מונה לפי UTC היה מתאפס בשלוש לפנות בוקר במקום בחצות.
    recordSent(db, '2026-09-08');
    expect(sentToday(db, '2026-09-08')).toBe(1);
    expect(sentToday(db, '2026-09-09')).toBe(0);
  });

  it('reached נכון בדיוק בגבול', () => {
    setSetting(db, 'whatsapp_daily_cap', '3');
    recordSent(db);
    recordSent(db);
    expect(capStatus(db).reached).toBe(false);
    recordSent(db);
    expect(capStatus(db).reached).toBe(true);
    expect(capStatus(db).remaining).toBe(0);
  });

  it('מכסה לא חוקית חוזרת לברירת המחדל במקום לאפס שליחה', () => {
    setSetting(db, 'whatsapp_daily_cap', 'שלוש');
    expect(capStatus(db).cap).toBe(50);
  });
});
