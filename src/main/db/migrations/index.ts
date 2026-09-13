import sql001 from './001_init.sql?raw';
import sql002 from './002_payment_reversals.sql?raw';
import sql003 from './003_security_settings.sql?raw';
import sql004 from './004_receipts_dir.sql?raw';
import sql005 from './005_whatsapp.sql?raw';
import sql006 from './006_open_charges_lines.sql?raw';
import sql007 from './007_notify_events.sql?raw';
import sql008 from './008_occasion_sedra_keys.sql?raw';
import sql009 from './009_shavuot_key.sql?raw';
import sql010 from './010_setup_wizard.sql?raw';
import sql011 from './011_setup_completed_backfill.sql?raw';
import sql012 from './012_vow_items.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * רשימת המיגרציות בסדר עלייה. הוספת מיגרציה = קובץ SQL חדש + שורה כאן
 * + עדכון `docs/DATA-MODEL.md` (CLAUDE.md, דרך עבודה).
 *
 * **מיגרציה שהוחלה היא קפואה.** אין לערוך קובץ קיים – DB שכבר רשם את הגרסה
 * הזו ב-`schema_version` לא יריץ אותה שוב, ויישאר עם סכימה ישנה ושגיאות
 * ריצה סתומות. כל שינוי = קובץ חדש עם המספר הבא.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '001_init', sql: sql001 },
  { version: 2, name: '002_payment_reversals', sql: sql002 },
  { version: 3, name: '003_security_settings', sql: sql003 },
  { version: 4, name: '004_receipts_dir', sql: sql004 },
  { version: 5, name: '005_whatsapp', sql: sql005 },
  { version: 6, name: '006_open_charges_lines', sql: sql006 },
  { version: 7, name: '007_notify_events', sql: sql007 },
  { version: 8, name: '008_occasion_sedra_keys', sql: sql008 },
  { version: 9, name: '009_shavuot_key', sql: sql009 },
  { version: 10, name: '010_setup_wizard', sql: sql010 },
  { version: 11, name: '011_setup_completed_backfill', sql: sql011 },
  { version: 12, name: '012_vow_items', sql: sql012 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
