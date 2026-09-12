import type { Database } from 'better-sqlite3';
import type { UserRole } from '@shared/types';
import type { AuthUserDto, SessionDto } from '@shared/api';
import { getSetting } from './settings';
import { listUsers, type AuthUser } from './auth';

/**
 * מצב ההתחברות של החלון. נשמר בזיכרון בלבד – סגירת היישום מנתקת.
 *
 * ההתקנה היא של גבאי יחיד על מחשב ביתי, ולכן הכניסה בסיסמה היא **ניתנת לכיבוי**
 * דרך ההגדרה `require_login`. כשהיא כבויה המערכת עובדת עם משתמש ברירת המחדל,
 * אבל כל פעולה עדיין נרשמת ב-audit_log עם מזהה המשתמש הזה – כך שהחלפת המצב
 * אינה משנה דבר בשאר המערכת (CLAUDE.md כלל 12).
 */

interface State {
  userId: number | null;
  locked: boolean;
}

const state: State = { userId: null, locked: false };

export function toDto(user: AuthUser): AuthUserDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    needsPassword: user.needsPassword,
  };
}

export function loginRequired(db: Database): boolean {
  return (getSetting(db, 'require_login') ?? '0') === '1';
}

export function idleLockMinutes(db: Database): number {
  const raw = Number(getSetting(db, 'idle_lock_minutes') ?? '0');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** המשתמש שיוגדר כברירת מחדל כשההתחברות כבויה: המנהל הפעיל הראשון. */
function defaultUser(db: Database): AuthUser | null {
  const all = listUsers(db);
  return (
    all.find((u) => u.role === 'admin' && u.isActive) ??
    all.find((u) => u.isActive) ??
    all[0] ??
    null
  );
}

export function setCurrentUser(userId: number | null): void {
  state.userId = userId;
  state.locked = false;
}

export function lock(): void {
  state.locked = true;
}

export function isLocked(): boolean {
  return state.locked;
}

/** המשתמש הפעיל לפעולות כתיבה. זורק כשאין אף אחד – לא כותבים בלי חתימה. */
export function currentUser(db: Database): { id: number; displayName: string; role: UserRole } {
  const user = resolveUser(db);
  if (!user) throw new Error('אין משתמש מחובר');
  return { id: user.id, displayName: user.displayName, role: user.role };
}

function resolveUser(db: Database): AuthUser | null {
  if (!loginRequired(db)) return defaultUser(db);
  if (state.userId === null) return null;
  return listUsers(db).find((u) => u.id === state.userId) ?? null;
}

export function session(db: Database): SessionDto {
  const required = loginRequired(db);
  const user = resolveUser(db);
  return {
    user: user ? toDto(user) : null,
    authenticated: user !== null && !(required && state.locked),
    idleLockMinutes: idleLockMinutes(db),
    loginRequired: required,
  };
}
