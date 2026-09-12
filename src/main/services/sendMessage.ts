import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { writeAudit } from './audit';
import { capStatus, recordSent } from './dailyCounter';
import { errorText, type SendErrorCode, type SendOutcome } from '../whatsapp/sendOutcome';

/**
 * החיבור בין מנוע השליחה ל-DB (W-60..W-64).
 *
 * `MessageSender` יודע לדבר עם החלון; הקובץ הזה יודע מה זה אומר עבור פריט
 * הקמפיין. ההפרדה מאפשרת לבדוק את כל מעברי המצב עם שולח מדומה, בלי Electron.
 */

/** החוזה שמנוע הקמפיין (W3) יקבל כתלות – כך הוא נבדק בלי חלון. */
export interface MessageSenderPort {
  send(request: { phoneE164: string; text: string }): Promise<SendOutcome>;
}

export interface SendItemResult {
  itemId: number;
  outcome: SendOutcome;
}

interface ItemRow {
  id: number;
  campaign_id: number;
  member_id: number;
  phone_e164: string | null;
  rendered_text: string;
  status: string;
  attempts: number;
}

function loadItem(db: Database, itemId: number): ItemRow {
  const row = db
    .prepare(
      `SELECT id, campaign_id, member_id, phone_e164, rendered_text, status, attempts
       FROM message_campaign_item WHERE id = ?`,
    )
    .get(itemId) as ItemRow | undefined;
  if (!row) throw new Error('פריט הקמפיין לא נמצא');
  return row;
}

function markFailed(db: Database, itemId: number, code: SendErrorCode, message: string): void {
  db.prepare(
    `UPDATE message_campaign_item
     SET status = 'failed', error_code = ?, error_message = ? WHERE id = ?`,
  ).run(code, message, itemId);
  refreshCounters(db, itemId);
}

/** מסנכרן את המונים של הקמפיין מהפריטים – מקור אמת אחד. */
export function refreshCounters(db: Database, itemId: number): void {
  db.prepare(
    `UPDATE message_campaign SET
       sent_count = (SELECT COUNT(*) FROM message_campaign_item
                     WHERE campaign_id = message_campaign.id AND status = 'sent'),
       failed_count = (SELECT COUNT(*) FROM message_campaign_item
                       WHERE campaign_id = message_campaign.id AND status = 'failed'),
       skipped_count = (SELECT COUNT(*) FROM message_campaign_item
                        WHERE campaign_id = message_campaign.id AND status = 'skipped'),
       updated_at = ?
     WHERE id = (SELECT campaign_id FROM message_campaign_item WHERE id = ?)`,
  ).run(nowIso(), itemId);
}

/**
 * שולח פריט אחד ומעדכן את ה-DB לפי התוצאה.
 *
 * הסדר קריטי (WB-08): הפריט מסומן `sending` **לפני** השליחה, ורק אחרי
 * אימות הוא הופך ל-`sent`. קריסה באמצע משאירה `sending`, שמתורגם ל-`unknown`
 * בהפעלה הבאה – פריט שדורש החלטה ידנית ולא נשלח שוב אוטומטית. שליחה כפולה
 * גרועה מהודעה חסרה.
 */
export async function sendCampaignItem(
  db: Database,
  itemId: number,
  sender: MessageSenderPort,
  userId: number,
): Promise<SendItemResult> {
  const item = loadItem(db, itemId);

  if (item.phone_e164 === null || item.phone_e164.trim() === '') {
    markFailed(db, itemId, 'invalid_number', errorText('invalid_number'));
    return {
      itemId,
      outcome: {
        ok: false,
        errorCode: 'invalid_number',
        errorMessage: errorText('invalid_number'),
      },
    };
  }

  // WB-07 – בדיקת המכסה לפני השליחה, לא אחריה.
  const cap = capStatus(db);
  if (cap.reached) {
    markFailed(db, itemId, 'daily_cap', errorText('daily_cap'));
    return {
      itemId,
      outcome: { ok: false, errorCode: 'daily_cap', errorMessage: errorText('daily_cap') },
    };
  }

  db.prepare(
    `UPDATE message_campaign_item SET status = 'sending', attempts = attempts + 1 WHERE id = ?`,
  ).run(itemId);

  const outcome = await sender.send({
    phoneE164: item.phone_e164,
    text: item.rendered_text,
  });

  if (outcome.ok) {
    db.prepare(
      `UPDATE message_campaign_item SET status = 'sent', sent_at = ?, error_code = NULL,
         error_message = NULL WHERE id = ?`,
    ).run(nowIso(), itemId);
    // המונה עולה רק אחרי אימות: הודעה שנכשלה אינה גוזלת מהמכסה.
    recordSent(db);
    refreshCounters(db, itemId);
    writeAudit(db, {
      userId,
      entity: 'message_campaign_item',
      entityId: itemId,
      action: 'update',
      after: { status: 'sent', memberId: item.member_id },
    });
  } else {
    markFailed(db, itemId, outcome.errorCode, outcome.errorMessage);
    writeAudit(db, {
      userId,
      entity: 'message_campaign_item',
      entityId: itemId,
      action: 'update',
      after: { status: 'failed', errorCode: outcome.errorCode, memberId: item.member_id },
    });
  }

  return { itemId, outcome };
}

/**
 * W-47 – פריטים שנשארו `sending` מקריסה. הופכים ל-`unknown` ולא ל-`pending`:
 * ייתכן שההודעה כן יצאה, ושליחה חוזרת אוטומטית תגיע פעמיים לאותו אדם.
 */
export function reconcileStuckSending(db: Database): number {
  const info = db
    .prepare(
      `UPDATE message_campaign_item SET status = 'unknown',
         error_code = 'timeout',
         error_message = 'היישום נסגר באמצע השליחה – יש לבדוק ידנית אם ההודעה הגיעה'
       WHERE status = 'sending'`,
    )
    .run();
  return info.changes;
}

/**
 * W-22 – שליחה לחבר אחד, כקמפיין של פריט יחיד. זו גם הדרך המהירה ביותר
 * לבדוק את המנוע מקצה לקצה, וגם מה שהגבאי צריך כשהוא רוצה להזכיר לאדם אחד.
 */
export function firstPendingItem(db: Database, campaignId: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM message_campaign_item
       WHERE campaign_id = ? AND status = 'pending' ORDER BY sort_order LIMIT 1`,
    )
    .get(campaignId) as { id: number } | undefined;
  return row?.id ?? null;
}
