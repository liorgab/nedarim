import { describe, expect, it } from 'vitest';
import {
  COMBINED_PARASHIOT,
  CREDIT_REASONS,
  EVENTS,
  HOLIDAYS,
  PARASHIOT,
} from '@main/db/seed-data';
import {
  normalizeOccasionText,
  resolveDonationType,
  resolveExpenseCategory,
  resolveOccasion,
  resolvePaymentMethod,
} from './occasions';

const KNOWN = new Set<string>([
  ...PARASHIOT.map((p) => p.he),
  ...COMBINED_PARASHIOT.map((p) => p.he),
  ...HOLIDAYS.map((h) => h.he),
  ...EVENTS,
  ...CREDIT_REASONS,
  'יתרת פתיחה',
  'אחר',
]);

const r = (text: string, amount = 100, date: string | null = '2025-01-01') =>
  resolveOccasion(text, amount, date, KNOWN);

describe('normalizeOccasionText', () => {
  it('מאחד גרשיים ומכווץ רווחים', () => {
    expect(normalizeOccasionText('יוה״כ')).toBe('יוה"כ');
    expect(normalizeOccasionText('כי  תבוא')).toBe('כי תבוא');
    expect(normalizeOccasionText('  ניצבים  וילך ')).toBe('ניצבים וילך');
  });
});

describe('פרשות – התאמה ישירה', () => {
  it.each(['בראשית', 'נח', 'לך לך', 'כי תבוא', 'האזינו'])('%s', (name) => {
    expect(r(name)).toMatchObject({ occasionName: name, note: null, needsReview: false });
  });
});

describe('שגיאות כתיב שנמצאו בקובץ', () => {
  it.each([
    ['תצווה', 'תצוה'],
    ['פיקודי', 'פקודי'],
    ['פחקודי', 'פקודי'],
    ['מיקץ', 'מקץ'],
    ['בוא', 'בא'],
    ['קורח', 'קרח'],
    ['ניצבים', 'נצבים'],
    ['נחח', 'נח'],
    ['כי תישא', 'כי תשא'],
    ['כי  תבוא', 'כי תבוא'],
  ])('%s → %s', (input, expected) => {
    expect(r(input)).toMatchObject({ occasionName: expected, needsReview: false });
  });
});

describe('פרשות מחוברות', () => {
  it.each([
    ['מטות מסעי', 'מטות-מסעי'],
    ['מטות מעי', 'מטות-מסעי'],
    ['ניצבים וילך', 'נצבים-וילך'],
    ['ניצבין וילך', 'נצבים-וילך'],
    ['נצבים וילך', 'נצבים-וילך'],
    ['בהר בחוקותי', 'בהר-בחוקותי'],
    ['תזריע מצורע', 'תזריע-מצורע'],
    ['אחרי מות קדושים', 'אחרי מות-קדושים'],
    ['אחרי מות קדושעם', 'אחרי מות-קדושים'],
  ])('%s → %s', (input, expected) => {
    expect(r(input)).toMatchObject({ occasionName: expected, needsReview: false });
  });
});

describe('חגים וקיצורים', () => {
  it.each([
    ['יוה"כ', 'יום כיפור'],
    ['יוה״כ', 'יום כיפור'],
    ['חג סוכות', 'סוכות'],
    ['חג פסח', 'פסח'],
    ['פסח ראשון', 'פסח'],
    ['שבת סוכות', 'שבת חול המועד סוכות'],
    ['סוכות/שבת', 'שבת חול המועד סוכות'],
    ['סוכוץ/שבת', 'שבת חול המועד סוכות'],
    ['פסח/שבת', 'שבת חול המועד פסח'],
    ['י בטבת', 'עשרה בטבת'],
    ['ברכות השנה', 'ברכת השנה'],
  ])('%s → %s', (input, expected) => {
    expect(r(input)).toMatchObject({ occasionName: expected, needsReview: false });
  });

  it('רוה"ש האזינו → ראש השנה + הערה', () => {
    expect(r('רוה"ש האזינו')).toMatchObject({
      occasionName: 'ראש השנה',
      note: 'האזינו',
      needsReview: false,
    });
  });
});

describe('הכרעה לפי תאריך', () => {
  it('שבת חוה"מ בניסן → פסח', () => {
    expect(r('שבת חוה"מ', 100, '2026-04-04')).toMatchObject({
      occasionName: 'שבת חול המועד פסח',
    });
  });

  it('שבת חוה"מ בתשרי → סוכות', () => {
    expect(r('שבת חוה"מ', 100, '2025-10-11')).toMatchObject({
      occasionName: 'שבת חול המועד סוכות',
    });
  });

  it('שבת חוה"מ -יצחק → פסח + הערה', () => {
    expect(r('שבת חוה"מ -יצחק', 100, '2024-04-27')).toMatchObject({
      occasionName: 'שבת חול המועד פסח',
      note: 'יצחק',
    });
  });
});

describe('הפרדת פירוט חופשי', () => {
  it.each([
    ['אמור- זגורי', 'אמור', 'זגורי'],
    ['ויגש -חיים', 'ויגש', 'חיים'],
    ['ויגש דור', 'ויגש', 'דור'],
    ['בא - מאיר חמו של אייל', 'בא', 'מאיר חמו של אייל'],
    ['ברכת השנה-קורן', 'ברכת השנה', 'קורן'],
    ['ברכת השנה יצחק', 'ברכת השנה', 'יצחק'],
    ['נח- הבן של רוני', 'נח', 'הבן של רוני'],
    ['הקפות אורין', 'הקפות', 'אורין'],
    ['שמחת תורה אבא', 'שמחת תורה', 'אבא'],
    ['יוה"כ-אלירן', 'יום כיפור', 'אלירן'],
    ['צו-יצחק שיטרית', 'צו', 'יצחק שיטרית'],
  ])('%s → %s + "%s"', (input, occasion, note) => {
    expect(r(input)).toMatchObject({ occasionName: occasion, note, needsReview: false });
  });
});

describe('יתרת פתיחה', () => {
  it.each(['יתרות תשפ"ג', 'יתרות תשפ״ג'])('%s', (input) => {
    expect(r(input, 1392)).toMatchObject({
      occasionName: 'יתרת פתיחה',
      isOpening: true,
      note: null,
      needsReview: false,
    });
  });

  it('יתרות תשפ"ג מרגי שמעון → הערה נשמרת', () => {
    expect(r('יתרות תשפ"ג מרגי שמעון')).toMatchObject({
      occasionName: 'יתרת פתיחה',
      isOpening: true,
      note: 'מרגי שמעון',
    });
  });

  it('יתרת פתיחה שלילית נשארת יתרת פתיחה, לא זיכוי', () => {
    // חבר 24 בקובץ: -5 ₪
    expect(r('יתרות תשפ"ג', -5)).toMatchObject({ isOpening: true, isCredit: false });
  });
});

describe('זיכויים', () => {
  it('סכום שלילי ללא מילת זיכוי – מסווג לפי הסימן', () => {
    expect(r('ראש השנה', -300)).toMatchObject({
      occasionName: 'ראש השנה',
      isCredit: true,
      creditReason: 'זיכוי – אחר',
    });
  });

  it('"זיכוי" לבד', () => {
    expect(r('זיכוי', -100)).toMatchObject({ isCredit: true, occasionName: 'אחר' });
  });

  it('זיכוי עם פרשה נשמר תחת הפרשה (לצורך F-82)', () => {
    expect(r('זיכוי תולדות', -50)).toMatchObject({
      occasionName: 'תולדות',
      isCredit: true,
    });
    expect(r('עקב-זיכוי', -86)).toMatchObject({ occasionName: 'עקב', isCredit: true });
  });

  it('סיבת הזיכוי נגזרת מהטקסט', () => {
    expect(r('זיכוי חיוב בטעות', -150).creditReason).toBe('זיכוי – חיוב בטעות');
    expect(r('זיכוי-לא משלם', -100).creditReason).toBe('זיכוי – לא משלם (מחיקת חוב)');
    expect(r('זיכוי-ממתקים', -20).creditReason).toBe('זיכוי – אחר');
  });

  it('שגיאת כתיב "זיבוי" מזוהה', () => {
    expect(r('זיבוי שמעון מרגי', -300)).toMatchObject({ isCredit: true });
  });

  it('"חיוב על זיכוי בטעות" בסכום חיובי נשאר חיוב', () => {
    expect(r('חיוב על זיכוי בטעות', 10).isCredit).toBe(false);
  });

  it('זיכוי של יתרת פתיחה', () => {
    expect(r('זיכוי חוב יתרות תשפ"ג', -3758)).toMatchObject({
      occasionName: 'יתרת פתיחה',
      isCredit: true,
    });
  });
});

describe('ערכים מיוחדים וזבל', () => {
  it.each([
    ['סיכום שנתי', 'אחר'],
    ['חוב', 'אחר'],
    ['איפוס', 'אחר'],
    ['לא ידוע', 'אחר'],
    ['תרומה שלא נרשמה', 'אחר'],
  ])('%s → אחר + דגל', (input, expected) => {
    const res = r(input);
    expect(res.occasionName).toBe(expected);
    expect(res.needsReview).toBe(true);
  });

  it("צ'ק חזר נשאר חיוב תקין ללא דגל", () => {
    expect(r("צ'ק חזר", 2358)).toMatchObject({
      occasionName: 'אחר',
      isCredit: false,
      needsReview: false,
    });
  });

  it.each(['100', 'צ2', 'אושרי', 'טישב', ''])('"%s" → אחר + דגל + טקסט מקורי בהערה', (input) => {
    const res = r(input);
    expect(res.occasionName).toBe('אחר');
    expect(res.needsReview).toBe(true);
    if (input !== '') expect(res.note).toBe(input);
  });
});

describe('resolvePaymentMethod', () => {
  const methods = new Set(['מזומן', 'המחאה', 'הוראת קבע', 'כרטיס אשראי', 'העברה בנקאית']);

  it.each(['מזומן', 'המחאה', 'הוראת קבע'])('%s מוכר', (m) => {
    expect(resolvePaymentMethod(m, methods)).toMatchObject({ name: m, needsReview: false });
  });

  it.each([
    [100, 'מזומן'],
    ['שולם והודפס', 'מזומן'],
    [null, 'מזומן'],
    ['', 'מזומן'],
  ])('ערך פגום %s → מזומן + דגל', (input, expected) => {
    const res = resolvePaymentMethod(input, methods);
    expect(res.name).toBe(expected);
    expect(res.needsReview).toBe(true);
  });

  it('מזומן-מאיר חזן → מזומן ללא דגל (alias מפורש)', () => {
    expect(resolvePaymentMethod('מזומן-מאיר חזן', methods)).toMatchObject({
      name: 'מזומן',
      needsReview: false,
    });
  });
});

describe('resolveExpenseCategory', () => {
  it.each([
    ['משכורת לרב לחודש ספטמבר כולל מענק חג', 'משכורת לרב'],
    ['שקע מזגן', 'תחזוקה ותיקונים'],
    ['אושר עד שמחת תורה', 'כיבוד וחגים'],
    ['טישו ושקיות אשפה', 'כיבוד וחגים'],
    ['חשבון חשמל', 'חשמל ומים'],
    ['תיקון אינסטלציה', 'תחזוקה ותיקונים'],
    ['משהו אחר לגמרי', 'אחר'],
  ])('"%s" → %s', (desc, expected) => {
    expect(resolveExpenseCategory(desc).category).toBe(expected);
  });
});

describe('resolveDonationType', () => {
  const types = new Set(['בדק בית', 'ברכת השנה', 'משכורת לרב', 'כללי']);

  it('סוג מוכר עובר כמו שהוא', () => {
    expect(resolveDonationType('בדק בית', '', types)).toMatchObject({
      name: 'בדק בית',
      needsReview: false,
    });
  });

  it('ריק עם ייעוד "משכורת לרב" → משכורת לרב', () => {
    expect(resolveDonationType(null, 'תרומה למשכורת לרב', types).name).toBe('משכורת לרב');
  });

  it('ריק לגמרי → כללי + דגל', () => {
    expect(resolveDonationType(null, '', types)).toMatchObject({
      name: 'כללי',
      needsReview: true,
    });
  });
});
