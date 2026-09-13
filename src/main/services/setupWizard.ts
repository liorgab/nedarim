import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { getSetting, setSetting } from './settings';
import { SETTING_SPECS, type SettingKey } from './configuration';

/**
 * F-110..F-114 – אשף ההתקנה הראשונה.
 *
 * למה אשף ולא באנר: עד היום התקנה חדשה הציגה באנר שמפנה למסך ההגדרות עם
 * 25 שדות בחמש קבוצות. הגבאי מילא את שם בית הכנסת – השדה היחיד שסומן
 * חובה – ויצא. שנת הכספים ומספר הקבלה הראשון נשארו על
 * ברירת המחדל, ואיש לא שאל אותו עליהם. מספר קבלה שגוי מתגלה רק אחרי
 * שהופקה קבלה ראשונה, ואז אי אפשר לתקן (כלל 4 – מספר לעולם אינו נערך).
 *
 * **מה שהאשף אינו עושה:** הוא אינו ממציא ערכים. כל שדה הוא אותו
 * `SettingSpec` של מסך ההגדרות, ולכן אין כאן ערך עסקי קשיח (כלל 12), ומה
 * שהגבאי מדלג עליו נשאר בדיוק כפי שהיה.
 */

/** צעד באשף. הסדר הוא סדר החשיבות, לא סדר הקבוצות במסך ההגדרות. */
export interface WizardStep {
  id: string;
  title: string;
  /** למה הצעד הזה חשוב – מוצג מעל השדות. */
  intro: string;
  keys: readonly SettingKey[];
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: 'synagogue',
    title: 'פרטי בית הכנסת',
    intro:
      'הפרטים האלה מופיעים על כל קבלה ובכותרת כל דוח. שם בית הכנסת הוא השדה היחיד שחובה למלא – את השאר אפשר להשלים בהמשך.',
    keys: [
      'synagogue_name',
      'synagogue_city',
      'synagogue_address',
      'synagogue_phone',
      'association_number',
    ],
  },
  {
    id: 'receipt',
    title: 'קבלות',
    intro:
      'מספר הקבלה הראשון הוא ההחלטה החשובה ביותר כאן. אם אתם ממשיכים מפנקס או ממערכת קודמת – הזינו את המספר שאחרי האחרון שהופק. מספר קבלה לעולם אינו נערך ואינו משוחרר, ולכן קשה לתקן טעות אחרי שהופקה קבלה ראשונה.',
    keys: ['receipt_paper_size', 'receipt_footer_text', 'receipts_dir'],
  },
  {
    id: 'finance',
    title: 'שנה כספית',
    intro:
      'חודש תחילת השנה הכספית קובע את חתך הדוחות ואת "השנה הנוכחית" במאזן. בבתי כנסת רבים זה תשרי, כלומר ספטמבר או אוקטובר.',
    keys: ['fiscal_year_start_month', 'credit_approval_threshold_agorot'],
  },
];

/**
 * **למה אין כאן צעד "גיבוי".**
 *
 * היה כאן צעד שביקש לבחור תיקיית גיבוי, והוא הטעה: מיד אחרי אשף ההתקנה
 * נפתח אשף הייבוא, ולכן "בחרו תיקיית גיבוי" נקרא כ"מאיפה לייבא". גבאי
 * שבחר תיקייה ציפה שהנתונים שלו ייטענו ממנה – ובמקום זה נפתח אשף ייבוא
 * ריק.
 *
 * שחזור מגיבוי הוא **ייבוא**, ומקומו באשף הייבוא, שם הוא מוצג לצד שאר
 * מקורות הנתונים. תיקיית היעד לגיבויים עתידיים נשארת בהגדרות ← גיבוי
 * ושחזור, עם ברירת מחדל שעובדת בלי שאיש יגדיר דבר.
 */

/** כל המפתחות שהאשף מציג, בסדר הופעתם. */
export function wizardKeys(): SettingKey[] {
  return WIZARD_STEPS.flatMap((s) => [...s.keys]);
}

export interface WizardState {
  /** האשף כבר הושלם ולא ייפתח שוב מעצמו. */
  completed: boolean;
  completedAt: string | null;
  /** שדות חובה שעדיין ריקים – האשף אינו מאפשר לסיים כל עוד יש כאלה. */
  missingRequired: SettingKey[];
}

const REQUIRED_KEYS: readonly SettingKey[] = SETTING_SPECS.filter((s) => s.required === true).map(
  (s) => s.key,
);

export function wizardState(db: Database): WizardState {
  const completedAt = (getSetting(db, 'setup_completed_at') ?? '').trim();
  return {
    completed: completedAt !== '',
    completedAt: completedAt === '' ? null : completedAt,
    missingRequired: REQUIRED_KEYS.filter((k) => (getSetting(db, k) ?? '').trim() === ''),
  };
}

/**
 * מסיים את האשף. נכשל כשחסר שדה חובה – כדי שלא ייווצר מצב של מערכת
 * "מוגדרת" בלי שם בית כנסת, שמדפיסה קבלות ריקות.
 */
export function completeSetup(db: Database): WizardState {
  const state = wizardState(db);
  if (state.missingRequired.length > 0) {
    const labels = state.missingRequired
      .map((k) => SETTING_SPECS.find((s) => s.key === k)?.label ?? k)
      .join(', ');
    throw new Error(`יש למלא את שדות החובה: ${labels}`);
  }
  setSetting(db, 'setup_completed_at', nowIso());
  return wizardState(db);
}

/**
 * פותח מחדש את האשף. שימושי כשמעבירים את המערכת לבית כנסת אחר, או פשוט
 * כדי לעבור שוב על ההגדרות בלי לחפש אותן אחת-אחת.
 */
export function reopenSetup(db: Database): WizardState {
  setSetting(db, 'setup_completed_at', '');
  return wizardState(db);
}
