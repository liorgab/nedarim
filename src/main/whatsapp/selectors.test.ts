import { describe, expect, it } from 'vitest';
import {
  CHAT_LIST,
  CHROME_USER_AGENT,
  INVALID_NUMBER_DIALOG,
  INVALID_NUMBER_TEXTS,
  MESSAGE_INPUT,
  MESSAGE_STATUS_ICON,
  OUTGOING_BUBBLE,
  PENDING_STATUS_ICONS,
  QR_CANVAS,
  SELECTORS_VERIFIED_ON,
  SEND_BUTTON,
  SENT_STATUS_ICONS,
  STALE_TEXTS,
  bodyContainsExpression,
  existsExpression,
  firstMatchExpression,
  sendUrl,
  type SelectorGroup,
} from './selectors';

/**
 * WB-06 – הבדיקות כאן אינן יכולות לאמת שה-selectors תואמים ל-WhatsApp
 * (זה דורש דפדפן וסשן חי, וזו בדיקת השטח הידנית). מה שהן כן נועלות:
 * שהמבנה תקין, שיש fallbacks, ושהביטויים שמוזרקים לדף הם JS חוקי.
 */

/** סופר מופעים של תו במחרוזת. */
const count = (text: string, ch: string): number => text.split(ch).length - 1;

const GROUPS: ReadonlyArray<[string, SelectorGroup]> = [
  ['QR', QR_CANVAS],
  ['רשימת שיחות', CHAT_LIST],
  ['תיבת כתיבה', MESSAGE_INPUT],
  ['כפתור שליחה', SEND_BUTTON],
  ['דיאלוג מספר לא קיים', INVALID_NUMBER_DIALOG],
  ['בועה יוצאת', OUTGOING_BUBBLE],
  ['סטאטוס הודעה', MESSAGE_STATUS_ICON],
];

describe('מבנה ה-selectors', () => {
  for (const [name, group] of GROUPS) {
    it(`${name}: לפחות שני selectors, כי הראשון נשבר`, () => {
      // selector יחיד פירושו שכל שינוי ב-WhatsApp שובר את המודול לגמרי.
      expect(group.selectors.length).toBeGreaterThanOrEqual(2);
    });

    it(`${name}: אין selectors כפולים`, () => {
      expect(new Set(group.selectors).size).toBe(group.selectors.length);
    });

    it(`${name}: לכל selector יש תווית בעברית להודעות שגיאה`, () => {
      expect(group.label.trim()).not.toBe('');
      expect(group.label).toMatch(/[֐-׿]/);
    });

    it(`${name}: כל selector תקין מבנית`, () => {
      // אין DOM בסביבת הבדיקה, ולכן לא ניתן להריץ querySelector. מה שכן
      // אפשר לתפוס הוא את הטעות הנפוצה: סוגריים או מרכאות שלא נסגרו,
      // שהופכים את ה-selector לשגיאה בזמן ריצה בתוך הדף.
      for (const selector of group.selectors) {
        expect(selector.trim(), 'selector ריק').not.toBe('');
        expect(count(selector, '['), `סוגריים מרובעים ב-${selector}`).toBe(count(selector, ']'));
        expect(count(selector, '('), `סוגריים ב-${selector}`).toBe(count(selector, ')'));
        expect(count(selector, '"') % 2, `מרכאות ב-${selector}`).toBe(0);
        expect(selector).not.toContain(';');
      }
    });
  }

  it('קוד ה-QR נבדק מול הגרסה העדכנית ולא רק מול testid היסטורי', () => {
    // `qrcode` הוסר מ-WhatsApp Web ואומת ב-2026-09-06 שהמזהה הוא
    // `link-device-qr-code`. אם מישהו יסיר אותו, המודול יחזור לדווח
    // `loading` לנצח מול מסך QR תקין.
    expect(QR_CANVAS.selectors[0]).toContain('link-device-qr-code');
  });

  it('תאריך האימות מעודכן ובפורמט ISO', () => {
    expect(SELECTORS_VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('UA', () => {
  it('אינו מכיל את המחרוזת Electron (WB-04)', () => {
    // WhatsApp Web חוסם UA לא מוכר.
    expect(CHROME_USER_AGENT).not.toContain('Electron');
    expect(CHROME_USER_AGENT).toContain('Chrome/');
  });
});

describe('sendUrl (WB-03)', () => {
  it('מקודד את המספר ואת הטקסט', () => {
    const url = sendUrl('972501234567', 'שלום עולם');
    expect(url).toContain('phone=972501234567');
    expect(url).toContain(encodeURIComponent('שלום עולם'));
  });

  it('טקסט עם & ו-# אינו שובר את הכתובת', () => {
    const url = sendUrl('972501234567', 'א & ב # ג');
    expect(url).not.toContain(' & ');
    expect(new URL(url).searchParams.get('text')).toBe('א & ב # ג');
  });

  it('שורות חדשות נשמרות', () => {
    const url = sendUrl('972501234567', 'שורה\nשנייה');
    expect(new URL(url).searchParams.get('text')).toBe('שורה\nשנייה');
  });
});

describe('ביטויים שמוזרקים לדף', () => {
  const isValidJs = (code: string) => {
    expect(() => new Function(`return ${code}`)).not.toThrow();
  };

  it('existsExpression הוא JS חוקי', () => {
    for (const [, group] of GROUPS) isValidJs(existsExpression(group));
  });

  it('firstMatchExpression הוא JS חוקי', () => {
    for (const [, group] of GROUPS) isValidJs(firstMatchExpression(group));
  });

  it('bodyContainsExpression הוא JS חוקי גם עם טקסט עברי', () => {
    isValidJs(bodyContainsExpression(STALE_TEXTS));
    isValidJs(bodyContainsExpression(INVALID_NUMBER_TEXTS));
  });

  it('בלי body הביטוי מחזיר false ולא זורק', () => {
    // מדמים דף בלי `document.body` – המצב שקיים בשנייה הראשונה של הטעינה,
    // ובדיוק הרגע שבו `SessionMonitor` דוגם.
    const fn = new Function('document', `return ${bodyContainsExpression(['x'])}`) as (
      doc: unknown,
    ) => boolean;
    expect(fn({ body: null })).toBe(false);
    expect(fn({ body: { innerText: 'yyy x zzz' } })).toBe(true);
  });
});

describe('אייקוני סטאטוס הודעה', () => {
  it('אין חפיפה בין "ממתין" ל"נשלח"', () => {
    // חפיפה הייתה גורמת לאימות שליחה להצליח על הודעה שעדיין בשעון.
    const overlap = PENDING_STATUS_ICONS.filter((i) => SENT_STATUS_ICONS.includes(i));
    expect(overlap).toEqual([]);
  });

  it('שתי הרשימות אינן ריקות', () => {
    expect(PENDING_STATUS_ICONS.length).toBeGreaterThan(0);
    expect(SENT_STATUS_ICONS.length).toBeGreaterThan(0);
  });
});

describe('טקסטים לזיהוי מצבים', () => {
  it('מספר לא קיים – בעברית ובאנגלית', () => {
    expect(INVALID_NUMBER_TEXTS.some((t) => /[֐-׿]/.test(t))).toBe(true);
    expect(INVALID_NUMBER_TEXTS.some((t) => /[a-z]/i.test(t))).toBe(true);
  });

  it('stale – בעברית ובאנגלית', () => {
    expect(STALE_TEXTS.some((t) => /[֐-׿]/.test(t))).toBe(true);
    expect(STALE_TEXTS.some((t) => /[a-z]/i.test(t))).toBe(true);
  });
});
