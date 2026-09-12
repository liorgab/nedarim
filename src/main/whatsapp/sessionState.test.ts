import { describe, expect, it } from 'vitest';
import {
  SECONDS_PER_MESSAGE,
  canSend,
  deriveState,
  estimateSeconds,
  formatDuration,
  parseWid,
  type PageProbe,
} from './sessionState';

const probe = (over: Partial<PageProbe> = {}): PageProbe => ({
  loaded: true,
  hasQr: false,
  hasChatList: false,
  hasStaleText: false,
  ...over,
});

describe('deriveState (W-51)', () => {
  it('חלון סגור → disconnected', () => {
    expect(deriveState(probe({ hasChatList: true }), false).state).toBe('disconnected');
  });

  it('דף שטרם נטען → loading', () => {
    expect(deriveState(probe({ loaded: false }), true).state).toBe('loading');
  });

  it('QR → qr, עם הנחיה לסרוק', () => {
    const r = deriveState(probe({ hasQr: true }), true);
    expect(r.state).toBe('qr');
    expect(r.message).toContain('סרוק');
  });

  it('רשימת שיחות → ready, בלי הודעת שגיאה', () => {
    const r = deriveState(probe({ hasChatList: true }), true);
    expect(r.state).toBe('ready');
    expect(r.message).toBeUndefined();
  });

  it('טקסט "פתוח בחלון אחר" גובר על רשימת שיחות', () => {
    // המסך הזה מופיע גם כשיש סשן תקף. אם ה-stale לא היה גובר, המצב היה
    // מדווח ready והשליחה הייתה נכשלת בלי הסבר.
    const r = deriveState(probe({ hasChatList: true, hasStaleText: true }), true);
    expect(r.state).toBe('stale');
    expect(r.message).toContain('במקום אחר');
  });

  it('QR גובר על רשימת שיחות בזמן התנתקות', () => {
    expect(deriveState(probe({ hasQr: true, hasChatList: true }), true).state).toBe('qr');
  });

  it('דף נטען בלי QR ובלי רשימה → loading ולא ready', () => {
    // המצב הזה מתרחש גם כש-WhatsApp שינה את ה-DOM. עדיף להישאר loading
    // מאשר לדווח ready ולנסות לשלוח למסך שאיננו יודעים לקרוא.
    expect(deriveState(probe(), true).state).toBe('loading');
  });
});

describe('canSend', () => {
  it('רק ready מאפשר שליחה', () => {
    expect(canSend('ready')).toBe(true);
    for (const s of ['disconnected', 'loading', 'qr', 'stale'] as const) {
      expect(canSend(s), `המצב ${s} לא אמור לאפשר שליחה`).toBe(false);
    }
  });
});

describe('estimateSeconds', () => {
  it('אין נמענים → אפס', () => {
    expect(estimateSeconds(0, 8, 20)).toEqual({ minSeconds: 0, maxSeconds: 0 });
  });

  it('נמען אחד – בלי השהיות, רק זמן העבודה', () => {
    expect(estimateSeconds(1, 8, 20)).toEqual({
      minSeconds: SECONDS_PER_MESSAGE,
      maxSeconds: SECONDS_PER_MESSAGE,
    });
  });

  it('n נמענים → n-1 השהיות, לא n', () => {
    // ההודעה הראשונה נשלחת מיד.
    const r = estimateSeconds(10, 10, 10);
    expect(r.minSeconds).toBe(10 * SECONDS_PER_MESSAGE + 9 * 10);
  });

  it('הטווח מתרחב עם ההשהיה', () => {
    const r = estimateSeconds(50, 8, 20);
    expect(r.maxSeconds).toBeGreaterThan(r.minSeconds);
    expect(r.maxSeconds - r.minSeconds).toBe(49 * 12);
  });

  it('הערכה כוללת את זמן השליחה עצמה ולא רק את ההשהיות', () => {
    expect(estimateSeconds(5, 0, 0).minSeconds).toBe(5 * SECONDS_PER_MESSAGE);
  });
});

describe('formatDuration', () => {
  it('פחות מדקה בשניות', () => {
    expect(formatDuration(30)).toBe('כ-30 שניות');
  });
  it('דקות', () => {
    expect(formatDuration(240)).toBe('כ-4 דקות');
  });
  it('שעות עגולות', () => {
    expect(formatDuration(7200)).toBe('כ-2 שעות');
  });
  it('שעות ודקות', () => {
    expect(formatDuration(4800)).toBe('כ-1 שעות ו-20 דקות');
  });
  it('אפס אינו מוצג כ-0 שניות', () => {
    expect(formatDuration(0)).toBe('כ-1 שניות');
  });
});

describe('parseWid (W-56)', () => {
  it('WID מלא עם מזהה מכשיר ודומיין', () => {
    // המקרה שנצפה בבדיקה החיה: בלי חיתוך ב-":" התקבל 97250123456739.
    expect(parseWid('"972501234567:39@c.us"')).toBe('972501234567');
  });

  it('WID בלי מזהה מכשיר', () => {
    expect(parseWid('972501234567@c.us')).toBe('972501234567');
  });

  it('מספר נקי', () => {
    expect(parseWid('972501234567')).toBe('972501234567');
  });

  it('ריק או חסר מחזיר null', () => {
    expect(parseWid(null)).toBeNull();
    expect(parseWid(undefined)).toBeNull();
    expect(parseWid('')).toBeNull();
    expect(parseWid('  ')).toBeNull();
    expect(parseWid('""')).toBeNull();
  });

  it('ערך שאינו מספר מחזיר null במקום מחרוזת ריקה', () => {
    expect(parseWid('@c.us')).toBeNull();
    expect(parseWid('abc@c.us')).toBeNull();
  });

  it('מספר קצר או ארוך מדי נדחה', () => {
    expect(parseWid('1234567')).toBeNull();
    expect(parseWid('1234567890123456')).toBeNull();
  });

  it('מספר זר תקין מתקבל', () => {
    expect(parseWid('12125550100:12@c.us')).toBe('12125550100');
  });
});
