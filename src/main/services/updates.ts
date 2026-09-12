import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, net } from 'electron';
import { decideUpdate, parseGitHubRepo, type ReleaseInfo, type UpdateDecision } from '@shared/version';

/**
 * F-115..F-118 – בדיקת עדכון מול GitHub Releases.
 *
 * **הפונקציה הזו נקראת אך ורק כשהגבאי לוחץ על כפתור.** אין בדיקה ברקע,
 * אין בדיקה בעלייה ואין תזמון. זו הסיבה שהמערכת עדיין יכולה להצהיר
 * שהיא אינה מתחברת לאינטרנט מעצמה (PRIVACY.md): החיבור היחיד קורה
 * ברגע שבו המשתמש ביקש אותו במפורש, ורק אז.
 *
 * ההחלטה מה להציע (`decideUpdate`) טהורה ויושבת ב-`@shared/version`.
 * כאן נשארת רק הפנייה עצמה והתרגום מ-JSON של GitHub.
 */

const TIMEOUT_MS = 15_000;
/** רק שחרורים אחרונים – אין טעם לשאוב היסטוריה שלמה. */
const RELEASES_URL = (repo: string) =>
  `https://api.github.com/repos/${repo}/releases?per_page=20`;

/** קובץ ההתקנה ל-Windows. `.exe` בלבד – זה מה ש-electron-builder מפיק. */
const INSTALLER = /\.exe$/i;

export type UpdateCheck =
  | { ok: true; decision: UpdateDecision; currentVersion: string; repo: string }
  | { ok: false; reason: 'no-repo' | 'network' | 'rate-limit' | 'server'; message: string };

interface GitHubAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubAsset[];
}

function toReleaseInfo(raw: GitHubRelease): ReleaseInfo | null {
  if (typeof raw.tag_name !== 'string' || raw.tag_name === '') return null;
  const asset = (raw.assets ?? []).find(
    (a) => typeof a.name === 'string' && INSTALLER.test(a.name),
  );
  return {
    tagName: raw.tag_name,
    name: raw.name ?? raw.tag_name,
    body: raw.body ?? '',
    htmlUrl: raw.html_url ?? '',
    publishedAt: raw.published_at ?? '',
    prerelease: raw.prerelease === true,
    draft: raw.draft === true,
    installerUrl: asset?.browser_download_url ?? null,
  };
}

/** כתובת הרפוזיטורי מ-`package.json`. `null` = בדיקת עדכונים אינה זמינה. */
export function repoSlug(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      repository?: string | { url?: string };
    };
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    return parseGitHubRepo(url);
  } catch {
    return null;
  }
}

/**
 * פנייה ל-GitHub דרך `net` של Electron ולא דרך `fetch` של Node: הוא
 * משתמש במחסנית הרשת של Chromium, ולכן מכבד הגדרות proxy ותעודות של
 * מערכת ההפעלה – מה שבבית כנסת עם רשת מנוהלת עושה את ההבדל.
 */
async function fetchReleases(repo: string): Promise<GitHubRelease[]> {
  const response = await net.fetch(RELEASES_URL(repo), {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `nedarim/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(String(response.status)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as GitHubRelease[];
}

export async function checkForUpdate(
  options: { includePrerelease?: boolean } = {},
): Promise<UpdateCheck> {
  const repo = repoSlug();
  if (repo === null) {
    return {
      ok: false,
      reason: 'no-repo',
      message: 'לא הוגדרה כתובת רפוזיטורי, ולכן אי אפשר לבדוק עדכונים.',
    };
  }

  const currentVersion = app.getVersion();
  try {
    const raw = await fetchReleases(repo);
    const releases = raw
      .map(toReleaseInfo)
      .filter((r): r is ReleaseInfo => r !== null);
    return {
      ok: true,
      repo,
      currentVersion,
      decision: decideUpdate({
        currentVersion,
        releases,
        includePrerelease: options.includePrerelease === true,
      }),
    };
  } catch (e) {
    const status = (e as { status?: number }).status;
    // 403 מ-GitHub ללא אימות הוא כמעט תמיד מגבלת קצב לפי כתובת IP.
    if (status === 403 || status === 429) {
      return {
        ok: false,
        reason: 'rate-limit',
        message: 'GitHub חסם זמנית בקשות מהכתובת הזו. אפשר לנסות שוב בעוד כשעה.',
      };
    }
    if (status !== undefined) {
      return { ok: false, reason: 'server', message: `GitHub החזיר שגיאה ${status}.` };
    }
    return {
      ok: false,
      reason: 'network',
      message: 'לא הצלחתי להתחבר ל-GitHub. ייתכן שאין חיבור לאינטרנט.',
    };
  }
}
