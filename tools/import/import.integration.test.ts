import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '@main/db/connection';
import { seed, systemUserId } from '@main/db/seed';
import { monthlyBalance } from '@main/services/balance';
import { shekelToAgorot } from '@shared/money';
import { legacyMonthKey, simulateLegacyMacro } from './legacySim';
import { importWorkbook } from './importer';
import { reconcile } from './reconcile';
import type { ImportOutcome } from './importer';
import type { ReconcileResult } from './types';
import { readLegacyWorkbook, type LegacyWorkbook } from './workbook';

/**
 * בדיקת רגרסיה מלאה על קובץ האמת. נועלת את התוצאה של שלב 1:
 * אם שינוי עתידי בכללי הייבוא יזיז שקל אחד – הבדיקה תיפול.
 *
 * הבדיקה מדלגת אם אין קובץ ב-`data/legacy/` (למשל אצל מי שהוריד את הפרויקט מ-GitHub
 * בלי נתוני בית הכנסת).
 */
const LEGACY_DIR = 'data/legacy';
const legacyFile = existsSync(LEGACY_DIR)
  ? readdirSync(LEGACY_DIR).find((f) => f.endsWith('.xlsm'))
  : undefined;

describe.skipIf(!legacyFile)('ייבוא מלא מהקובץ הישן', () => {
  let db: Database;
  let wb: LegacyWorkbook;
  let outcome: ImportOutcome;
  let rec: ReconcileResult;

  beforeAll(() => {
    wb = readLegacyWorkbook(join(LEGACY_DIR, legacyFile!));
    db = openDatabase({ file: ':memory:' });
    seed(db);
    outcome = importWorkbook(db, wb, systemUserId(db));
    rec = reconcile(db, wb);
  });

  it('קורא את מבנה החוברת כפי שמתועד', () => {
    expect(wb.members).toHaveLength(90);
    expect(wb.charges).toHaveLength(1306);
    expect(wb.payments).toHaveLength(409);
    expect(wb.donations).toHaveLength(45);
    expect(wb.expenses).toHaveLength(169); // 169 הוצאות + שורת סיכום שמדולגת
    expect(Math.max(...wb.receiptCounter)).toBe(452);
    expect(wb.legacyBalance).toHaveLength(37);
  });

  it('מייבא את כל הרשומות', () => {
    expect(outcome.counts).toMatchObject({
      members: 90,
      openingBalances: 38,
      payments: 409,
      donations: 43, // 45 שורות, מהן 2 ריקות בסכום 0
      expenses: 169,
      receipts: 451, // 408 בכרטיסיות + 43 בתרומות; מספר 336 לא בשימוש
      skipped: 2,
    });
    expect(outcome.counts.charges + outcome.counts.credits).toBe(1268);
  });

  it('יתרת כל אחד מ-90 החברים זהה לקובץ הישן (SPEC 7.3 בדיקה 1)', () => {
    expect(rec.balances.checked).toBe(90);
    expect(rec.balances.diffs).toEqual([]);
  });

  it('סה"כ חיובים, תשלומים ויתרה זהים לקובץ', () => {
    expect(rec.totals.legacyCharges).toBe(rec.totals.importedCharges);
    expect(rec.totals.legacyPayments).toBe(rec.totals.importedPayments);
    // המספרים שאומתו ידנית מול הקובץ: 423,661 ₪ חיובים, 378,709 ₪ תשלומים
    expect(rec.totals.importedCharges).toBe(42_366_100);
    expect(rec.totals.importedPayments).toBe(37_870_900);
    expect(rec.totals.importedCharges - rec.totals.importedPayments).toBe(4_495_200);
  });

  it('כל סטייה במאזן החודשי מוסברת (SPEC 7.3 בדיקות 2–3)', () => {
    const unexplained = rec.months.diffs.filter((d) => d.cause === 'unknown');
    expect(unexplained).toEqual([]);
    // ארבע סטיות ידועות: שתיהן באג פענוח תאריך בקובץ הישן, ושתיים "המאזן לא חושב מחדש"
    expect(rec.months.diffs).toHaveLength(4);
    expect(rec.months.diffs.filter((d) => d.cause === 'legacy-parse-bug')).toHaveLength(2);
    expect(rec.months.diffs.filter((d) => d.cause === 'stale-macro')).toHaveLength(2);
  });

  it('קבלות: 451 ללא כפילויות, כל אחת מצביעה על מקור אחד (SPEC 7.3 בדיקה 4)', () => {
    expect(rec.receipts.counterMax).toBe(452);
    expect(rec.receipts.imported).toBe(451);
    expect(rec.receipts.duplicates).toEqual([]);
    expect(rec.receipts.ambiguous).toEqual([]);
    // 336 הוקצה בגיליון המונה אך אין לו תשלום או תרומה – הכרעה של הגבאי
    expect(rec.receipts.missing).toEqual([336]);
  });

  it('המונים מתחילים אחרי הערך הגבוה ביותר שיובא (B-03, B-08)', () => {
    const seq = Object.fromEntries(
      (
        db.prepare('SELECT name, next_value FROM sequence').all() as Array<{
          name: string;
          next_value: number;
        }>
      ).map((r) => [r.name, r.next_value]),
    );
    expect(seq['receipt']).toBe(453);
    expect(seq['member']).toBe(91);
    expect(seq['donation']).toBe(46);
    expect(seq['expense']).toBe(170);
  });

  it('מזהה את התנועות שהמאזן הישן לא סופר (ממצא #1)', () => {
    const months = rec.outOfWindow.map((o) => o.ym).sort();
    expect(months).toEqual(['2026-10', '2026-12']);
  });

  /**
   * DoD של שלב 3: המאזן במערכת החדשה מול עמודות B/C/E בגיליון `מאזן שנתי` הישן,
   * לכל 37 החודשים.
   *
   * שלושה חודשים *אמורים* להיות שונים, והשוני הוא לטובתנו: בשניים מהם המאקרו
   * הישן לא הצליח לפרסר את התאריך, ובאחד המאזן פשוט לא חושב מחדש. הבדיקה
   * נועלת גם את הרשימה הזו – חודש רביעי שיצטרף אליה יפיל אותה.
   */
  it('המאזן החודשי זהה לגיליון הישן ב-34 מתוך 37 החודשים (F-80)', () => {
    const { rows } = monthlyBalance(db, { kind: 'all' });
    const byMonth = new Map(rows.map((r) => [r.ym, r]));
    const EXPENSE_TOLERANCE = 100; // `SumHotzaa As Long` במאקרו חותך לשקל

    const differing: string[] = [];
    for (const legacy of wb.legacyBalance) {
      const ours = byMonth.get(legacy.ym);
      const same =
        (ours?.donationsAgorot ?? 0) === shekelToAgorot(legacy.donations) &&
        (ours?.vowPaymentsAgorot ?? 0) === shekelToAgorot(legacy.vowPayments) &&
        Math.abs((ours?.expensesAgorot ?? 0) - shekelToAgorot(legacy.expenses)) <=
          EXPENSE_TOLERANCE;
      if (!same) differing.push(legacy.ym);
    }

    expect(wb.legacyBalance).toHaveLength(37);
    expect(differing).toEqual(['2025-07', '2025-10', '2026-08']);
    expect(37 - differing.length).toBe(34);
  });

  it('כל אחד משלושת הפערים מוסבר, ובכולם המערכת החדשה היא הנכונה', () => {
    const simulated = simulateLegacyMacro(wb);
    const { rows } = monthlyBalance(db, { kind: 'all' });
    const byMonth = new Map(rows.map((r) => [r.ym, r]));

    // 07/2025 – תרומה בתאריך 27.07.2925: Right(v,4)='2925', המאקרו מפיל אותה
    expect(byMonth.get('2025-07')!.donationsAgorot).toBe(30_500);
    expect(shekelToAgorot(simulated.get('2025-07')!.donations)).toBe(25_300);

    // 10/2025 – תשלום בתאריך '5.10.2025': Mid(v,4,2)='0.', המאקרו מפיל אותו
    expect(byMonth.get('2025-10')!.vowPaymentsAgorot).toBe(2_445_020);
    expect(shekelToAgorot(simulated.get('2025-10')!.vowPayments)).toBe(2_435_020);

    // 08/2026 – כאן המאקרו דווקא היה קורא נכון; הגיליון פשוט לא חושב מחדש
    expect(byMonth.get('2026-08')!.vowPaymentsAgorot).toBe(
      shekelToAgorot(simulated.get('2026-08')!.vowPayments),
    );
    expect(shekelToAgorot(wb.legacyBalance.find((b) => b.ym === '2026-08')!.vowPayments)).toBe(
      1_006_400,
    );
  });

  it('המאזן ממשיך לספור גם מחוץ ל-37 החודשים הקבועים (ממצא #1)', () => {
    const { rows } = monthlyBalance(db, { kind: 'all' });
    const beyond = rows.filter((r) => r.ym > '2026-09');
    expect(beyond.length).toBeGreaterThan(0);
    expect(
      beyond.every(
        (r) => legacyMonthKey({ t: 's', v: `01.${r.ym.slice(5)}.${r.ym.slice(0, 4)}` }) === null,
      ),
    ).toBe(true);
    // היתרה המצטברת האחרונה כוללת אותם
    expect(rows[rows.length - 1]!.cumulativeAgorot).not.toBe(
      rows.find((r) => r.ym === '2026-09')?.cumulativeAgorot,
    );
  });

  it('פרטי בית הכנסת נלקחו מתבנית הקבלה', () => {
    const get = (k: string) =>
      (db.prepare('SELECT value FROM setting WHERE key = ?').get(k) as { value: string }).value;
    // לא בודקים שם ספציפי: הבדיקה רצה על החוברת של מי שמריץ אותה, וכל
    // בית כנסת הוא אחר. מה שחשוב הוא שהשם נשאב ולא נשאר ריק.
    expect((get('synagogue_name') ?? '').trim().length).toBeGreaterThan(2);
    expect(get('synagogue_city')).toContain('שדות מיכה');
  });

  it('אף שנה עברית בקבלות אינה הטקסט הקבוע השגוי מהתבנית', () => {
    const wrong = db
      .prepare("SELECT COUNT(*) c FROM receipt WHERE hebrew_year = 'תשפ״ב'")
      .get() as { c: number };
    const years = db
      .prepare('SELECT DISTINCT hebrew_year FROM receipt ORDER BY hebrew_year')
      .all() as Array<{ hebrew_year: string }>;
    expect(wrong.c).toBe(0);
    expect(years.length).toBeGreaterThan(1);
  });

  it('אידמפוטנטי: הרצה שנייה נותנת בדיוק אותה תוצאה', () => {
    const second = importWorkbook(db, wb, systemUserId(db));
    expect(second.counts).toEqual(outcome.counts);
    const rec2 = reconcile(db, wb);
    expect(rec2.balances.diffs).toEqual([]);
    expect(rec2.receipts.imported).toBe(451);
    const members = db.prepare('SELECT COUNT(*) c FROM member').get() as { c: number };
    expect(members.c).toBe(90);
  });

  it('כל תנועה מסומנת במקור שלה בקובץ (import_source_ref)', () => {
    for (const table of ['member', 'vow_charge', 'vow_payment', 'donation', 'expense', 'receipt']) {
      const row = db
        .prepare(`SELECT COUNT(*) c FROM ${table} WHERE import_source_ref IS NULL`)
        .get() as { c: number };
      expect(row.c, table).toBe(0);
    }
  });

  it('אין סכומי אפס ואין סכומים לא שלמים', () => {
    for (const table of ['vow_charge', 'vow_payment', 'donation', 'expense']) {
      const row = db
        .prepare(
          `SELECT COUNT(*) c FROM ${table} WHERE amount_agorot = 0 OR amount_agorot <> CAST(amount_agorot AS INTEGER)`,
        )
        .get() as { c: number };
      expect(row.c, table).toBe(0);
    }
  });
});
