import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { UserRole } from '@shared/types';
import { writeAudit } from './audit';
import { nowIso } from '@shared/datetime';

/**
 * SPEC 6.3 / דרישות אבטחה – משתמשים, סיסמאות ותפקידים.
 *
 * גיבוב הסיסמה ב-`scrypt` מספריית ה-crypto המובנית של Node, ולא ב-bcrypt כפי
 * שנכתב ב-SPEC. הסיבה מעשית: bcrypt הוא מודול נייטיב שידרוש קומפילציה או
 * prebuild נוסף בכל שדרוג Electron, ו-scrypt נותן חוזק זהה (הוא אף התקן
 * המומלץ של OWASP) בלי אף תלות. הפרמטרים נשמרים בתוך ה-hash עצמו, כדי שאפשר
 * יהיה להחמיר אותם בעתיד בלי לשבור סיסמאות קיימות.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };
const SALT_BYTES = 16;

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  /** true כשעדיין לא נקבעה סיסמה – מחייב קביעה בהתחברות הראשונה. */
  needsPassword: boolean;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored === '') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(keyB64!, 'base64');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** דרישות מינימום לסיסמה. מכוון נמוך: המשתמש הוא גבאי אחד על מחשב ביתי. */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 6) errors.push('הסיסמה חייבת להכיל לפחות 6 תווים');
  if (password.trim() === '') errors.push('הסיסמה אינה יכולה להיות רווחים בלבד');
  return errors;
}

interface Row {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: number;
  password_hash: string;
}

const toUser = (r: Row): AuthUser => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  isActive: r.is_active === 1,
  needsPassword: r.password_hash === '',
});

export function listUsers(db: Database): AuthUser[] {
  return (db.prepare('SELECT * FROM user ORDER BY id').all() as Row[]).map(toUser);
}

export function getUserByName(db: Database, username: string): AuthUser | null {
  const row = db.prepare('SELECT * FROM user WHERE username = ?').get(username.trim()) as
    Row | undefined;
  return row ? toUser(row) : null;
}

export interface LoginResult {
  ok: boolean;
  user: AuthUser | null;
  /** true כשהמשתמש קיים אך אין לו עדיין סיסמה – יש לקבוע אחת. */
  needsPassword: boolean;
  message?: string;
}

/**
 * התחברות. משתמש שטרם נקבעה לו סיסמה (התקנה חדשה) מזוהה בלי סיסמה
 * ומתבקש לקבוע אחת מייד – כדי שהתקנה טרייה לא תהיה נעולה מחוץ לעצמה.
 */
export function login(db: Database, username: string, password: string): LoginResult {
  const row = db.prepare('SELECT * FROM user WHERE username = ?').get(username.trim()) as
    Row | undefined;
  if (!row)
    return { ok: false, user: null, needsPassword: false, message: 'שם משתמש או סיסמה שגויים' };
  if (row.is_active !== 1) {
    return { ok: false, user: null, needsPassword: false, message: 'המשתמש מושבת' };
  }
  if (row.password_hash === '') {
    return { ok: true, user: toUser(row), needsPassword: true };
  }
  if (!verifyPassword(password, row.password_hash)) {
    writeAudit(db, {
      userId: row.id,
      entity: 'user',
      entityId: row.id,
      action: 'login',
      after: { success: false },
    });
    return { ok: false, user: null, needsPassword: false, message: 'שם משתמש או סיסמה שגויים' };
  }
  writeAudit(db, {
    userId: row.id,
    entity: 'user',
    entityId: row.id,
    action: 'login',
    after: { success: true },
  });
  return { ok: true, user: toUser(row), needsPassword: false };
}

export function setPassword(db: Database, userId: number, password: string, actorId: number): void {
  const errors = validatePassword(password);
  if (errors.length > 0) throw new Error(errors.join('; '));
  db.transaction(() => {
    db.prepare('UPDATE user SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(password),
      nowIso(),
      userId,
    );
    writeAudit(db, {
      userId: actorId,
      entity: 'user',
      entityId: userId,
      action: 'update',
      after: { passwordChanged: true },
    });
  })();
}

/** שינוי סיסמה על ידי המשתמש עצמו – מחייב את הסיסמה הנוכחית. */
export function changeOwnPassword(
  db: Database,
  userId: number,
  currentPassword: string,
  newPassword: string,
): void {
  const row = db.prepare('SELECT * FROM user WHERE id = ?').get(userId) as Row | undefined;
  if (!row) throw new Error('משתמש לא נמצא');
  if (row.password_hash !== '' && !verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('הסיסמה הנוכחית שגויה');
  }
  setPassword(db, userId, newPassword, userId);
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: UserRole;
  password: string;
}

export function createUser(
  db: Database,
  input: CreateUserInput,
  actorId: number,
  actorRole: UserRole,
): AuthUser {
  if (actorRole !== 'admin') throw new Error('ניהול משתמשים מותר למנהל בלבד');
  const username = input.username.trim();
  if (username === '') throw new Error('שם משתמש הוא שדה חובה');
  if (input.displayName.trim() === '') throw new Error('שם לתצוגה הוא שדה חובה');
  if (getUserByName(db, username)) throw new Error(`שם המשתמש "${username}" כבר קיים`);
  const errors = validatePassword(input.password);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const ts = nowIso();
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO user (username, display_name, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(username, input.displayName.trim(), hashPassword(input.password), input.role, ts, ts);
    const newId = Number(info.lastInsertRowid);
    writeAudit(db, {
      userId: actorId,
      entity: 'user',
      entityId: newId,
      action: 'create',
      after: { username, role: input.role },
    });
    return newId;
  })();

  return (
    getUserByName(db, username) ?? {
      id,
      username,
      displayName: input.displayName,
      role: input.role,
      isActive: true,
      needsPassword: false,
    }
  );
}

export function updateUser(
  db: Database,
  userId: number,
  patch: { displayName?: string; role?: UserRole; isActive?: boolean },
  actorId: number,
  actorRole: UserRole,
): AuthUser[] {
  if (actorRole !== 'admin') throw new Error('ניהול משתמשים מותר למנהל בלבד');
  const before = db.prepare('SELECT * FROM user WHERE id = ?').get(userId) as Row | undefined;
  if (!before) throw new Error('משתמש לא נמצא');

  // אסור להישאר בלי אף מנהל פעיל – אחרת ההתקנה ננעלת מחוץ לעצמה.
  const losingAdmin =
    before.role === 'admin' &&
    ((patch.role !== undefined && patch.role !== 'admin') || patch.isActive === false);
  if (losingAdmin) {
    const admins = (
      db
        .prepare("SELECT COUNT(*) c FROM user WHERE role = 'admin' AND is_active = 1 AND id <> ?")
        .get(userId) as { c: number }
    ).c;
    if (admins === 0) throw new Error('חייב להישאר לפחות מנהל פעיל אחד במערכת');
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE user SET display_name = COALESCE(?, display_name),
         role = COALESCE(?, role), is_active = COALESCE(?, is_active), updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.displayName?.trim() ?? null,
      patch.role ?? null,
      patch.isActive === undefined ? null : patch.isActive ? 1 : 0,
      nowIso(),
      userId,
    );
    writeAudit(db, {
      userId: actorId,
      entity: 'user',
      entityId: userId,
      action: 'update',
      before: { role: before.role, is_active: before.is_active, display_name: before.display_name },
      after: patch,
    });
  })();

  return listUsers(db);
}
