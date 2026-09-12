/**
 * מפיק את `THIRD-PARTY-NOTICES.md` מתוך `node_modules` בפועל.
 *
 *   npm run licenses
 *
 * למה כלי ולא רשימה ידנית: רשימת רישיונות שנכתבת ביד מתיישנת בשקט בכל
 * `npm install`, ודווקא שם הנזק מתגלה מאוחר. הסורק גם **נכשל** כשהוא לא
 * מצליח לזהות רישיון, במקום לרשום "?" ולהמשיך.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Pkg {
  name?: string;
  version?: string;
  license?: string | Array<{ type?: string }>;
  licenses?: string | Array<{ type?: string }>;
  dependencies?: Record<string, string>;
}

const ROOT = process.cwd();

/**
 * פותר חבילה כפי ש-Node פותר אותה: קודם `node_modules` מקונן של המבקש,
 * ואז כלפי מעלה. בלי זה חבילות מקוננות (`better-sqlite3/node_modules/...`)
 * נראות כחסרות – וזה בדיוק מה שקרה בגרסה הראשונה של הסורק.
 */
function resolvePkg(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = join(dir, '..');
    if (parent === dir || !dir.startsWith(ROOT)) return null;
    dir = parent;
  }
}

function licenseOf(pkg: Pkg): string {
  const raw = pkg.license ?? pkg.licenses;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((x) => x.type ?? '?').join(' OR ');
  return '';
}

/** קובץ רישיון שמצורף לחבילה – עדות נוספת כשהשדה חסר. */
function licenseFile(dir: string): string | null {
  try {
    return readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f)) ?? null;
  } catch {
    return null;
  }
}

export interface Entry {
  name: string;
  version: string;
  license: string;
  hasLicenseFile: boolean;
}

export function collect(): { entries: Entry[]; unresolved: string[] } {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Pkg;
  const entries = new Map<string, Entry>();
  const unresolved: string[] = [];
  const stack: Array<[string, string]> = Object.keys(root.dependencies ?? {}).map((d) => [
    d,
    ROOT,
  ]);

  while (stack.length > 0) {
    const [name, from] = stack.pop()!;
    const dir = resolvePkg(name, from);
    if (dir === null) {
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg;
    const key = `${name}@${pkg.version ?? ''}`;
    if (entries.has(key)) continue;
    entries.set(key, {
      name,
      version: pkg.version ?? '',
      license: licenseOf(pkg),
      hasLicenseFile: licenseFile(dir) !== null,
    });
    for (const d of Object.keys(pkg.dependencies ?? {})) stack.push([d, dir]);
  }

  return {
    entries: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unresolved,
  };
}

/** רישיונות שאינם מתירניים-סתם ולכן ראויים לשורה משלהם במסמך. */
const NOTABLE = /GPL|Apache|OFL|BSD|MPL|EPL|CDDL|Zlib|0BSD/i;

const NOTE: Record<string, string> = {
  'GPL-2.0': 'כותרות המקור מצהירות "or later" – ראו ההסבר למעלה',
  'LGPL-2.1': 'תואם GPL',
  'Apache-2.0': 'תואם GPLv3 (אינו תואם GPLv2)',
  'OFL-1.1': 'גופן – יצירה נפרדת, נשאר תחת OFL',
};

export function render(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.license, (counts.get(e.license) ?? 0) + 1);

  const notable = entries.filter((e) => NOTABLE.test(e.license));
  const rows = notable
    .map((e) => `| \`${e.name}\` | ${e.version} | ${e.license} | ${NOTE[e.license] ?? ''} |`)
    .join('\n');

  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `- **${l}** — ${n}`)
    .join('\n');

  return `# רישיונות של רכיבי צד שלישי

NEDARIM מופצת תחת **GPL-3.0-or-later** (ראו \`LICENSE\`). המסמך הזה מרכז את
הרכיבים שנארזים בהתקנה ואת הרישיונות שלהם. הוא **נוצר אוטומטית** מתוך
\`node_modules\` – \`npm run licenses\`.

## למה GPL ולא MIT

\`@hebcal/core\` – הרכיב שמחשב את כל התאריכים העבריים, הפרשות והחגים –
מופץ תחת GPL, וכותרות המקור שלו קובעות במפורש:

> _"This program is free software; you can redistribute it and/or modify it
> under the terms of the GNU General Public License as published by the Free
> Software Foundation; **either version 2 of the License, or (at your option)
> any later version**."_

כלומר רישיון מתירני לא עמד על הפרק מרגע שנבחר hebcal, והצהרת MIT הקודמת
לא הייתה נכונה. מימוש אופציית ה-"or later" ל-GPLv3 נעשה בכוונה: תחת GPLv2
בלבד, רכיב Apache-2.0 (\`cssjanus\`, שמגיע עם תמיכת ה-RTL) נחשב בלתי תואם;
תחת GPLv3 הוא תואם.

**מה זה אומר למי שמוריד:** מותר להשתמש, לשנות ולהפיץ – בחינם, לכל מטרה,
כולל מסחרית. התנאי היחיד: מי שמפיץ גרסה שונה חייב לשחרר גם את המקור שלה
תחת GPL. שימוש פנימי בבית הכנסת שלך אינו "הפצה" ואינו מחייב דבר.

## רכיבים שאינם MIT/ISC

| רכיב | גרסה | רישיון | הערה |
|---|---|---|---|
${rows}

## סיכום כל העץ הנארז

${summary}

_${entries.length} חבילות._

## כלים שאינם נארזים

\`xlsx\` (Apache-2.0) משמש **רק** את כלי הייבוא החד-פעמי ב-\`tools/import/\`,
ולכן הוא ב-\`devDependencies\` ואינו חלק מההתקנה. גרסת ה-npm שלו נטושה ויש
לה התראת אבטחה ללא תיקון; הוא קורא אך ורק קובץ Excel שהמשתמש עצמו מספק.
כתיבת קובצי Excel מהיישום עצמו נעשית ב-\`write-excel-file\` (MIT).
`;
}

const { entries, unresolved } = collect();
if (unresolved.length > 0) {
  // כישלון רועש: רשימת רישיונות חלקית גרועה מרשימה שלא קיימת.
  console.error(`חבילות שלא נפתרו: ${unresolved.join(', ')}`);
  process.exit(1);
}
const missing = entries.filter((e) => e.license === '');
if (missing.length > 0) {
  console.error(`חבילות ללא רישיון מוצהר: ${missing.map((e) => e.name).join(', ')}`);
  process.exit(1);
}

writeFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), render(entries), 'utf8');
console.log(`נכתב THIRD-PARTY-NOTICES.md – ${entries.length} חבילות, הכול עם רישיון מוצהר.`);
