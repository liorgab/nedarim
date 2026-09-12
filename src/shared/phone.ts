/**
 * נרמול מספרי נייד ל-E.164 (WB-11, DATA-MODEL "מיגרציה 005").
 *
 * פונקציה **טהורה** – בלי `db`, בלי הגדרות, בלי תופעות לוואי. היא מקור האמת
 * היחיד לשאלה "לאיזה מספר נשלח", ומשמשת גם את ה-repository בכל שמירה וגם את
 * ה-backfill החד-פעמי.
 *
 * העיקרון: `member.mobile` נשאר **בדיוק כפי שהוזן** – זה מה שהגבאי רואה ומקליד.
 * `mobile_e164` הוא הגזירה המכונית שלו, ורק היא נשלחת ל-WhatsApp. כך מספר
 * שהוקלד כ-"050-123-4567 של הבן" נשאר קריא במסך, ובכל זאת נשלח נכון.
 *
 * הפורמט המוחזר הוא ספרות בלבד ללא `+` – זה מה ש-WhatsApp Web מצפה לו
 * בפרמטר `?phone=`.
 */

/** למה המספר נדחה, או מה חריג בו למרות שהוא תקין. מוצג כאזהרה במסך החברים. */
export type MobileReason = 'landline' | 'too_short' | 'multiple' | 'foreign' | 'no_digits';

export type MobileStatus = 'valid' | 'invalid' | 'missing';

export interface NormalizedMobile {
  /** E.164 ללא `+`, למשל `972501234567`. NULL כשאין מספר שמיש. */
  e164: string | null;
  status: MobileStatus;
  reason?: MobileReason;
}

/** אורך נייד ישראלי מנורמל: 972 + 5 + 8 ספרות. */
const IL_MOBILE_LENGTH = 12;
const IL_CODE = '972';

/** אורך סביר למספר בינלאומי כלשהו (E.164 מגביל ל-15). */
const MIN_FOREIGN_DIGITS = 8;
const MAX_E164_DIGITS = 15;

/**
 * מפרידים בין כמה מספרים שנדחסו לשדה אחד, כמו `050-1234567 / 054-1112222`
 * בקובץ הישן.
 *
 * `\b` אינו שמיש כאן: הוא גבול מילה של ASCII בלבד, ומול אותיות עבריות הוא
 * פשוט לא מתאים. לכן "או" ו-"ו-" מזוהים לפי הרווחים שסביבם.
 */
const SEPARATORS = /[/,;|]|\s+או\s+|\s+ו-\s*/;

/** לוקחים את המספר הראשון ומסמנים `multiple`, כדי שהגבאי יראה שיש שם עוד. */
function candidates(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => /\d/.test(part));
}

/** משאיר ספרות בלבד, ומשמר `+` מוביל כסימן שהמספר כבר בינלאומי. */
function digitsOf(text: string): { digits: string; hadPlus: boolean } {
  const trimmed = text.trim();
  const hadPlus = trimmed.startsWith('+');
  return { digits: trimmed.replace(/\D/g, ''), hadPlus };
}

/**
 * מסיר קידומות חיוג בינלאומי ומחזיר את המספר בצורתו הלאומית + קוד המדינה
 * שזוהה, אם זוהה.
 */
function stripInternationalPrefix(
  digits: string,
  hadPlus: boolean,
  countryCode: string,
): { rest: string; country: string | null } {
  // 00 מוביל = קידומת חיוג בינלאומי (`00972...`).
  const value = digits.startsWith('00') ? digits.slice(2) : digits;

  if (value.startsWith(countryCode)) {
    // `9720501234567` – קידומת המדינה ואחריה אפס מקומי מיותר.
    const rest = value.slice(countryCode.length);
    return { rest: rest.startsWith('0') ? rest.slice(1) : rest, country: countryCode };
  }

  // `+1 212 555 0100` – מספר זר מפורש. בלי `+` או `00` אין דרך לדעת שקוד
  // המדינה הוא חלק מהמספר ולא ספרות מקומיות, ולכן מזהים זר רק כשסומן ככזה.
  if ((hadPlus || digits.startsWith('00')) && value.length > 0) {
    return { rest: value, country: 'foreign' };
  }

  return { rest: value, country: null };
}

const isIsraeliMobileNational = (national: string): boolean =>
  national.length === 9 && national.startsWith('5');

/**
 * מנרמל מספר נייד יחיד.
 *
 * @param raw הערך כפי שהוזן ב-`member.mobile`.
 * @param defaultCountryCode קוד המדינה שמניחים כשהמספר מקומי. ברירת מחדל 972.
 */
export function normalizeMobile(
  raw: string | null | undefined,
  defaultCountryCode: string = IL_CODE,
): NormalizedMobile {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { e164: null, status: 'missing' };
  }
  if (!/\d/.test(raw)) {
    // "אין", "לברר" – שדה שמולא בטקסט במקום במספר.
    return { e164: null, status: 'missing', reason: 'no_digits' };
  }

  const parts = candidates(raw);
  const multiple = parts.length > 1;
  const first = parts[0] ?? raw;

  const { digits, hadPlus } = digitsOf(first);
  const { rest, country } = stripInternationalPrefix(digits, hadPlus, defaultCountryCode);

  const withReason = (result: NormalizedMobile): NormalizedMobile => {
    if (multiple && result.status === 'valid') return { ...result, reason: 'multiple' };
    return result;
  };

  // מספר זר מפורש: לא ניתן לדעת בכל מדינה מה נייד ומה קווי, ולכן מקבלים
  // כל מספר באורך סביר ומסמנים `foreign` כדי שהגבאי ישים לב.
  if (country === 'foreign') {
    if (rest.length < MIN_FOREIGN_DIGITS || rest.length > MAX_E164_DIGITS) {
      return { e164: null, status: 'invalid', reason: 'too_short' };
    }
    return withReason({ e164: rest, status: 'valid', reason: 'foreign' });
  }

  // מכאן והלאה: מספר מקומי, או מספר עם קוד המדינה שהוגדר.
  const national = rest.startsWith('0') ? rest.slice(1) : rest;

  if (isIsraeliMobileNational(national)) {
    return withReason({ e164: `${defaultCountryCode}${national}`, status: 'valid' });
  }

  // קווי ישראלי: מתחיל בספרה שאינה 5 (02, 03, 04, 08, 09, 077…).
  if (national.length >= 8 && !national.startsWith('5')) {
    return { e164: null, status: 'invalid', reason: 'landline' };
  }

  return { e164: null, status: 'invalid', reason: 'too_short' };
}

/** תצוגה קריאה של מספר מנורמל: `+972-52-925-9399`. */
export function formatE164ForDisplay(e164: string | null): string {
  if (e164 === null || e164 === '') return '';
  if (e164.startsWith(IL_CODE) && e164.length === IL_MOBILE_LENGTH) {
    const national = e164.slice(IL_CODE.length);
    return `+${IL_CODE}-${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
  }
  return `+${e164}`;
}
