import { describe, expect, it } from 'vitest';
import {
  IMPORT_MODES,
  MODE_INFO,
  SKIP_TEXT,
  countActions,
  decideRowAction,
  fillableFields,
  type DecideRowInput,
  type ImportMode,
} from './modes';

/**
 * זה הכלל שקובע מה קורה לנתונים כספיים קיימים. "העשרה שדורסת" או
 * "הוספה שמוחקת" הן טעויות שמתגלות רק אחרי שהנתונים כבר אבדו.
 */

const input = (over: Partial<DecideRowInput> = {}): DecideRowInput => ({
  mode: 'upsert',
  hasNaturalKey: true,
  existing: null,
  incoming: { 'שם פרטי': 'ישראל', נייד: '0501234567' },
  ...over,
});

const existing = (values: Record<string, string | number | null>) => ({ id: 7, values });

describe('טבלת המצבים', () => {
  it('לכל מצב יש תיאור ותווית', () => {
    for (const m of IMPORT_MODES) {
      expect(MODE_INFO[m].label, m).not.toBe('');
      expect(MODE_INFO[m].description.length, m).toBeGreaterThan(20);
    }
  });

  it('רק מצב המחיקה מסומן כמסוכן', () => {
    expect(MODE_INFO.replace.danger).not.toBeNull();
    for (const m of ['upsert', 'insert', 'enrich'] as const) {
      expect(MODE_INFO[m].danger, m).toBeNull();
    }
  });

  it('לכל סיבת דילוג יש טקסט', () => {
    for (const [reason, text] of Object.entries(SKIP_TEXT)) {
      expect(text.length, reason).toBeGreaterThan(5);
    }
  });
});

describe('replace – מחיקה וייבוא מחדש', () => {
  it('כל שורה היא הוספה, גם כשיש רשומה קיימת', () => {
    // הטבלה רוקנה מראש, ולכן אין למה להתאים.
    expect(decideRowAction(input({ mode: 'replace', existing: existing({}) }))).toEqual({
      kind: 'insert',
    });
  });

  it('עובד גם בלי מפתח טבעי', () => {
    expect(
      decideRowAction(input({ mode: 'replace', hasNaturalKey: false })).kind,
    ).toBe('insert');
  });
});

describe('upsert – עדכון + הוספה', () => {
  it('רשומה חדשה מתווספת', () => {
    expect(decideRowAction(input({ mode: 'upsert' }))).toEqual({ kind: 'insert' });
  });

  it('רשומה קיימת מתעדכנת', () => {
    expect(decideRowAction(input({ mode: 'upsert', existing: existing({}) }))).toEqual({
      kind: 'update',
      id: 7,
    });
  });
});

describe('insert – הוספת חסרות בלבד', () => {
  it('רשומה חדשה מתווספת', () => {
    expect(decideRowAction(input({ mode: 'insert' })).kind).toBe('insert');
  });

  it('רשומה קיימת מדולגת ואינה משתנה', () => {
    // ההבטחה המרכזית של המצב הזה.
    const action = decideRowAction(input({ mode: 'insert', existing: existing({}) }));
    expect(action).toEqual({ kind: 'skip', reason: 'already-exists' });
  });
});

describe('enrich – העשרה', () => {
  it('ממלא רק שדה שריק ברשומה הקיימת', () => {
    const action = decideRowAction(
      input({
        mode: 'enrich',
        existing: existing({ 'שם פרטי': 'ישראל', נייד: null }),
      }),
    );
    expect(action).toEqual({ kind: 'enrich', id: 7, fields: ['נייד'] });
  });

  it('אינו דורס ערך קיים', () => {
    // המלכודת המרכזית: העשרה שדורסת היא עדכון, והמשתמש לא ביקש עדכון.
    const action = decideRowAction(
      input({
        mode: 'enrich',
        existing: existing({ 'שם פרטי': 'משה', נייד: '0509999999' }),
        incoming: { 'שם פרטי': 'ישראל', נייד: '0501234567' },
      }),
    );
    expect(action).toEqual({ kind: 'skip', reason: 'nothing-to-fill' });
  });

  it('תא ריק בקובץ אינו מוחק ערך קיים', () => {
    // המלכודת השנייה: גיליון עם עמודה ריקה היה מרוקן שדות במערכת.
    const action = decideRowAction(
      input({
        mode: 'enrich',
        existing: existing({ 'שם פרטי': 'משה', נייד: '0509999999' }),
        incoming: { 'שם פרטי': null, נייד: '' },
      }),
    );
    expect(action.kind).toBe('skip');
  });

  it('אינו יוצר רשומות חדשות', () => {
    expect(decideRowAction(input({ mode: 'enrich', existing: null }))).toEqual({
      kind: 'skip',
      reason: 'no-match',
    });
  });

  it('רווחים בלבד נחשבים ריק', () => {
    const action = decideRowAction(
      input({ mode: 'enrich', existing: existing({ נייד: '   ', 'שם פרטי': 'א' }) }),
    );
    expect(action.kind).toBe('enrich');
    if (action.kind !== 'enrich') return;
    expect(action.fields).toEqual(['נייד']);
  });
});

describe('יישות בלי מפתח טבעי', () => {
  it('הוספה ועדכון מתנהגים כהוספה', () => {
    // נדר אינו ניתן לזיהוי – אין לו מספר ייחודי.
    for (const mode of ['insert', 'upsert'] as ImportMode[]) {
      expect(decideRowAction(input({ mode, hasNaturalKey: false })).kind, mode).toBe('insert');
    }
  });

  it('העשרה בלתי אפשרית ומדווחת בבירור', () => {
    expect(decideRowAction(input({ mode: 'enrich', hasNaturalKey: false }))).toEqual({
      kind: 'skip',
      reason: 'no-natural-key',
    });
  });
});

describe('fillableFields', () => {
  it('רק ריק בקיים ומלא בנכנס', () => {
    expect(
      fillableFields(
        { a: null, b: 'יש', c: '', d: 'יש' },
        { a: 'חדש', b: 'חדש', c: null, d: '' },
      ),
    ).toEqual(['a']);
  });

  it('אפס אינו נחשב ריק', () => {
    // יתרת פתיחה 0 היא ערך אמיתי, לא שדה שלא מולא.
    expect(fillableFields({ balance: 0 }, { balance: 500 })).toEqual([]);
  });

  it('שדה שאינו בקיים כלל נחשב ריק', () => {
    expect(fillableFields({}, { a: 'x' })).toEqual(['a']);
  });
});

describe('countActions', () => {
  it('סופר לפי סוג', () => {
    const counts = countActions([
      { kind: 'insert' },
      { kind: 'insert' },
      { kind: 'update', id: 1 },
      { kind: 'enrich', id: 2, fields: ['a'] },
      { kind: 'skip', reason: 'already-exists' },
    ]);
    expect(counts).toEqual({ insert: 2, update: 1, enrich: 1, skip: 1 });
  });

  it('רשימה ריקה', () => {
    expect(countActions([])).toEqual({ insert: 0, update: 0, enrich: 0, skip: 0 });
  });
});
