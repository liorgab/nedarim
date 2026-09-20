import type { Database } from 'better-sqlite3';
import type { MemberStatus, MemberWithBalance } from '@shared/types';
import { snapshot, writeAudit } from './audit';
import { getSetting } from './settings';
import { normalizeMobile, type NormalizedMobile } from './PhoneNormalizer';
import { nowIso } from '@shared/datetime';

/** F-10..F-14 – ניהול חברים. */

export interface MemberFilter {
  /** חיפוש חופשי בשם, כינוי, נייד ומספר חבר. */
  search?: string;
  status?: MemberStatus | 'all';
  /** רק חברים עם יתרת חוב שונה מאפס. */
  onlyWithBalance?: boolean;
  /** W-21 – רק חברים שיתרתם מעל סכום נתון. */
  minBalanceAgorot?: number;
  /** W-20 – סינון לפי תקינות הנייד. */
  mobileStatus?: 'valid' | 'not_valid' | 'all';
}

export interface MembersKpis {
  count: number;
  totalDebtAgorot: number;
  totalCreditAgorot: number;
  withDebt: number;
  averageDebtAgorot: number;
  maxDebtAgorot: number;
}

interface Row {
  member_id: number;
  member_number: number;
  first_name: string;
  last_name: string;
  status: MemberStatus;
  opening_balance_agorot: number;
  charges_agorot: number;
  payments_agorot: number;
  balance_agorot: number;
  last_payment_date: string | null;
  nickname: string | null;
  mobile: string | null;
  mobile_e164: string | null;
  mobile_status: 'valid' | 'invalid' | 'missing';
  mobile_reason: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

const SELECT = `
  SELECT b.*, m.nickname, m.mobile, m.email, m.address, m.notes
  FROM v_member_balance b JOIN member m ON m.id = b.member_id`;

function toMember(r: Row): MemberWithBalance {
  return {
    id: r.member_id,
    memberNumber: r.member_number,
    firstName: r.first_name,
    lastName: r.last_name,
    nickname: r.nickname,
    mobile: r.mobile,
    mobileE164: r.mobile_e164,
    mobileStatus: r.mobile_status,
    mobileReason: r.mobile_reason,
    email: r.email,
    address: r.address,
    status: r.status,
    openingBalanceAgorot: r.opening_balance_agorot,
    notes: r.notes,
    balanceAgorot: r.balance_agorot,
    totalChargesAgorot: r.opening_balance_agorot + r.charges_agorot,
    totalPaymentsAgorot: r.payments_agorot,
    lastPaymentDate: r.last_payment_date,
  };
}

/**
 * רשימת חברים עם יתרות. הסינון נעשה ב-SQL, ה-KPIs מחושבים על התוצאה המסוננת
 * (CLAUDE.md כלל-על 16: הסטטיסטיקה תמיד לפי הסינון הפעיל).
 */
export function listMembers(
  db: Database,
  filter: MemberFilter = {},
): { rows: MemberWithBalance[]; total: number; kpis: MembersKpis } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  const status = filter.status ?? 'active';
  if (status !== 'all') {
    where.push('b.status = @status');
    params['status'] = status;
  }
  if (filter.search && filter.search.trim() !== '') {
    where.push(`(
      b.first_name LIKE @q OR b.last_name LIKE @q OR
      COALESCE(m.nickname, '') LIKE @q OR COALESCE(m.mobile, '') LIKE @q OR
      CAST(b.member_number AS TEXT) LIKE @q
    )`);
    params['q'] = `%${filter.search.trim()}%`;
  }
  if (filter.onlyWithBalance) where.push('b.balance_agorot <> 0');
  if (filter.minBalanceAgorot !== undefined) {
    where.push('b.balance_agorot >= @minBalance');
    params['minBalance'] = filter.minBalanceAgorot;
  }
  if (filter.mobileStatus === 'valid') where.push("b.mobile_status = 'valid'");
  if (filter.mobileStatus === 'not_valid') where.push("b.mobile_status <> 'valid'");

  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.member_number`;
  const rows = (db.prepare(sql).all(params) as Row[]).map(toMember);

  const total = (db.prepare('SELECT COUNT(*) c FROM v_member_balance').get() as { c: number }).c;
  const debts = rows.filter((r) => r.balanceAgorot > 0);
  const credits = rows.filter((r) => r.balanceAgorot < 0);
  const kpis: MembersKpis = {
    count: rows.length,
    totalDebtAgorot: debts.reduce((s, r) => s + r.balanceAgorot, 0),
    totalCreditAgorot: credits.reduce((s, r) => s - r.balanceAgorot, 0),
    withDebt: debts.length,
    averageDebtAgorot:
      debts.length === 0
        ? 0
        : Math.round(debts.reduce((s, r) => s + r.balanceAgorot, 0) / debts.length),
    maxDebtAgorot: debts.reduce((max, r) => Math.max(max, r.balanceAgorot), 0),
  };

  return { rows, total, kpis };
}

export function getMember(db: Database, id: number): MemberWithBalance | null {
  const row = db.prepare(`${SELECT} WHERE b.member_id = ?`).get(id) as Row | undefined;
  return row ? toMember(row) : null;
}

export interface MemberInput {
  firstName: string;
  lastName: string;
  nickname?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** בודק כפילות שם – אזהרה בלבד (SPEC 6.2), לא חסימה. */
export function findDuplicateNames(
  db: Database,
  firstName: string,
  lastName: string,
  excludeId?: number,
): Array<{ id: number; memberNumber: number }> {
  return db
    .prepare(
      `SELECT id, member_number AS memberNumber FROM member
       WHERE deleted_at IS NULL AND first_name = ? AND last_name = ? AND id <> ?`,
    )
    .all(firstName.trim(), lastName.trim(), excludeId ?? -1) as Array<{
    id: number;
    memberNumber: number;
  }>;
}

/**
 * WB-11 – **הנקודה היחידה** שבה `mobile_e164`/`mobile_status` נגזרים.
 *
 * כל מסלול כתיבה של חבר עובר כאן, כדי שלא ייווצר מצב שבו `mobile` עודכן
 * וה-E.164 נשאר של המספר הישן – ואז הודעה נשלחת לאדם הלא נכון.
 */
function normalizedMobileFor(db: Database, raw: string | null | undefined): NormalizedMobile {
  const countryCode = (getSetting(db, 'default_country_code') ?? '972').trim() || '972';
  return normalizeMobile(raw, countryCode);
}

/**
 * F-11 – הוספת חבר. מספר החבר מוקצה מהמונה בטרנזקציה ואינו חוזר לשימוש (B-08).
 */
export function createMember(db: Database, input: MemberInput, userId: number): MemberWithBalance {
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  assertNameFilled(db, first, last);

  const mobile = normalizedMobileFor(db, input.mobile);

  const create = db.transaction(() => {
    const seq = db.prepare("SELECT next_value FROM sequence WHERE name = 'member'").get() as {
      next_value: number;
    };
    db.prepare("UPDATE sequence SET next_value = next_value + 1 WHERE name = 'member'").run();
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO member (member_number, first_name, last_name, nickname, mobile, email,
           address, notes, status, opening_balance_agorot, created_at, updated_at, created_by,
           mobile_e164, mobile_status, mobile_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq.next_value,
        first,
        last,
        input.nickname ?? null,
        input.mobile ?? null,
        input.email ?? null,
        input.address ?? null,
        input.notes ?? null,
        ts,
        ts,
        userId,
        mobile.e164,
        mobile.status,
        mobile.reason ?? null,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'member', id),
    });
    return id;
  });

  const id = create();
  return getMember(db, id)!;
}

/**
 * F-13 – בדיקת השם לפי מצב הניהול.
 *
 * במצב "שם מלא" יש שדה אחד, והוא נשמר ב-`first_name`; דרישת שם משפחה שם
 * הייתה חוסמת כל שמירה. במצב "נפרד" שני השדות חובה, כפי שהיה עד היום.
 *
 * הבדיקה כאן ולא רק בטופס: ה-renderer אינו הגבול, ויבוא או קריאת IPC
 * ישירה חייבים להיתקל באותו כלל.
 */
function assertNameFilled(db: Database, first: string, last: string): void {
  if (first === '') throw new Error('שם החבר הוא שדה חובה');

  const mode = getSetting(db, 'member_name_mode') ?? 'split';
  if (mode !== 'full' && last === '') {
    throw new Error('שם פרטי ושם משפחה הם שדות חובה');
  }
}

/** F-12 – עריכת פרטי חבר. שינוי שם אינו נוגע בקבלות שכבר הופקו (הן מקפיאות payer_name). */
export function updateMember(
  db: Database,
  id: number,
  input: MemberInput,
  userId: number,
): MemberWithBalance {
  const before = snapshot(db, 'member', id);
  if (!before) throw new Error(`חבר ${id} לא נמצא`);
  assertNameFilled(db, input.firstName.trim(), input.lastName.trim());

  const mobile = normalizedMobileFor(db, input.mobile);

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE member SET first_name = ?, last_name = ?, nickname = ?, mobile = ?, email = ?,
         address = ?, notes = ?, updated_at = ?,
         mobile_e164 = ?, mobile_status = ?, mobile_reason = ? WHERE id = ?`,
    ).run(
      input.firstName.trim(),
      input.lastName.trim(),
      input.nickname ?? null,
      input.mobile ?? null,
      input.email ?? null,
      input.address ?? null,
      input.notes ?? null,
      nowIso(),
      mobile.e164,
      mobile.status,
      mobile.reason ?? null,
      id,
    );
    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(db, 'member', id),
    });
  });
  run();
  return getMember(db, id)!;
}

/** F-13 – השבתה/הפעלה. חבר עם יתרה ≠ 0 מחייב אישור מפורש מהמתקשר. */
export function setMemberStatus(
  db: Database,
  id: number,
  status: MemberStatus,
  userId: number,
  options: { confirmedWithBalance?: boolean } = {},
): MemberWithBalance {
  const member = getMember(db, id);
  if (!member) throw new Error(`חבר ${id} לא נמצא`);
  if (status === 'inactive' && member.balanceAgorot !== 0 && !options.confirmedWithBalance) {
    throw new Error('לחבר יש יתרה שאינה אפס – נדרש אישור מפורש להשבתה');
  }

  const before = snapshot(db, 'member', id);
  const run = db.transaction(() => {
    db.prepare('UPDATE member SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      id,
    );
    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(db, 'member', id),
    });
  });
  run();
  return getMember(db, id)!;
}

/**
 * F-14 – מיזוג כפילויות (מנהל בלבד): כל התנועות עוברות מ-`fromId` ל-`toId`,
 * יתרת הפתיחה מתווספת, והחבר המקורי מושבת. מספר החבר לא משוחרר (B-08).
 */
export function mergeMembers(
  db: Database,
  fromId: number,
  toId: number,
  userId: number,
): MemberWithBalance {
  if (fromId === toId) throw new Error('לא ניתן למזג חבר לעצמו');
  const from = getMember(db, fromId);
  const to = getMember(db, toId);
  if (!from || !to) throw new Error('אחד החברים לא נמצא');

  const run = db.transaction(() => {
    const beforeFrom = snapshot(db, 'member', fromId);
    const beforeTo = snapshot(db, 'member', toId);
    db.prepare('UPDATE vow_charge SET member_id = ? WHERE member_id = ?').run(toId, fromId);
    db.prepare('UPDATE vow_payment SET member_id = ? WHERE member_id = ?').run(toId, fromId);
    db.prepare('UPDATE donation SET member_id = ? WHERE member_id = ?').run(toId, fromId);
    db.prepare(
      'UPDATE member SET opening_balance_agorot = opening_balance_agorot + ? WHERE id = ?',
    ).run(from.openingBalanceAgorot, toId);
    const ts = nowIso();
    db.prepare(
      `UPDATE member SET status = 'inactive', opening_balance_agorot = 0,
         notes = COALESCE(notes || ' · ', '') || ?, updated_at = ? WHERE id = ?`,
    ).run(`מוזג לחבר מס' ${to.memberNumber}`, ts, fromId);

    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: fromId,
      action: 'update',
      before: beforeFrom,
      after: snapshot(db, 'member', fromId),
    });
    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: toId,
      action: 'update',
      before: beforeTo,
      after: snapshot(db, 'member', toId),
    });
  });
  run();
  return getMember(db, toId)!;
}

/** F-02 – עשרת החייבים הגדולים, למסך הראשי. */
export function topDebtors(db: Database, limit = 10): MemberWithBalance[] {
  const rows = db
    .prepare(`${SELECT} WHERE b.balance_agorot > 0 ORDER BY b.balance_agorot DESC LIMIT ?`)
    .all(limit) as Row[];
  return rows.map(toMember);
}
