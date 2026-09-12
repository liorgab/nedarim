import type { Database } from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations';
import { nowIso } from '@shared/datetime';

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

const CREATE_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export function currentSchemaVersion(db: Database): number {
  db.exec(CREATE_VERSION_TABLE);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

/**
 * מריץ את כל המיגרציות שטרם הוחלו, כל אחת בטרנזקציה משלה.
 * אידמפוטנטי: הרצה חוזרת על DB מעודכן לא עושה דבר.
 */
export function migrate(db: Database): MigrationResult {
  const from = currentSchemaVersion(db);
  const applied: string[] = [];

  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= from) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        nowIso(),
      );
    });
    run();
    applied.push(m.name);
  }

  return { from, to: currentSchemaVersion(db), applied };
}

export { LATEST_SCHEMA_VERSION };
