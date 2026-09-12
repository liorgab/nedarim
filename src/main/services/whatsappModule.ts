import type { Database } from 'better-sqlite3';
import type { UserRole } from '@shared/types';
import { nowIso, todayIso } from '@shared/datetime';
import { writeAudit } from './audit';
import { getSetting, setSetting } from './settings';

/**
 * מצב מודול ה-WhatsApp והאישור לשימוש בו (W-53, W-54).
 *
 * ב-W0 אין כאן שום קשר ל-WhatsApp עצמו – רק ההגדרות והמכסה. החיבור, ה-QR
 * ומצב הסשן נוספים ב-W1.
 */

export interface WhatsAppModuleState {
  enabled: boolean;
  consentAcceptedAt: string | null;
  minDelaySec: number;
  maxDelaySec: number;
  dailyCap: number;
  sentToday: number;
}

function numberSetting(db: Database, key: string, fallback: number): number {
  const raw = Number(getSetting(db, key) ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** כמה הודעות כבר נשלחו היום. המונה נשמר ב-DB כדי לשרוד הפעלה מחדש (WB-07). */
export function sentToday(db: Database, day = todayIso()): number {
  const row = db.prepare('SELECT sent_count FROM whatsapp_daily_counter WHERE day = ?').get(day) as
    { sent_count: number } | undefined;
  return row?.sent_count ?? 0;
}

export function whatsappModuleState(db: Database): WhatsAppModuleState {
  const consent = (getSetting(db, 'whatsapp_consent_accepted_at') ?? '').trim();
  return {
    enabled: (getSetting(db, 'whatsapp_enabled') ?? '0') === '1',
    consentAcceptedAt: consent === '' ? null : consent,
    minDelaySec: numberSetting(db, 'whatsapp_min_delay_sec', 8),
    maxDelaySec: numberSetting(db, 'whatsapp_max_delay_sec', 20),
    dailyCap: numberSetting(db, 'whatsapp_daily_cap', 50),
    sentToday: sentToday(db),
  };
}

/**
 * W-54 – אישור אזהרת השימוש. זו לא הצהרה ריקה: אוטומציה של WhatsApp Web
 * מנוגדת לתנאי השימוש ועלולה לגרום לחסימת המספר, ולכן האישור נרשם ביומן
 * הביקורת עם המשתמש והשעה.
 */
export function acceptWhatsAppConsent(
  db: Database,
  userId: number,
  role: UserRole,
): WhatsAppModuleState {
  if (role !== 'admin') throw new Error('הפעלת מודול וואטסאפ מותרת למנהל בלבד');

  const ts = nowIso();
  db.transaction(() => {
    setSetting(db, 'whatsapp_consent_accepted_at', ts);
    setSetting(db, 'whatsapp_enabled', '1');
    writeAudit(db, {
      userId,
      entity: 'setting',
      entityId: null,
      action: 'update',
      after: { whatsapp_consent_accepted_at: ts, whatsapp_enabled: '1' },
    });
  })();

  return whatsappModuleState(db);
}
