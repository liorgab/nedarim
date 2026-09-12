import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAILURE_THRESHOLD,
  countsAsFailure,
  decideStep,
  isRetryable,
  phaseForStop,
  pickDelaySeconds,
  stopText,
  type RunnerInput,
} from './runnerDecision';

/**
 * W3 – ההחלטה של מנוע הקמפיין.
 *
 * כל מצב שהמנוע יכול להיקלע אליו נבדק כאן, כי בלולאה החיה הוא מתרחש
 * פעם בכמה מאות הודעות ואי אפשר לשחזר אותו ביד.
 */

const base: RunnerInput = {
  request: 'run',
  nextItemId: 7,
  consecutiveFailures: 0,
  quotaRemaining: 10,
  connected: true,
  attemptsSinceStart: 1,
  waitCompleted: false,
  delaySeconds: 14,
  failureThreshold: DEFAULT_FAILURE_THRESHOLD,
};

const step = (patch: Partial<RunnerInput> = {}) => decideStep({ ...base, ...patch });

describe('סדר העדיפויות', () => {
  it('ביטול גובר על הכול', () => {
    // גם כשיש מקום במכסה, החיבור תקין ויש עוד פריטים.
    expect(step({ request: 'cancel' })).toEqual({ kind: 'stop', reason: 'user_cancel' });
  });

  it('ביטול גובר גם כשאין עוד פריטים', () => {
    expect(step({ request: 'cancel', nextItemId: null })).toEqual({
      kind: 'stop',
      reason: 'user_cancel',
    });
  });

  it('סיום גובר על השהיה שהמשתמש ביקש', () => {
    // אין מה להשהות כשאין מה לשלוח.
    expect(step({ request: 'pause', nextItemId: null })).toEqual({ kind: 'done' });
  });

  it('סיום גובר על ניתוק, מכסה וכשלים', () => {
    // קמפיין שהפריט האחרון בו נכשל **הסתיים**, ואין טעם לדווח עליו
    // "נעצר עקב כשלים".
    const done = step({
      nextItemId: null,
      connected: false,
      quotaRemaining: 0,
      consecutiveFailures: 9,
    });
    expect(done).toEqual({ kind: 'done' });
  });

  it('השהיה שהמשתמש ביקש גוברת על עצירות אוטומטיות', () => {
    // כדי שההודעה שתוצג תהיה "מושהה" ולא "החיבור נותק".
    expect(step({ request: 'pause', connected: false })).toEqual({
      kind: 'stop',
      reason: 'user_pause',
    });
  });

  it('ניתוק גובר על מכסה', () => {
    expect(step({ connected: false, quotaRemaining: 0 })).toEqual({
      kind: 'stop',
      reason: 'disconnected',
    });
  });
});

describe('עצירות אוטומטיות', () => {
  it('מכסה שנוצלה עוצרת', () => {
    expect(step({ quotaRemaining: 0 })).toEqual({ kind: 'stop', reason: 'daily_cap' });
  });

  it('שלושה כשלים רצופים עוצרים', () => {
    expect(step({ consecutiveFailures: DEFAULT_FAILURE_THRESHOLD })).toEqual({
      kind: 'stop',
      reason: 'consecutive_failures',
    });
  });

  it('הסף נקבע בהגדרה ולא בקוד', () => {
    expect(step({ consecutiveFailures: 2, failureThreshold: 2 }).kind).toBe('stop');
    expect(step({ consecutiveFailures: 4, failureThreshold: 5 }).kind).not.toBe('stop');
  });

  it('סף אפס מבטל את העצירה האוטומטית ולא עוצר מיד', () => {
    expect(step({ consecutiveFailures: 9, failureThreshold: 0 }).kind).not.toBe('stop');
  });

  it('שני כשלים רצופים אינם עוצרים', () => {
    expect(step({ consecutiveFailures: 2 }).kind).not.toBe('stop');
  });

  it('ניתוק עוצר (W-45)', () => {
    expect(step({ connected: false })).toEqual({ kind: 'stop', reason: 'disconnected' });
  });
});

describe('המתנה ושליחה', () => {
  it('ההודעה הראשונה יוצאת מיד', () => {
    // המתנה לפני הראשונה נראית כמו תקלה ולא כמו זהירות.
    expect(step({ attemptsSinceStart: 0 })).toEqual({ kind: 'send', itemId: 7 });
  });

  it('אחרי הראשונה – המתנה לפני כל הודעה', () => {
    expect(step({ attemptsSinceStart: 1 })).toEqual({ kind: 'wait', seconds: 14, nextItemId: 7 });
  });

  it('אחרי שההמתנה הושלמה – שליחה, ולא המתנה נוספת', () => {
    // בלי זה הלולאה ממתינה לנצח ושום הודעה אינה יוצאת.
    expect(step({ attemptsSinceStart: 1, waitCompleted: true })).toEqual({
      kind: 'send',
      itemId: 7,
    });
  });

  it('ניתוק בזמן ההמתנה עוצר, גם כשההמתנה הושלמה', () => {
    // התנאים נבדקים מחדש **אחרי** ההמתנה, ולא רק לפניה.
    expect(step({ waitCompleted: true, connected: false })).toEqual({
      kind: 'stop',
      reason: 'disconnected',
    });
  });

  it('אין פריטים – סיום', () => {
    expect(step({ nextItemId: null })).toEqual({ kind: 'done' });
  });
});

describe('pickDelaySeconds', () => {
  it('הערך בטווח', () => {
    for (let i = 0; i < 200; i++) {
      const v = pickDelaySeconds(8, 20);
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('הקצוות ניתנים להגרלה', () => {
    expect(pickDelaySeconds(8, 20, () => 0)).toBe(8);
    expect(pickDelaySeconds(8, 20, () => 0.999999)).toBe(20);
  });

  it('טווח הפוך מתוקן ולא מפיל', () => {
    // הגדרה שגויה בטופס לא אמורה להפיל קמפיין באמצע.
    expect(pickDelaySeconds(20, 8, () => 0)).toBe(8);
  });

  it('טווח אפסי מחזיר את אותו ערך', () => {
    expect(pickDelaySeconds(10, 10, () => 0.5)).toBe(10);
  });

  it('ערך שלילי אינו הופך להמתנה שלילית', () => {
    expect(pickDelaySeconds(-5, 3, () => 0)).toBe(0);
  });
});

describe('phaseForStop', () => {
  it('ביטול הוא סופי', () => {
    expect(phaseForStop('user_cancel')).toBe('cancelled');
  });

  it('כל השאר ניתנים להמשך', () => {
    for (const reason of ['user_pause', 'daily_cap', 'consecutive_failures', 'disconnected'] as const) {
      expect(phaseForStop(reason), reason).toBe('paused');
    }
  });
});

describe('countsAsFailure', () => {
  it('תקלות מנגנון נספרות', () => {
    expect(countsAsFailure('timeout')).toBe(true);
    expect(countsAsFailure('selector')).toBe(true);
    expect(countsAsFailure('not_connected')).toBe(true);
  });

  it('מספר שאינו בוואטסאפ אינו נספר', () => {
    // שלושה כאלה ברצף ברשימה ממוינת לפי שם הם צירוף מקרים, לא תקלה.
    expect(countsAsFailure('not_on_whatsapp')).toBe(false);
    expect(countsAsFailure('invalid_number')).toBe(false);
  });
});

describe('isRetryable', () => {
  it('תקלות זמניות ניתנות לניסיון חוזר', () => {
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('selector')).toBe(true);
    expect(isRetryable('not_connected')).toBe(true);
  });

  it('מספר פסול אינו ניתן לניסיון חוזר', () => {
    // ניסיון חוזר ייכשל שוב בדיוק באותו אופן.
    expect(isRetryable('not_on_whatsapp')).toBe(false);
    expect(isRetryable('invalid_number')).toBe(false);
  });

  it('מכסה וביטול אינם "כשל" שחוזרים עליו', () => {
    expect(isRetryable('daily_cap')).toBe(false);
    expect(isRetryable('cancelled')).toBe(false);
  });
});

describe('stopText', () => {
  it('ההודעה אומרת את הסף שנקבע בהגדרות', () => {
    expect(stopText('consecutive_failures', 5)).toContain('5 הודעות');
  });

  it('לכל סיבה יש הודעה', () => {
    for (const reason of [
      'user_pause',
      'user_cancel',
      'daily_cap',
      'consecutive_failures',
      'disconnected',
    ] as const) {
      expect(stopText(reason).length, reason).toBeGreaterThan(10);
    }
  });
});
