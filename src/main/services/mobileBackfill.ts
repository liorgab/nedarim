import type { Database } from 'better-sqlite3';
import { writeAudit } from './audit';
import { getSetting } from './settings';
import { normalizeMobile } from './PhoneNormalizer';

/**
 * WB-11 – מילוי חד-פעמי של `mobile_e164` / `mobile_status` לחברים קיימים.
 *
 * SQL לא יכול להריץ את `PhoneNormalizer`, ולכן מיגרציה 005 יוצרת את העמודות
 * ריקות והצעד הזה ממלא אותן. הוא רץ בכל הפעלה של היישום ומוגן בתנאי
 * `mobile_e164 IS NULL` – כלומר אידמפוטנטי, ולא נוגע בחבר שכבר חושב.
 *
 * `mobile` המקורי לעולם אינו נדרס: הוא מה שהגבאי הקליד וממשיך לראות.
 */

export interface BackfillSummary {
  /** כמה חברים נבדקו בהרצה הזו. 0 = אין מה לעשות. */
  processed: number;
  valid: number;
  invalid: number;
  missing: number;
  /** כמה מספרים מנורמלים מופיעים אצל יותר מחבר אחד. */
  duplicates: number;
}

interface Row {
  id: number;
  mobile: string | null;
}

export function backfillMobileE164(db: Database, userId: number | null = null): BackfillSummary {
  const countryCode = (getSetting(db, 'default_country_code') ?? '972').trim() || '972';

  // רק חברים שטרם חושבו. חבר בלי `mobile` כלל מקבל `missing` פעם אחת ואז
  // `mobile_e164` שלו נשאר NULL – ולכן הוא ייבחר שוב בכל הרצה. כדי למנוע
  // עבודה חוזרת מיותרת, מסננים גם לפי `mobile_status` שנשאר בברירת המחדל.
  const rows = db
    .prepare(
      `SELECT id, mobile FROM member
       WHERE mobile_e164 IS NULL
         AND (mobile IS NOT NULL AND TRIM(mobile) <> '')
         AND mobile_status = 'missing'`,
    )
    .all() as Row[];

  const summary: BackfillSummary = {
    processed: rows.length,
    valid: 0,
    invalid: 0,
    missing: 0,
    duplicates: 0,
  };

  if (rows.length > 0) {
    const update = db.prepare(
      `UPDATE member SET mobile_e164 = ?, mobile_status = ?, mobile_reason = ? WHERE id = ?`,
    );
    db.transaction(() => {
      for (const row of rows) {
        const n = normalizeMobile(row.mobile, countryCode);
        update.run(n.e164, n.status, n.reason ?? null, row.id);
        summary[n.status] += 1;
      }
    })();
  }

  summary.duplicates = (
    db.prepare('SELECT COUNT(*) c FROM v_member_duplicate_mobile').get() as { c: number }
  ).c;

  // רושמים ביומן רק כשבאמת נעשתה עבודה, אחרת כל הפעלה של היישום הייתה
  // מוסיפה רשומה ריקה ליומן הביקורת.
  if (rows.length > 0) {
    writeAudit(db, {
      userId,
      entity: 'member',
      entityId: null,
      action: 'backfill_mobile',
      after: summary,
    });
  }

  return summary;
}

/** סך המצבים בכל טבלת החברים – לדיווח ולבדיקות, לא רק לחברים שעודכנו עכשיו. */
export function mobileStatusBreakdown(db: Database): {
  valid: number;
  invalid: number;
  missing: number;
  total: number;
} {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN mobile_status = 'valid' THEN 1 ELSE 0 END) AS valid,
         SUM(CASE WHEN mobile_status = 'invalid' THEN 1 ELSE 0 END) AS invalid,
         SUM(CASE WHEN mobile_status = 'missing' THEN 1 ELSE 0 END) AS missing,
         COUNT(*) AS total
       FROM member WHERE deleted_at IS NULL`,
    )
    .get() as { valid: number; invalid: number; missing: number; total: number };
  return {
    valid: row.valid ?? 0,
    invalid: row.invalid ?? 0,
    missing: row.missing ?? 0,
    total: row.total ?? 0,
  };
}
