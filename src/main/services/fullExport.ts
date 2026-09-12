import type { Database } from 'better-sqlite3';
import { agorotToShekel } from '@shared/money';
import { writeAudit } from './audit';
import { writeFullExport, type ExportTable } from './exporters';

/**
 * F-104 – ייצוא מלא של כל הנתונים ל-Excel, גיליון לכל ישות.
 *
 * המטרה מוצהרת ב-SPEC: "כדי שבית הכנסת לעולם לא יהיה נעול במערכת".
 * לכן הייצוא הוא של הטבלאות עצמן, עם שמות עמודות מובנים בעברית, ולא של דוחות
 * מעובדים. סכומים מומרים לשקלים כדי שהקובץ יהיה שמיש בגיליון.
 */

interface TableSpec {
  sheet: string;
  sql: string;
  /** עמודות שהן סכום באגורות ויש להמיר לשקלים. */
  moneyColumns?: readonly string[];
}

const TABLES: readonly TableSpec[] = [
  {
    sheet: 'חברים',
    sql: `SELECT m.member_number AS "מס' חבר", m.first_name AS "שם פרטי",
                 m.last_name AS "שם משפחה", m.nickname AS "כינוי", m.mobile AS "נייד",
                 m.email AS "דוא""ל", m.address AS "כתובת",
                 CASE m.status WHEN 'active' THEN 'פעיל' ELSE 'לא פעיל' END AS "סטאטוס",
                 m.opening_balance_agorot AS "יתרת פתיחה",
                 b.balance_agorot AS "יתרת חוב",
                 b.last_payment_date AS "תשלום אחרון",
                 m.notes AS "הערות", m.import_source_ref AS "מקור בייבוא"
          FROM member m LEFT JOIN v_member_balance b ON b.member_id = m.id
          WHERE m.deleted_at IS NULL ORDER BY m.member_number`,
    moneyColumns: ['יתרת פתיחה', 'יתרת חוב'],
  },
  {
    sheet: 'חיובי נדר',
    sql: `SELECT m.member_number AS "מס' חבר", m.first_name || ' ' || m.last_name AS "שם",
                 c.charge_date AS "תאריך", o.name AS "פרשה / אירוע",
                 c.occasion_note AS "פירוט", c.amount_agorot AS "סכום",
                 CASE c.kind WHEN 'vow' THEN 'נדר' WHEN 'credit' THEN 'זיכוי' ELSE 'יתרת פתיחה' END AS "סוג",
                 c.credit_reason AS "סיבת זיכוי", c.notes AS "הערות",
                 c.needs_review AS "לבדיקה", c.import_source_ref AS "מקור בייבוא"
          FROM vow_charge c JOIN member m ON m.id = c.member_id
          JOIN occasion o ON o.id = c.occasion_id
          WHERE c.deleted_at IS NULL ORDER BY c.charge_date, c.id`,
    moneyColumns: ['סכום'],
  },
  {
    sheet: 'תשלומי נדר',
    sql: `SELECT m.member_number AS "מס' חבר", m.first_name || ' ' || m.last_name AS "שם",
                 p.payment_date AS "תאריך", p.amount_agorot AS "סכום",
                 pm.name AS "אמצעי תשלום", p.reference AS "אסמכתא",
                 r.receipt_number AS "מס' קבלה", p.notes AS "הערות",
                 p.needs_review AS "לבדיקה", p.import_source_ref AS "מקור בייבוא"
          FROM vow_payment p JOIN member m ON m.id = p.member_id
          JOIN payment_method pm ON pm.id = p.payment_method_id
          LEFT JOIN receipt r ON r.id = p.receipt_id
          WHERE p.deleted_at IS NULL ORDER BY p.payment_date, p.id`,
    moneyColumns: ['סכום'],
  },
  {
    sheet: 'תרומות',
    sql: `SELECT d.donation_number AS "מס""ד", d.donation_date AS "תאריך",
                 d.donor_name AS "תורם", m.member_number AS "מס' חבר",
                 dt.name AS "סוג תרומה", pm.name AS "אופן", d.amount_agorot AS "סכום",
                 d.purpose AS "ייעוד", d.reference AS "אסמכתא",
                 r.receipt_number AS "מס' קבלה", d.import_source_ref AS "מקור בייבוא"
          FROM donation d JOIN donation_type dt ON dt.id = d.donation_type_id
          JOIN payment_method pm ON pm.id = d.payment_method_id
          LEFT JOIN member m ON m.id = d.member_id
          LEFT JOIN receipt r ON r.id = d.receipt_id
          WHERE d.deleted_at IS NULL ORDER BY d.donation_number`,
    moneyColumns: ['סכום'],
  },
  {
    sheet: 'הוצאות',
    sql: `SELECT e.expense_number AS "מס""ד", e.expense_date AS "תאריך",
                 e.amount_agorot AS "סכום", c.name AS "קטגוריה",
                 e.description AS "פירוט", e.supplier AS "ספק", e.reference AS "אסמכתא",
                 pm.name AS "אמצעי תשלום", e.attachment_path AS "קובץ מצורף",
                 e.notes AS "הערות", e.import_source_ref AS "מקור בייבוא"
          FROM expense e JOIN expense_category c ON c.id = e.category_id
          LEFT JOIN payment_method pm ON pm.id = e.payment_method_id
          WHERE e.deleted_at IS NULL ORDER BY e.expense_number`,
    moneyColumns: ['סכום'],
  },
  {
    sheet: 'קבלות',
    sql: `SELECT receipt_number AS "מס' קבלה",
                 CASE source_type WHEN 'vow_payment' THEN 'תשלום נדרים' ELSE 'תרומה' END AS "מקור",
                 payer_name AS "שולם על ידי", amount_agorot AS "סכום",
                 payment_method_text AS "אמצעי", payment_reference AS "אסמכתא",
                 payment_date AS "תאריך תשלום", purpose_text AS "עבור",
                 hebrew_year AS "שנה עברית", issued_at AS "הופקה",
                 print_count AS "הדפסות", cancelled_at AS "בוטלה",
                 cancel_reason AS "סיבת ביטול", pdf_path AS "קובץ PDF"
          FROM receipt ORDER BY receipt_number`,
    moneyColumns: ['סכום'],
  },
  {
    sheet: 'מאזן חודשי',
    sql: `SELECT ym AS "חודש", donations_agorot AS "תרומות",
                 vow_payments_agorot AS "נדרים", expenses_agorot AS "הוצאות"
          FROM v_monthly_balance`,
    moneyColumns: ['תרומות', 'נדרים', 'הוצאות'],
  },
  {
    sheet: 'רשימות ערכים',
    sql: `SELECT 'פרשה / אירוע' AS "רשימה", name AS "ערך", type AS "סוג",
                 CASE is_active WHEN 1 THEN 'פעיל' ELSE 'מושבת' END AS "סטאטוס" FROM occasion
          UNION ALL SELECT 'אמצעי תשלום', name, NULL,
                 CASE is_active WHEN 1 THEN 'פעיל' ELSE 'מושבת' END FROM payment_method
          UNION ALL SELECT 'סוג תרומה', name, NULL,
                 CASE is_active WHEN 1 THEN 'פעיל' ELSE 'מושבת' END FROM donation_type
          UNION ALL SELECT 'קטגוריית הוצאה', name, NULL,
                 CASE is_active WHEN 1 THEN 'פעיל' ELSE 'מושבת' END FROM expense_category`,
  },
  {
    sheet: 'הגדרות',
    sql: `SELECT key AS "מפתח", value AS "ערך" FROM setting ORDER BY key`,
  },
  {
    sheet: 'יומן ביקורת',
    sql: `SELECT a.ts AS "מועד", u.display_name AS "משתמש", a.entity AS "ישות",
                 a.entity_id AS "מזהה", a.action AS "פעולה",
                 a.before_json AS "לפני", a.after_json AS "אחרי"
          FROM audit_log a LEFT JOIN user u ON u.id = a.user_id ORDER BY a.id`,
  },
];

/** בונה את הטבלאות לייצוא. מיוצא בנפרד כדי שאפשר יהיה לבדוק בלי לכתוב קובץ. */
export function buildExportTables(db: Database): ExportTable[] {
  return TABLES.map((spec) => {
    const rows = db.prepare(spec.sql).all() as Array<Record<string, unknown>>;
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const money = new Set(spec.moneyColumns ?? []);
    const matrix: Array<Array<string | number | null>> = [columns];
    for (const row of rows) {
      matrix.push(
        columns.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (money.has(c) && typeof v === 'number') return agorotToShekel(v);
          return typeof v === 'number' ? v : String(v);
        }),
      );
    }
    return { name: spec.sheet, matrix };
  });
}

export async function exportEverything(
  db: Database,
  path: string,
  userId: number | null,
): Promise<string> {
  const tables = buildExportTables(db);
  await writeFullExport(tables, path);
  writeAudit(db, {
    userId,
    entity: 'export',
    entityId: null,
    action: 'backup',
    after: { path, sheets: tables.map((t) => t.name) },
  });
  return path;
}
