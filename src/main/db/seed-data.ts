/**
 * נתוני seed – רשימות הערכים ההתחלתיות (SPEC נספח א').
 * זהו קובץ נתונים בלבד: אין כאן שום ערך ספציפי לבית כנסת מסוים,
 * כדי שכל מי שמוריד את המערכת יתחיל מרשימות תקניות וריקות מנתונים (CLAUDE.md כלל 12).
 */

export interface SeedOccasion {
  name: string;
  type: 'parasha' | 'holiday' | 'event' | 'credit' | 'opening' | 'other';
  hebcalKey?: string;
}

/** 54 פרשות השנה בסדר קריאתן. `hebcalKey` = המזהה האנגלי של @hebcal/core. */
export const PARASHIOT: ReadonlyArray<{ he: string; key: string }> = [
  { he: 'בראשית', key: 'Bereshit' },
  { he: 'נח', key: 'Noach' },
  { he: 'לך לך', key: 'Lech-Lecha' },
  { he: 'וירא', key: 'Vayera' },
  { he: 'חיי שרה', key: 'Chayei Sara' },
  { he: 'תולדות', key: 'Toldot' },
  { he: 'ויצא', key: 'Vayetzei' },
  { he: 'וישלח', key: 'Vayishlach' },
  { he: 'וישב', key: 'Vayeshev' },
  { he: 'מקץ', key: 'Miketz' },
  { he: 'ויגש', key: 'Vayigash' },
  { he: 'ויחי', key: 'Vayechi' },
  { he: 'שמות', key: 'Shemot' },
  { he: 'וארא', key: 'Vaera' },
  { he: 'בא', key: 'Bo' },
  { he: 'בשלח', key: 'Beshalach' },
  { he: 'יתרו', key: 'Yitro' },
  { he: 'משפטים', key: 'Mishpatim' },
  { he: 'תרומה', key: 'Terumah' },
  { he: 'תצוה', key: 'Tetzaveh' },
  { he: 'כי תשא', key: 'Ki Tisa' },
  { he: 'ויקהל', key: 'Vayakhel' },
  { he: 'פקודי', key: 'Pekudei' },
  { he: 'ויקרא', key: 'Vayikra' },
  { he: 'צו', key: 'Tzav' },
  { he: 'שמיני', key: 'Shmini' },
  { he: 'תזריע', key: 'Tazria' },
  { he: 'מצורע', key: 'Metzora' },
  { he: 'אחרי מות', key: 'Achrei Mot' },
  { he: 'קדושים', key: 'Kedoshim' },
  { he: 'אמור', key: 'Emor' },
  { he: 'בהר', key: 'Behar' },
  { he: 'בחוקותי', key: 'Bechukotai' },
  { he: 'במדבר', key: 'Bamidbar' },
  { he: 'נשא', key: 'Nasso' },
  { he: 'בהעלותך', key: "Beha'alotcha" },
  { he: 'שלח לך', key: "Sh'lach" },
  { he: 'קרח', key: 'Korach' },
  { he: 'חוקת', key: 'Chukat' },
  { he: 'בלק', key: 'Balak' },
  { he: 'פנחס', key: 'Pinchas' },
  { he: 'מטות', key: 'Matot' },
  { he: 'מסעי', key: 'Masei' },
  { he: 'דברים', key: 'Devarim' },
  { he: 'ואתחנן', key: 'Vaetchanan' },
  { he: 'עקב', key: 'Eikev' },
  { he: 'ראה', key: "Re'eh" },
  { he: 'שופטים', key: 'Shoftim' },
  { he: 'כי תצא', key: 'Ki Teitzei' },
  { he: 'כי תבוא', key: 'Ki Tavo' },
  { he: 'נצבים', key: 'Nitzavim' },
  { he: 'וילך', key: 'Vayeilech' },
  { he: 'האזינו', key: "Ha'azinu" },
  { he: 'וזאת הברכה', key: 'Vezot Haberakhah' },
];

/** פרשות מחוברות – נקראות כיחידה אחת בשנים מסוימות. */
export const COMBINED_PARASHIOT: ReadonlyArray<{ he: string; key: string }> = [
  { he: 'ויקהל-פקודי', key: 'Vayakhel-Pekudei' },
  { he: 'תזריע-מצורע', key: 'Tazria-Metzora' },
  { he: 'אחרי מות-קדושים', key: 'Achrei Mot-Kedoshim' },
  { he: 'בהר-בחוקותי', key: 'Behar-Bechukotai' },
  { he: 'חוקת-בלק', key: 'Chukat-Balak' },
  { he: 'מטות-מסעי', key: 'Matot-Masei' },
  { he: 'נצבים-וילך', key: 'Nitzavim-Vayeilech' },
];

export const HOLIDAYS: ReadonlyArray<{ he: string; key?: string }> = [
  { he: 'ראש השנה', key: 'Rosh Hashana' },
  { he: 'צום גדליה', key: 'Tzom Gedaliah' },
  { he: 'יום כיפור', key: 'Yom Kippur' },
  // המפתחות כאן הם מה ש-`getSedra` מחזיר לשבת – זה הצרכן היחיד של
  // `hebcal_key`. `Sukkot I`/`Pesach I` (מזהי האירוע ב-`getHolidaysOnDate`)
  // לעולם אינם מוחזרים משם, ולכן היו ערכים מתים.
  { he: 'סוכות', key: 'Sukkot' },
  { he: 'שבת חול המועד סוכות', key: 'Sukkot Shabbat Chol ha-Moed' },
  { he: 'הושענא רבה', key: 'Sukkot VII (Hoshana Raba)' },
  { he: 'שמיני עצרת', key: 'Shmini Atzeret' },
  { he: 'שמחת תורה', key: 'Simchat Torah' },
  { he: 'הקפות' },
  { he: 'חנוכה', key: 'Chanukah' },
  { he: 'עשרה בטבת', key: "Asara B'Tevet" },
  { he: 'ט״ו בשבט', key: 'Tu BiShvat' },
  { he: 'פורים', key: 'Purim' },
  { he: 'פסח', key: 'Pesach' },
  { he: 'שבת חול המועד פסח', key: 'Pesach Shabbat Chol ha-Moed' },
  { he: 'שביעי של פסח', key: 'Pesach VII' },
  { he: 'פסח שני', key: 'Pesach Sheni' },
  { he: 'ל״ג בעומר', key: 'Lag BaOmer' },
  // hebcal מחזיר `Shavuot` בלבד; שבועות לעולם אינו חל בשבת ולכן `Shavuot I`
  // היה ערך מת עד שברירת המחדל התחילה להתחשב בחגים (מיגרציה 009).
  { he: 'שבועות', key: 'Shavuot' },
  { he: 'תשעה באב', key: "Tish'a B'Av" },
];

export const EVENTS: readonly string[] = [
  'ברכת השנה',
  'בר מצווה',
  'חתן',
  'שבת חתן',
  'ברית',
  'אזכרה',
  'אמצע שבוע',
  'בדק בית',
  'ראש חודש',
  'אחר',
];

/** סוגי זיכוי/תיקון (SPEC נספח א'). משמשים גם כ-`credit_reason` בטופס הזיכוי F-35. */
export const CREDIT_REASONS: readonly string[] = [
  'זיכוי – חיוב בטעות',
  'זיכוי – לא משלם (מחיקת חוב)',
  'זיכוי – הנחה',
  'זיכוי – אחר',
];

export const PAYMENT_METHODS: ReadonlyArray<{ name: string; requiresReference: boolean }> = [
  { name: 'מזומן', requiresReference: false },
  { name: 'המחאה', requiresReference: true },
  { name: 'הוראת קבע', requiresReference: false },
  { name: 'כרטיס אשראי', requiresReference: false },
  { name: 'העברה בנקאית', requiresReference: true },
  { name: 'ביט/פייבוקס', requiresReference: false },
];

export const DONATION_TYPES: readonly string[] = ['בדק בית', 'ברכת השנה', 'משכורת לרב', 'כללי'];

export const EXPENSE_CATEGORIES: readonly string[] = [
  'משכורת לרב',
  'תחזוקה ותיקונים',
  'ציוד',
  'כיבוד וחגים',
  'חשמל ומים',
  'הדפסות',
  'אחר',
];

/**
 * הגדרות ברירת מחדל. ערכי בית הכנסת ריקים בכוונה – הם נקבעים באשף ההפעלה
 * הראשונה או מיובאים מהקובץ הישן. אין כאן שום ערך קשיח (CLAUDE.md כלל 12).
 */
export const DEFAULT_SETTINGS: Readonly<Record<string, string>> = {
  synagogue_name: '',
  synagogue_city: '',
  synagogue_address: '',
  synagogue_phone: '',
  association_number: '',
  logo_path: '',
  signature_path: '',
  receipt_footer_text: 'בתודה, ועד בית הכנסת',
  fiscal_year_start_month: '9',
  backup_dir: '',
  receipts_dir: '',
  credit_approval_threshold_agorot: '50000',
  receipt_paper_size: 'A5',
  default_printer: '',
  require_login: '0',
  idle_lock_minutes: '15',
  external_backup_reminder_days: '7',
  // מודול WhatsApp (מיגרציה 005). כבוי כברירת מחדל – נדלק במסך ההגדרות
  // אחרי אישור ההסכמה (W-54).
  whatsapp_enabled: '0',
  whatsapp_consent_accepted_at: '',
  whatsapp_min_delay_sec: '8',
  whatsapp_max_delay_sec: '20',
  whatsapp_daily_cap: '50',
  whatsapp_stop_after_consecutive_failures: '3',
  default_country_code: '972',
  gabbai_phone_display: '',
  whatsapp_open_charges_max_lines: '10',
};

/** מונים רצים. התקנה נקייה מתחילה מ-1; כלי הייבוא מקדם אותם לפי הנתונים. */
export const DEFAULT_SEQUENCES: Readonly<Record<string, number>> = {
  receipt: 1,
  member: 1,
  donation: 1,
  expense: 1,
};

/** שם קבוע ל-occasion של יתרת פתיחה – משמש גם את כלי הייבוא. */
export const OPENING_OCCASION_NAME = 'יתרת פתיחה';
/** שם קבוע ל-occasion "לא ידוע/אחר" שאליו נופלים ערכים לא ממופים בייבוא. */
export const FALLBACK_OCCASION_NAME = 'אחר';

/**
 * W-15 – שלוש תבניות פתיחה.
 *
 * **הנוסח כאן הוא טיוטה לאישור הגבאי** (שאלה פתוחה #3 ב-WHATSAPP-SPEC).
 * הוא נכתב כך שיהיה שמיש מיד אחרי התקנה, ולא כדי לקבע ניסוח: כל תבנית
 * ניתנת לעריכה או להשבתה במסך התבניות, ושם בית הכנסת מגיע מההגדרות.
 */
export const MESSAGE_TEMPLATES: ReadonlyArray<{ name: string; body: string }> = [
  {
    name: 'תזכורת יתרה',
    body:
      'שלום {{nickname_or_first}},\n\n' +
      'יתרת הנדרים שלך ב{{synagogue_name}} עומדת על {{balance}}.\n' +
      'נשמח להסדרה בהזדמנות הקרובה.\n\n' +
      'שבת שלום ומבורך,\nועד בית הכנסת',
  },
  {
    name: 'תזכורת יתרה עם פירוט',
    body:
      'שלום {{nickname_or_first}},\n\n' +
      'יתרת הנדרים שלך ב{{synagogue_name}} עומדת על {{balance}}, ' +
      'מתוך {{open_charges_count}} חיובים:\n\n' +
      '{{open_charges}}\n\n' +
      'נשמח להסדרה בהזדמנות הקרובה.\n\n' +
      'שבת שלום ומבורך,\nועד בית הכנסת',
  },
  {
    name: 'תודה על התשלום',
    body:
      'שלום {{nickname_or_first}},\n\n' +
      'תודה רבה על התשלום. יתרתך המעודכנת: {{balance}}.\n\n' +
      'תזכה למצוות,\n{{synagogue_name}}',
  },
  {
    name: 'הודעה כללית',
    body: 'שלום {{nickname_or_first}},\n\n\n\nבברכה,\n{{synagogue_name}}',
  },
];
