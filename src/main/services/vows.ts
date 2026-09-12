import type { Database } from 'better-sqlite3';
import type { IsoDate } from '@shared/types';
import { getNumberSetting } from './settings';
import { snapshot, writeAudit } from './audit';
import {
  holidayKeysForDate,
  isShabbat,
  localDateToIso,
  parashaKeyForVowDate,
  todayIso,
} from './hebrewCalendar';
import { findOccasionByHebcalKey } from './lookups';
import { nowIso } from '@shared/datetime';

/** F-30..F-36 – הזנת נדר, הזנה מרובה, זיכוי וביטול. */

/** SPEC 6.2: לא לפני תחילת הנתונים, ולא יותר מ-7 ימים בעתיד. */
export const MAX_FUTURE_DAYS = 7;
export const MAX_AMOUNT_AGOROT = 100_000_000; // 1,000,000 ₪

export interface VowInput {
  memberId: number;
  chargeDate: IsoDate;
  occasionId: number;
  occasionNote?: string | null;
  amountAgorot: number;
  notes?: string | null;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** אימות קלט לפי SPEC 6.2. שגיאה חוסמת, אזהרה רק מוצגת. */
export function validateVow(db: Database, input: VowInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) {
    issues.push({ field: 'amount', message: 'הסכום חייב להיות מספר חיובי', severity: 'error' });
  } else if (input.amountAgorot > MAX_AMOUNT_AGOROT) {
    issues.push({ field: 'amount', message: 'הסכום חורג מהמקסימום המותר', severity: 'error' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.chargeDate)) {
    issues.push({ field: 'chargeDate', message: 'תאריך לא תקין', severity: 'error' });
  } else {
    const limit = new Date();
    limit.setDate(limit.getDate() + MAX_FUTURE_DAYS);
    if (input.chargeDate > localDateToIso(limit)) {
      issues.push({
        field: 'chargeDate',
        message: `לא ניתן להזין תאריך יותר מ-${MAX_FUTURE_DAYS} ימים בעתיד`,
        severity: 'error',
      });
    }
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    if (input.chargeDate < localDateToIso(yearAgo)) {
      issues.push({
        field: 'chargeDate',
        message: 'התאריך ישן מכשנה – לוודא שזה מכוון',
        severity: 'warning',
      });
    }
  }

  const occasion = db.prepare('SELECT id FROM occasion WHERE id = ?').get(input.occasionId);
  if (!occasion) {
    issues.push({ field: 'occasionId', message: 'יש לבחור פרשה או אירוע', severity: 'error' });
  }

  const member = db
    .prepare('SELECT id FROM member WHERE id = ? AND deleted_at IS NULL')
    .get(input.memberId);
  if (!member) issues.push({ field: 'memberId', message: 'חבר לא נמצא', severity: 'error' });

  return issues;
}

function assertValid(issues: ValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));
}

/** F-30..F-32 – הזנת נדר בודד. */
export function createVow(db: Database, input: VowInput, userId: number): number {
  assertValid(validateVow(db, input));
  const ts = nowIso();

  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vow_charge (member_id, charge_date, occasion_id, occasion_note,
           amount_agorot, kind, notes, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, 'vow', ?, ?, ?, ?)`,
      )
      .run(
        input.memberId,
        input.chargeDate,
        input.occasionId,
        input.occasionNote?.trim() || null,
        input.amountAgorot,
        input.notes?.trim() || null,
        ts,
        ts,
        userId,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'vow_charge',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'vow_charge', id),
    });
    return id;
  });
  return run();
}

export interface BulkVowInput {
  chargeDate: IsoDate;
  occasionId: number;
  lines: Array<{ memberId: number; amountAgorot: number; occasionNote?: string | null }>;
}

/**
 * F-33 – הזנה מרובה אחרי שבת/חג: תאריך ופרשה משותפים, שורה לכל חבר.
 * הכול בטרנזקציה אחת – או שהכול נשמר או ששום דבר לא נשמר.
 */
export function createVowsBulk(
  db: Database,
  input: BulkVowInput,
  userId: number,
): { ids: number[]; totalAgorot: number } {
  if (input.lines.length === 0) throw new Error('אין שורות להזנה');

  // אימות כל השורות לפני שכותבים משהו
  for (const line of input.lines) {
    assertValid(
      validateVow(db, {
        memberId: line.memberId,
        chargeDate: input.chargeDate,
        occasionId: input.occasionId,
        amountAgorot: line.amountAgorot,
      }),
    );
  }

  const run = db.transaction(() => {
    const ids = input.lines.map((line) =>
      createVow(
        db,
        {
          memberId: line.memberId,
          chargeDate: input.chargeDate,
          occasionId: input.occasionId,
          occasionNote: line.occasionNote ?? null,
          amountAgorot: line.amountAgorot,
        },
        userId,
      ),
    );
    return ids;
  });

  const ids = run();
  return { ids, totalAgorot: input.lines.reduce((s, l) => s + l.amountAgorot, 0) };
}

export interface CreditInput {
  memberId: number;
  chargeDate: IsoDate;
  occasionId: number;
  amountAgorot: number;
  creditReason: string;
  note: string;
  reversalOfId?: number | null;
}

/**
 * F-35 – זיכוי/תיקון. סכום מעל הסף שבהגדרות דורש הרשאת מנהל.
 * הערה היא שדה חובה, כדי שתמיד יהיה תיעוד למה בוטל חוב.
 */
export function createCredit(
  db: Database,
  input: CreditInput,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): number {
  if (input.note.trim() === '') throw new Error('הערה היא שדה חובה בזיכוי');
  if (input.creditReason.trim() === '') throw new Error('יש לבחור סיבת זיכוי');
  assertValid(
    validateVow(db, {
      memberId: input.memberId,
      chargeDate: input.chargeDate,
      occasionId: input.occasionId,
      amountAgorot: input.amountAgorot,
    }),
  );

  const threshold = getNumberSetting(db, 'credit_approval_threshold_agorot', 50_000);
  if (input.amountAgorot > threshold && userRole !== 'admin') {
    throw new Error(`זיכוי מעל ${threshold / 100} ₪ מחייב הרשאת מנהל`);
  }

  const ts = nowIso();
  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vow_charge (member_id, charge_date, occasion_id, occasion_note,
           amount_agorot, kind, credit_reason, reversal_of_id, notes,
           created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, 'credit', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.memberId,
        input.chargeDate,
        input.occasionId,
        input.note.trim(),
        input.amountAgorot,
        input.creditReason.trim(),
        input.reversalOfId ?? null,
        input.note.trim(),
        ts,
        ts,
        userId,
      );
    const id = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId,
      entity: 'vow_charge',
      entityId: id,
      action: 'create',
      after: snapshot(db, 'vow_charge', id),
    });
    return id;
  });
  return run();
}

/**
 * F-36 – מחיקה לוגית של חיוב. מותרת למנהל תמיד, ולמזין רק על חיוב שהוא עצמו
 * רשם היום. תמיד נרשמת ביומן הביקורת עם המצב הקודם (B-09).
 */
export function deleteVowCharge(
  db: Database,
  id: number,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): void {
  const row = db.prepare('SELECT * FROM vow_charge WHERE id = ? AND deleted_at IS NULL').get(id) as
    { created_by: number | null; created_at: string } | undefined;
  if (!row) throw new Error('התנועה לא נמצאה או כבר נמחקה');

  if (userRole !== 'admin') {
    const sameUser = row.created_by === userId;
    const sameDay = row.created_at.slice(0, 10) === todayIso();
    if (!sameUser || !sameDay) {
      throw new Error('מזין יכול למחוק רק תנועה שהוא עצמו רשם היום');
    }
  }

  const before = snapshot(db, 'vow_charge', id);
  const run = db.transaction(() => {
    db.prepare('UPDATE vow_charge SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      nowIso(),
      id,
    );
    writeAudit(db, { userId, entity: 'vow_charge', entityId: id, action: 'delete', before });
  });
  run();
}

/** F-31 – ברירת המחדל של הפרשה לתאריך נתון. */
/**
 * F-31 – האירוע המוצע בהזנת נדר לתאריך נתון.
 *
 * **בשבת מנצחת הקריאה, ביום חול מנצח החג.**
 *
 * הסיבה לחלוקה הזו: בשבת יש קריאה בתורה שנושאת את שם היום, ו-`getSedra`
 * מדייק יותר מרשימת החגים – בשבת חול המועד פסח הוא מחזיר
 * `Pesach Shabbat Chol ha-Moed` בעוד שרשימת החגים מחזירה `Pesach III
 * (CH''M)` שיתקלף ל'פסח'. ביום חול אין קריאה, וזהות היום היא החג עצמו:
 * נדר שנודר ביום כיפור צריך להירשם על יום כיפור ולא על הפרשה של השבת
 * שקדמה לו.
 *
 * **טבלת `occasion` היא המסננת.** רק חג שיש לו שורה פעילה עם `hebcal_key`
 * נבחר; `getHolidaysOnDate` מחזיר 97 מזהים בשנה (ימי זיכרון, ראשי חודשים,
 * ימי כיפור קטן), ורובם אינם אירועים שנודרים בהם. הגבאי שולט ברשימה –
 * השבתת שורה או ניקוי המפתח שלה מוציאים אותה מברירת המחדל (כלל 12).
 *
 * זו **ברירת מחדל בלבד**: הגבאי רשאי לבחור כל אירוע אחר מהרשימה.
 */
export function defaultOccasionFor(
  db: Database,
  date: IsoDate,
): { occasionId: number; name: string } | null {
  if (!isShabbat(date)) {
    for (const key of holidayKeysForDate(date)) {
      const occ = findOccasionByHebcalKey(db, key);
      if (occ) return { occasionId: occ.id, name: occ.name };
    }
  }

  const key = parashaKeyForVowDate(date);
  if (!key) return null;
  const occ = findOccasionByHebcalKey(db, key);
  return occ ? { occasionId: occ.id, name: occ.name } : null;
}
