import type { Database } from 'better-sqlite3';
import { shekelToAgorot } from '@shared/money';
import type { IsoDate } from '@shared/types';
import { hebrewYearForIssue, parashaKeyForVowDate } from '@main/services/hebrewCalendar';
import type { RawCell } from './dates';
import { fixImplausibleYear, parseLegacyDate } from './dates';
import {
  resolveDonationType,
  resolveExpenseCategory,
  resolveOccasion,
  resolvePaymentMethod,
} from './occasions';
import type { LegacyWorkbook } from './workbook';
import type { ImportCounts, ImportIssue } from './types';
import { nowIso } from '../../src/shared/datetime';

/** טווח שנים סביר לנתוני הקובץ – משמש לזיהוי שנים בלתי אפשריות (נמצא 2925). */
const MIN_DATA_YEAR = 2020;
const MAX_DATA_YEAR = 2035;

/** תאריך יתרות הפתיחה (SPEC 7.2). */
const OPENING_DATE: IsoDate = '2023-09-01';

const IMPORT_TAG = 'import';

interface Ctx {
  db: Database;
  userId: number;
  issues: ImportIssue[];
  counts: ImportCounts;
  occasionIds: Map<string, number>;
  paymentMethodIds: Map<string, number>;
  donationTypeIds: Map<string, number>;
  expenseCategoryIds: Map<string, number>;
  memberIds: Map<number, number>;
  /** hebcal_key → שם עברי, לרמז "הפרשה שחלה באותו תאריך" בדוח החריגים. */
  parashaByKey: Map<string, string>;
  dates: IsoDate[];
}

function loadLookup(db: Database, table: string): Map<string, number> {
  const rows = db.prepare(`SELECT id, name FROM ${table}`).all() as Array<{
    id: number;
    name: string;
  }>;
  return new Map(rows.map((r) => [r.name, r.id]));
}

function idOf(map: Map<string, number>, name: string, table: string): number {
  const id = map.get(name);
  if (id === undefined) throw new Error(`ערך "${name}" חסר בטבלת ${table} – יש להריץ seed`);
  return id;
}

function now(): string {
  return nowIso();
}

/** ממיר סכום מהקובץ (שקלים, float) לאגורות, עם דיווח על ערך לא תקין. */
function toAgorot(
  ctx: Ctx,
  value: number,
  sourceRef: string,
  entity: ImportIssue['entity'],
): number | null {
  if (!Number.isFinite(value)) {
    ctx.issues.push({
      severity: 'error',
      entity,
      sourceRef,
      message: 'סכום לא מספרי – השורה לא יובאה',
      rawValue: String(value),
    });
    return null;
  }
  return shekelToAgorot(value);
}

/** מפרסר תאריך ומדווח. מחזיר null אם נכשל. */
function resolveDate(
  ctx: Ctx,
  cell: RawCell | null,
  sourceRef: string,
  entity: ImportIssue['entity'],
  label: string,
  /** false = הקורא מטפל בכישלון בעצמו (יש לו ערך נפילה), ולכן אין לרשום שגיאה. */
  reportFailure = true,
): IsoDate | null {
  const parsed = parseLegacyDate(cell);
  if (parsed.iso === null) {
    if (reportFailure) {
      ctx.issues.push({
        severity: 'error',
        entity,
        sourceRef,
        message: `${label} לא ניתן לפענוח – ${parsed.reason ?? 'לא ידוע'}`,
        rawValue: parsed.raw,
        action: 'השורה לא יובאה',
      });
    }
    return null;
  }
  const fixed = fixImplausibleYear(parsed.iso, MIN_DATA_YEAR, MAX_DATA_YEAR);
  if (fixed.fixed) {
    ctx.issues.push({
      severity: 'warning',
      entity,
      sourceRef,
      message: `${label}: ${fixed.reason}`,
      rawValue: parsed.raw,
      action: `יובא כ-${fixed.iso}`,
    });
  } else if (fixed.reason) {
    ctx.issues.push({
      severity: 'warning',
      entity,
      sourceRef,
      message: `${label}: ${fixed.reason}`,
      rawValue: parsed.raw,
      action: `יובא כ-${fixed.iso}`,
    });
  } else if (parsed.confidence === 'guessed') {
    ctx.issues.push({
      severity: 'warning',
      entity,
      sourceRef,
      message: `${label} פוענח בניחוש – ${parsed.reason ?? ''}`,
      rawValue: parsed.raw,
      action: `יובא כ-${fixed.iso}`,
    });
  }
  ctx.dates.push(fixed.iso);
  return fixed.iso;
}

/** מנקה שם משפחה: 'כהן(יעקב כהן)' → { lastName, nickname }. */
export function splitLastName(raw: string): { lastName: string; nickname: string | null } {
  const text = raw.replace(/\s+/g, ' ').trim();
  // בקובץ נמצאה גם סוגר פותח שגוי: 'משפחת בן שטרית{חנינה)'
  const m = /^(.*?)[({[]\s*(.+?)\s*[)}\]]?\s*$/.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined && m[1].trim() !== '') {
    return { lastName: m[1].trim(), nickname: m[2].trim() };
  }
  return { lastName: text, nickname: null };
}

/** התאמת שם תורם לחבר קיים. מחזיר את מזהה החבר ואת שארית הטקסט כייעוד. */
export function matchDonor(
  donorText: string,
  members: ReadonlyArray<{ memberNumber: number; firstName: string; lastName: string }>,
): { memberNumber: number | null; donorName: string; purpose: string | null } {
  const text = donorText.replace(/\s+/g, ' ').trim();
  if (text === '') return { memberNumber: null, donorName: '', purpose: null };

  // הפרדת ייעוד: 'סמי דדון - משכורת לרב חודש מאי 24'
  const dashIdx = text.search(/\s+[-–]\s+/);
  const head = dashIdx === -1 ? text : text.slice(0, dashIdx).trim();
  let purpose =
    dashIdx === -1
      ? null
      : text
          .slice(dashIdx)
          .replace(/^[\s\-–]+/, '')
          .trim();

  // התאמה מדויקת "שם פרטי שם משפחה" בתחילת המחרוזת
  let best: { memberNumber: number; matched: string } | null = null;
  for (const m of members) {
    const full = `${m.firstName} ${m.lastName}`.replace(/\s+/g, ' ').trim();
    if (full === '') continue;
    if (head === full) return { memberNumber: m.memberNumber, donorName: full, purpose };
    if (text.startsWith(full) && (best === null || full.length > best.matched.length)) {
      best = { memberNumber: m.memberNumber, matched: full };
    }
  }
  if (best) {
    const rest = text
      .slice(best.matched.length)
      .replace(/^[\s\-–]+/, '')
      .trim();
    if (rest !== '') purpose = purpose ? `${rest}` : rest;
    return { memberNumber: best.memberNumber, donorName: best.matched, purpose: purpose || null };
  }
  return { memberNumber: null, donorName: head, purpose };
}

export interface ImportOutcome {
  counts: ImportCounts;
  issues: ImportIssue[];
  dataRange: { minDate: IsoDate | null; maxDate: IsoDate | null };
}

/**
 * מייבא את כל תוכן החוברת ל-DB בטרנזקציה אחת.
 * אידמפוטנטי: כל רשומה שיובאה בעבר (`import_source_ref IS NOT NULL`) נמחקת פיזית
 * לפני הייבוא, כך שהרצה חוזרת נותנת אותה תוצאה בדיוק.
 */
export function importWorkbook(db: Database, wb: LegacyWorkbook, userId: number): ImportOutcome {
  const ctx: Ctx = {
    db,
    userId,
    issues: [],
    counts: {
      members: 0,
      openingBalances: 0,
      charges: 0,
      credits: 0,
      payments: 0,
      donations: 0,
      expenses: 0,
      receipts: 0,
      skipped: 0,
      flagged: 0,
    },
    occasionIds: loadLookup(db, 'occasion'),
    paymentMethodIds: loadLookup(db, 'payment_method'),
    donationTypeIds: loadLookup(db, 'donation_type'),
    expenseCategoryIds: loadLookup(db, 'expense_category'),
    memberIds: new Map(),
    parashaByKey: new Map(
      (
        db
          .prepare('SELECT hebcal_key, name FROM occasion WHERE hebcal_key IS NOT NULL')
          .all() as Array<{ hebcal_key: string; name: string }>
      ).map((r) => [r.hebcal_key, r.name]),
    ),
    dates: [],
  };

  const run = db.transaction(() => {
    clearPreviousImport(db);
    importMembers(ctx, wb);
    importCharges(ctx, wb);
    importPayments(ctx, wb);
    importDonations(ctx, wb);
    importExpenses(ctx, wb);
    updateSequences(db);
    importSettings(db, wb);
    db.prepare(
      `INSERT INTO audit_log (ts, user_id, entity, entity_id, action, after_json)
       VALUES (?, ?, 'import', NULL, 'import', ?)`,
    ).run(now(), userId, JSON.stringify(ctx.counts));
  });
  run();

  ctx.counts.flagged = ctx.issues.filter((i) => i.severity !== 'info').length;
  const sorted = [...ctx.dates].sort();
  return {
    counts: ctx.counts,
    issues: ctx.issues,
    dataRange: { minDate: sorted[0] ?? null, maxDate: sorted[sorted.length - 1] ?? null },
  };
}

/** מחיקה פיזית של ייבוא קודם – זה הדבר היחיד במערכת שמוחק פיזית, וזה מכוון. */
function clearPreviousImport(db: Database): void {
  db.prepare('UPDATE vow_payment SET receipt_id = NULL WHERE import_source_ref IS NOT NULL').run();
  db.prepare('UPDATE donation SET receipt_id = NULL WHERE import_source_ref IS NOT NULL').run();
  for (const table of ['receipt', 'vow_charge', 'vow_payment', 'donation', 'expense', 'member']) {
    db.prepare(`DELETE FROM ${table} WHERE import_source_ref IS NOT NULL`).run();
  }
  db.prepare("DELETE FROM audit_log WHERE entity = 'import'").run();
}

function importMembers(ctx: Ctx, wb: LegacyWorkbook): void {
  const stmt = ctx.db.prepare(
    `INSERT INTO member (member_number, first_name, last_name, nickname, mobile, notes,
       status, opening_balance_agorot, import_source_ref, created_at, updated_at, created_by)
     VALUES (@memberNumber, @firstName, @lastName, @nickname, @mobile, @notes,
       @status, 0, @sourceRef, @ts, @ts, @userId)`,
  );
  const ts = now();

  for (const m of wb.members) {
    const first = m.firstName.replace(/\s+/g, ' ').trim();
    const { lastName, nickname } = splitLastName(m.lastName);
    if (first === '' && lastName === '') {
      ctx.issues.push({
        severity: 'error',
        entity: 'member',
        sourceRef: m.sourceRef,
        message: 'חבר ללא שם – לא יובא',
        action: 'דולג',
      });
      ctx.counts.skipped += 1;
      continue;
    }

    // 'סיכום שנת תשפ"ג' אינו חבר אמיתי אלא שורת אגרגציה מהקובץ הישן.
    const isAggregate = `${first} ${lastName}`.includes('סיכום שנת');
    if (isAggregate) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'member',
        sourceRef: m.sourceRef,
        message: `"${first} ${lastName}" אינו חבר אמיתי אלא שורת סיכום שנתית בקובץ הישן`,
        action: 'יובא כחבר לא-פעיל כדי לשמור על התאמה למאזן הישן. יתרתו 0.',
        suggestion: 'להחליט אם למחוק אותו מהמערכת החדשה (ראו "החלטות פתוחות" ב-ROADMAP)',
      });
    }

    const info = stmt.run({
      memberNumber: m.memberNumber,
      firstName: first || '—',
      lastName: lastName || '—',
      nickname,
      mobile: m.mobile,
      notes: m.notes,
      status: isAggregate ? 'inactive' : 'active',
      sourceRef: m.sourceRef,
      ts,
      userId: ctx.userId,
    });
    ctx.memberIds.set(m.memberNumber, Number(info.lastInsertRowid));
    ctx.counts.members += 1;
  }
}

/**
 * התאריך המוקדם ביותר שיש לחבר בכל צד של הכרטיסייה. משמש כברירת מחדל לשורה
 * שסכומה תקין אך תא התאריך שלה ריק – עדיף לשמור על התאמת היתרה מאשר לזרוק את הכסף.
 */
function earliestDatePerMember(wb: LegacyWorkbook): Map<number, IsoDate> {
  const out = new Map<number, IsoDate>();
  const consider = (memberNumber: number, cell: RawCell | null) => {
    const iso = parseLegacyDate(cell).iso;
    if (!iso) return;
    const current = out.get(memberNumber);
    if (current === undefined || iso < current) out.set(memberNumber, iso);
  };
  for (const c of wb.charges) consider(c.memberNumber, c.date);
  for (const p of wb.payments) consider(p.memberNumber, p.date);
  return out;
}

function importCharges(ctx: Ctx, wb: LegacyWorkbook): void {
  const known = new Set(ctx.occasionIds.keys());
  const earliest = earliestDatePerMember(wb);
  const insertCharge = ctx.db.prepare(
    `INSERT INTO vow_charge (member_id, charge_date, occasion_id, occasion_note, amount_agorot,
       kind, credit_reason, needs_review, import_source_ref, created_at, updated_at, created_by)
     VALUES (@memberId, @date, @occasionId, @note, @amount, @kind, @creditReason, @needsReview,
       @sourceRef, @ts, @ts, @userId)`,
  );
  const bumpOpening = ctx.db.prepare(
    'UPDATE member SET opening_balance_agorot = opening_balance_agorot + ? WHERE id = ?',
  );
  const ts = now();

  for (const c of wb.charges) {
    const memberId = ctx.memberIds.get(c.memberNumber);
    if (memberId === undefined) {
      ctx.issues.push({
        severity: 'error',
        entity: 'charge',
        sourceRef: c.sourceRef,
        message: `חיוב לחבר ${c.memberNumber} שאינו קיים ברשימת החברים`,
        action: 'דולג',
      });
      ctx.counts.skipped += 1;
      continue;
    }

    const agorot = toAgorot(ctx, c.amount, c.sourceRef, 'charge');
    if (agorot === null || agorot === 0) {
      if (agorot === 0) {
        ctx.issues.push({
          severity: 'warning',
          entity: 'charge',
          sourceRef: c.sourceRef,
          message: 'חיוב בסכום 0 – לא יובא',
          rawValue: String(c.amount),
          action: 'דולג',
        });
      }
      ctx.counts.skipped += 1;
      continue;
    }

    // התאריך נדרש לפני פענוח הפרשה (הכרעת 'שבת חוה"מ' תלויה בעונה).
    const parsedDate = parseLegacyDate(c.date);
    const resolution = resolveOccasion(c.occasion, c.amount, parsedDate.iso, known);

    // --- יתרת פתיחה → שדה בחבר, לא שורת תנועה (ראו DATA-MODEL, "יתרות פתיחה – החלטה")
    if (resolution.isOpening && !resolution.isCredit) {
      bumpOpening.run(agorot, memberId);
      ctx.counts.openingBalances += 1;
      if (resolution.note) {
        ctx.issues.push({
          severity: 'info',
          entity: 'charge',
          sourceRef: c.sourceRef,
          message: `יתרת פתיחה עם פירוט "${resolution.note}"`,
          action: `נרשמה ב-opening_balance_agorot של חבר ${c.memberNumber}`,
        });
      }
      continue;
    }

    let date = resolveDate(ctx, c.date, c.sourceRef, 'charge', 'תאריך חיוב', false);
    if (date === null) {
      // נפילה לתאריך המוקדם ביותר של אותו חבר, ואם אין – לתאריך תחילת הנתונים.
      // אילו היינו מדלגים, יתרת החבר במערכת החדשה הייתה שונה מהקובץ הישן.
      date = earliest.get(c.memberNumber) ?? OPENING_DATE;
      ctx.issues.push({
        severity: 'warning',
        entity: 'charge',
        sourceRef: c.sourceRef,
        message: `חיוב של ${c.amount} ₪ ללא תאריך – יובא כדי לשמור על התאמת היתרה`,
        rawValue: c.occasion,
        action: `הוגדר התאריך ${date} (התנועה המוקדמת ביותר של החבר)`,
        suggestion: 'לקבוע את התאריך הנכון ידנית לאחר הייבוא',
      });
    }

    const occasionId = idOf(ctx.occasionIds, resolution.occasionName, 'occasion');
    if (resolution.needsReview) {
      const suggestion = suggestParasha(ctx, date);
      ctx.issues.push({
        severity: 'warning',
        entity: 'charge',
        sourceRef: c.sourceRef,
        message: resolution.reason ?? 'פרשה/אירוע דורש בדיקה',
        rawValue: c.occasion,
        action: `יובא כ-"${resolution.occasionName}" עם ההערה המקורית`,
        ...(suggestion ? { suggestion: `הפרשה שחלה באותו תאריך: ${suggestion}` } : {}),
      });
    }

    insertCharge.run({
      memberId,
      date,
      occasionId,
      note: resolution.note,
      amount: Math.abs(agorot),
      kind: resolution.isCredit ? 'credit' : 'vow',
      creditReason: resolution.creditReason,
      needsReview: resolution.needsReview ? 1 : 0,
      sourceRef: c.sourceRef,
      ts,
      userId: ctx.userId,
    });
    if (resolution.isCredit) ctx.counts.credits += 1;
    else ctx.counts.charges += 1;
  }
}

function suggestParasha(ctx: Ctx, date: IsoDate): string | null {
  const key = parashaKeyForVowDate(date);
  if (!key) return null;
  return ctx.parashaByKey.get(key) ?? key;
}

function importPayments(ctx: Ctx, wb: LegacyWorkbook): void {
  const methodNames = new Set(ctx.paymentMethodIds.keys());
  const insertPayment = ctx.db.prepare(
    `INSERT INTO vow_payment (member_id, payment_date, amount_agorot, is_reversal,
       payment_method_id, needs_review, import_source_ref, created_at, updated_at, created_by)
     VALUES (@memberId, @date, @amount, @isReversal, @methodId, @needsReview, @sourceRef,
       @ts, @ts, @userId)`,
  );
  const ts = now();

  for (const p of wb.payments) {
    const memberId = ctx.memberIds.get(p.memberNumber);
    if (memberId === undefined) {
      ctx.issues.push({
        severity: 'error',
        entity: 'payment',
        sourceRef: p.sourceRef,
        message: `תשלום לחבר ${p.memberNumber} שאינו קיים`,
        action: 'דולג',
      });
      ctx.counts.skipped += 1;
      continue;
    }

    const agorot = toAgorot(ctx, p.amount, p.sourceRef, 'payment');
    if (agorot === null || agorot === 0) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'payment',
        sourceRef: p.sourceRef,
        message: `תשלום בסכום ${p.amount} – לא יובא`,
        rawValue: String(p.amount),
        action: 'דולג',
      });
      ctx.counts.skipped += 1;
      continue;
    }
    // סכום שלילי בצד הזיכוי = ביטול/החזר תשלום. בקובץ נמצאו שתי שורות כאלה,
    // ולשתיהן הוקצה מספר קבלה. חייבות להיכנס, אחרת היתרה והמאזן לא יתאימו.
    const isReversal = agorot < 0;
    if (isReversal) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'payment',
        sourceRef: p.sourceRef,
        message: `תשלום בסכום שלילי (${p.amount} ₪) – ביטול/החזר`,
        rawValue: String(p.amount),
        action: 'יובא כתשלום מבטל (is_reversal = 1)',
        suggestion: 'לבדוק אם מדובר בהחזר כספי או בתיקון רישום',
      });
    }

    const date = resolveDate(ctx, p.date, p.sourceRef, 'payment', 'תאריך תשלום');
    if (date === null) {
      ctx.counts.skipped += 1;
      continue;
    }

    const method = resolvePaymentMethod(p.method, methodNames);
    if (method.needsReview) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'payment',
        sourceRef: p.sourceRef,
        message: method.reason ?? 'אמצעי תשלום לא מזוהה',
        rawValue: p.method === null ? '' : String(p.method),
        action: `יובא כ-"${method.name}" עם דגל לבדיקה`,
      });
    }

    const info = insertPayment.run({
      memberId,
      date,
      amount: agorot,
      isReversal: isReversal ? 1 : 0,
      methodId: idOf(ctx.paymentMethodIds, method.name, 'payment_method'),
      needsReview: method.needsReview || isReversal ? 1 : 0,
      sourceRef: p.sourceRef,
      ts,
      userId: ctx.userId,
    });
    ctx.counts.payments += 1;
    const paymentId = Number(info.lastInsertRowid);

    if (p.receiptNumber !== null) {
      const payerRow = ctx.db
        .prepare('SELECT first_name, last_name FROM member WHERE id = ?')
        .get(memberId) as { first_name: string; last_name: string };
      const receiptId = createReceipt(ctx, {
        receiptNumber: p.receiptNumber,
        sourceType: 'vow_payment',
        sourceId: paymentId,
        payerName: `${payerRow.first_name} ${payerRow.last_name}`.trim(),
        amountAgorot: agorot,
        methodText: method.name,
        paymentDate: date,
        purposeText: 'תשלום נדרים',
        issueDateCell: p.receiptIssueDate,
        sourceRef: p.sourceRef,
      });
      if (receiptId !== null) {
        ctx.db
          .prepare('UPDATE vow_payment SET receipt_id = ? WHERE id = ?')
          .run(receiptId, paymentId);
      }
    } else if (p.status !== '' && p.status !== 'שולם') {
      ctx.issues.push({
        severity: 'info',
        entity: 'payment',
        sourceRef: p.sourceRef,
        message: `תשלום בסטאטוס "${p.status}" ללא מספר קבלה`,
        action: 'יובא ללא קבלה',
      });
    }
  }
}

interface ReceiptInput {
  receiptNumber: number;
  sourceType: 'vow_payment' | 'donation';
  sourceId: number;
  payerName: string;
  amountAgorot: number;
  methodText: string;
  paymentDate: IsoDate;
  purposeText: string;
  issueDateCell: RawCell | null;
  sourceRef: string;
}

function createReceipt(ctx: Ctx, input: ReceiptInput): number | null {
  const existing = ctx.db
    .prepare('SELECT id, source_type, source_id FROM receipt WHERE receipt_number = ?')
    .get(input.receiptNumber) as { id: number; source_type: string; source_id: number } | undefined;
  if (existing) {
    ctx.issues.push({
      severity: 'error',
      entity: 'receipt',
      sourceRef: input.sourceRef,
      message: `מספר קבלה ${input.receiptNumber} מופיע יותר מפעם אחת בקובץ`,
      action: 'הקבלה הכפולה לא נוצרה; התשלום/התרומה יובאו בלי קבלה',
    });
    return null;
  }

  const parsed = parseLegacyDate(input.issueDateCell);
  const issueDate = parsed.iso ?? input.paymentDate;
  if (parsed.iso === null) {
    ctx.issues.push({
      severity: 'warning',
      entity: 'receipt',
      sourceRef: input.sourceRef,
      message: `לקבלה ${input.receiptNumber} אין תאריך הפקה תקין`,
      rawValue: parsed.raw,
      action: `הוגדר תאריך התשלום (${input.paymentDate}) כתאריך ההפקה`,
    });
  }
  const issuedAt = `${issueDate}T00:00:00`;

  const info = ctx.db
    .prepare(
      `INSERT INTO receipt (receipt_number, source_type, source_id, payer_name, amount_agorot,
         payment_method_text, payment_date, purpose_text, hebrew_year, issued_at, issued_by,
         print_count, import_source_ref)
       VALUES (@receiptNumber, @sourceType, @sourceId, @payerName, @amount, @methodText,
         @paymentDate, @purposeText, @hebrewYear, @issuedAt, @userId, 1, @sourceRef)`,
    )
    .run({
      receiptNumber: input.receiptNumber,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      payerName: input.payerName || '—',
      amount: input.amountAgorot,
      methodText: input.methodText,
      paymentDate: input.paymentDate,
      purposeText: input.purposeText,
      hebrewYear: hebrewYearForIssue(issuedAt),
      issuedAt,
      userId: ctx.userId,
      sourceRef: input.sourceRef,
    });
  ctx.counts.receipts += 1;
  return Number(info.lastInsertRowid);
}

function importDonations(ctx: Ctx, wb: LegacyWorkbook): void {
  const methodNames = new Set(ctx.paymentMethodIds.keys());
  const typeNames = new Set(ctx.donationTypeIds.keys());
  const insert = ctx.db.prepare(
    `INSERT INTO donation (donation_number, donation_date, member_id, donor_name,
       donation_type_id, payment_method_id, amount_agorot, is_reversal, purpose, notes,
       needs_review, import_source_ref, created_at, updated_at, created_by)
     VALUES (@donationNumber, @date, @memberId, @donorName, @typeId, @methodId, @amount,
       @isReversal, @purpose, @notes, @needsReview, @sourceRef, @ts, @ts, @userId)`,
  );
  const ts = now();

  for (const d of wb.donations) {
    const agorot = toAgorot(ctx, d.amount, d.sourceRef, 'donation');
    if (agorot === null || agorot === 0) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'donation',
        sourceRef: d.sourceRef,
        message: `תרומה מס"ד ${d.donationNumber} בסכום ${d.amount} וללא פרטים – לא יובאה`,
        action: 'דולג; מספר המס"ד לא יעשה בו שימוש חוזר (B-08)',
      });
      ctx.counts.skipped += 1;
      continue;
    }
    const isReversal = agorot < 0;
    if (isReversal) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'donation',
        sourceRef: d.sourceRef,
        message: `תרומה בסכום שלילי (${d.amount} ₪) – ביטול תרומה`,
        rawValue: d.donorText,
        action: 'יובאה כתרומה מבטלת (is_reversal = 1)',
      });
    }

    const date = resolveDate(ctx, d.date, d.sourceRef, 'donation', 'תאריך תרומה');
    if (date === null) {
      ctx.counts.skipped += 1;
      continue;
    }

    const match = matchDonor(d.donorText, wb.members);
    const memberId =
      match.memberNumber === null ? null : (ctx.memberIds.get(match.memberNumber) ?? null);
    if (memberId === null && d.donorText.trim() !== '') {
      ctx.issues.push({
        severity: 'info',
        entity: 'donation',
        sourceRef: d.sourceRef,
        message: `תורם "${d.donorText}" לא הותאם לחבר`,
        action: 'יובא כתורם חיצוני (שם חופשי)',
      });
    }

    const purpose =
      [match.purpose, d.notes].filter((x) => x && x.trim() !== '').join(' · ') || null;
    const method = resolvePaymentMethod(d.method, methodNames);
    const type = resolveDonationType(d.type, purpose ?? '', typeNames);
    if (method.needsReview) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'donation',
        sourceRef: d.sourceRef,
        message: method.reason ?? 'אופן תרומה לא מזוהה',
        rawValue: d.method === null ? '' : String(d.method),
        action: `יובא כ-"${method.name}"`,
      });
    }
    if (type.needsReview) {
      ctx.issues.push({
        severity: 'warning',
        entity: 'donation',
        sourceRef: d.sourceRef,
        message: 'סוג תרומה חסר או לא מזוהה',
        rawValue: d.type === null ? '' : String(d.type),
        action: `יובא כ-"${type.name}"`,
      });
    }

    const info = insert.run({
      donationNumber: d.donationNumber,
      date,
      memberId,
      donorName: match.donorName || d.donorText || '—',
      typeId: idOf(ctx.donationTypeIds, type.name, 'donation_type'),
      methodId: idOf(ctx.paymentMethodIds, method.name, 'payment_method'),
      amount: agorot,
      isReversal: isReversal ? 1 : 0,
      purpose,
      notes: null,
      needsReview: method.needsReview || type.needsReview || isReversal ? 1 : 0,
      sourceRef: d.sourceRef,
      ts,
      userId: ctx.userId,
    });
    ctx.counts.donations += 1;
    const donationId = Number(info.lastInsertRowid);

    if (d.receiptNumber !== null) {
      const receiptId = createReceipt(ctx, {
        receiptNumber: d.receiptNumber,
        sourceType: 'donation',
        sourceId: donationId,
        payerName: match.donorName || d.donorText,
        amountAgorot: agorot,
        methodText: method.name,
        paymentDate: date,
        purposeText: `תרומה – ${type.name}`,
        issueDateCell: d.receiptIssueDate,
        sourceRef: d.sourceRef,
      });
      if (receiptId !== null) {
        ctx.db
          .prepare('UPDATE donation SET receipt_id = ? WHERE id = ?')
          .run(receiptId, donationId);
      }
    }
  }
}

function importExpenses(ctx: Ctx, wb: LegacyWorkbook): void {
  const insert = ctx.db.prepare(
    `INSERT INTO expense (expense_number, expense_date, amount_agorot, is_refund, category_id,
       description, reference, notes, needs_review, import_source_ref, created_at, updated_at, created_by)
     VALUES (@expenseNumber, @date, @amount, @isRefund, @categoryId, @description, @reference,
       @notes, @needsReview, @sourceRef, @ts, @ts, @userId)`,
  );
  const ts = now();

  for (const e of wb.expenses) {
    const agorot = toAgorot(ctx, e.amount, e.sourceRef, 'expense');
    if (agorot === null) {
      ctx.counts.skipped += 1;
      continue;
    }
    const date = resolveDate(ctx, e.date, e.sourceRef, 'expense', 'תאריך הוצאה');
    if (date === null) {
      ctx.counts.skipped += 1;
      continue;
    }

    const description = e.description.trim();
    if (description === '') {
      ctx.issues.push({
        severity: 'warning',
        entity: 'expense',
        sourceRef: e.sourceRef,
        message: `הוצאה מס"ד ${e.expenseNumber} ללא פירוט`,
        action: 'יובאה עם הפירוט "ללא פירוט" ודגל לבדיקה',
      });
    }
    const cat = resolveExpenseCategory(description);
    if (!cat.matched && description !== '') {
      ctx.issues.push({
        severity: 'info',
        entity: 'expense',
        sourceRef: e.sourceRef,
        message: 'קטגוריית ההוצאה לא זוהתה לפי מילות מפתח',
        rawValue: description,
        action: 'סווגה כ-"אחר"',
      });
    }
    if (agorot < 0) {
      ctx.issues.push({
        severity: 'info',
        entity: 'expense',
        sourceRef: e.sourceRef,
        message: `הוצאה שלילית (${e.amount} ₪) – "${description}"`,
        action: 'יובאה כהחזר/תיקון (is_refund = 1)',
      });
    }

    // עמודת 'הערות' בקובץ מכילה אסמכתא כשהיא כוללת ספרות (SPEC 7.1)
    const noteText = e.notes ?? '';
    const hasDigits = /\d/.test(noteText);

    insert.run({
      expenseNumber: e.expenseNumber,
      date,
      amount: agorot,
      isRefund: agorot < 0 ? 1 : 0,
      categoryId: idOf(ctx.expenseCategoryIds, cat.category, 'expense_category'),
      description: description || 'ללא פירוט',
      reference: hasDigits ? noteText : null,
      notes: hasDigits ? null : noteText || null,
      needsReview: description === '' || !cat.matched ? 1 : 0,
      sourceRef: e.sourceRef,
      ts,
      userId: ctx.userId,
    });
    ctx.counts.expenses += 1;
  }
}

/** מעדכן את המונים ל-MAX+1 לפי מה שיובא בפועל (B-03, B-08). */
function updateSequences(db: Database): void {
  const next = (sql: string): number => {
    const row = db.prepare(sql).get() as { m: number | null };
    return (row.m ?? 0) + 1;
  };
  const set = db.prepare('UPDATE sequence SET next_value = ? WHERE name = ?');
  set.run(next('SELECT MAX(receipt_number) m FROM receipt'), 'receipt');
  set.run(next('SELECT MAX(member_number) m FROM member'), 'member');
  set.run(next('SELECT MAX(donation_number) m FROM donation'), 'donation');
  set.run(next('SELECT MAX(expense_number) m FROM expense'), 'expense');
}

/** פרטי בית הכנסת מתבנית הקבלה הישנה (SPEC 7.1). */
function importSettings(db: Database, wb: LegacyWorkbook): void {
  const upsert = db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  if (wb.settings.synagogueName) upsert.run('synagogue_name', wb.settings.synagogueName);
  if (wb.settings.synagogueCity) upsert.run('synagogue_city', wb.settings.synagogueCity);
  if (wb.settings.receiptFooter) upsert.run('receipt_footer_text', wb.settings.receiptFooter);
}

export { IMPORT_TAG };
