import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed, systemUserId } from '../db/seed';
import { importEntity } from './catalog';
import { blockingReasons, buildResolver, executeImport, existingKeys } from './execute';
import { rowRulesFor } from './rules';
import { validateSheet, type ParsedRow } from './validate';

/**
 * שלב C – הכתיבה. כאן נכתבים נתונים כספיים, ולכן כל בדיקה מאמתת מול
 * ה-DB עצמו ולא מול ערך מוחזר.
 */

let dir: string;
let db: Database;
let userId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-imp-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
  userId = systemUserId(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* כבר סגור */
  }
  rmSync(dir, { recursive: true, force: true });
});

/** מריץ אימות אמיתי ומחזיר שורות מוכנות – אותו מסלול שהאשף יעבור. */
function prepare(
  entityId: Parameters<typeof importEntity>[0],
  raw: Record<string, unknown>[],
  alsoPending: ReadonlyMap<string, Set<string>> = new Map(),
) {
  const entity = importEntity(entityId);
  const pending = new Map(alsoPending as ReadonlyMap<never, Set<string>>);
  const key = entity.naturalKey[0];
  if (key !== undefined) {
    pending.set(entityId as never, new Set(raw.map((r) => String(r[key] ?? ''))));
  }
  const result = validateSheet({
    entity,
    raw,
    resolveRef: buildResolver(db, pending),
    rowRules: rowRulesFor(entityId),
  });
  expect(result.issues.filter((i) => i.severity === 'error'), 'הקלט לבדיקה אינו תקין').toEqual([]);
  return result.rows;
}

const members = (rows: ParsedRow[]) => [{ entity: 'member' as const, rows }];

const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }).n;

describe('הוספה בסיסית', () => {
  it('חברים נכתבים עם כל השדות', () => {
    const rows = prepare('member', [
      {
        'מספר חבר': '1',
        'שם פרטי': 'ישראל',
        'שם משפחה': 'ישראלי',
        כינוי: 'שרוליק',
        'יתרת פתיחה (₪)': '1,500',
      },
    ]);
    const result = executeImport(db, { mode: 'insert', sheets: members(rows), userId });

    expect(result.totals.insert).toBe(1);
    const row = db.prepare('SELECT * FROM member WHERE member_number = 1').get() as Record<
      string,
      unknown
    >;
    expect(row['first_name']).toBe('ישראל');
    expect(row['nickname']).toBe('שרוליק');
    // שקלים הומרו לאגורות.
    expect(row['opening_balance_agorot']).toBe(150000);
  });

  it('חותמות זמן ומשתמש נכתבים', () => {
    executeImport(db, {
      mode: 'insert',
      sheets: members(prepare('member', [{ 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב' }])),
      userId,
    });
    const row = db.prepare('SELECT * FROM member WHERE member_number = 1').get() as Record<
      string,
      unknown
    >;
    expect(String(row['created_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row['created_by']).toBe(userId);
    expect(String(row['import_source_ref'])).toContain('import:');
  });

  it('הייבוא נרשם ביומן הביקורת', () => {
    executeImport(db, {
      mode: 'insert',
      sheets: members(prepare('member', [{ 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב' }])),
      userId,
    });
    const n = (
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity = 'import'").get() as { n: number }
    ).n;
    expect(n).toBe(1);
  });
});

describe('ארבעת המצבים מול DB', () => {
  const seedMember = () =>
    executeImport(db, {
      mode: 'insert',
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'ישראל', 'שם משפחה': 'ישראלי', כינוי: '' },
        ]),
      ),
      userId,
    });

  const again = (mode: 'insert' | 'upsert' | 'enrich', over: Record<string, unknown> = {}) =>
    executeImport(db, {
      mode,
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'משה', 'שם משפחה': 'כהן', כינוי: 'מוישה', ...over },
        ]),
      ),
      userId,
    });

  it('insert – קיים אינו משתנה', () => {
    seedMember();
    const r = again('insert');
    expect(r.totals.skip).toBe(1);
    expect(r.totals.insert).toBe(0);
    const row = db.prepare('SELECT first_name FROM member WHERE member_number = 1').get();
    expect(row).toEqual({ first_name: 'ישראל' });
  });

  it('upsert – קיים מתעדכן', () => {
    seedMember();
    const r = again('upsert');
    expect(r.totals.update).toBe(1);
    const row = db.prepare('SELECT first_name, nickname FROM member WHERE member_number = 1').get();
    expect(row).toEqual({ first_name: 'משה', nickname: 'מוישה' });
  });

  it('enrich – ממלא ריק ולא דורס מלא', () => {
    seedMember();
    const r = again('enrich');
    expect(r.totals.enrich).toBe(1);
    const row = db.prepare('SELECT first_name, nickname FROM member WHERE member_number = 1').get();
    // הכינוי היה ריק ומולא; השם היה מלא ולא נדרס.
    expect(row).toEqual({ first_name: 'ישראל', nickname: 'מוישה' });
  });

  it('enrich על רשומה שכולה מלאה מדלג', () => {
    seedMember();
    again('upsert');
    const r = again('enrich');
    expect(r.totals.skip).toBe(1);
    expect(r.totals.enrich).toBe(0);
  });

  it('replace – מוחק הכול ומייבא מחדש', () => {
    seedMember();
    const r = executeImport(db, {
      mode: 'replace',
      sheets: members(
        prepare('member', [{ 'מספר חבר': '9', 'שם פרטי': 'חדש', 'שם משפחה': 'לגמרי' }]),
      ),
      userId,
    });
    expect(r.totals.insert).toBe(1);
    expect(count('member')).toBe(1);
    expect(
      db.prepare('SELECT member_number FROM member').get(),
    ).toEqual({ member_number: 9 });
  });
});

describe('הפניות ותלויות', () => {
  function seedMembers(): void {
    executeImport(db, {
      mode: 'insert',
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב' },
          { 'מספר חבר': '2', 'שם פרטי': 'ג', 'שם משפחה': 'ד' },
        ]),
      ),
      userId,
    });
  }

  it('תרומה מקושרת לחבר לפי מספר חבר ולא לפי מזהה', () => {
    seedMembers();
    const rows = prepare('donation', [
      {
        תאריך: '09/09/2026',
        'מספר חבר': '2',
        'שם התורם': 'ג ד',
        'סוג תרומה': 'בדק בית',
        'אמצעי תשלום': 'מזומן',
        'סכום (₪)': '200',
      },
    ]);
    executeImport(db, { mode: 'insert', sheets: [{ entity: 'donation', rows }], userId });

    const row = db
      .prepare('SELECT d.amount_agorot, m.member_number FROM donation d JOIN member m ON m.id = d.member_id')
      .get();
    expect(row).toEqual({ amount_agorot: 20000, member_number: 2 });
  });

  it('חברים ונדרים באותו ייבוא – הסדר נשמר', () => {
    // הגיליונות מועברים בסדר הפוך בכוונה; importOrder אמור לתקן.
    const memberRows = prepare('member', [
      { 'מספר חבר': '5', 'שם פרטי': 'ה', 'שם משפחה': 'ו' },
    ]);
    // החברים עדיין לא ב-DB בזמן האימות – הם מגיעים מאותו קובץ.
    const vowRows = prepare(
      'vow_charge',
      [{ 'מספר חבר': '5', תאריך: '18/10/2025', 'פרשה / אירוע': 'בראשית', 'סכום (₪)': '360' }],
      new Map([['member', new Set(['5'])]]),
    );

    const r = executeImport(db, {
      mode: 'insert',
      sheets: [
        { entity: 'vow_charge', rows: vowRows },
        { entity: 'member', rows: memberRows },
      ],
      userId,
    });
    expect(r.totals.insert).toBe(2);
    expect(count('vow_charge')).toBe(1);
  });
});

describe('תרגום ערכים ומספור אוטומטי', () => {
  it('"פעיל" נכתב כ-active ולא נדחה על אילוץ CHECK', () => {
    // התבנית בעברית, ה-CHECK באנגלית. בלי המיפוי ההוספה נכשלת.
    executeImport(db, {
      mode: 'insert',
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב', סטאטוס: 'לא פעיל' },
        ]),
      ),
      userId,
    });
    expect(db.prepare('SELECT status FROM member').get()).toEqual({ status: 'inactive' });
  });

  it('סוג נדר ריק מקבל את ברירת המחדל', () => {
    // ל-kind אין DEFAULT ב-DB, ולכן הוא חייב להגיע מהקטלוג.
    executeImport(db, {
      mode: 'insert',
      sheets: [
        {
          entity: 'member',
          rows: prepare('member', [{ 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב' }]),
        },
        {
          entity: 'vow_charge',
          rows: prepare(
            'vow_charge',
            [{ 'מספר חבר': '1', תאריך: '18/10/2025', 'פרשה / אירוע': 'בראשית', 'סכום (₪)': '360' }],
            new Map([['member', new Set(['1'])]]),
          ),
        },
      ],
      userId,
    });
    expect(db.prepare('SELECT kind FROM vow_charge').get()).toEqual({ kind: 'vow' });
  });

  it('"זיכוי" נכתב כ-credit', () => {
    executeImport(db, {
      mode: 'insert',
      sheets: [
        {
          entity: 'member',
          rows: prepare('member', [{ 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב' }]),
        },
        {
          entity: 'vow_charge',
          rows: prepare(
            'vow_charge',
            [{
              'מספר חבר': '1', תאריך: '18/10/2025', 'פרשה / אירוע': 'בראשית',
              'סכום (₪)': '100', סוג: 'זיכוי', 'סיבת זיכוי': 'טעות רישום',
            }],
            new Map([['member', new Set(['1'])]]),
          ),
        },
      ],
      userId,
    });
    expect(db.prepare('SELECT kind FROM vow_charge').get()).toEqual({ kind: 'credit' });
  });

  it('מספר תרומה ריק מקבל את הבא ברצף', () => {
    // התבנית מבטיחה "ריק = המערכת מקצה"; בלי המימוש זו שגיאת NOT NULL
    // על שדה שסומן רשות.
    const rows = prepare('donation', [
      {
        תאריך: '09/09/2026', 'שם התורם': 'אלמוני', 'סוג תרומה': 'בדק בית',
        'אמצעי תשלום': 'מזומן', 'סכום (₪)': '200',
      },
      {
        תאריך: '10/09/2026', 'שם התורם': 'פלוני', 'סוג תרומה': 'בדק בית',
        'אמצעי תשלום': 'מזומן', 'סכום (₪)': '300',
      },
    ]);
    executeImport(db, { mode: 'insert', sheets: [{ entity: 'donation', rows }], userId });

    const numbers = (
      db.prepare('SELECT donation_number n FROM donation ORDER BY n').all() as { n: number }[]
    ).map((r) => r.n);
    expect(numbers).toHaveLength(2);
    expect(numbers[1]).toBe(numbers[0]! + 1);
  });

  it('מספר תרומה מפורש נשמר כמו שהוא', () => {
    const rows = prepare('donation', [
      {
        'מספר תרומה': '77', תאריך: '09/09/2026', 'שם התורם': 'אלמוני',
        'סוג תרומה': 'בדק בית', 'אמצעי תשלום': 'מזומן', 'סכום (₪)': '200',
      },
    ]);
    executeImport(db, { mode: 'insert', sheets: [{ entity: 'donation', rows }], userId });
    expect(db.prepare('SELECT donation_number FROM donation').get()).toEqual({
      donation_number: 77,
    });
  });

  it('תא ריק בעדכון אינו מוחק ערך קיים', () => {
    // המלכודת: גיליון עם עמודה ריקה היה מרוקן שדות במערכת.
    executeImport(db, {
      mode: 'insert',
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב', כינוי: 'קיים' },
        ]),
      ),
      userId,
    });
    executeImport(db, {
      mode: 'upsert',
      sheets: members(
        prepare('member', [
          { 'מספר חבר': '1', 'שם פרטי': 'א', 'שם משפחה': 'ב', כינוי: '' },
        ]),
      ),
      userId,
    });
    expect(db.prepare('SELECT nickname FROM member').get()).toEqual({ nickname: 'קיים' });
  });
});

describe('טרנזקציה – הכול או כלום', () => {
  it('כישלון באמצע מגלגל את הכול אחורה', () => {
    // שורה שלישית בלי שם משפחה – עוברת את `insert` ונכשלת על NOT NULL
    // ברמת ה-DB. שורות שעברו אימות לא יגיעו לכאן, אבל שכבת הכתיבה
    // חייבת להיות בטוחה גם כשמשהו חומק.
    const rows: ParsedRow[] = [
      { row: 3, values: { 'מספר חבר': 1, 'שם פרטי': 'א', 'שם משפחה': 'ב' } },
      { row: 4, values: { 'מספר חבר': 2, 'שם פרטי': 'ג', 'שם משפחה': 'ד' } },
      { row: 5, values: { 'מספר חבר': 3, 'שם פרטי': 'ה', 'שם משפחה': null } },
    ];
    expect(() =>
      executeImport(db, { mode: 'insert', sheets: members(rows), userId }),
    ).toThrow();

    // ייבוא שנכשל באמצע והשאיר שני חברים גרוע מכישלון מלא – הוא נראה
    // כמו הצלחה חלקית.
    expect(count('member')).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='import'").get() as { n: number })
        .n,
    ).toBe(0);
  });
});

describe('חסימת מחיקה כשקיימות קבלות', () => {
  function issueReceipt(): void {
    db.prepare(
      `INSERT INTO receipt (receipt_number, source_type, source_id, payer_name, amount_agorot,
         payment_method_text, payment_date, purpose_text, hebrew_year, issued_at)
       VALUES (1, 'vow_payment', 1, 'משלם', 1000, 'מזומן', '2026-01-01', 'תשלום', 'תשפ״ו', '2026-01-01T10:00:00')`,
    ).run();
  }

  it('ללא קבלות – אין חסימה', () => {
    expect(blockingReasons(db, 'replace', ['vow_payment'])).toEqual([]);
  });

  it('עם קבלות – מחיקת תשלומים ותרומות חסומה', () => {
    issueReceipt();
    const blocks = blockingReasons(db, 'replace', ['vow_payment', 'donation']);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.message).toContain('קבלה');
  });

  it('החסימה חלה רק על מצב המחיקה', () => {
    issueReceipt();
    for (const mode of ['upsert', 'insert', 'enrich'] as const) {
      expect(blockingReasons(db, mode, ['vow_payment']), mode).toEqual([]);
    }
  });

  it('יישות שאינה בייבוא אינה נחסמת', () => {
    issueReceipt();
    expect(blockingReasons(db, 'replace', ['member'])).toEqual([]);
  });

  it('קבלה מבוטלת אינה חוסמת', () => {
    issueReceipt();
    db.prepare("UPDATE receipt SET cancelled_at = '2026-01-02T10:00:00'").run();
    expect(blockingReasons(db, 'replace', ['vow_payment'])).toEqual([]);
  });
});

describe('פותר ההפניות', () => {
  it('מוצא רשומה שכבר ב-DB', () => {
    executeImport(db, {
      mode: 'insert',
      sheets: members(prepare('member', [{ 'מספר חבר': '7', 'שם פרטי': 'א', 'שם משפחה': 'ב' }])),
      userId,
    });
    const resolve = buildResolver(db, new Map());
    expect(resolve('member', '7')).toBe(true);
    expect(resolve('member', '8')).toBe(false);
  });

  it('מוצא גם רשומה שרק בקובץ הנוכחי', () => {
    // בלי זה, ייבוא ראשוני של חברים + תרומות היה דוחה את כל התרומות.
    const resolve = buildResolver(db, new Map([['member', new Set(['99'])]]));
    expect(resolve('member', '99')).toBe(true);
  });

  it('מפתח ריק אינו נפתר', () => {
    expect(buildResolver(db, new Map())('member', '')).toBe(false);
  });

  it('existingKeys מחזיר את המפתחות שבטבלה', () => {
    executeImport(db, {
      mode: 'insert',
      sheets: members(prepare('member', [{ 'מספר חבר': '3', 'שם פרטי': 'א', 'שם משפחה': 'ב' }])),
      userId,
    });
    expect(existingKeys(db, importEntity('member'))).toEqual(new Set(['3']));
  });
});
