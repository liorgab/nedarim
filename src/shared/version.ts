/**
 * השוואת גרסאות ובחירת העדכון – **טהור לחלוטין**.
 *
 * זה הקוד שמחליט אם להציע למשתמש להתקין גרסה אחרת. טעות כאן מתבטאת
 * בהצעה לרדת גרסה, או בעדכון שלא מוצע אף פעם – שתי תקלות שמתגלות רק
 * אצל משתמשים. לכן ההשוואה מופרדת לחלוטין מכל קריאת רשת.
 *
 * SemVer מצומצם: `major.minor.patch` עם תווית אופציונלית (`1.2.0-beta.1`).
 * אין תמיכה ב-build metadata (`+sha`) כי אין בו שימוש כאן.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** `beta.1` ב-`1.2.0-beta.1`. ריק בגרסת שחרור. */
  prerelease: string;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw: string): ParsedVersion | null {
  const m = VERSION.exec(raw.trim());
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? '',
  };
}

/**
 * משווה שני חלקי תווית מוקדמת לפי SemVer: מספר < טקסט, ומספרים
 * מושווים כמספרים כך ש-`beta.10` גדול מ-`beta.9`.
 */
function comparePrereleaseParts(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    // חלק חסר קטן מחלק קיים: `beta` < `beta.1`.
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (nx !== null) {
      return -1;
    } else if (ny !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** `-1` אם a קטנה, `1` אם גדולה, `0` אם שוות. גרסה לא תקינה נחשבת קטנה. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }

  // גרסת שחרור גדולה מגרסה מוקדמת עם אותם מספרים: 1.2.0 > 1.2.0-beta.
  if (pa.prerelease === '' && pb.prerelease === '') return 0;
  if (pa.prerelease === '') return 1;
  if (pb.prerelease === '') return -1;
  return comparePrereleaseParts(pa.prerelease, pb.prerelease);
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

// ------------------------------------------------------- בחירת העדכון

/** שחרור כפי שהוא מגיע מ-GitHub, מצומצם למה שבאמת בשימוש. */
export interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  prerelease: boolean;
  draft: boolean;
  /** קובץ ההתקנה, אם צורף לשחרור. */
  installerUrl: string | null;
}

export type UpdateDecision =
  | { kind: 'up-to-date' }
  | { kind: 'available'; release: ReleaseInfo }
  /** יש גרסה חדשה אבל בלי קובץ התקנה – אפשר רק להפנות לדף השחרור. */
  | { kind: 'available-no-installer'; release: ReleaseInfo }
  | { kind: 'none' };

export interface DecideUpdateInput {
  currentVersion: string;
  releases: readonly ReleaseInfo[];
  /** האם להציע גם גרסאות מוקדמות. ברירת מחדל: לא. */
  includePrerelease?: boolean;
}

/**
 * בוחר את השחרור שכדאי להציע.
 *
 * **מדלג על טיוטות תמיד** – טיוטה היא שחרור שהמתחזק עוד עובד עליו.
 * גרסאות מוקדמות מדולגות אלא אם המשתמש ביקש במפורש.
 *
 * נבחר ה**גבוה ביותר** ולא הראשון ברשימה: GitHub מחזיר לפי תאריך פרסום,
 * ותיקון דחוף לגרסה ישנה עלול להתפרסם אחרי גרסה חדשה יותר.
 */
export function decideUpdate(input: DecideUpdateInput): UpdateDecision {
  const candidates = input.releases
    .filter((r) => !r.draft)
    .filter((r) => input.includePrerelease === true || !r.prerelease)
    .filter((r) => parseVersion(r.tagName) !== null)
    .filter((r) => isNewer(r.tagName, input.currentVersion));

  if (candidates.length === 0) {
    return input.releases.length === 0 ? { kind: 'none' } : { kind: 'up-to-date' };
  }

  const best = candidates.reduce((a, b) => (compareVersions(b.tagName, a.tagName) > 0 ? b : a));
  return best.installerUrl === null
    ? { kind: 'available-no-installer', release: best }
    : { kind: 'available', release: best };
}

// ------------------------------------------------------ כתובת הרפוזיטורי

/**
 * מחלץ `owner/repo` מכתובת git. תומך ב-`https://`, ב-`git@` וב-`git+`.
 * מחזיר `null` כשהכתובת חסרה או אינה של GitHub – ואז בדיקת העדכונים
 * פשוט כבויה, בלי שגיאה למשתמש.
 */
export function parseGitHubRepo(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  const m = /github\.com[/:]([^/]+)\/([^/.\s]+)/.exec(url.trim());
  if (m === null) return null;
  return `${m[1]}/${m[2]}`;
}
