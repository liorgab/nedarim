import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/connection';
import { seed } from '../db/seed';
import {
  createVowItem,
  deleteVowItem,
  getVowItem,
  listVowItems,
  updateVowItem,
  vowItemCategories,
} from './vowItems';

/**
 * F-140..F-143 – רשימת הנדרים למכירה, מול DB אמיתי.
 *
 * הבדיקה החשובה כאן היא הסינון לפי מועד: זו הסיבה שהרשימה קיימת, וגם
 * המקום היחיד שבו טעות אינה נראית כשגיאה אלא כרשימה שנראית סבירה.
 */

let dir: string;
let db: Database;

const occasionId = (name: string): number =>
  (db.prepare('SELECT id FROM occasion WHERE name = ?').get(name) as { id: number }).id;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-vowitems-'));
  db = openDatabase({ file: join(dir, 'nedarim.db') });
  seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('הזרעה', () => {
  it('103 הכיבודים נכתבים בהתקנה', () => {
    expect(listVowItems(db)).toHaveLength(103);
  });

  it('הזרעה שנייה אינה מחזירה כיבוד שנמחק', () => {
    // בלי זה, כיבוד שהגבאי מחק היה חוזר בכל הפעלה של היישום.
    const item = listVowItems(db)[0]!;
    deleteVowItem(db, item.id, 1);
    seed(db);
    expect(listVowItems(db).some((i) => i.id === item.id)).toBe(false);
  });

  it('הקטגוריות מהפנקס נשמרו', () => {
    expect(vowItemCategories(db)).toContain('שבת רגילה');
    expect(vowItemCategories(db)).toContain('ימים נוראים');
  });

  it('הכיבודים מקושרים למועדים', () => {
    const yonah = listVowItems(db).find((i) => i.name.includes('מפטיר יונה'))!;
    expect(yonah.scope).toBe('occasion');
    expect(yonah.occasionNames).toEqual(['יום כיפור']);
  });
});

describe('סינון לפי מועד', () => {
  it('בפרשה מופיעים כיבודי שבת', () => {
    const items = listVowItems(db, { occasionId: occasionId('בראשית') });
    expect(items.some((i) => i.name === 'עליית שלישי (שחרית)')).toBe(true);
  });

  it('בפרשה לא מופיעים כיבודי חג', () => {
    const items = listVowItems(db, { occasionId: occasionId('בראשית') });
    expect(items.some((i) => i.name.includes('מפטיר יונה'))).toBe(false);
  });

  it('ביום כיפור מופיעים כיבודי כיפור', () => {
    const items = listVowItems(db, { occasionId: occasionId('יום כיפור') });
    const names = items.map((i) => i.name);
    expect(names.some((n) => n.includes('כל נדרי'))).toBe(true);
    expect(names.some((n) => n.includes('נעילה'))).toBe(true);
    expect(names.some((n) => n.includes('פרנס השנה'))).toBe(true);
  });

  it('ביום כיפור לא מופיעות 18 עליות השבת', () => {
    // אין קריאה של שבת רגילה ביום כיפור, והצגתן הייתה מטביעה את מה
    // שבאמת נמכר.
    const items = listVowItems(db, { occasionId: occasionId('יום כיפור') });
    expect(items.some((i) => i.category === 'שבת רגילה')).toBe(false);
  });

  it('שביעי של פסח אינו מציג את כיבודי יום א׳ של פסח', () => {
    const items = listVowItems(db, { occasionId: occasionId('שביעי של פסח') });
    expect(items.some((i) => i.name.includes('שירת הים'))).toBe(true);
    expect(items.some((i) => i.name.includes("פסח - יום א'"))).toBe(false);
  });

  it('שבת חול המועד סוכות מציגה גם כיבודי חוה״מ וגם כיבודי שבת', () => {
    // היא פרשה **וגם** מועד, ולכן שתי הקבוצות רלוונטיות.
    const items = listVowItems(db, { occasionId: occasionId('שבת חול המועד סוכות') });
    expect(items.some((i) => i.name.includes('חול המועד סוכות'))).toBe(true);
  });

  it('בלי סינון מוחזרת כל הרשימה', () => {
    expect(listVowItems(db).length).toBeGreaterThan(
      listVowItems(db, { occasionId: occasionId('יום כיפור') }).length,
    );
  });
});

describe('חיפוש וסינון', () => {
  it('חיפוש חופשי בשם', () => {
    const items = listVowItems(db, { search: 'הגבהה' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.name.includes('הגבהה'))).toBe(true);
  });

  it('חיפוש לפי תזמון המכירה', () => {
    expect(listVowItems(db, { search: 'נעילה' }).length).toBeGreaterThan(0);
  });

  it('סינון לפי קטגוריה', () => {
    const items = listVowItems(db, { category: 'שבת רגילה' });
    expect(items).toHaveLength(18);
  });

  it('סינון לפי תחולה', () => {
    expect(listVowItems(db, { scope: 'shabbat' }).length).toBeGreaterThan(0);
  });

  it('כיבוד כבוי אינו מוחזר כברירת מחדל', () => {
    const item = listVowItems(db)[0]!;
    updateVowItem(db, item.id, { ...item, isActive: false }, 1);
    expect(listVowItems(db).some((i) => i.id === item.id)).toBe(false);
    expect(listVowItems(db, { includeInactive: true }).some((i) => i.id === item.id)).toBe(true);
  });
});

describe('CRUD', () => {
  it('יצירה עם שיוך למועד', () => {
    const created = createVowItem(
      db,
      {
        name: 'פתיחת ההיכל בהושענא רבה',
        category: 'ימים נוראים',
        scope: 'occasion',
        occasionIds: [occasionId('הושענא רבה')],
      },
      1,
    );
    expect(created.occasionNames).toEqual(['הושענא רבה']);
    expect(listVowItems(db, { occasionId: occasionId('הושענא רבה') }).map((i) => i.name)).toContain(
      'פתיחת ההיכל בהושענא רבה',
    );
  });

  it('שם ריק נדחה', () => {
    expect(() => createVowItem(db, { name: '   ', scope: 'always' }, 1)).toThrow(/שם/);
  });

  it('שיוך למועדים בלי אף מועד נדחה', () => {
    // אחרת נוצר כיבוד שלא יופיע לעולם באף רשימה.
    expect(() =>
      createVowItem(db, { name: 'כיבוד יתום', scope: 'occasion', occasionIds: [] }, 1),
    ).toThrow(/מועד/);
  });

  it('שם כפול נדחה', () => {
    const name = listVowItems(db)[0]!.name;
    expect(() => createVowItem(db, { name, scope: 'always' }, 1)).toThrow();
  });

  it('עדכון מחליף את השיוך ולא מוסיף לו', () => {
    const item = listVowItems(db).find((i) => i.name.includes('מפטיר יונה'))!;
    const updated = updateVowItem(
      db,
      item.id,
      { ...item, occasionIds: [occasionId('ראש השנה')] },
      1,
    );
    expect(updated.occasionNames).toEqual(['ראש השנה']);
  });

  it('מחיקה של כיבוד שלא נמכר – מחיקה אמיתית', () => {
    const created = createVowItem(db, { name: 'כיבוד זמני', scope: 'always' }, 1);
    expect(deleteVowItem(db, created.id, 1)).toEqual({ deleted: true, usedBy: 0 });
    expect(getVowItem(db, created.id)).toBeNull();
  });

  it('כיבוד שכבר נמכר מכובה ולא נמחק', () => {
    // מחיקה הייתה הופכת "עליית שלישי, 180 ₪" ל"נדר בלי שם" בכרטיסייה.
    const item = listVowItems(db)[0]!;
    db.prepare(
      `INSERT INTO member (member_number, first_name, last_name, created_at, updated_at)
       VALUES (1, 'ישראל', 'ישראלי', '2026-01-01T09:00:00', '2026-01-01T09:00:00')`,
    ).run();
    db.prepare(
      `INSERT INTO vow_charge
         (member_id, charge_date, occasion_id, amount_agorot, kind, vow_item_id, created_at, updated_at)
       VALUES (1, '2026-01-03', ?, 18000, 'vow', ?, '2026-01-03T09:00:00', '2026-01-03T09:00:00')`,
    ).run(occasionId('בראשית'), item.id);

    const result = deleteVowItem(db, item.id, 1);
    expect(result).toEqual({ deleted: false, usedBy: 1 });
    expect(getVowItem(db, item.id)?.isActive).toBe(false);
  });

  it('כל שינוי נרשם ביומן הביקורת', () => {
    const created = createVowItem(db, { name: 'כיבוד ליומן', scope: 'always' }, 1);
    deleteVowItem(db, created.id, 1);
    const rows = db
      .prepare("SELECT action FROM audit_log WHERE entity = 'vow_item' AND entity_id = ?")
      .all(created.id) as Array<{ action: string }>;
    expect(rows.map((r) => r.action)).toEqual(['create', 'delete']);
  });
});
