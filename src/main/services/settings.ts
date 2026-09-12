import type { Database } from 'better-sqlite3';

export function getAllSettings(db: Database): Record<string, string | null> {
  const rows = db.prepare('SELECT key, value FROM setting').all() as Array<{
    key: string;
    value: string | null;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSetting(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string | null): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** קורא הגדרה מספרית עם ברירת מחדל – אין ערכים קשיחים בקוד הצרכן (כלל 12). */
export function getNumberSetting(db: Database, key: string, fallback: number): number {
  const raw = getSetting(db, key);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
