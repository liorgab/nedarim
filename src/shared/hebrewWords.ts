/**
 * סכום במילים בעברית לקבלה (SPEC F-71, נספח ב').
 *
 * דקדוק: "שקל" זכר, "אגורה" נקבה, ולכן המספר משנה צורה לפי מה שהוא סופר.
 * "מאה" נקבה ולכן המאות תמיד בצורת הנקבה ("שלוש מאות", לא "שלושה מאות").
 * החיבור ב-ו' נעשה רק לפני האיבר האחרון: "מאה עשרים ושלושה", "מאה וחמישה".
 */

export type Gender = 'm' | 'f';

const UNITS: Record<Gender, readonly string[]> = {
  m: ['', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'],
  f: ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'],
};

const TEENS: Record<Gender, readonly string[]> = {
  m: [
    'עשרה',
    'אחד עשר',
    'שנים עשר',
    'שלושה עשר',
    'ארבעה עשר',
    'חמישה עשר',
    'שישה עשר',
    'שבעה עשר',
    'שמונה עשר',
    'תשעה עשר',
  ],
  f: [
    'עשר',
    'אחת עשרה',
    'שתים עשרה',
    'שלוש עשרה',
    'ארבע עשרה',
    'חמש עשרה',
    'שש עשרה',
    'שבע עשרה',
    'שמונה עשרה',
    'תשע עשרה',
  ],
};

const TENS: readonly string[] = [
  '',
  '',
  'עשרים',
  'שלושים',
  'ארבעים',
  'חמישים',
  'שישים',
  'שבעים',
  'שמונים',
  'תשעים',
];

const HUNDREDS: readonly string[] = [
  '',
  'מאה',
  'מאתיים',
  'שלוש מאות',
  'ארבע מאות',
  'חמש מאות',
  'שש מאות',
  'שבע מאות',
  'שמונה מאות',
  'תשע מאות',
];

/** צורת הנסמך של 3–9 לפני "אלפים": "שלושת אלפים". */
const THOUSAND_CONSTRUCT: readonly string[] = [
  '',
  '',
  '',
  'שלושת',
  'ארבעת',
  'חמשת',
  'ששת',
  'שבעת',
  'שמונת',
  'תשעת',
];

/** מחבר איברים: ו' רק לפני האחרון. */
function joinParts(parts: readonly string[]): string {
  const clean = parts.filter((p) => p !== '');
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(' ')} ו${clean[clean.length - 1]}`;
}

/** 1–999 במילים, בהתאם למין. */
export function under1000(n: number, gender: Gender): string {
  if (n <= 0 || n >= 1000) throw new RangeError(`מחוץ לטווח: ${n}`);
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rest > 0) {
    if (rest < 10) {
      parts.push(UNITS[gender][rest]!);
    } else if (rest < 20) {
      parts.push(TEENS[gender][rest - 10]!);
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(TENS[t]!);
      if (u > 0) parts.push(UNITS[gender][u]!);
    }
  }
  return joinParts(parts);
}

/** חלק האלפים: 1000 → 'אלף', 2000 → 'אלפיים', 3000 → 'שלושת אלפים', 25000 → 'עשרים וחמישה אלף'. */
function thousandsWords(thousands: number): string {
  if (thousands === 1) return 'אלף';
  if (thousands === 2) return 'אלפיים';
  if (thousands >= 3 && thousands <= 9) return `${THOUSAND_CONSTRUCT[thousands]} אלפים`;
  if (thousands === 10) return 'עשרת אלפים';
  return `${under1000(thousands, 'm')} אלף`;
}

/** מספר שלם 0–999,999 במילים. 0 מוחזר כמחרוזת ריקה (המתקשר מטפל). */
export function integerToHebrewWords(n: number, gender: Gender): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) {
    throw new RangeError(`המרה למילים נתמכת ל-0..999,999 בלבד, התקבל ${n}`);
  }
  if (n === 0) return '';
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (thousands === 0) return under1000(rest, gender);
  const head = thousandsWords(thousands);
  if (rest === 0) return head;
  const tail = under1000(rest, gender);
  // ו' החיבור מופיעה פעם אחת בלבד, לפני האיבר האחרון של המספר כולו.
  // אם היא כבר קיימת בתוך השארית ("מאתיים שלושים וארבעה") – מחברים ברווח בלבד.
  return tail.includes(' ו') ? `${head} ${tail}` : joinParts([head, tail]);
}

/**
 * הסכום כפי שיודפס על הקבלה, למשל:
 *   100000 אגורות → "אלף שקלים חדשים"
 *   123456 אגורות → "אלף מאתיים שלושים וארבעה שקלים חדשים וחמישים ושש אגורות"
 */
export function amountToHebrewWords(amountAgorot: number): string {
  if (!Number.isInteger(amountAgorot)) {
    throw new TypeError(`סכום באגורות חייב להיות מספר שלם, התקבל ${amountAgorot}`);
  }
  const negative = amountAgorot < 0;
  const abs = Math.abs(amountAgorot);
  const shekels = Math.floor(abs / 100);
  const agorot = abs % 100;

  if (shekels > 999_999) {
    throw new RangeError('סכום גדול מדי להמרה למילים');
  }

  const shekelPart =
    shekels === 0
      ? ''
      : shekels === 1
        ? 'שקל חדש אחד'
        : `${integerToHebrewWords(shekels, 'm')} שקלים חדשים`;

  const agorotPart =
    agorot === 0 ? '' : agorot === 1 ? 'אגורה אחת' : `${integerToHebrewWords(agorot, 'f')} אגורות`;

  let words: string;
  if (shekelPart === '' && agorotPart === '') words = 'אפס שקלים חדשים';
  else if (agorotPart === '') words = shekelPart;
  else if (shekelPart === '') words = agorotPart;
  else words = `${shekelPart} ו${agorotPart}`;

  return negative ? `מינוס ${words}` : words;
}
