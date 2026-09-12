import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_ENTITIES, importEntity } from './catalog';
import { fieldHint, sheetRows, templateSheets, writeTemplate } from './template';

/**
 * תבנית הייבוא. הבדיקה **קוראת את הקובץ בחזרה** עם `xlsx` – קורא עצמאי –
 * ולא מסתפקת בכך שנוצר: תבנית שנפתחת שבורה ב-Excel היא בדיוק סוג הכשל
 * שמתגלה רק אצל מי שניסה להשתמש בה.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nedarim-tpl-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('קטלוג הייבוא', () => {
  it('שמות גיליונות ייחודיים ובאורך חוקי ל-Excel', () => {
    const sheets = IMPORT_ENTITIES.map((e) => e.sheet);
    expect(new Set(sheets).size).toBe(sheets.length);
    for (const s of sheets) {
      expect(s.length, s).toBeLessThanOrEqual(31);
      // התווים ש-Excel אוסר בשם גיליון: : \ / ? * [ ]
      expect(s, s).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it('לכל יישות יש לפחות שדה חובה אחד', () => {
    for (const e of IMPORT_ENTITIES) {
      expect(e.fields.some((f) => f.required), e.id).toBe(true);
    }
  });

  it('כותרות השדות ייחודיות בתוך כל יישות', () => {
    for (const e of IMPORT_ENTITIES) {
      const labels = e.fields.map((f) => f.label);
      expect(new Set(labels).size, e.id).toBe(labels.length);
    }
  });

  it('כל שדה ref מצביע ליישות קיימת ולשדה קיים בה', () => {
    for (const e of IMPORT_ENTITIES) {
      for (const f of e.fields) {
        if (f.ref === undefined) continue;
        const target = importEntity(f.ref.entity);
        expect(target.fields.map((t) => t.label), `${e.id}.${f.label}`).toContain(f.ref.by);
        // שדה ref חייב להופיע גם ב-dependsOn, אחרת סדר הייבוא שגוי.
        expect(e.dependsOn, `${e.id} → ${f.ref.entity}`).toContain(f.ref.entity);
      }
    }
  });

  it('שדה עם עמודה ב-DB אינו גם ref', () => {
    // ref מתורגם למזהה בייבוא; עמודה ישירה נכתבת כמו שהיא. שניהם יחד
    // אומר שמישהו לא החליט מה קורה לערך.
    for (const e of IMPORT_ENTITIES) {
      for (const f of e.fields) {
        if (f.ref !== undefined) expect(f.column, `${e.id}.${f.label}`).toBeNull();
      }
    }
  });
});

describe('fieldHint', () => {
  it('מסמן חובה ורשות', () => {
    expect(fieldHint({ label: 'x', column: 'x', type: 'text', required: true })).toContain('חובה');
    expect(fieldHint({ label: 'x', column: 'x', type: 'text', required: false })).toContain('רשות');
  });

  it('מציג ערכים מותרים', () => {
    const hint = fieldHint({
      label: 'x', column: 'x', type: 'choice', required: false, choices: ['כן', 'לא'],
    });
    expect(hint).toContain('כן / לא');
  });

  it('מפנה לגיליון המקור בשדה ref', () => {
    const member = importEntity('donation').fields.find((f) => f.label === 'מספר חבר')!;
    expect(fieldHint(member)).toContain('חברים');
  });
});

describe('מבנה הגיליון', () => {
  const rows = sheetRows(importEntity('member'));

  it('ארבע שורות: הסבר, כותרות, עזרה, דוגמה', () => {
    expect(rows).toHaveLength(4);
  });

  it('שדה חובה מסומן בכוכבית ובאדום, רשות בירוק', () => {
    const entity = importEntity('member');
    entity.fields.forEach((f, i) => {
      const cell = rows[1]![i]!;
      expect(cell.value, f.label).toBe(f.required ? `${f.label} *` : f.label);
      // הצבע נושא את המידע, אבל לא לבדו – ראו שורת העזרה.
      expect(cell.backgroundColor, f.label).toBe(f.required ? '#F8D7DA' : '#D1E7DD');
    });
  });

  it('חובה/רשות מופיע גם כטקסט, לא רק כצבע', () => {
    // הדפסה בשחור-לבן ועיוורון צבעים מבטלים את ההבחנה החזותית.
    const entity = importEntity('member');
    entity.fields.forEach((f, i) => {
      expect(rows[2]![i]!.value, f.label).toContain(f.required ? 'חובה' : 'רשות');
    });
  });

  it('שורת הדוגמה מסומנת למחיקה', () => {
    // בלי הסימון היא מיובאת כרשומה אמיתית – טעות שקורית כמעט תמיד.
    expect(rows[3]![0]!.value).toContain('למחוק');
  });
});

describe('templateSheets', () => {
  it('הגיליונות בסדר הייבוא – חברים לפני נדרים', () => {
    const names = templateSheets().map((s) => s.sheet);
    expect(names.indexOf('חברים')).toBeLessThan(names.indexOf('נדרים'));
    expect(names.indexOf('אמצעי תשלום')).toBeLessThan(names.indexOf('תשלומים'));
  });

  it('כל גיליון מוגדר RTL', () => {
    for (const s of templateSheets()) expect(s.rightToLeft, s.sheet).toBe(true);
  });

  it('רוחב עמודה לכל שדה', () => {
    for (const s of templateSheets()) {
      const entity = IMPORT_ENTITIES.find((e) => e.sheet === s.sheet)!;
      expect(s.columns, s.sheet).toHaveLength(entity.fields.length);
    }
  });
});

describe('הקובץ שנוצר', () => {
  async function readBack(path: string): Promise<Record<string, string[][]>> {
    const XLSX = await import('xlsx');
    const book = XLSX.read(path, { type: 'file' });
    const out: Record<string, string[][]> = {};
    for (const name of book.SheetNames) {
      out[name] = XLSX.utils.sheet_to_json(book.Sheets[name]!, {
        header: 1, raw: false, defval: '',
      }) as string[][];
    }
    return out;
  }

  it('נוצר גיליון לכל יישות, ונקרא בחזרה', async () => {
    const path = await writeTemplate(join(dir, 'tpl.xlsx'));
    const sheets = await readBack(path);
    expect(Object.keys(sheets)).toHaveLength(IMPORT_ENTITIES.length);
    for (const e of IMPORT_ENTITIES) expect(Object.keys(sheets), e.sheet).toContain(e.sheet);
  });

  it('הכותרות בגיליון החברים נקראות בעברית', async () => {
    const path = await writeTemplate(join(dir, 'tpl2.xlsx'));
    const rows = (await readBack(path))['חברים']!;
    expect(rows[1]).toContain('מספר חבר *');
    expect(rows[1]).toContain('כינוי');
  });
});
