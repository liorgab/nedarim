import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { writeAudit } from './audit';
import { getAllSettings, setSetting } from './settings';

/**
 * F-90..F-92 – הגדרות המערכת וניהול רשימות הערך.
 *
 * זהו המקום שבו כל גבאי שמתקין את המערכת מגדיר אותה לבית הכנסת שלו: שם, יישוב,
 * מספר הקבלה שממנו להתחיל, חודש תחילת השנה הכספית, סף אישור לזיכוי וגודל נייר.
 * אין ערך עסקי אחד קשיח בקוד (CLAUDE.md כלל 12); הכול מגיע מכאן.
 */

/** מפתחות ההגדרה שהמסך יודע לערוך, עם הטיפוס והאימות של כל אחד. */
export type SettingKey =
  | 'member_name_mode'
  | 'synagogue_name'
  | 'synagogue_city'
  | 'synagogue_address'
  | 'synagogue_phone'
  | 'association_number'
  | 'logo_path'
  | 'signature_path'
  | 'receipt_footer_text'
  | 'receipt_paper_size'
  | 'default_printer'
  | 'fiscal_year_start_month'
  | 'credit_approval_threshold_agorot'
  | 'receipts_dir'
  | 'backup_dir'
  | 'require_login'
  | 'idle_lock_minutes'
  | 'external_backup_reminder_days'
  | 'whatsapp_enabled'
  | 'whatsapp_min_delay_sec'
  | 'whatsapp_max_delay_sec'
  | 'whatsapp_daily_cap'
  | 'whatsapp_stop_after_consecutive_failures'
  | 'default_country_code'
  | 'gabbai_phone_display'
  | 'whatsapp_open_charges_max_lines';

export interface SettingSpec {
  key: SettingKey;
  label: string;
  group: 'synagogue' | 'receipt' | 'finance' | 'system' | 'whatsapp';
  type: 'text' | 'number' | 'money' | 'month' | 'choice' | 'path' | 'image' | 'bool';
  help?: string;
  choices?: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  min?: number;
  max?: number;
}

/** התיאור המלא של מסך ההגדרות. המסך נבנה מהרשימה הזו, לא מקוד קשיח. */
export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: 'synagogue_name',
    label: 'שם בית הכנסת',
    group: 'synagogue',
    type: 'text',
    required: true,
    help: 'מודפס בראש כל קבלה ובכותרת הדוחות',
  },
  { key: 'synagogue_city', label: 'יישוב', group: 'synagogue', type: 'text' },
  { key: 'synagogue_address', label: 'כתובת', group: 'synagogue', type: 'text' },
  { key: 'synagogue_phone', label: 'טלפון', group: 'synagogue', type: 'text' },
  {
    key: 'association_number',
    label: 'מספר עמותה',
    group: 'synagogue',
    type: 'text',
    help: 'אם לבית הכנסת יש עמותה רשומה. יודפס על הקבלה',
  },
  { key: 'logo_path', label: 'לוגו', group: 'synagogue', type: 'image' },

  {
    key: 'receipt_footer_text',
    label: 'נוסח תחתית הקבלה',
    group: 'receipt',
    type: 'text',
  },
  { key: 'signature_path', label: 'תמונת חתימה', group: 'receipt', type: 'image' },
  {
    // F-13 – שם פרטי ומשפחה בנפרד, או שדה אחד.
    //
    // ההגדרה משנה רק **איך הטופס שואל**, לא מה נשמר: במצב "שם מלא" הערך
    // נכנס ל`first_name` ו-`last_name` נשאר ריק. לכן מעבר בין המצבים אינו
    // מאבד דבר, ובית כנסת שניהל שם מלא יכול לעבור ל"נפרד" ולהשלים את שם
    // המשפחה חבר-חבר.
    key: 'member_name_mode',
    label: 'ניהול שם החבר',
    group: 'system',
    type: 'choice',
    choices: [
      { value: 'split', label: 'שם פרטי ושם משפחה בנפרד' },
      { value: 'full', label: 'שם מלא בשדה אחד' },
    ],
    help: 'משפיע על טופס החבר, על רשימת החברים ועל המיון. אפשר לעבור בין המצבים בכל עת בלי לאבד נתונים.',
  },
  {
    key: 'receipt_paper_size',
    label: 'גודל נייר לקבלה',
    group: 'receipt',
    type: 'choice',
    choices: [
      { value: 'A5', label: 'A5' },
      { value: 'A4', label: 'A4' },
    ],
  },
  {
    key: 'default_printer',
    label: 'מדפסת ברירת מחדל',
    group: 'receipt',
    type: 'text',
    help: 'ריק = מדפסת ברירת המחדל של Windows',
  },

  {
    key: 'fiscal_year_start_month',
    label: 'חודש תחילת שנה כספית',
    group: 'finance',
    type: 'month',
    min: 1,
    max: 12,
    help: 'בבית הכנסת הנוכחי: ספטמבר. משפיע על המאזן ועל סינון הכרטיסייה',
  },
  {
    key: 'credit_approval_threshold_agorot',
    label: 'סף אישור מנהל לזיכוי',
    group: 'finance',
    type: 'money',
    min: 0,
    help: 'זיכוי מעל הסכום הזה יחייב הרשאת מנהל',
  },

  {
    key: 'receipts_dir',
    label: 'תיקיית ארכיון הקבלות',
    group: 'system',
    type: 'path',
    help: 'ריק = תיקיית הנתונים של היישום. קבלות שכבר הופקו נשארות במקומן; השינוי חל על קבלות חדשות בלבד',
  },
  { key: 'backup_dir', label: 'תיקיית גיבוי', group: 'system', type: 'path' },
  {
    key: 'external_backup_reminder_days',
    label: 'תזכורת גיבוי חיצוני (ימים)',
    group: 'system',
    type: 'number',
    min: 1,
    max: 365,
  },
  {
    key: 'whatsapp_enabled',
    label: 'מודול וואטסאפ פעיל',
    group: 'whatsapp',
    type: 'bool',
    help: 'הדלקה דורשת אישור אזהרת השימוש. מומלץ SIM ייעודי לבית הכנסת ולא המספר האישי',
  },
  {
    key: 'default_country_code',
    label: 'קידומת מדינה',
    group: 'whatsapp',
    type: 'text',
    help: 'ברירת מחדל 972. משמשת לנרמול מספרים שהוזנו בפורמט מקומי (05X…)',
  },
  {
    key: 'gabbai_phone_display',
    label: 'טלפון הגבאי (לשימוש בתבניות)',
    group: 'whatsapp',
    type: 'text',
    help: 'מוצג בהודעות דרך השדה {{gabbai_phone}}',
  },
  {
    key: 'whatsapp_open_charges_max_lines',
    label: 'שורות פירוט חוב בהודעה',
    group: 'whatsapp',
    type: 'number',
    min: 0,
    max: 50,
    help: 'כמה חיובים לפרט בשדה {{פירוט החוב}}. 0 = הכול. מה שנחתך מסוכם בשורה אחת',
  },
  {
    key: 'whatsapp_min_delay_sec',
    label: 'השהיה מינימלית בין הודעות (שניות)',
    group: 'whatsapp',
    type: 'number',
    min: 3,
    max: 600,
    help: 'השהיה אקראית בין ההודעות מקטינה את הסיכון לחסימת המספר',
  },
  {
    key: 'whatsapp_max_delay_sec',
    label: 'השהיה מקסימלית בין הודעות (שניות)',
    group: 'whatsapp',
    type: 'number',
    min: 3,
    max: 600,
  },
  {
    key: 'whatsapp_daily_cap',
    label: 'מכסה יומית',
    group: 'whatsapp',
    type: 'number',
    min: 1,
    max: 200,
    help: 'קמפיין שחורג מהמכסה נעצר וניתן להמשיך אותו למחרת',
  },
  {
    key: 'whatsapp_stop_after_consecutive_failures',
    label: 'עצירה אחרי כשלים רצופים',
    group: 'whatsapp',
    type: 'number',
    min: 1,
    max: 20,
    help: 'כשלים רצופים הם בדרך כלל סימן לניתוק או לחסימה, ולא לבעיה במספר בודד',
  },

  {
    key: 'require_login',
    label: 'לדרוש התחברות בסיסמה',
    group: 'system',
    type: 'bool',
    help: 'כבוי = היישום נפתח ישירות. מומלץ להדליק כשהמחשב משותף',
  },
  {
    key: 'idle_lock_minutes',
    label: 'נעילה אוטומטית (דקות)',
    group: 'system',
    type: 'number',
    min: 0,
    max: 240,
    help: '0 = ללא נעילה אוטומטית. פעיל רק כשנדרשת התחברות',
  },
];

export interface CountersInfo {
  /** המספר שיוקצה לקבלה הבאה. */
  nextReceiptNumber: number;
  /** המספר הגבוה ביותר שכבר הופק. 0 = טרם הופקה קבלה. */
  maxIssuedReceiptNumber: number;
  nextMemberNumber: number;
  nextDonationNumber: number;
  nextExpenseNumber: number;
}

export function getCounters(db: Database): CountersInfo {
  const seq = (name: string) =>
    (db.prepare('SELECT next_value v FROM sequence WHERE name = ?').get(name) as { v: number }).v;
  const maxReceipt = (
    db.prepare('SELECT COALESCE(MAX(receipt_number), 0) v FROM receipt').get() as { v: number }
  ).v;
  return {
    nextReceiptNumber: seq('receipt'),
    maxIssuedReceiptNumber: maxReceipt,
    nextMemberNumber: seq('member'),
    nextDonationNumber: seq('donation'),
    nextExpenseNumber: seq('expense'),
  };
}

export interface ConfigurationView {
  settings: Record<string, string>;
  specs: readonly SettingSpec[];
  counters: CountersInfo;
  /** ההתקנה עדיין לא הוגדרה – פותח את אשף ההפעלה הראשונה. */
  isFirstRun: boolean;
}

export function getConfiguration(db: Database): ConfigurationView {
  const raw = getAllSettings(db);
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) settings[k] = v ?? '';
  return {
    settings,
    specs: SETTING_SPECS,
    counters: getCounters(db),
    isFirstRun: (settings['synagogue_name'] ?? '').trim() === '',
  };
}

export interface SettingValidationError {
  key: string;
  message: string;
}

/** אימות ערכי ההגדרות לפי ה-spec, לפני שמירה. */
/** מוודא שהתיקייה קיימת (או ניתנת ליצירה) ושאפשר לכתוב אליה. */
export function pathProblem(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return 'לא ניתן ליצור את התיקייה';
  }
  if (!statSync(dir).isDirectory()) return 'הנתיב אינו תיקייה';
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return 'אין הרשאת כתיבה לתיקייה';
  }
  return null;
}

export function validateSettings(patch: Record<string, string>): SettingValidationError[] {
  const errors: SettingValidationError[] = [];
  const byKey = new Map(SETTING_SPECS.map((s) => [s.key as string, s]));

  for (const [key, value] of Object.entries(patch)) {
    const spec = byKey.get(key);
    if (!spec) {
      errors.push({ key, message: 'הגדרה לא מוכרת' });
      continue;
    }
    const text = value.trim();

    if (spec.required && text === '') {
      errors.push({ key, message: `${spec.label} הוא שדה חובה` });
      continue;
    }
    if (text === '') continue;

    if (spec.type === 'number' || spec.type === 'month' || spec.type === 'money') {
      const n = Number(text);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        errors.push({ key, message: `${spec.label}: יש להזין מספר שלם` });
        continue;
      }
      if (spec.min !== undefined && n < spec.min) {
        errors.push({ key, message: `${spec.label}: המינימום הוא ${spec.min}` });
      }
      if (spec.max !== undefined && n > spec.max) {
        errors.push({ key, message: `${spec.label}: המקסימום הוא ${spec.max}` });
      }
    }
    if (spec.type === 'choice' && !spec.choices?.some((c) => c.value === text)) {
      errors.push({ key, message: `${spec.label}: ערך לא חוקי` });
    }
    // נתיב נבדק בפועל בזמן השמירה, ולא כשמפיקים קבלה: תיקייה שגויה שמתגלה
    // רק ברגע ההפקה משאירה את הגבאי בלי קבלה מול התורם.
    if (spec.type === 'path') {
      const problem = pathProblem(text);
      if (problem !== null) errors.push({ key, message: `${spec.label}: ${problem}` });
    }
  }
  // הצלבה בין שתי הגדרות: השהיה מינימלית גדולה מהמקסימלית הופכת את הטווח
  // האקראי לבלתי חוקי, וזה מתגלה רק באמצע קמפיין.
  const min = patch['whatsapp_min_delay_sec'];
  const max = patch['whatsapp_max_delay_sec'];
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
    errors.push({
      key: 'whatsapp_min_delay_sec',
      message: 'ההשהיה המינימלית אינה יכולה להיות גדולה מהמקסימלית',
    });
  }

  return errors;
}

/** שמירת הגדרות. כל שינוי נרשם ביומן הביקורת (B-10). */
export function saveSettings(
  db: Database,
  patch: Record<string, string>,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): ConfigurationView {
  if (userRole !== 'admin') throw new Error('שינוי הגדרות מותר למנהל בלבד');
  const errors = validateSettings(patch);
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const before = getAllSettings(db);
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) setSetting(db, key, value.trim());
    writeAudit(db, {
      userId,
      entity: 'setting',
      entityId: null,
      action: 'update',
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])),
      after: patch,
    });
  })();
  return getConfiguration(db);
}

/**
 * קביעת המספר שממנו יתחיל מספור הקבלות (F-92).
 *
 * זו ההגדרה הרגישה ביותר במערכת: B-03 קובע שמספר קבלה לעולם אינו חוזר.
 * לכן אפשר לקבוע אותו רק כלפי מעלה, ולעולם לא מתחת למספר שכבר הופק בפועל.
 * בית כנסת חדש שמגיע מפנקס נייר יכול להתחיל למשל מ-1001.
 */
export function setReceiptStartNumber(
  db: Database,
  next: number,
  userId: number,
  userRole: 'admin' | 'clerk' | 'viewer',
): CountersInfo {
  if (userRole !== 'admin') throw new Error('שינוי מספור הקבלות מותר למנהל בלבד');
  if (!Number.isInteger(next) || next < 1) {
    throw new Error('מספר הקבלה הבא חייב להיות מספר שלם חיובי');
  }

  const counters = getCounters(db);
  if (next <= counters.maxIssuedReceiptNumber) {
    throw new Error(
      `כבר הופקה קבלה מס' ${counters.maxIssuedReceiptNumber}. ` +
        `מספר קבלה לעולם אינו חוזר לשימוש, ולכן אפשר להתחיל רק מ-${counters.maxIssuedReceiptNumber + 1} ומעלה.`,
    );
  }

  db.transaction(() => {
    db.prepare("UPDATE sequence SET next_value = ? WHERE name = 'receipt'").run(next);
    writeAudit(db, {
      userId,
      entity: 'sequence',
      entityId: null,
      action: 'update',
      before: { receipt: counters.nextReceiptNumber },
      after: { receipt: next },
    });
  })();
  return getCounters(db);
}

// ------------------------------------------------------------------ F-91 רשימות

export type LookupTable = 'occasion' | 'payment_method' | 'donation_type' | 'expense_category';

const LOOKUP_LABEL: Record<LookupTable, string> = {
  occasion: 'פרשה / אירוע',
  payment_method: 'אמצעי תשלום',
  donation_type: 'סוג תרומה',
  expense_category: 'קטגוריית הוצאה',
};

/** באילו טבלאות ובאיזו עמודה כל רשימה נמצאת בשימוש – כדי לא לאפשר מחיקה. */
const LOOKUP_USAGE: Record<LookupTable, ReadonlyArray<{ table: string; column: string }>> = {
  occasion: [{ table: 'vow_charge', column: 'occasion_id' }],
  payment_method: [
    { table: 'vow_payment', column: 'payment_method_id' },
    { table: 'donation', column: 'payment_method_id' },
    { table: 'expense', column: 'payment_method_id' },
  ],
  donation_type: [{ table: 'donation', column: 'donation_type_id' }],
  expense_category: [{ table: 'expense', column: 'category_id' }],
};

export interface LookupRow {
  id: number;
  name: string;
  isActive: boolean;
  /** בכמה רשומות הערך בשימוש – ערך בשימוש ניתן להשבתה אך לא למחיקה. */
  usageCount: number;
  /** רק ל-occasion. */
  type?: string;
  requiresReference?: boolean;
}

export function listLookup(db: Database, table: LookupTable): LookupRow[] {
  const usageSql = LOOKUP_USAGE[table]
    .map(
      (u) =>
        `(SELECT COUNT(*) FROM ${u.table} t WHERE t.${u.column} = l.id AND t.deleted_at IS NULL)`,
    )
    .join(' + ');
  const extra =
    table === 'occasion' ? ', l.type' : table === 'payment_method' ? ', l.requires_reference' : '';

  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.is_active${extra}, ${usageSql} AS usage_count
       FROM ${table} l ORDER BY ${table === 'occasion' ? 'l.sort_order, l.name' : 'l.id'}`,
    )
    .all() as Array<{
    id: number;
    name: string;
    is_active: number;
    usage_count: number;
    type?: string;
    requires_reference?: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.is_active === 1,
    usageCount: r.usage_count,
    ...(r.type !== undefined ? { type: r.type } : {}),
    ...(r.requires_reference !== undefined
      ? { requiresReference: r.requires_reference === 1 }
      : {}),
  }));
}

export function addLookupValue(
  db: Database,
  table: LookupTable,
  name: string,
  userId: number,
  options: { type?: string; requiresReference?: boolean } = {},
): LookupRow[] {
  const clean = name.trim();
  if (clean === '') throw new Error(`${LOOKUP_LABEL[table]}: השם הוא שדה חובה`);
  const exists = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(clean);
  if (exists) throw new Error(`הערך "${clean}" כבר קיים ברשימה`);

  db.transaction(() => {
    if (table === 'occasion') {
      const maxOrder = (
        db.prepare('SELECT COALESCE(MAX(sort_order), 0) v FROM occasion').get() as { v: number }
      ).v;
      db.prepare(
        'INSERT INTO occasion (name, type, hebcal_key, sort_order, is_active) VALUES (?, ?, NULL, ?, 1)',
      ).run(clean, options.type ?? 'event', maxOrder + 10);
    } else if (table === 'payment_method') {
      db.prepare(
        'INSERT INTO payment_method (name, requires_reference, is_active) VALUES (?, ?, 1)',
      ).run(clean, options.requiresReference ? 1 : 0);
    } else {
      db.prepare(`INSERT INTO ${table} (name, is_active) VALUES (?, 1)`).run(clean);
    }
    writeAudit(db, {
      userId,
      entity: table,
      entityId: null,
      action: 'create',
      after: { name: clean },
    });
  })();
  return listLookup(db, table);
}

export function renameLookupValue(
  db: Database,
  table: LookupTable,
  id: number,
  name: string,
  userId: number,
): LookupRow[] {
  const clean = name.trim();
  if (clean === '') throw new Error(`${LOOKUP_LABEL[table]}: השם הוא שדה חובה`);
  const before = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as
    { name: string } | undefined;
  if (!before) throw new Error('הערך לא נמצא');

  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(clean, id);
    writeAudit(db, {
      userId,
      entity: table,
      entityId: id,
      action: 'update',
      before,
      after: { name: clean },
    });
  })();
  return listLookup(db, table);
}

/**
 * השבתה/הפעלה. אין מחיקה: ערך שהיה בשימוש חייב להישאר כדי שרשומות היסטוריות
 * ימשיכו להצביע עליו (SPEC F-91).
 */
export function setLookupActive(
  db: Database,
  table: LookupTable,
  id: number,
  isActive: boolean,
  userId: number,
): LookupRow[] {
  const before = db.prepare(`SELECT name, is_active FROM ${table} WHERE id = ?`).get(id);
  if (!before) throw new Error('הערך לא נמצא');
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, id);
    writeAudit(db, {
      userId,
      entity: table,
      entityId: id,
      action: 'update',
      before,
      after: { is_active: isActive ? 1 : 0 },
    });
  })();
  return listLookup(db, table);
}
