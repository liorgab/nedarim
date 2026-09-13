/**
 * F-141 – לאיזה מועד שייך כל כיבוד.
 *
 * **המועד הקובע הוא תזמון המכירה**, לא תזמון הביצוע. "פרנס חצי-שנתי (קיץ)"
 * מבורך בכל שבת במשך חצי שנה, אבל הוא נמכר בערב פסח – ולכן הוא מופיע
 * ברשימה של פסח ולא בכל שבת. זו ההנחיה המפורשת של הגבאי, והיא גם מה
 * שהופך את הרשימה לשימושית: היא עונה על "מה אני מוכר עכשיו".
 *
 * הפונקציה **טהורה ונבדקת על כל 103 השורות**, כי שיוך שגוי כאן מציג
 * לגבאי את הרשימה הלא נכונה בדיוק ברגע שבו אין לו זמן לחפש.
 */

/** היקף התחולה של כיבוד. */
export type VowItemScope =
  /** כל שבת רגילה – מוצג לצד כל פרשה. */
  | 'shabbat'
  /** מועדים מסוימים בלבד, לפי `occasions`. */
  | 'occasion'
  /** תמיד, בכל אירוע. */
  | 'always';

export interface ScopeDecision {
  scope: VowItemScope;
  /** שמות המועדים (כפי שהם ב-`occasion.name`) כש-`scope === 'occasion'`. */
  occasions: string[];
}

export interface ScopeInput {
  name: string;
  category: string;
  saleTiming: string;
}

/**
 * כללי ההתאמה, **לפי סדר**: הראשון שמתאים קובע.
 *
 * הסדר הוא ההתנהגות. "שביעי של פסח" חייב להיבדק לפני "פסח", אחרת כל
 * כיבודי השביעי היו נופלים לרשימה של פסח ונעלמים מהיום שבו הם באמת
 * נמכרים.
 */
const RULES: ReadonlyArray<{ match: RegExp; occasions: readonly string[] }> = [
  // ימים נוראים
  { match: /כל נדרי|נעילה|יונה|יום כיפור|כיפור/, occasions: ['יום כיפור'] },
  { match: /ר["״']ה|ראש השנה/, occasions: ['ראש השנה'] },

  // פסח – הימים המיוחדים לפני הכלליים
  { match: /שביעי של פסח/, occasions: ['שביעי של פסח'] },
  { match: /אחרון של פסח/, occasions: ['שביעי של פסח'] },
  { match: /חול המועד פסח/, occasions: ['שבת חול המועד פסח', 'פסח'] },
  { match: /פסח/, occasions: ['פסח'] },

  // שבועות
  { match: /שבועות/, occasions: ['שבועות'] },

  // תשרי – שמחת תורה ושמיני עצרת לפני סוכות.
  // ההקפות נבדקות ראשונות: הן מופיעות גם כאירוע נפרד, ואילו עליית חתן
  // תורה היא עלייה ולא הקפה – שיוך שלה ל"הקפות" היה רעש ברשימה.
  { match: /הקפה|הקפות/, occasions: ['שמחת תורה', 'הקפות'] },
  { match: /שמחת תורה/, occasions: ['שמחת תורה'] },
  { match: /שמיני עצרת/, occasions: ['שמיני עצרת'] },
  { match: /חול המועד סוכות/, occasions: ['שבת חול המועד סוכות', 'סוכות'] },
  { match: /הושענא רבה/, occasions: ['הושענא רבה'] },
  { match: /סוכות/, occasions: ['סוכות'] },
];

/** תזמוני מכירה שקובעים בעצמם, כשהשם אינו מסגיר את המועד. */
const SALE_TIMING_RULES: ReadonlyArray<{ match: RegExp; occasions: readonly string[] }> = [
  { match: /ערב פסח/, occasions: ['פסח'] },
  { match: /ערב יום כיפור/, occasions: ['יום כיפור'] },
];

/**
 * מחליט לאיזה מועד שייך כיבוד.
 *
 * קטגוריית "שבת רגילה" נקבעת לפי הקטגוריה ולא לפי השם: כל 18 הכיבודים בה
 * נמכרים בכל שבת לאורך השנה, ואין בשמם דבר שקושר אותם לחג.
 */
export function decideScope(input: ScopeInput): ScopeDecision {
  if (input.category === 'שבת רגילה') return { scope: 'shabbat', occasions: [] };

  for (const rule of RULES) {
    if (rule.match.test(input.name)) {
      return { scope: 'occasion', occasions: [...rule.occasions] };
    }
  }

  for (const rule of SALE_TIMING_RULES) {
    if (rule.match.test(input.saleTiming)) {
      return { scope: 'occasion', occasions: [...rule.occasions] };
    }
  }

  // נמכר בכל שבת, או בשבת מברכים – שתיהן שבתות.
  if (/בכל שבת|שבת מברכים/.test(input.saleTiming)) {
    return { scope: 'shabbat', occasions: [] };
  }

  // לא זוהה מועד. `always` ולא השמטה: כיבוד שאיש אינו רואה הוא כיבוד
  // שאינו נמכר, וזו טעות גרועה יותר מהופעה במקום מיותר.
  return { scope: 'always', occasions: [] };
}
