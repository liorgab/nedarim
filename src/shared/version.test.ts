import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  decideUpdate,
  isNewer,
  parseGitHubRepo,
  parseVersion,
  type ReleaseInfo,
} from './version';

/**
 * הקוד שמחליט אם להציע למשתמש להתקין גרסה אחרת. טעות כאן מתבטאת בהצעה
 * לרדת גרסה, או בעדכון שלא מוצע אף פעם – שתי תקלות שמתגלות רק בשטח.
 */

describe('parseVersion', () => {
  it('גרסה רגילה', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' });
  });

  it('קידומת v מתקבלת – כך GitHub מתייג', () => {
    expect(parseVersion('v0.1.0')).toMatchObject({ major: 0, minor: 1, patch: 0 });
  });

  it('גרסה מוקדמת', () => {
    expect(parseVersion('1.2.0-beta.1')?.prerelease).toBe('beta.1');
  });

  it('ערכים לא תקינים', () => {
    for (const bad of ['', '1.2', 'abc', '1.2.3.4', 'v', '1.2.x']) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('major, minor, patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.1.2', '1.1.1')).toBe(1);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
  });

  it('10 גדול מ-9 ולא קטן ממנו', () => {
    // ההשוואה מספרית ולא לקסיקוגרפית; זו הטעות הקלאסית.
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
  });

  it('גרסת שחרור גדולה מגרסה מוקדמת עם אותם מספרים', () => {
    expect(compareVersions('1.2.0', '1.2.0-beta.1')).toBe(1);
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1);
  });

  it('סדר בין גרסאות מוקדמות', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    // חלק חסר קטן מחלק קיים.
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBe(-1);
  });

  it('גרסה לא תקינה נחשבת קטנה ולא מפילה', () => {
    expect(compareVersions('לא-גרסה', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', 'לא-גרסה')).toBe(1);
    expect(compareVersions('xx', 'yy')).toBe(0);
  });

  it('isNewer עקבי עם compareVersions', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.0', '1.0.0')).toBe(false);
  });
});

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tagName: 'v1.0.0',
    name: 'גרסה 1.0.0',
    body: 'שינויים',
    htmlUrl: 'https://github.com/x/y/releases/tag/v1.0.0',
    publishedAt: '2026-09-12T10:00:00Z',
    prerelease: false,
    draft: false,
    installerUrl: 'https://github.com/x/y/releases/download/v1.0.0/setup.exe',
    ...over,
  };
}

describe('decideUpdate', () => {
  it('אין שחרורים כלל', () => {
    expect(decideUpdate({ currentVersion: '1.0.0', releases: [] })).toEqual({ kind: 'none' });
  });

  it('הגרסה המותקנת היא האחרונה', () => {
    expect(decideUpdate({ currentVersion: '1.0.0', releases: [release()] })).toEqual({
      kind: 'up-to-date',
    });
  });

  it('גרסה חדשה עם קובץ התקנה', () => {
    const d = decideUpdate({ currentVersion: '1.0.0', releases: [release({ tagName: 'v1.1.0' })] });
    expect(d.kind).toBe('available');
  });

  it('גרסה חדשה בלי קובץ התקנה', () => {
    const d = decideUpdate({
      currentVersion: '1.0.0',
      releases: [release({ tagName: 'v1.1.0', installerUrl: null })],
    });
    expect(d.kind).toBe('available-no-installer');
  });

  it('טיוטה מדולגת תמיד', () => {
    const d = decideUpdate({
      currentVersion: '1.0.0',
      releases: [release({ tagName: 'v2.0.0', draft: true })],
    });
    expect(d.kind).toBe('up-to-date');
  });

  it('גרסה מוקדמת מדולגת אלא אם ביקשו במפורש', () => {
    const releases = [release({ tagName: 'v2.0.0-beta.1', prerelease: true })];
    expect(decideUpdate({ currentVersion: '1.0.0', releases }).kind).toBe('up-to-date');
    expect(
      decideUpdate({ currentVersion: '1.0.0', releases, includePrerelease: true }).kind,
    ).toBe('available');
  });

  it('נבחרת הגרסה הגבוהה ולא הראשונה ברשימה', () => {
    // GitHub מחזיר לפי תאריך פרסום. תיקון דחוף ל-1.0.x עלול להתפרסם
    // אחרי 1.2.0, ובלי הבחירה הזו היינו מציעים לרדת גרסה.
    const d = decideUpdate({
      currentVersion: '1.0.0',
      releases: [
        release({ tagName: 'v1.0.1', publishedAt: '2026-10-01T00:00:00Z' }),
        release({ tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' }),
      ],
    });
    expect(d.kind).toBe('available');
    if (d.kind !== 'available') return;
    expect(d.release.tagName).toBe('v1.2.0');
  });

  it('תגית שאינה גרסה מדולגת ולא מפילה', () => {
    const d = decideUpdate({
      currentVersion: '1.0.0',
      releases: [release({ tagName: 'nightly' }), release({ tagName: 'v1.1.0' })],
    });
    expect(d.kind).toBe('available');
  });

  it('לא מציע לרדת גרסה', () => {
    const d = decideUpdate({ currentVersion: '2.0.0', releases: [release({ tagName: 'v1.9.0' })] });
    expect(d.kind).toBe('up-to-date');
  });
});

describe('parseGitHubRepo', () => {
  it('כל צורות הכתובת', () => {
    const cases = [
      'https://github.com/liorg/nedarim',
      'https://github.com/liorg/nedarim.git',
      'git+https://github.com/liorg/nedarim.git',
      'git@github.com:liorg/nedarim.git',
      'git://github.com/liorg/nedarim.git',
    ];
    for (const url of cases) expect(parseGitHubRepo(url), url).toBe('liorg/nedarim');
  });

  it('כתובת חסרה או שאינה GitHub – בדיקת העדכונים פשוט כבויה', () => {
    for (const bad of [null, undefined, '', 'https://gitlab.com/a/b', 'לא כתובת']) {
      expect(parseGitHubRepo(bad), String(bad)).toBeNull();
    }
  });
});
