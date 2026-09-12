/** טיפוסי הליבה המשותפים ל-main ול-renderer. מקור אמת יחיד. */

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // YYYY-MM-DDTHH:MM:SS

export type UserRole = 'admin' | 'clerk' | 'viewer';
export type MemberStatus = 'active' | 'inactive';
export type ChargeKind = 'vow' | 'credit' | 'opening';
export type OccasionType = 'parasha' | 'holiday' | 'event' | 'credit' | 'opening' | 'other';
export type ReceiptSourceType = 'vow_payment' | 'donation';
export type PaymentStatus = 'recorded' | 'receipted' | 'cancelled';
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'print'
  | 'login'
  | 'backup'
  | 'restore'
  | 'import'
  | 'backfill_mobile';

export interface Member {
  id: number;
  memberNumber: number;
  firstName: string;
  lastName: string;
  nickname: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  status: MemberStatus;
  openingBalanceAgorot: number;
  notes: string | null;
}

export interface MemberWithBalance extends Member {
  /** נייד מנורמל ל-E.164 (מיגרציה 005). NULL = אין מספר שמיש. */
  mobileE164: string | null;
  mobileStatus: 'valid' | 'invalid' | 'missing';
  /** סיבה להצגה כאזהרה, גם כשהמספר תקין (multiple/foreign). */
  mobileReason: string | null;
  balanceAgorot: number;
  totalChargesAgorot: number;
  totalPaymentsAgorot: number;
  lastPaymentDate: IsoDate | null;
}

export interface Occasion {
  id: number;
  name: string;
  type: OccasionType;
  hebcalKey: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Lookup {
  id: number;
  name: string;
  isActive: boolean;
}

export interface PaymentMethod extends Lookup {
  requiresReference: boolean;
}

export interface LedgerRow {
  rowType: 'charge' | 'payment';
  id: number;
  memberId: number;
  date: IsoDate;
  hebrewDate: string;
  occasion: string | null;
  note: string | null;
  debitAgorot: number;
  creditAgorot: number;
  paymentMethod: string | null;
  receiptNumber: number | null;
  status: ChargeKind | PaymentStatus;
  /** יתרה מצטברת – מחושבת בשכבת התצוגה לפי סדר השורות. */
  runningBalanceAgorot: number;
}

export interface MonthlyBalanceRow {
  ym: string; // YYYY-MM
  donationsAgorot: number;
  vowPaymentsAgorot: number;
  incomeAgorot: number;
  expensesAgorot: number;
  netAgorot: number;
  cumulativeAgorot: number;
}

export interface HebrewDateInfo {
  gregorian: IsoDate;
  hebrew: string;
  hebrewYear: string;
  parasha: string | null;
  /** שם החג בעברית, אם יש – למשל 'ערב ראש השנה'. `null` ביום רגיל. */
  holiday: string | null;
}

export interface AppInfo {
  version: string;
  dbPath: string;
  schemaVersion: number;
}

/** מצב מיון גנרי לכל טבלה במערכת (כלל-על 14 ב-CLAUDE.md). */
export interface SortState<TField extends string = string> {
  field: TField;
  direction: 'asc' | 'desc';
}

/** תוצאת שאילתה מעומדת עם סיכומים – כל טבלה אגרגטיבית מחזירה גם KPIs (כלל-על 16). */
export interface Paged<TRow, TKpi = Record<string, number>> {
  rows: TRow[];
  total: number;
  kpis: TKpi;
}
