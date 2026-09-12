import type { Database } from 'better-sqlite3';
import { todayIso } from '@shared/datetime';
import { getSetting } from './settings';

/**
 * WB-07 – המכסה היומית.
 *
 * המונה יושב ב-DB ולא בזיכרון, כדי שהמכסה תישמר גם אחרי הפעלה מחדש. גבאי
 * שסוגר ופותח את היישום באמצע היום לא אמור לקבל 50 הודעות נוספות – זו בדיוק
 * הדרך להיחסם.
 *
 * היום נקבע לפי השעון **המקומי** (`todayIso`). מונה לפי UTC היה מתאפס
 * בשלוש לפנות בוקר במקום בחצות.
 */

export interface CapStatus {
  cap: number;
  sentToday: number;
  remaining: number;
  /** true = אין מקום לעוד הודעה היום. */
  reached: boolean;
}

function capFrom(db: Database): number {
  const raw = Number(getSetting(db, 'whatsapp_daily_cap') ?? '50');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

export function sentToday(db: Database, day = todayIso()): number {
  const row = db.prepare('SELECT sent_count FROM whatsapp_daily_counter WHERE day = ?').get(day) as
    { sent_count: number } | undefined;
  return row?.sent_count ?? 0;
}

export function capStatus(db: Database, day = todayIso()): CapStatus {
  const cap = capFrom(db);
  const sent = sentToday(db, day);
  return {
    cap,
    sentToday: sent,
    remaining: Math.max(0, cap - sent),
    reached: sent >= cap,
  };
}

/**
 * מגדיל את המונה. נקרא **אחרי** אימות שההודעה יצאה, ולא לפניה: הודעה
 * שנכשלה אינה אמורה לגזול מהמכסה.
 */
export function recordSent(db: Database, day = todayIso()): number {
  db.prepare(
    `INSERT INTO whatsapp_daily_counter (day, sent_count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET sent_count = sent_count + 1`,
  ).run(day);
  return sentToday(db, day);
}
