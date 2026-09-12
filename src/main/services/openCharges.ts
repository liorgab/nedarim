import type { Database } from 'better-sqlite3';

/**
 * פירוט החיובים שטרם כוסו – לשדה `{{open_charges}}` בתבנית ההודעה.
 *
 * **המערכת אינה מקצה תשלום לחיוב.** `vow_payment` מחזיק `member_id` וסכום,
 * בלי `charge_id`; היתרה היא `יתרת פתיחה + חיובים − זיכויים − תשלומים`
 * (B-01). לכן השאלה "אילו נדרים לא שולמו" אינה קיימת בנתונים ואי אפשר
 * לשלוף אותה – היא נגזרת.
 *
 * הגזירה כאן היא **FIFO**: התשלומים והזיכויים סוגרים את החיובים הישנים
 * ביותר, ומה שנותר לא מכוסה הוא החוב הפתוח. זו גם הדרך שבה הגבאי מדבר
 * ("נשאר לך מבראשית ומנח"), וגם הבחירה היחידה שמתיישבת תמיד עם היתרה
 * הכוללת: סכום השורות שמוחזרות כאן שווה בדיוק ל-`balance_agorot`.
 *
 * יתרת הפתיחה נחשבת לפריט הישן ביותר, כי היא קדמה לכל חיוב מתועד.
 */

export interface OpenChargeLine {
  /** תאריך החיוב. NULL = יתרת פתיחה, שאין לה תאריך. */
  date: string | null;
  /** שם הפרשה/האירוע, או "יתרת פתיחה". */
  occasion: string;
  /** פירוט חופשי שהוזן עם החיוב (הבן, אורח…). */
  note: string | null;
  /** הסכום המקורי של החיוב. */
  amountAgorot: number;
  /** כמה ממנו עדיין פתוח. שווה ל-`amountAgorot` בחיוב שלא שולם כלל. */
  remainingAgorot: number;
}

interface ChargeRow {
  member_id: number;
  charge_date: string;
  occasion_name: string;
  occasion_note: string | null;
  amount_agorot: number;
  kind: 'vow' | 'credit' | 'opening';
}

const OPENING_LABEL = 'יתרת פתיחה';

/**
 * מחשב את החיובים הפתוחים לכל אחד מהחברים שנתבקשו, בשאילתה אחת.
 * מוחזר מפתח לכל חבר גם כשאין לו חוב (מערך ריק), כדי שהקורא לא יצטרך
 * להתמודד עם `undefined`.
 */
export function openChargesFor(db: Database, memberIds: number[]): Map<number, OpenChargeLine[]> {
  const result = new Map<number, OpenChargeLine[]>();
  if (memberIds.length === 0) return result;
  for (const id of memberIds) result.set(id, []);

  const placeholders = memberIds.map(() => '?').join(',');

  const openings = new Map<number, number>();
  for (const row of db
    .prepare(`SELECT id, opening_balance_agorot FROM member WHERE id IN (${placeholders})`)
    .all(...memberIds) as Array<{ id: number; opening_balance_agorot: number }>) {
    openings.set(row.id, row.opening_balance_agorot);
  }

  // חיובים וזיכויים, מהישן לחדש. `id` כשובר שוויון כדי שהסדר יהיה יציב
  // בין הרצות כשיש כמה חיובים באותו תאריך.
  const charges = db
    .prepare(
      `SELECT c.member_id, c.charge_date, o.name AS occasion_name, c.occasion_note,
              c.amount_agorot, c.kind
       FROM vow_charge c JOIN occasion o ON o.id = c.occasion_id
       WHERE c.member_id IN (${placeholders}) AND c.deleted_at IS NULL
       ORDER BY c.member_id, c.charge_date, c.id`,
    )
    .all(...memberIds) as ChargeRow[];

  const paymentsByMember = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT member_id, COALESCE(SUM(amount_agorot), 0) AS total FROM vow_payment
       WHERE member_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY member_id`,
    )
    .all(...memberIds) as Array<{ member_id: number; total: number }>) {
    paymentsByMember.set(row.member_id, row.total);
  }

  const byMember = new Map<number, ChargeRow[]>();
  for (const c of charges) {
    const list = byMember.get(c.member_id) ?? [];
    list.push(c);
    byMember.set(c.member_id, list);
  }

  for (const memberId of memberIds) {
    const opening = openings.get(memberId) ?? 0;
    const memberCharges = byMember.get(memberId) ?? [];

    // כל מה שמקטין חוב: תשלומים, זיכויים, ויתרת פתיחה שלילית (זכות).
    let credit = paymentsByMember.get(memberId) ?? 0;
    for (const c of memberCharges) {
      if (c.kind === 'credit') credit += c.amount_agorot;
    }
    if (opening < 0) credit += -opening;

    const debits: OpenChargeLine[] = [];
    if (opening > 0) {
      debits.push({
        date: null,
        occasion: OPENING_LABEL,
        note: null,
        amountAgorot: opening,
        remainingAgorot: opening,
      });
    }
    for (const c of memberCharges) {
      if (c.kind === 'credit') continue;
      debits.push({
        date: c.charge_date,
        occasion: c.occasion_name,
        note: c.occasion_note,
        amountAgorot: c.amount_agorot,
        remainingAgorot: c.amount_agorot,
      });
    }

    // FIFO: מכסים מהישן לחדש.
    const open: OpenChargeLine[] = [];
    for (const debit of debits) {
      if (credit >= debit.remainingAgorot) {
        credit -= debit.remainingAgorot;
        continue;
      }
      open.push({ ...debit, remainingAgorot: debit.remainingAgorot - credit });
      credit = 0;
    }

    result.set(memberId, open);
  }

  return result;
}
