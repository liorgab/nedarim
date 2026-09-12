import type { IsoDate } from '@shared/types';
import map from './occasion-map.json' with { type: 'json' };

/**
 * פענוח השדה החופשי 'פרשת שבוע' מהקובץ הישן לרשימה סגורה (SPEC 7.1, WORKBOOK-STRUCTURE).
 *
 * הקובץ מכיל 233 מחרוזות שונות, מהן 148 חד-פעמיות: שגיאות כתיב, פרשה+שם אורח,
 * זיכויים בניסוחים חופשיים וערכי זבל. ההיגיון כאן דטרמיניסטי לחלוטין ומכוסה בבדיקות.
 */

export interface OccasionResolution {
  /** שם ה-occasion ברשימה הסגורה. */
  occasionName: string;
  /** הפירוט החופשי שהופרד מהשם (שם אורח, בן, וכו'). */
  note: string | null;
  /** האם השורה היא זיכוי. */
  isCredit: boolean;
  /** סיבת הזיכוי, כשהשורה זיכוי. */
  creditReason: string | null;
  /** האם השורה היא יתרת פתיחה. */
  isOpening: boolean;
  /** דורש בדיקה ידנית → מגיע לדוח החריגים. */
  needsReview: boolean;
  /** הסבר קצר לדוח. */
  reason?: string;
}

const ALIASES = map.aliases as Record<string, string>;
const EXACT = map.exact as Record<
  string,
  { occasion: string; note: string | null; review?: boolean }
>;
const DATE_DEPENDENT = map.dateDependent as Record<string, { nisan: string; tishrei: string }>;
const CREDIT_PREFIXES = map.creditPrefixes as string[];
const CREDIT_REASONS = map.creditReasons as Array<{ match: string; reason: string }>;

const OPENING_PREFIX = 'יתרות';

/** מנרמל: גרשיים אחידים, רווחים מכווצים, ניקוי קצוות. */
export function normalizeOccasionText(raw: string): string {
  return raw
    .replace(/[‎‏؜]/g, '')
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** מפצל 'אמור- זגורי' ל-['אמור', 'זגורי']. מפריד = מקף עם/בלי רווחים. */
function splitHeadNote(text: string): { head: string; note: string | null } {
  const idx = text.search(/\s*[-–]\s*/);
  if (idx === -1) return { head: text, note: null };
  const m = /\s*[-–]\s*/.exec(text.slice(idx));
  const sepLen = m ? m[0].length : 1;
  const head = text.slice(0, idx).trim();
  const note = text.slice(idx + sepLen).trim();
  return { head, note: note === '' ? null : note };
}

/** חודש עברי גס לפי החודש הלועזי – מספיק כדי להבחין בין פסח לסוכות. */
function seasonOf(date: IsoDate | null): 'nisan' | 'tishrei' | null {
  if (!date) return null;
  const month = Number(date.slice(5, 7));
  if (month >= 3 && month <= 6) return 'nisan';
  if (month >= 9 && month <= 11) return 'tishrei';
  return null;
}

function creditReasonFor(text: string): string {
  for (const r of CREDIT_REASONS) {
    if (text.includes(r.match)) return r.reason;
  }
  return map.defaultCreditReason;
}

/** האם השם הוא ערך תקין ברשימה הסגורה. `known` מגיע מה-DB. */
type KnownNames = ReadonlySet<string>;

/**
 * הפונקציה המרכזית.
 * @param rawText הטקסט מהתא
 * @param amount הסכום (הסימן קובע זיכוי)
 * @param date תאריך התנועה (להכרעת 'שבת חוה"מ')
 * @param known שמות ה-occasion הקיימים ב-DB
 */
export function resolveOccasion(
  rawText: string,
  amount: number,
  date: IsoDate | null,
  known: KnownNames,
): OccasionResolution {
  const text = normalizeOccasionText(rawText);
  const negative = amount < 0;

  // --- יתרת פתיחה: 'יתרות תשפ"ג', 'יתרות תשפ"ג מרגי שמעון', 'יתרות תשפ"ג- זיכוי'
  if (text.startsWith(OPENING_PREFIX)) {
    // מסירים את מילת 'יתרות', את השנה העברית ('תשפ"ג') ואת המפרידים – מה שנשאר הוא ההערה.
    const note = text
      .slice(OPENING_PREFIX.length)
      .replace(/^[\s\-–]*/, '')
      .replace(/^ת[שר]["']?[א-ת]["']?[א-ת]?\s*/, '')
      .replace(/^[\s\-–]*/, '')
      .trim();
    return {
      occasionName: 'יתרת פתיחה',
      note: note === '' ? null : note,
      isCredit: false,
      creditReason: null,
      isOpening: true,
      needsReview: false,
    };
  }

  // --- זיכוי: הסימן קובע; טקסט קובע רק אם הוא *מתחיל* במילת זיכוי.
  const startsWithCredit = CREDIT_PREFIXES.some((p) => text.startsWith(p));
  const isCredit = negative || startsWithCredit;

  if (isCredit) {
    // 'זיכוי חוב יתרות תשפ"ג' → זיכוי של יתרת פתיחה
    const stripped = startsWithCredit
      ? text.replace(new RegExp(`^(${CREDIT_PREFIXES.join('|')})`), '').replace(/^[\s\-–]*/, '')
      : text;
    const inner = resolveNonCredit(stripped, date, known);
    return {
      occasionName: inner.occasionName,
      note: startsWithCredit ? (inner.note ?? (stripped === '' ? null : stripped)) : inner.note,
      isCredit: true,
      creditReason: creditReasonFor(text),
      isOpening: false,
      needsReview: inner.needsReview,
      ...(inner.reason ? { reason: inner.reason } : {}),
    };
  }

  const r = resolveNonCredit(text, date, known);
  return {
    occasionName: r.occasionName,
    note: r.note,
    isCredit: false,
    creditReason: null,
    isOpening: false,
    needsReview: r.needsReview,
    ...(r.reason ? { reason: r.reason } : {}),
  };
}

interface Partial {
  occasionName: string;
  note: string | null;
  needsReview: boolean;
  reason?: string;
}

function lookup(candidate: string, date: IsoDate | null, known: KnownNames): string | null {
  if (known.has(candidate)) return candidate;
  const alias = ALIASES[candidate];
  if (alias && known.has(alias)) return alias;
  const dep = DATE_DEPENDENT[candidate];
  if (dep) {
    const season = seasonOf(date);
    const chosen = season ? dep[season] : dep.nisan;
    if (known.has(chosen)) return chosen;
  }
  return null;
}

function resolveNonCredit(text: string, date: IsoDate | null, known: KnownNames): Partial {
  if (text === '') {
    return { occasionName: 'אחר', note: null, needsReview: true, reason: 'תא פרשה ריק' };
  }

  // זיכוי של יתרת פתיחה: 'זיכוי חוב יתרות תשפ"ג', 'זיכוי - יתרות שנה שעברה'.
  // מגיע לכאן אחרי הסרת מילת הזיכוי, ולכן צריך זיהוי גם באמצע המחרוזת.
  if (text.includes('יתרות')) {
    return { occasionName: 'יתרת פתיחה', note: null, needsReview: false };
  }

  // 1) התאמה מלאה מפורשת
  const exact = EXACT[text];
  if (exact) {
    return {
      occasionName: exact.occasion,
      note: exact.note,
      needsReview: exact.review === true,
      ...(exact.review ? { reason: 'ערך מיוחד שמופה ידנית' } : {}),
    };
  }

  // 2) המחרוזת כולה היא occasion מוכר / alias / תלוי-תאריך
  const whole = lookup(text, date, known);
  if (whole) return { occasionName: whole, note: null, needsReview: false };

  // 3) פיצול לפי מקף: 'אמור- זגורי' → 'אמור' + 'זגורי'
  const { head, note } = splitHeadNote(text);
  if (head !== text) {
    const byHead = lookup(head, date, known);
    if (byHead) return { occasionName: byHead, note, needsReview: false };
  }

  // 4) פיצול לפי רווח מהסוף: 'ברכת השנה יצחק' → 'ברכת השנה' + 'יצחק'
  const words = text.split(' ');
  for (let take = words.length - 1; take >= 1; take--) {
    const candidate = words.slice(0, take).join(' ');
    const found = lookup(candidate, date, known);
    if (found) {
      const rest = words
        .slice(take)
        .join(' ')
        .replace(/^[\s\-–]*/, '')
        .trim();
      return { occasionName: found, note: rest === '' ? null : rest, needsReview: false };
    }
  }

  // 5) לא מזוהה → 'אחר' + הטקסט המקורי כהערה + דגל (WORKBOOK-STRUCTURE)
  return {
    occasionName: 'אחר',
    note: text,
    needsReview: true,
    reason: 'פרשה/אירוע לא מזוהה',
  };
}

/** נרמול אמצעי תשלום מהקובץ הישן. */
export function resolvePaymentMethod(
  raw: unknown,
  known: KnownNames,
): { name: string; needsReview: boolean; reason?: string } {
  const text = raw === null || raw === undefined ? '' : normalizeOccasionText(String(raw));
  if (text !== '' && known.has(text)) return { name: text, needsReview: false };
  const alias = (map.paymentMethodAliases as Record<string, string>)[text];
  if (alias && known.has(alias)) return { name: alias, needsReview: false };
  return {
    name: map.fallbackPaymentMethod,
    needsReview: true,
    reason: text === '' ? 'אמצעי תשלום ריק' : `אמצעי תשלום לא מזוהה: "${text}"`,
  };
}

/** סיווג קטגוריית הוצאה לפי מילות מפתח בפירוט. */
export function resolveExpenseCategory(description: string): {
  category: string;
  matched: boolean;
} {
  const text = normalizeOccasionText(description);
  for (const rule of map.expenseCategoryKeywords as Array<{
    category: string;
    keywords: string[];
  }>) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return { category: rule.category, matched: true };
    }
  }
  return { category: map.fallbackExpenseCategory, matched: false };
}

/** סיווג סוג תרומה: הערך מהקובץ אם מוכר, אחרת לפי הייעוד, אחרת ברירת מחדל. */
export function resolveDonationType(
  raw: unknown,
  purpose: string,
  known: KnownNames,
): { name: string; needsReview: boolean } {
  const text = raw === null || raw === undefined ? '' : normalizeOccasionText(String(raw));
  if (text !== '' && known.has(text)) return { name: text, needsReview: false };
  const haystack = normalizeOccasionText(`${text} ${purpose}`);
  for (const rule of map.donationTypeKeywords as Array<{ type: string; keywords: string[] }>) {
    if (rule.keywords.some((k) => haystack.includes(k)) && known.has(rule.type)) {
      return { name: rule.type, needsReview: true };
    }
  }
  return { name: map.fallbackDonationType, needsReview: true };
}
