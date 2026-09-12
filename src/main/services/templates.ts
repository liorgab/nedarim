import type { Database } from 'better-sqlite3';
import type { UserRole } from '@shared/types';
import { nowIso, todayIso } from '@shared/datetime';
import { writeAudit } from './audit';
import { getSetting } from './settings';
import { hebrewInfo } from './hebrewCalendar';
import { findOccasionByHebcalKey } from './lookups';
import { parashaKeyForVowDate } from './hebrewCalendar';
import { openChargesFor } from './openCharges';
import type { NotifyEventKind } from '../whatsapp/notifyEvents';
import {
  TEMPLATE_FIELDS,
  renderTemplate,
  validateTemplate,
  type CampaignContext,
  type MemberContext,
  type TemplateValidation,
} from '../whatsapp/TemplateRenderer';

/**
 * W-10..W-16 – ניהול תבניות ההודעה, ובניית ההקשר שממנו הן מרונדרות.
 *
 * החלוקה מכוונת: `TemplateRenderer` טהור וניתן לבדיקה בלי DB, והקובץ הזה
 * הוא זה שיודע לשלוף חבר, פרשה והגדרות ולהרכיב מהם `MemberContext` +
 * `CampaignContext`.
 */

export interface MessageTemplate {
  id: number;
  name: string;
  body: string;
  isActive: boolean;
  /** W-81 – האירוע שהתבנית משמשת לו. `null` = תבנית חופשית. */
  eventKind: NotifyEventKind | null;
}

export interface MessageTemplateInput {
  id?: number;
  name: string;
  body: string;
  isActive?: boolean;
}

interface TemplateRow {
  id: number;
  name: string;
  body: string;
  is_active: number;
  event_kind: string | null;
}

const toTemplate = (r: TemplateRow): MessageTemplate => ({
  id: r.id,
  name: r.name,
  body: r.body,
  isActive: r.is_active === 1,
  eventKind: (r.event_kind as NotifyEventKind | null) ?? null,
});

/**
 * `free` – תבניות לקמפיינים ולשליחה ידנית.
 * `event` – תבנית לכל אירוע כספי (W-81).
 *
 * ברירת המחדל `free` בכוונה: אשף הקמפיין ובורר התבנית בשליחה בודדת אינם
 * אמורים להציע "נדר חדש", שבנויה סביב `{{amount}}` ותרונדר `—` ל-90 חברים.
 */
export type TemplateScope = 'free' | 'event' | 'all';

const SCOPE_SQL: Record<TemplateScope, string> = {
  free: 'AND event_kind IS NULL',
  event: 'AND event_kind IS NOT NULL',
  all: '',
};

export function listTemplates(
  db: Database,
  includeInactive = true,
  scope: TemplateScope = 'free',
): MessageTemplate[] {
  const where = includeInactive ? '' : 'AND is_active = 1';
  return (
    db
      .prepare(
        `SELECT id, name, body, is_active, event_kind FROM message_template
         WHERE deleted_at IS NULL ${where} ${SCOPE_SQL[scope]} ORDER BY name`,
      )
      .all() as TemplateRow[]
  ).map(toTemplate);
}

export function getTemplate(db: Database, id: number): MessageTemplate | null {
  const row = db
    .prepare('SELECT id, name, body, is_active, event_kind FROM message_template WHERE id = ?')
    .get(id) as TemplateRow | undefined;
  return row ? toTemplate(row) : null;
}

/** W-10 – הוספה או עריכה. `admin` בלבד (WB-10). */
export function saveTemplate(
  db: Database,
  input: MessageTemplateInput,
  userId: number,
  role: UserRole,
): MessageTemplate {
  if (role !== 'admin') throw new Error('ניהול תבניות מותר למנהל בלבד');

  const name = input.name.trim();
  if (name === '') throw new Error('שם התבנית הוא שדה חובה');

  const validation = validateTemplate(input.body);
  if (!validation.ok) throw new Error(validation.errors.join('; '));

  const ts = nowIso();
  const isActive = input.isActive === false ? 0 : 1;

  const id = db.transaction(() => {
    if (input.id !== undefined) {
      const before = getTemplate(db, input.id);
      if (!before) throw new Error('התבנית לא נמצאה');
      db.prepare(
        `UPDATE message_template SET name = ?, body = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      ).run(name, input.body, isActive, ts, input.id);
      writeAudit(db, {
        userId,
        entity: 'message_template',
        entityId: input.id,
        action: 'update',
        before: { name: before.name, body: before.body, isActive: before.isActive },
        after: { name, body: input.body, isActive: isActive === 1 },
      });
      return input.id;
    }

    const info = db
      .prepare(
        `INSERT INTO message_template (name, body, is_active, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, input.body, isActive, ts, ts, userId);
    const newId = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'message_template',
      entityId: newId,
      action: 'create',
      after: { name, body: input.body },
    });
    return newId;
  })();

  return getTemplate(db, id)!;
}

/**
 * מחיקה לוגית בלבד (CLAUDE.md כלל 6): קמפיינים ישנים מפנים לתבנית, ומחיקה
 * פיזית הייתה משאירה אותם בלי שם.
 */
export function removeTemplate(db: Database, id: number, userId: number, role: UserRole): void {
  if (role !== 'admin') throw new Error('ניהול תבניות מותר למנהל בלבד');
  const before = getTemplate(db, id);
  if (!before) throw new Error('התבנית לא נמצאה');

  db.transaction(() => {
    db.prepare('UPDATE message_template SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      nowIso(),
      id,
    );
    writeAudit(db, {
      userId,
      entity: 'message_template',
      entityId: id,
      action: 'delete',
      before: { name: before.name },
    });
  })();
}

/** W-12 – רשימת השדות לצ'יפים בעורך. */
export function templateFields(): readonly { key: string; label: string; example: string }[] {
  return TEMPLATE_FIELDS;
}

export function validateTemplateBody(body: string): TemplateValidation {
  return validateTemplate(body);
}

/**
 * ההקשר המשותף לכל הנמענים בקמפיין. מחושב **פעם אחת**: `hebcal` והגדרות
 * אינם משתנים בין נמען לנמען, ובקמפיין של 90 חברים זה 90 חישובים מיותרים.
 */
export function buildCampaignContext(db: Database, dateIso = todayIso()): CampaignContext {
  const info = hebrewInfo(dateIso);
  const parashaKey = parashaKeyForVowDate(dateIso);
  const occasion = parashaKey ? findOccasionByHebcalKey(db, parashaKey) : null;

  return {
    todayIso: dateIso,
    todayHebrew: info.hebrew,
    // שם הפרשה מגיע מטבלת `occasion` (שם עברי), לא מה-key של hebcal.
    parasha: occasion?.name ?? '',
    hebrewYear: info.hebrewYear,
    synagogueName: (getSetting(db, 'synagogue_name') ?? '').trim(),
    gabbaiPhone: (getSetting(db, 'gabbai_phone_display') ?? '').trim(),
    openChargesMaxLines: Number(getSetting(db, 'whatsapp_open_charges_max_lines') ?? '10') || 0,
  };
}

interface MemberRow {
  id: number;
  first_name: string;
  last_name: string;
  nickname: string | null;
  member_number: number;
  balance_agorot: number;
  last_payment_date: string | null;
  mobile: string | null;
  mobile_e164: string | null;
  mobile_status: 'valid' | 'invalid' | 'missing';
  mobile_reason: string | null;
  status: string;
}

// `nickname` אינו בתצוגה (הוא לא חלק מחישוב היתרה), ולכן מצרפים ל-member –
// אותו דפוס שקיים ב-`members.ts`.
const MEMBER_CONTEXT_SQL = `
  SELECT b.member_id AS id, b.first_name, b.last_name, m.nickname, b.member_number,
         b.balance_agorot, b.last_payment_date, b.mobile, b.mobile_e164, b.mobile_status,
         b.mobile_reason, b.status
  FROM v_member_balance b JOIN member m ON m.id = b.member_id`;

export interface MemberForMessaging extends MemberContext {
  id: number;
  mobile: string | null;
  mobileE164: string | null;
  mobileStatus: 'valid' | 'invalid' | 'missing';
  mobileReason: string | null;
}

// `openCharges` נוסף בנפרד: הוא מגיע משאילתה אחרת, לכל החברים יחד.
const toMemberForMessaging = (r: MemberRow): Omit<MemberForMessaging, 'openCharges'> => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  nickname: r.nickname,
  memberNumber: r.member_number,
  balanceAgorot: r.balance_agorot,
  lastPaymentDate: r.last_payment_date,
  mobile: r.mobile,
  mobileE164: r.mobile_e164,
  mobileStatus: r.mobile_status,
  mobileReason: r.mobile_reason,
});

export function membersForMessaging(db: Database, memberIds: number[]): MemberForMessaging[] {
  if (memberIds.length === 0) return [];
  const placeholders = memberIds.map(() => '?').join(',');
  const rows = db
    .prepare(`${MEMBER_CONTEXT_SQL} WHERE b.member_id IN (${placeholders})`)
    .all(...memberIds) as MemberRow[];

  // פירוט החוב לכל החברים בשאילתה אחת, ולא אחת לכל חבר.
  const openCharges = openChargesFor(db, memberIds);

  const byId = new Map<number, MemberForMessaging>(
    rows.map((r) => [
      r.id,
      { ...toMemberForMessaging(r), openCharges: openCharges.get(r.id) ?? [] },
    ]),
  );
  // שומרים על סדר הבחירה של הגבאי, ולא על סדר ה-SQL.
  return memberIds
    .map((id) => byId.get(id))
    .filter((m): m is MemberForMessaging => m !== undefined);
}

/** W-13 – תצוגה מקדימה על חבר יחיד. */
export function renderForMember(db: Database, body: string, memberId: number): string {
  const [member] = membersForMessaging(db, [memberId]);
  if (!member) throw new Error('החבר לא נמצא');
  return renderTemplate(body, member, buildCampaignContext(db));
}

/** חבר ברירת המחדל לתצוגה המקדימה: הראשון עם יתרת חוב (W-13). */
export function previewMemberId(db: Database): number | null {
  const row = db
    .prepare(
      `SELECT member_id FROM v_member_balance
       WHERE status = 'active' AND balance_agorot > 0
       ORDER BY balance_agorot DESC LIMIT 1`,
    )
    .get() as { member_id: number } | undefined;
  if (row) return row.member_id;
  const any = db.prepare('SELECT member_id FROM v_member_balance LIMIT 1').get() as
    { member_id: number } | undefined;
  return any?.member_id ?? null;
}
