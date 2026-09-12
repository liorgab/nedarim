/**
 * כותב `RELEASE_NOTES.md` מתוך `CHANGELOG.md`, לתיאור ה-Release ב-GitHub.
 *
 *   npm run release:notes           # לפי הגרסה ב-package.json
 *   npm run release:notes -- 0.2.0
 *
 * למה לא להשאיר ל-GitHub לייצר "מה השתנה" מרשימת ה-commits: רשימת commits
 * נכתבת למפתחים. מה שמופיע בכפתור "בדוק אם יש עדכון" נקרא על ידי הגבאי,
 * והוא צריך משפטים בעברית שמסבירים מה השתנה עבורו.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractVersionNotes } from './notes';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
// תחת `vite-node` הארגומנטים מתחילים ב-argv[2] רק כשמעבירים אותם אחרי `--`.
const version = process.argv[2] ?? pkg.version;

const notes = extractVersionNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
if (notes === null) {
  // כישלון רועש: שחרור בלי תיאור מגיע למשתמשים כ"גרסה חדשה" בלי הסבר.
  console.error(
    `לא נמצא סעיף לגרסה ${version} ב-CHANGELOG.md. יש להוסיף "## [${version}] – <תאריך>" לפני השחרור.`,
  );
  process.exit(1);
}

writeFileSync(join(root, 'RELEASE_NOTES.md'), `${notes.body}\n`, 'utf8');
console.log(`נכתב RELEASE_NOTES.md לגרסה ${notes.version} (${notes.body.length} תווים).`);
