/**
 * F-120 – קטלוג היישויות שניתן לייבא.
 *
 * **הכלל המרכזי: התבנית מדברת בשפה של הגבאי, לא של בסיס הנתונים.**
 * בקובץ האקסל כותבים "מספר חבר 35" ו"פרשה: בראשית", לא `member_id=35`
 * ו-`occasion_id=1`. אף אחד לא יודע מה המזהה הפנימי, ובקובץ שנערך ביד
 * הוא גם משתנה בין התקנות. התרגום נעשה בייבוא, וכישלון שלו הוא בדיוק
 * סוג השגיאה שהאשף אמור לדווח ("תרומה לחבר 47 – החבר אינו קיים").
 *
 * מה **לא** נמצא כאן בכוונה: `audit_log` (יומן ביקורת אינו נתון שמייבאים),
 * `schema_version`, `sequence`, `user`, `setting` ו-`message_*`. ייבוא של
 * יומן ביקורת היה הופך אותו מראיה לטענה.
 */

export type ImportEntityId =
  | 'payment_method'
  | 'donation_type'
  | 'expense_category'
  | 'occasion'
  | 'member'
  | 'vow_charge'
  | 'vow_payment'
  | 'donation'
  | 'expense';

export type ImportFieldType = 'text' | 'number' | 'money' | 'date' | 'bool' | 'choice';

export interface ImportField {
  /** כותרת העמודה בגיליון – בעברית, כי הגבאי עורך את הקובץ. */
  label: string;
  /** העמודה ב-DB. `null` כשהשדה הוא מפתח אנושי שמתורגם בייבוא. */
  column: string | null;
  type: ImportFieldType;
  required: boolean;
  help?: string;
  example?: string;
  choices?: readonly string[];
  /**
   * תרגום מהערך שהגבאי כותב לערך שב-DB.
   *
   * הכרחי כשהתבנית בעברית וה-CHECK באנגלית: "פעיל" → `active`,
   * "נדר" → `vow`. בלי המיפוי הערך נכתב כמו שהוא ונדחה על אילוץ –
   * שגיאת DB סתומה במקום ייבוא שעובד.
   */
  dbValues?: Readonly<Record<string, string>>;
  /** ערך ה-DB כשהתא ריק ואין לעמודה ברירת מחדל משלה. */
  defaultValue?: string | number;
  /**
   * שדה שמצביע על יישות אחרת לפי מפתח אנושי.
   * `by` הוא ה-label של השדה המזהה באותה יישות.
   */
  ref?: { entity: ImportEntityId; by: string };
}

export interface ImportEntity {
  id: ImportEntityId;
  /** שם הגיליון בקובץ. עד 31 תווים, ייחודי (מגבלת Excel). */
  sheet: string;
  label: string;
  table: string;
  /**
   * המפתח האנושי שמזהה רשומה קיימת – הבסיס למצבי "עדכון" ו"הוספת חסרות".
   * ריק = אין מפתח יציב, ולכן היישות תומכת בהוספה בלבד.
   */
  naturalKey: readonly string[];
  /** יישויות שחייבות להיות מיובאות לפניה. */
  dependsOn: readonly ImportEntityId[];
  fields: readonly ImportField[];
  /** הסבר שמופיע בראש הגיליון בתבנית. */
  intro: string;
}

const ACTIVE: ImportField = {
  label: 'פעיל',
  column: 'is_active',
  type: 'bool',
  required: false,
  help: 'כן / לא. ריק = כן',
  example: 'כן',
};

/** רשימות ערכים – שלוש יישויות זהות במבנה. */
const lookup = (
  id: ImportEntityId,
  sheet: string,
  label: string,
  table: string,
  example: string,
): ImportEntity => ({
  id,
  sheet,
  label,
  table,
  naturalKey: ['שם'],
  dependsOn: [],
  intro: `רשימת ${label}. השם חייב להיות ייחודי.`,
  fields: [
    { label: 'שם', column: 'name', type: 'text', required: true, example },
    ACTIVE,
  ],
});

export const IMPORT_ENTITIES: readonly ImportEntity[] = [
  lookup('payment_method', 'אמצעי תשלום', 'אמצעי תשלום', 'payment_method', 'מזומן'),
  lookup('donation_type', 'סוגי תרומה', 'סוגי תרומה', 'donation_type', 'בדק בית'),
  lookup('expense_category', 'קטגוריות הוצאה', 'קטגוריות הוצאה', 'expense_category', 'חשמל ומים'),

  {
    id: 'occasion',
    sheet: 'פרשות ואירועים',
    label: 'פרשות ואירועים',
    table: 'occasion',
    naturalKey: ['שם'],
    dependsOn: [],
    intro:
      'פרשות השבוע, חגים ואירועים. המערכת מגיעה עם הרשימה המלאה – כאן מוסיפים אירועים מקומיים בלבד (בר מצווה, אזכרה, וכדומה).',
    fields: [
      { label: 'שם', column: 'name', type: 'text', required: true, example: 'בר מצווה' },
      {
        label: 'סוג',
        column: 'type',
        type: 'choice',
        required: true,
        choices: ['parasha', 'holiday', 'event', 'credit', 'opening', 'other'],
        help: 'event = אירוע מקומי',
        example: 'event',
      },
      ACTIVE,
    ],
  },

  {
    id: 'member',
    sheet: 'חברים',
    label: 'חברים',
    table: 'member',
    naturalKey: ['מספר חבר'],
    dependsOn: [],
    intro:
      'חברי בית הכנסת. זו היישות הראשונה שמיובאת – כל השאר מפנה אליה לפי מספר החבר.',
    fields: [
      {
        label: 'מספר חבר',
        column: 'member_number',
        type: 'number',
        required: true,
        help: 'מזהה ייחודי. כל שאר הגיליונות מפנים אליו.',
        example: '35',
      },
      { label: 'שם פרטי', column: 'first_name', type: 'text', required: true, example: 'ישראל' },
      { label: 'שם משפחה', column: 'last_name', type: 'text', required: true, example: 'ישראלי' },
      { label: 'כינוי', column: 'nickname', type: 'text', required: false, example: 'שרוליק' },
      {
        label: 'נייד',
        column: 'mobile',
        type: 'text',
        required: false,
        help: 'כל צורה – המערכת מנרמלת',
        example: '050-1234567',
      },
      { label: 'דוא״ל', column: 'email', type: 'text', required: false },
      { label: 'כתובת', column: 'address', type: 'text', required: false },
      {
        label: 'סטאטוס',
        column: 'status',
        type: 'choice',
        required: false,
        choices: ['פעיל', 'לא פעיל'],
        dbValues: { פעיל: 'active', 'לא פעיל': 'inactive' },
        help: 'ריק = פעיל',
        example: 'פעיל',
      },
      {
        label: 'יתרת פתיחה (₪)',
        column: 'opening_balance_agorot',
        type: 'money',
        required: false,
        help: 'חוב קיים מלפני המערכת. שלילי = יתרת זכות.',
        example: '1500',
      },
      { label: 'הערות', column: 'notes', type: 'text', required: false },
    ],
  },

  {
    id: 'vow_charge',
    sheet: 'נדרים',
    label: 'נדרים וזיכויים',
    table: 'vow_charge',
    naturalKey: [],
    dependsOn: ['member', 'occasion'],
    intro:
      'נדרים וזיכויים. אין מפתח ייחודי לנדר, ולכן היישות תומכת בהוספה בלבד – ייבוא חוזר של אותו קובץ ייצור כפילויות.',
    fields: [
      {
        label: 'מספר חבר',
        column: null,
        type: 'number',
        required: true,
        ref: { entity: 'member', by: 'מספר חבר' },
        example: '35',
      },
      { label: 'תאריך', column: 'charge_date', type: 'date', required: true, example: '18/10/2025' },
      {
        label: 'פרשה / אירוע',
        column: null,
        type: 'text',
        required: true,
        ref: { entity: 'occasion', by: 'שם' },
        help: 'שם מתוך גיליון "פרשות ואירועים"',
        example: 'בראשית',
      },
      { label: 'פירוט', column: 'occasion_note', type: 'text', required: false, example: 'הבן' },
      { label: 'סכום (₪)', column: 'amount_agorot', type: 'money', required: true, example: '360' },
      {
        label: 'סוג',
        column: 'kind',
        type: 'choice',
        required: false,
        choices: ['נדר', 'זיכוי'],
        dbValues: { נדר: 'vow', זיכוי: 'credit' },
        defaultValue: 'vow',
        help: 'ריק = נדר',
        example: 'נדר',
      },
      {
        label: 'סיבת זיכוי',
        column: 'credit_reason',
        type: 'text',
        required: false,
        help: 'חובה כשהסוג הוא "זיכוי"',
        example: 'טעות רישום',
      },
      { label: 'הערות', column: 'notes', type: 'text', required: false },
    ],
  },

  {
    id: 'vow_payment',
    sheet: 'תשלומים',
    label: 'תשלומי נדרים',
    table: 'vow_payment',
    naturalKey: [],
    dependsOn: ['member', 'payment_method'],
    intro:
      'תשלומים על חשבון נדרים. הייבוא **אינו מפיק קבלות** – מספרי קבלה מוקצים רק מתוך המערכת (כלל 4), ולכן תשלום מיובא נכנס בסטאטוס "שולם" בלי קבלה.',
    fields: [
      {
        label: 'מספר חבר',
        column: null,
        type: 'number',
        required: true,
        ref: { entity: 'member', by: 'מספר חבר' },
        example: '35',
      },
      {
        label: 'תאריך',
        column: 'payment_date',
        type: 'date',
        required: true,
        example: '14/10/2025',
      },
      { label: 'סכום (₪)', column: 'amount_agorot', type: 'money', required: true, example: '500' },
      {
        label: 'אמצעי תשלום',
        column: null,
        type: 'text',
        required: true,
        ref: { entity: 'payment_method', by: 'שם' },
        example: 'מזומן',
      },
      { label: 'אסמכתא', column: 'reference', type: 'text', required: false, example: '12345' },
      { label: 'הערות', column: 'notes', type: 'text', required: false },
    ],
  },

  {
    id: 'donation',
    sheet: 'תרומות',
    label: 'תרומות',
    table: 'donation',
    naturalKey: ['מספר תרומה'],
    dependsOn: ['member', 'donation_type', 'payment_method'],
    intro:
      'תרומות. התורם יכול להיות חבר (לפי מספר חבר) או שם חופשי – אם שניהם ריקים הרשומה נדחית.',
    fields: [
      {
        label: 'מספר תרומה',
        column: 'donation_number',
        type: 'number',
        required: false,
        help: 'ריק = המערכת מקצה את הבא בתור',
        example: '46',
      },
      {
        label: 'תאריך',
        column: 'donation_date',
        type: 'date',
        required: true,
        example: '09/09/2026',
      },
      {
        label: 'מספר חבר',
        column: null,
        type: 'number',
        required: false,
        ref: { entity: 'member', by: 'מספר חבר' },
        help: 'ריק כשהתורם אינו חבר',
        example: '35',
      },
      {
        label: 'שם התורם',
        column: 'donor_name',
        type: 'text',
        required: true,
        example: 'ישראל ישראלי',
      },
      {
        label: 'סוג תרומה',
        column: null,
        type: 'text',
        required: true,
        ref: { entity: 'donation_type', by: 'שם' },
        example: 'בדק בית',
      },
      {
        label: 'אמצעי תשלום',
        column: null,
        type: 'text',
        required: true,
        ref: { entity: 'payment_method', by: 'שם' },
        example: 'מזומן',
      },
      { label: 'סכום (₪)', column: 'amount_agorot', type: 'money', required: true, example: '200' },
      { label: 'ייעוד', column: 'purpose', type: 'text', required: false },
      { label: 'אסמכתא', column: 'reference', type: 'text', required: false },
      { label: 'הערות', column: 'notes', type: 'text', required: false },
    ],
  },

  {
    id: 'expense',
    sheet: 'הוצאות',
    label: 'הוצאות',
    table: 'expense',
    naturalKey: ['מספר הוצאה'],
    dependsOn: ['expense_category', 'payment_method'],
    intro: 'הוצאות בית הכנסת. החזר מסומן בעמודה "החזר" ויכול להיות בסכום שלילי.',
    fields: [
      {
        label: 'מספר הוצאה',
        column: 'expense_number',
        type: 'number',
        required: false,
        help: 'ריק = המערכת מקצה את הבא בתור',
        example: '170',
      },
      {
        label: 'תאריך',
        column: 'expense_date',
        type: 'date',
        required: true,
        example: '20/01/2026',
      },
      { label: 'סכום (₪)', column: 'amount_agorot', type: 'money', required: true, example: '700' },
      {
        label: 'קטגוריה',
        column: null,
        type: 'text',
        required: true,
        ref: { entity: 'expense_category', by: 'שם' },
        example: 'חשמל ומים',
      },
      { label: 'תיאור', column: 'description', type: 'text', required: true, example: 'חשבון חשמל' },
      { label: 'ספק', column: 'supplier', type: 'text', required: false },
      {
        label: 'אמצעי תשלום',
        column: null,
        type: 'text',
        required: false,
        ref: { entity: 'payment_method', by: 'שם' },
      },
      { label: 'אסמכתא', column: 'reference', type: 'text', required: false },
      { label: 'החזר', column: 'is_refund', type: 'bool', required: false, help: 'כן / לא' },
      { label: 'הערות', column: 'notes', type: 'text', required: false },
    ],
  },
];

export function importEntity(id: ImportEntityId): ImportEntity {
  const found = IMPORT_ENTITIES.find((e) => e.id === id);
  if (found === undefined) throw new Error(`יישות ייבוא לא מוכרת: ${id}`);
  return found;
}
