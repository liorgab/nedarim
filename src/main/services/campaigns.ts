import type { Database } from 'better-sqlite3';
import { nowIso, todayIso } from '@shared/datetime';
import { writeAudit } from './audit';
import { renderTemplate } from '../whatsapp/TemplateRenderer';
import { buildCampaignContext, membersForMessaging } from './templates';

/**
 * W-30..W-38 – הכנת קמפיין ושמירתו.
 *
 * ב-W0 יש כאן רק את מה שאינו נוגע ל-WhatsApp: חישוב הנמענים, רינדור ההודעות
 * ושמירה. ההרצה עצמה (`start/pause/resume/cancel`) נוספת ב-W3.
 */

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export type CampaignItemStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown';

export interface PreparedItem {
  memberId: number;
  memberNumber: number;
  fullName: string;
  mobile: string | null;
  phoneE164: string | null;
  mobileStatus: 'valid' | 'invalid' | 'missing';
  mobileReason: string | null;
  balanceAgorot: number;
  renderedText: string;
  /** `skipped` כבר בשלב ההכנה כשאין מספר תקין (W-23). */
  status: Extract<CampaignItemStatus, 'pending' | 'skipped'>;
}

export interface DuplicateWarning {
  phoneE164: string;
  members: Array<{ memberId: number; memberNumber: number; fullName: string }>;
}

export interface PreparedCampaign {
  name: string;
  body: string;
  templateId: number | null;
  items: PreparedItem[];
  /** מונים לתצוגה באשף – נספרים מהפריטים, לא מהקלט. */
  sendableCount: number;
  skippedCount: number;
  /** W-24 – מספרים שמופיעים אצל יותר מחבר אחד. */
  duplicates: DuplicateWarning[];
}

export interface PrepareInput {
  memberIds: number[];
  body: string;
  name?: string;
  templateId?: number | null;
}

/**
 * W-30/W-31 – מרנדר את ההודעות ומסמן מי ניתן לשליחה. **אינו שומר דבר**:
 * הגבאי עדיין באשף ויכול לחזור אחורה או לסגור.
 */
export function prepareCampaign(db: Database, input: PrepareInput): PreparedCampaign {
  const context = buildCampaignContext(db);
  const members = membersForMessaging(db, input.memberIds);

  const items: PreparedItem[] = members.map((m) => ({
    memberId: m.id,
    memberNumber: m.memberNumber,
    fullName: `${m.firstName} ${m.lastName}`.trim(),
    mobile: m.mobile,
    phoneE164: m.mobileE164,
    mobileStatus: m.mobileStatus,
    mobileReason: m.mobileReason,
    balanceAgorot: m.balanceAgorot,
    renderedText: renderTemplate(input.body, m, context),
    status: m.mobileStatus === 'valid' && m.mobileE164 !== null ? 'pending' : 'skipped',
  }));

  // W-24: כפילות נבדקת בתוך הקמפיין הזה, לא בכל טבלת החברים – שני חברים
  // עם אותו מספר מזיקים רק כשהם באותה שליחה.
  const byPhone = new Map<string, PreparedItem[]>();
  for (const item of items) {
    if (item.phoneE164 === null) continue;
    const list = byPhone.get(item.phoneE164) ?? [];
    list.push(item);
    byPhone.set(item.phoneE164, list);
  }
  const duplicates: DuplicateWarning[] = [...byPhone.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([phoneE164, list]) => ({
      phoneE164,
      members: list.map((i) => ({
        memberId: i.memberId,
        memberNumber: i.memberNumber,
        fullName: i.fullName,
      })),
    }));

  return {
    name: (input.name ?? '').trim() || defaultCampaignName(db, input.templateId ?? null),
    body: input.body,
    templateId: input.templateId ?? null,
    items,
    sendableCount: items.filter((i) => i.status === 'pending').length,
    skippedCount: items.filter((i) => i.status === 'skipped').length,
    duplicates,
  };
}

function defaultCampaignName(db: Database, templateId: number | null): string {
  const date = todayIso().split('-').reverse().join('/');
  if (templateId === null) return `הודעה – ${date}`;
  const row = db.prepare('SELECT name FROM message_template WHERE id = ?').get(templateId) as
    { name: string } | undefined;
  return row ? `${row.name} – ${date}` : `הודעה – ${date}`;
}

/**
 * W-37 – שומר את הקמפיין ואת כל הפריטים **בטרנזקציה אחת**, לפני שנשלחה
 * הודעה אחת. קמפיין חצי-שמור הוא קמפיין שאי אפשר להמשיך אחרי קריסה.
 */
/** W-86 – האירוע הכספי שיצר את הקמפיין. `null` = קמפיין יזום של הגבאי. */
export interface CampaignTrigger {
  kind: string;
  /** `entity:id` – ראו מיגרציה 007. */
  ref: string;
}

export function createCampaign(
  db: Database,
  prepared: PreparedCampaign,
  userId: number,
  trigger: CampaignTrigger | null = null,
): number {
  if (prepared.items.length === 0) throw new Error('אין נמענים בקמפיין');

  const ts = nowIso();
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO message_campaign
           (name, template_id, template_body_snapshot, status,
            total_count, sent_count, failed_count, skipped_count,
            trigger_kind, trigger_ref, created_at, updated_at, created_by)
         VALUES (?, ?, ?, 'draft', ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        prepared.name,
        prepared.templateId,
        prepared.body,
        prepared.items.length,
        prepared.skippedCount,
        trigger?.kind ?? null,
        trigger?.ref ?? null,
        ts,
        ts,
        userId,
      );
    const campaignId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO message_campaign_item
         (campaign_id, member_id, phone_e164, rendered_text, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    prepared.items.forEach((item, index) => {
      insertItem.run(
        campaignId,
        item.memberId,
        item.phoneE164,
        item.renderedText,
        item.status,
        index,
      );
    });

    writeAudit(db, {
      userId,
      entity: 'message_campaign',
      entityId: campaignId,
      action: 'create',
      after: {
        name: prepared.name,
        total: prepared.items.length,
        sendable: prepared.sendableCount,
        skipped: prepared.skippedCount,
      },
    });
    return campaignId;
  })();
}

export interface CampaignSummary {
  id: number;
  name: string;
  templateId: number | null;
  templateName: string | null;
  status: CampaignStatus;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

const SUMMARY_SQL = `
  SELECT c.id, c.name, c.template_id, t.name AS template_name, c.status,
         c.total_count, c.sent_count, c.failed_count, c.skipped_count,
         c.started_at, c.finished_at, c.created_at, u.display_name AS created_by_name
  FROM message_campaign c
  LEFT JOIN message_template t ON t.id = c.template_id
  LEFT JOIN user u ON u.id = c.created_by`;

interface SummaryRow {
  id: number;
  name: string;
  template_id: number | null;
  template_name: string | null;
  status: CampaignStatus;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  created_by_name: string | null;
}

const toSummary = (r: SummaryRow): CampaignSummary => ({
  id: r.id,
  name: r.name,
  templateId: r.template_id,
  templateName: r.template_name,
  status: r.status,
  totalCount: r.total_count,
  sentCount: r.sent_count,
  failedCount: r.failed_count,
  skippedCount: r.skipped_count,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  createdAt: r.created_at,
  createdByName: r.created_by_name,
});

export function listCampaigns(db: Database): CampaignSummary[] {
  return (db.prepare(`${SUMMARY_SQL} ORDER BY c.id DESC`).all() as SummaryRow[]).map(toSummary);
}

export interface CampaignItemDetail {
  id: number;
  memberId: number;
  memberNumber: number;
  fullName: string;
  phoneE164: string | null;
  renderedText: string;
  status: CampaignItemStatus;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  sentAt: string | null;
  sortOrder: number;
}

export interface CampaignDetail extends CampaignSummary {
  body: string;
  items: CampaignItemDetail[];
}

export function getCampaign(db: Database, id: number): CampaignDetail | null {
  const row = db.prepare(`${SUMMARY_SQL} WHERE c.id = ?`).get(id) as SummaryRow | undefined;
  if (!row) return null;

  const body = (
    db.prepare('SELECT template_body_snapshot b FROM message_campaign WHERE id = ?').get(id) as {
      b: string;
    }
  ).b;

  const items = (
    db
      .prepare(
        `SELECT i.id, i.member_id, m.member_number, m.first_name, m.last_name,
                i.phone_e164, i.rendered_text, i.status, i.error_code, i.error_message,
                i.attempts, i.sent_at, i.sort_order
         FROM message_campaign_item i JOIN member m ON m.id = i.member_id
         WHERE i.campaign_id = ? ORDER BY i.sort_order`,
      )
      .all(id) as Array<{
      id: number;
      member_id: number;
      member_number: number;
      first_name: string;
      last_name: string;
      phone_e164: string | null;
      rendered_text: string;
      status: CampaignItemStatus;
      error_code: string | null;
      error_message: string | null;
      attempts: number;
      sent_at: string | null;
      sort_order: number;
    }>
  ).map((i) => ({
    id: i.id,
    memberId: i.member_id,
    memberNumber: i.member_number,
    fullName: `${i.first_name} ${i.last_name}`.trim(),
    phoneE164: i.phone_e164,
    renderedText: i.rendered_text,
    status: i.status,
    errorCode: i.error_code,
    errorMessage: i.error_message,
    attempts: i.attempts,
    sentAt: i.sent_at,
    sortOrder: i.sort_order,
  }));

  return { ...toSummary(row), body, items };
}

/** W-47 – קמפיין שנקטע. משמש לבאנר בדשבורד. */
export function getUnfinishedCampaign(db: Database): CampaignSummary | null {
  const row = db
    .prepare(`${SUMMARY_SQL} WHERE c.status IN ('running','paused') ORDER BY c.id DESC LIMIT 1`)
    .get() as SummaryRow | undefined;
  return row ? toSummary(row) : null;
}
