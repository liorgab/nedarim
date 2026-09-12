import { describe, expect, it } from 'vitest';
import {
  decideVerify,
  decideWait,
  errorText,
  isRetryable,
  type SendErrorCode,
  type SendProbe,
  type VerifyProbe,
} from './sendOutcome';

const probe = (over: Partial<SendProbe> = {}): SendProbe => ({
  hasInput: false,
  hasInvalidNumberDialog: false,
  hasQr: false,
  hasStaleText: false,
  ...over,
});

const verify = (over: Partial<VerifyProbe> = {}): VerifyProbe => ({
  hasMatchingBubble: false,
  statusIcon: null,
  isPending: false,
  ...over,
});

describe('decideWait – המתנה אחרי הניווט (W-60 שלב 4)', () => {
  it('כלום עדיין לא נמצא → ממשיכים לחכות', () => {
    expect(decideWait(probe()).kind).toBe('wait');
  });

  it('תיבת כתיבה → מוכן לשליחה', () => {
    expect(decideWait(probe({ hasInput: true })).kind).toBe('ready');
  });

  it('דיאלוג "לא ב-WhatsApp" → כישלון מזוהה', () => {
    const d = decideWait(probe({ hasInvalidNumberDialog: true }));
    expect(d).toMatchObject({ kind: 'failed', errorCode: 'not_on_whatsapp' });
  });

  it('הדיאלוג גובר על תיבת הכתיבה', () => {
    // הדיאלוג מופיע מעל מסך שיש בו תיבת כתיבה. אם היינו בודקים קודם את
    // התיבה, היינו שולחים Enter לדיאלוג ומסמנים את הפריט `sent` בטעות –
    // שליחה שדווחה כמוצלחת ולא קרתה היא הגרועה מכולן.
    const d = decideWait(probe({ hasInput: true, hasInvalidNumberDialog: true }));
    expect(d).toMatchObject({ kind: 'failed', errorCode: 'not_on_whatsapp' });
  });

  it('QR באמצע → not_connected', () => {
    const d = decideWait(probe({ hasQr: true }));
    expect(d).toMatchObject({ kind: 'failed', errorCode: 'not_connected' });
  });

  it('QR גובר על תיבת כתיבה', () => {
    const d = decideWait(probe({ hasInput: true, hasQr: true }));
    expect(d).toMatchObject({ kind: 'failed', errorCode: 'not_connected' });
  });

  it('stale → not_connected עם הסבר משלו', () => {
    const d = decideWait(probe({ hasStaleText: true }));
    expect(d).toMatchObject({ kind: 'failed', errorCode: 'not_connected' });
    if (d.kind === 'failed') expect(d.errorMessage).toContain('במקום אחר');
  });

  it('כל כישלון מגיע עם הודעה בעברית', () => {
    for (const p of [
      probe({ hasInvalidNumberDialog: true }),
      probe({ hasQr: true }),
      probe({ hasStaleText: true }),
    ]) {
      const d = decideWait(p);
      expect(d.kind).toBe('failed');
      if (d.kind === 'failed') expect(d.errorMessage).toMatch(/[֐-׿]/);
    }
  });
});

describe('decideVerify – אימות אחרי Enter (W-60 שלב 6)', () => {
  it('אין בועה תואמת → ממשיכים לחכות', () => {
    expect(decideVerify(verify()).kind).toBe('wait');
  });

  it('בועה עם שעון → עדיין לא נשלח', () => {
    // ✓ אחד מספיק, אבל שעון פירושו שההודעה לא יצאה מהמכשיר.
    const d = decideVerify(
      verify({ hasMatchingBubble: true, statusIcon: 'msg-time', isPending: true }),
    );
    expect(d.kind).toBe('wait');
  });

  it('בועה בלי אייקון בכלל → ממשיכים לחכות', () => {
    expect(decideVerify(verify({ hasMatchingBubble: true, statusIcon: null })).kind).toBe('wait');
  });

  it('בועה עם ✓ → הצלחה', () => {
    const d = decideVerify(verify({ hasMatchingBubble: true, statusIcon: 'msg-check' }));
    expect(d.kind).toBe('ready');
  });

  it('✓✓ גם כן הצלחה', () => {
    expect(decideVerify(verify({ hasMatchingBubble: true, statusIcon: 'msg-dblcheck' })).kind).toBe(
      'ready',
    );
  });

  it('אייקון בלי בועה תואמת אינו מספיק', () => {
    // בועה של הודעה קודמת בשיחה לא אמורה לאשר את השליחה הנוכחית.
    expect(decideVerify(verify({ statusIcon: 'msg-check' })).kind).toBe('wait');
  });
});

describe('errorText', () => {
  const codes: SendErrorCode[] = [
    'invalid_number',
    'not_on_whatsapp',
    'timeout',
    'not_connected',
    'selector',
    'daily_cap',
    'cancelled',
  ];

  it('לכל קוד יש טקסט בעברית', () => {
    for (const code of codes) {
      const text = errorText(code);
      expect(text, `חסר טקסט ל-${code}`).not.toBe('');
      expect(text, `הטקסט של ${code} אינו בעברית`).toMatch(/[֐-׿]/);
    }
  });

  it('אין שני קודים עם אותו טקסט', () => {
    const texts = codes.map(errorText);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('isRetryable (W-46)', () => {
  it('כשל טכני ניתן לניסיון חוזר', () => {
    for (const code of ['timeout', 'not_connected', 'selector', 'daily_cap'] as const) {
      expect(isRetryable(code), code).toBe(true);
    }
  });

  it('מספר שאינו ב-WhatsApp – לא. ניסיון נוסף ייכשל באותו אופן', () => {
    expect(isRetryable('not_on_whatsapp')).toBe(false);
    expect(isRetryable('invalid_number')).toBe(false);
  });
});
