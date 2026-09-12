import {
  agorotToShekel,
  formatAgorot,
  formatAgorotPlain,
  parseShekelInput,
  shekelToAgorot,
} from '@shared/money';
import type { IsoDate } from '@shared/types';
import { todayIso } from '@shared/datetime';

export { formatAgorot, formatAgorotPlain, agorotToShekel, parseShekelInput, shekelToAgorot };
// מקור אמת יחיד לחותמות זמן ותאריכים – ראו `src/shared/datetime.ts`.
export { todayIso };

/** תצוגה `dd/mm/yyyy` (CLAUDE.md כלל 2). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** תצוגת חותמת זמן מה-audit: `dd/mm/yyyy hh:mm`. */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const [date, time] = ts.replace('T', ' ').split(' ');
  return `${formatDate(date)} ${(time ?? '').slice(0, 5)}`.trim();
}

/** תחילת השנה הכספית הנוכחית לפי חודש ההתחלה שבהגדרות (B-07). */
export function fiscalYearStart(startMonth: number, ref = new Date()): IsoDate {
  const year = ref.getMonth() + 1 >= startMonth ? ref.getFullYear() : ref.getFullYear() - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

/** צבע ליתרה: אדום לחוב, ירוק לזכות, ניטרלי לאפס (F-20). */
export function balanceColor(agorot: number): 'error.main' | 'success.main' | 'text.primary' {
  if (agorot > 0) return 'error.main';
  if (agorot < 0) return 'success.main';
  return 'text.primary';
}

export function memberFullName(m: {
  firstName: string;
  lastName: string;
  nickname?: string | null;
}): string {
  const base = `${m.firstName} ${m.lastName}`.trim();
  return m.nickname ? `${base} (${m.nickname})` : base;
}

/** גודל קובץ לקריאה אנושית. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}
