import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import { createVow } from './vows';
import { listVowItems } from './vowItems';
import { runReport } from './reports';

/**
 * F-84 – דוח כיבודים ורוכשים.
 *
 * הבדיקה המרכזית היא דווקא על **השורות הריקות**: דוח שמראה רק את מה
 * שנמכר אינו עונה על השאלה שבגללה הוא קיים – מה לא נמכר.
 */

let dir: string;
let db: Database;

/** 19/09/2026 – שבת פרשת האזינו. */
const SHABBAT = '2026-09-19';

const occasionId = (name: string): number =>
  (db.prepare('SELECT id FROM occasion WHERE name = ?').get(name) as { id: number }).id;

const addMember = (n: number, first: string): number => {
  const info = db
    .prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, 'ישראלי', '2026-01-01T09:00:00', '2026-01-01T09:00:00')`,
    )
    .run(n, first);
  return Number(info.lastInsertRowid);
};

const report = () => runReport(db, 'honors', { range: { kind: 'all' } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-honors-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('דוח כיבודים ורוכשים', () => {
  it('בלי נדרים – הדוח ריק ולא קורס', () => {
    const result = report();
    expect(result.rows).toEqual([]);
    expect(result.totals?.['amount']).toBe(0);
  });

  it('נדר שקושר לכיבוד מופיע עם הרוכש והסכום', () => {
    const member = addMember(1, 'אברהם');
    const item = listVowItems(db).find((i) => i.name === 'עליית שלישי (שחרית)')!;
    createVow(
      db,
      {
        memberId: member,
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        amountAgorot: 18000,
        vowItemId: item.id,
      },
      1,
    );

    const row = report().rows.find((r) => r['honor'] === 'עליית שלישי (שחרית)')!;
    expect(row['buyer']).toBe('אברהם ישראלי');
    expect(row['amount']).toBe(18000);
    expect(row['date']).toBe(SHABBAT);
    expect(String(row['hebrewDate'])).toContain('תשפ');
    expect(row['occasion']).toBe('האזינו');
  });

  it('כיבוד שלא נמכר מופיע עם רוכש וסכום ריקים', () => {
    // זו כל הנקודה של הדוח.
    const member = addMember(1, 'אברהם');
    const item = listVowItems(db).find((i) => i.name === 'עליית שלישי (שחרית)')!;
    createVow(
      db,
      {
        memberId: member,
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        amountAgorot: 18000,
        vowItemId: item.id,
      },
      1,
    );

    const empty = report().rows.find((r) => r['honor'] === 'הגבהה (שחרית)')!;
    expect(empty.buyer ?? null).toBeNull();
    expect(empty['amount']).toBeNull();
  });

  it('כל כיבודי השבת מופיעים, גם כשנמכר רק אחד', () => {
    const member = addMember(1, 'אברהם');
    const item = listVowItems(db).find((i) => i.name === 'עליית שלישי (שחרית)')!;
    createVow(
      db,
      {
        memberId: member,
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        amountAgorot: 18000,
        vowItemId: item.id,
      },
      1,
    );

    const result = report();
    const expected = listVowItems(db, { occasionId: occasionId('האזינו') }).length;
    expect(result.rows).toHaveLength(expected);
    expect(result.kpis.find((k) => k.key === 'sold')?.value).toBe(1);
    expect(result.kpis.find((k) => k.key === 'unsold')?.value).toBe(expected - 1);
  });

  it('נדר בלי שיוך לכיבוד עדיין מופיע – אחרת הדוח מסתיר כסף', () => {
    // כל הנדרים שנרשמו לפני שהרשימה קיימת נמצאים במצב הזה.
    const member = addMember(1, 'אברהם');
    createVow(
      db,
      {
        memberId: member,
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        occasionNote: 'עלייה לרפואת הבן',
        amountAgorot: 25000,
      },
      1,
    );

    const row = report().rows.find((r) => r['honor'] === 'עלייה לרפואת הבן')!;
    expect(row['buyer']).toBe('אברהם ישראלי');
    expect(row['amount']).toBe(25000);
  });

  it('נדר בלי שיוך ובלי פירוט מסומן ולא נעלם', () => {
    const member = addMember(1, 'אברהם');
    createVow(
      db,
      {
        memberId: member,
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        amountAgorot: 5000,
      },
      1,
    );
    expect(report().rows.some((r) => r['honor'] === 'ללא שיוך לכיבוד')).toBe(true);
  });

  it('שני רוכשים לאותו כיבוד – שורה לכל אחד', () => {
    const item = listVowItems(db).find((i) => i.name === 'הגבהה (שחרית)')!;
    for (const [n, name] of [
      [1, 'אברהם'],
      [2, 'יצחק'],
    ] as const) {
      createVow(
        db,
        {
          memberId: addMember(n, name),
          chargeDate: SHABBAT,
          occasionId: occasionId('האזינו'),
          amountAgorot: 10000,
          vowItemId: item.id,
        },
        1,
      );
    }

    const rows = report().rows.filter((r) => r['honor'] === 'הגבהה (שחרית)');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['buyer'])).toEqual(['אברהם ישראלי', 'יצחק ישראלי']);
  });

  it('מועד אחר מציג את הכיבודים שלו ולא של שבת', () => {
    const member = addMember(1, 'אברהם');
    createVow(
      db,
      {
        memberId: member,
        // תאריך בעבר: המערכת אינה מאפשרת יותר מ-7 ימים קדימה.
        chargeDate: '2026-09-12',
        occasionId: occasionId('יום כיפור'),
        amountAgorot: 50000,
      },
      1,
    );

    const honors = report().rows.map((r) => r['honor']);
    expect(honors.some((h) => String(h).includes('כל נדרי'))).toBe(true);
    expect(honors.some((h) => h === 'עליית שלישי (שחרית)')).toBe(false);
  });

  it('הסיכום סופר רק את מה שנמכר', () => {
    const item = listVowItems(db).find((i) => i.name === 'עליית שלישי (שחרית)')!;
    createVow(
      db,
      {
        memberId: addMember(1, 'אברהם'),
        chargeDate: SHABBAT,
        occasionId: occasionId('האזינו'),
        amountAgorot: 18000,
        vowItemId: item.id,
      },
      1,
    );
    expect(report().totals?.['amount']).toBe(18000);
  });

  it('זיכוי אינו מופיע כרכישה', () => {
    // זיכוי הוא תיקון, לא מכירה של כיבוד.
    const member = addMember(1, 'אברהם');
    db.prepare(
      `INSERT INTO vow_charge
         (member_id, charge_date, occasion_id, amount_agorot, kind, credit_reason, created_at, updated_at)
       VALUES (?, ?, ?, 5000, 'credit', 'זיכוי – הנחה', '2026-09-19T09:00:00', '2026-09-19T09:00:00')`,
    ).run(member, SHABBAT, occasionId('האזינו'));

    expect(report().rows).toEqual([]);
  });

  it('הדוח מופיע ברשימת הדוחות', () => {
    expect(report().title).toBe('כיבודים ורוכשים');
  });
});
