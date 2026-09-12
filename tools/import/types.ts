import type { IsoDate } from '@shared/types';
import type { DiffCause } from './legacySim';

export type IssueSeverity = 'error' | 'warning' | 'info';

/** שורה בדוח החריגים. כל רשומה שיובאה עם ניחוש, או שלא יובאה כלל, מגיעה לכאן. */
export interface ImportIssue {
  severity: IssueSeverity;
  entity: 'member' | 'charge' | 'payment' | 'donation' | 'expense' | 'receipt' | 'general';
  /** מיקום בקובץ המקורי, למשל `כרטיסיות!D6`. */
  sourceRef: string;
  /** תיאור החריגה. */
  message: string;
  /** הערך המקורי שגרם לחריגה. */
  rawValue?: string;
  /** מה המערכת עשתה בפועל. */
  action?: string;
  /** הצעה לתיקון ידני (למשל הפרשה שחלה באותו תאריך). */
  suggestion?: string;
}

export interface ImportCounts {
  members: number;
  openingBalances: number;
  charges: number;
  credits: number;
  payments: number;
  donations: number;
  expenses: number;
  receipts: number;
  skipped: number;
  flagged: number;
}

export interface BalanceDiff {
  memberNumber: number;
  name: string;
  legacyBalance: number;
  importedBalance: number;
  diff: number;
}

export interface MonthDiff {
  ym: string;
  field: 'donations' | 'vowPayments' | 'expenses';
  /** הערך שרשום בגיליון `מאזן שנתי`. */
  legacy: number;
  /** מה שהמאקרו הישן *היה* מחשב היום מאותם נתונים (סימולציה). */
  simulated: number;
  imported: number;
  diff: number;
  cause: DiffCause;
}

export interface ReceiptCheck {
  counterMax: number;
  imported: number;
  duplicates: number[];
  missing: number[];
  /** קבלות שמצביעות על יותר ממקור אחד. */
  ambiguous: number[];
}

export interface ReconcileResult {
  balances: { checked: number; diffs: BalanceDiff[] };
  months: { checked: number; diffs: MonthDiff[]; toleranceAgorot: number };
  receipts: ReceiptCheck;
  outOfWindow: Array<{ ym: string; vowPayments: number; donations: number; expenses: number }>;
  totals: {
    legacyCharges: number;
    importedCharges: number;
    legacyPayments: number;
    importedPayments: number;
  };
}

export interface ImportResult {
  sourceFile: string;
  startedAt: string;
  finishedAt: string;
  counts: ImportCounts;
  issues: ImportIssue[];
  reconcile: ReconcileResult;
  dataRange: { minDate: IsoDate | null; maxDate: IsoDate | null };
}
