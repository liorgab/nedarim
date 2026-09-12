import { formatAgorot } from '@shared/money';

/**
 * W-12..W-14 – רינדור תבנית הודעה עם שדות `{{field}}`.
 *
 * **טהור בכוונה**: הוא מקבל הקשר מוכן ולא `db`. הסיבה מעשית – `parasha`,
 * `today_hebrew` ו-`synagogue_name` מגיעים משלושה מקורות שונים (hebcal,
 * טבלת `occasion`, `setting`), ואם הרנדרר היה שולף אותם בעצמו כל בדיקת
 * יחידה הייתה דורשת בסיס נתונים. מי שמרכיב את ההקשר הוא `templates.ts`.
 */

export interface TemplateFieldSpec {
  key: string;
  label: string;
  /** דוגמה שמוצגת בצ'יפ בעורך, כדי שהגבאי יבין מה יצא. */
  example: string;
}

/** W-12 – השדות הזמינים. הרשימה הזו היא גם מקור הצ'יפים בעורך וגם הוולידציה. */
export const TEMPLATE_FIELDS: readonly TemplateFieldSpec[] = [
  { key: 'first_name', label: 'שם פרטי', example: 'ישראל' },
  { key: 'last_name', label: 'שם משפחה', example: 'ישראלי' },
  { key: 'full_name', label: 'שם מלא', example: 'ישראל ישראלי' },
  { key: 'nickname_or_first', label: 'כינוי או שם פרטי', example: 'שרוליק' },
  { key: 'member_number', label: 'מספר חבר', example: '35' },
  { key: 'balance', label: 'יתרה', example: '350 ₪' },
  { key: 'balance_abs', label: 'יתרה בערך מוחלט', example: '350 ₪' },
  { key: 'last_payment_date', label: 'תאריך תשלום אחרון', example: '14/10/2025' },
  {
    key: 'open_charges',
    label: 'פירוט החוב',
    example: '18/10/2025 · בראשית · 500 ₪\n25/10/2025 · נח · 360 ₪',
  },
  { key: 'open_charges_count', label: 'מספר חיובים פתוחים', example: '2' },
  { key: 'today', label: 'תאריך היום', example: '06/09/2026' },
  { key: 'today_hebrew', label: 'תאריך עברי', example: 'כ״ד באלול תשפ״ו' },
  { key: 'parasha', label: 'פרשת השבוע', example: 'נצבים־וילך' },
  { key: 'hebrew_year', label: 'שנה עברית', example: 'תשפ״ו' },
  { key: 'synagogue_name', label: 'שם בית הכנסת', example: 'בית הכנסת' },
  { key: 'gabbai_phone', label: 'טלפון הגבאי', example: '050-0000000' },
];

/**
 * W-85 – שדות שיש להם ערך רק בתבנית אירוע (נדר, תשלום, קבלה...).
 *
 * הם מופרדים מ-`TEMPLATE_FIELDS` ולא מעורבבים בה כדי שעורך התבניות יוכל
 * להציג אותם בקבוצה נפרדת: בקמפיין רגיל אין "סכום האירוע", והצגתם שם
 * הייתה מזמינה תבנית ששולחת `—` ל-90 חברים.
 */
export const EVENT_FIELDS: readonly TemplateFieldSpec[] = [
  { key: 'amount', label: 'סכום האירוע', example: '360 ₪' },
  { key: 'event_date', label: 'תאריך האירוע', example: '18/10/2025' },
  { key: 'occasion', label: 'אירוע/פרשה', example: 'בראשית' },
  { key: 'payment_method', label: 'אמצעי תשלום', example: 'מזומן' },
  { key: 'receipt_number', label: 'מספר קבלה', example: '1042' },
  { key: 'balance_after', label: 'יתרה אחרי הפעולה', example: '350 ₪' },
];

const EVENT_FIELD_KEYS = new Set(EVENT_FIELDS.map((f) => f.key));

const FIELD_KEYS = new Set([...TEMPLATE_FIELDS, ...EVENT_FIELDS].map((f) => f.key));

/** שורה בפירוט החוב. הגזירה עצמה ב-`services/openCharges.ts`. */
export interface OpenChargeLine {
  date: string | null;
  occasion: string;
  note: string | null;
  amountAgorot: number;
  remainingAgorot: number;
}

/** הנתונים של חבר יחיד, כפי שהם נדרשים לרינדור. */
export interface MemberContext {
  firstName: string;
  lastName: string;
  nickname: string | null;
  memberNumber: number;
  balanceAgorot: number;
  lastPaymentDate: string | null;
  /** החיובים שטרם כוסו (FIFO). ריק = אין חוב פתוח. */
  openCharges: readonly OpenChargeLine[];
}

/** נתונים שזהים לכל הנמענים בקמפיין – מחושבים פעם אחת. */
export interface CampaignContext {
  todayIso: string;
  todayHebrew: string;
  parasha: string;
  hebrewYear: string;
  synagogueName: string;
  gabbaiPhone: string;
  /**
   * כמה שורות פירוט להציג לכל היותר. 0 = ללא הגבלה.
   *
   * בנתוני האמת יש חברים עם 33 חיובים פתוחים, והודעת WhatsApp עם 33 שורות
   * היא קיר טקסט שאיש לא קורא. מה שנחתך מסוכם בשורה אחת, כך שהסכום הכולל
   * נשמר ואינו "נעלם".
   */
  openChargesMaxLines: number;
}

/**
 * W-85 – נתוני האירוע שיצר את ההודעה. `null` בכל קמפיין רגיל.
 *
 * כל שדה עשוי להיות `null` בנפרד: לתרומה אין אמצעי תשלום מוצג, לנדר אין
 * מספר קבלה, ולזיכוי אין פרשה.
 */
export interface EventContext {
  amountAgorot: number | null;
  eventDate: string | null;
  occasion: string | null;
  paymentMethod: string | null;
  receiptNumber: string | null;
  /** היתרה **אחרי** הפעולה – זה מה שהופך את השרשור ליומן. */
  balanceAfterAgorot: number | null;
}

/** תצוגה `dd/mm/yyyy`, זהה לזו שב-renderer (CLAUDE.md כלל 2). */
function formatDate(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const EMPTY = '—';

/**
 * פירוט החוב כרשימת שורות. פורמט: `תאריך · פרשה · סכום`.
 *
 * ההודעה נשלחת ב-WhatsApp, שאין בו טבלאות – ולכן שורה לכל חיוב, מופרדת
 * בנקודה מוגבהת. חיוב ששולם חלקית מוצג ביתרה שנותרה בלבד, אחרת הסכום
 * שבהודעה לא היה מסתכם ליתרה שהחבר רואה בשורה התחתונה.
 */
function formatOpenCharges(lines: readonly OpenChargeLine[], maxLines: number): string {
  if (lines.length === 0) return EMPTY;

  const limit = maxLines > 0 ? maxLines : lines.length;
  const shown = lines.slice(0, limit);
  const hidden = lines.slice(limit);

  const rendered = shown
    .map((line) => {
      const parts = [
        line.date === null ? null : formatDate(line.date),
        line.note !== null && line.note.trim() !== ''
          ? `${line.occasion} (${line.note.trim()})`
          : line.occasion,
        formatAgorot(line.remainingAgorot),
      ].filter((p): p is string => p !== null);
      return parts.join(' · ');
    })
    .join('\n');

  if (hidden.length === 0) return rendered;

  const hiddenTotal = hidden.reduce((sum, line) => sum + line.remainingAgorot, 0);
  return `${rendered}\nועוד ${hidden.length} חיובים · ${formatAgorot(hiddenTotal)}`;
}

function valueFor(
  key: string,
  member: MemberContext,
  campaign: CampaignContext,
  event: EventContext | null,
): string {
  switch (key) {
    case 'first_name':
      return member.firstName;
    case 'last_name':
      return member.lastName;
    case 'full_name':
      return `${member.firstName} ${member.lastName}`.trim();
    case 'nickname_or_first':
      // הכינוי הוא איך שקוראים לו בבית הכנסת; אם אין – השם הפרטי.
      return member.nickname !== null && member.nickname.trim() !== ''
        ? member.nickname.trim()
        : member.firstName;
    case 'member_number':
      return String(member.memberNumber);
    case 'balance':
      // יתרה שלילית היא זכות של החבר, והיא מוצגת ככזו ולא כמספר שלילי
      // באמצע משפט שמבקש תשלום.
      return member.balanceAgorot < 0
        ? `${formatAgorot(Math.abs(member.balanceAgorot))} לזכותך`
        : formatAgorot(member.balanceAgorot);
    case 'balance_abs':
      return formatAgorot(Math.abs(member.balanceAgorot));
    case 'last_payment_date':
      return formatDate(member.lastPaymentDate);
    case 'open_charges':
      return formatOpenCharges(member.openCharges, campaign.openChargesMaxLines);
    case 'open_charges_count':
      return String(member.openCharges.length);
    case 'today':
      return formatDate(campaign.todayIso);
    case 'today_hebrew':
      return campaign.todayHebrew || EMPTY;
    case 'parasha':
      return campaign.parasha || EMPTY;
    case 'hebrew_year':
      return campaign.hebrewYear || EMPTY;
    case 'synagogue_name':
      return campaign.synagogueName || EMPTY;
    case 'gabbai_phone':
      return campaign.gabbaiPhone || EMPTY;
    case 'amount':
      return event?.amountAgorot === null || event === null
        ? EMPTY
        : formatAgorot(Math.abs(event.amountAgorot));
    case 'event_date':
      return formatDate(event?.eventDate ?? null);
    case 'occasion':
      return event?.occasion || EMPTY;
    case 'payment_method':
      return event?.paymentMethod || EMPTY;
    case 'receipt_number':
      return event?.receiptNumber || EMPTY;
    case 'balance_after':
      // אותה מוסכמה כמו `balance`: יתרה שלילית היא זכות, ולא מספר שלילי
      // באמצע הודעה.
      if (event === null || event.balanceAfterAgorot === null) return EMPTY;
      return event.balanceAfterAgorot < 0
        ? `${formatAgorot(Math.abs(event.balanceAfterAgorot))} לזכותך`
        : formatAgorot(event.balanceAfterAgorot);
    default:
      return '';
  }
}

/** תופס `{{field}}` עם רווחים אופציונליים סביב השם. */
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * W-87 – שורה מותנית: `? ` בתחילת שורה.
 *
 * השורה נכללת רק אם **כל** השדות שבה קיבלו ערך אמיתי. הצורך מעשי: תבנית
 * התשלום רוצה להזכיר את מספר הקבלה, אבל תשלום בלי קבלה היה מקבל שורה
 * "קבלה מספר —". אותו דבר לגבי אסמכתא, הערת אירוע ופרשה בזיכוי.
 *
 * כלל אחד ולא שפת תבניות: אין תנאים מקוננים ואין `else`. שורה בלי שדות
 * כלל נכללת תמיד – אחרת `? תודה רבה` היה נעלם בלי סיבה.
 */
const CONDITIONAL_LINE = /^[ \t]*\?[ \t]/;

/**
 * W-13 – מרנדר את גוף התבנית עבור חבר יחיד.
 * שדה לא מוכר נשאר כפי שהוא, כדי שהגבאי יראה אותו בתצוגה המקדימה במקום
 * לקבל טקסט ריק בלי הסבר. השמירה נחסמת ממילא על ידי `validateTemplate`.
 */
export function renderTemplate(
  body: string,
  member: MemberContext,
  campaign: CampaignContext,
  event: EventContext | null = null,
): string {
  const render = (text: string): string =>
    text.replace(PLACEHOLDER, (match, key: string) =>
      FIELD_KEYS.has(key) ? valueFor(key, member, campaign, event) : match,
    );

  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (!CONDITIONAL_LINE.test(line)) {
      lines.push(render(line));
      continue;
    }
    const stripped = line.replace(CONDITIONAL_LINE, '');
    const keys = [...stripped.matchAll(PLACEHOLDER)]
      .map((m) => m[1]!)
      .filter((key) => FIELD_KEYS.has(key));
    const hasEmpty = keys.some((key) => {
      const value = valueFor(key, member, campaign, event);
      return value === '' || value === EMPTY;
    });
    if (!hasEmpty) lines.push(render(stripped));
  }
  return lines.join('\n');
}

export interface TemplateValidation {
  ok: boolean;
  /** שמות שדות שאינם ברשימה – שגיאה חוסמת. */
  unknownFields: string[];
  errors: string[];
  /** אזהרות שאינן חוסמות שמירה. */
  warnings: string[];
}

/** אורך שמעליו WhatsApp מתחיל לקצץ בתצוגה; אזהרה, לא שגיאה (W-14). */
const LONG_BODY = 1000;

/**
 * W-14 – ולידציה של גוף תבנית.
 *
 * `isEventTemplate` משפיע רק על אזהרה: שדה אירוע בתבנית חופשית יתרנדר
 * `—` אצל כל נמען, וזו טעות שקטה שכדאי להצביע עליה בעורך.
 */
export function validateTemplate(body: string, isEventTemplate = false): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unknown = new Set<string>();

  if (body.trim() === '') {
    errors.push('גוף ההודעה אינו יכול להיות ריק');
  }

  for (const match of body.matchAll(PLACEHOLDER)) {
    const key = match[1]!;
    if (!FIELD_KEYS.has(key)) unknown.add(key);
  }
  for (const key of unknown) {
    errors.push(`השדה {{${key}}} אינו מוכר`);
  }

  // סוגריים לא סגורים הם טעות הקלדה נפוצה, והיא שקטה: ההודעה נשלחת עם
  // "{{first_name" בתוכה.
  const opens = (body.match(/\{\{/g) ?? []).length;
  const closes = (body.match(/\}\}/g) ?? []).length;
  if (opens !== closes) {
    errors.push('יש סוגריים מסולסלים שלא נסגרו');
  }

  if (!isEventTemplate) {
    const eventFieldsUsed = [...body.matchAll(PLACEHOLDER)]
      .map((m) => m[1]!)
      .filter((key) => EVENT_FIELD_KEYS.has(key));
    for (const key of new Set(eventFieldsUsed)) {
      warnings.push(`השדה {{${key}}} מקבל ערך רק בתבנית אירוע, ובקמפיין רגיל יוצג "—"`);
    }
  }

  if (body.length > LONG_BODY) {
    warnings.push(`ההודעה ארוכה מ-${LONG_BODY} תווים (${body.length}) ועלולה להיקטע בתצוגה`);
  }

  return { ok: errors.length === 0, unknownFields: [...unknown], errors, warnings };
}
