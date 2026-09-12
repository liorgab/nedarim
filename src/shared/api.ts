/**
 * חוזה ה-IPC – מקור האמת היחיד לשני צדי הגשר (CLAUDE.md כלל 7).
 * ה-renderer קורא רק דרך `window.api`; ה-main רושם handler לכל ערוץ שמופיע כאן.
 */
import type {
  AppInfo,
  AuditAction,
  HebrewDateInfo,
  IsoDate,
  LedgerRow,
  Lookup,
  Member,
  MemberStatus,
  MemberWithBalance,
  MonthlyBalanceRow,
  Occasion,
  PaymentMethod,
  ReceiptSourceType,
  UserRole,
} from './types';

// ---------------------------------------------------------------- תשתית

/** GPLv3 §5 – המסמכים שחייבים להיות קריאים מתוך היישום. */
export type LegalDocIdDto = 'license' | 'notices' | 'privacy' | 'changelog';

export interface LegalDocDto {
  id: LegalDocIdDto;
  fileName: string;
  text: string;
}

/** F-115 – תוצאת בדיקת עדכון יזומה. */
export interface UpdateCheckDto {
  ok: boolean;
  /** `up-to-date` · `available` · `available-no-installer` · `none` */
  kind?: string;
  currentVersion?: string;
  repo?: string;
  release?: {
    tagName: string;
    name: string;
    body: string;
    htmlUrl: string;
    publishedAt: string;
    installerUrl: string | null;
  };
  reason?: 'no-repo' | 'network' | 'rate-limit' | 'server';
  message?: string;
}

export interface AppApi {
  /** מידע על הגרסה, נתיב ה-DB וגרסת הסכימה. */
  info(): Promise<AppInfo>;
  /** התפקיד של המשתמש הנוכחי. עד שלב 4 – תמיד admin. */
  currentUser(): Promise<{ id: number; displayName: string; role: UserRole }>;
  /** מדיניות פרטיות, רישיון והודעות צד שלישי – לקריאה במסך "אודות". */
  legalDoc(id: LegalDocIdDto): Promise<LegalDocDto>;
  /** פותח את תיקיית ההתקנה, כדי שאפשר יהיה לפתוח את הקבצים גם מחוצה לו. */
  openAppFolder(): Promise<void>;
  /**
   * F-115 – בדיקת עדכון. **יזומה בלבד**: נקראת רק כשהמשתמש לוחץ על
   * הכפתור. אין בדיקה ברקע ואין בדיקה בעלייה.
   */
  checkForUpdate(): Promise<UpdateCheckDto>;
  /** פותח קישור חיצוני בדפדפן ברירת המחדל. */
  openExternal(url: string): Promise<void>;
}

/** F-90 – שורה אחת בלוח השנה. */
export interface CalendarDayDto {
  gregorian: IsoDate;
  dayOfWeek: string;
  hebrew: string;
  hebrewYear: string;
  parasha: string | null;
  holiday: string | null;
  /** האירוע שיוצע בהזנת נדר לתאריך הזה (F-31). */
  occasion: string | null;
  isShabbat: boolean;
  isHoliday: boolean;
}

export interface CalendarApi {
  forDate(date: IsoDate): Promise<HebrewDateInfo>;
  defaultOccasionForDate(
    date: IsoDate,
  ): Promise<{ occasionId: number | null; name: string | null }>;
  /** F-90 – טווח תאריכים ללוח השנה. זורק כשהטווח ארוך מדי או הפוך. */
  range(from: IsoDate, to: IsoDate): Promise<CalendarDayDto[]>;
  /** החודש הלועזי של התאריך – ברירת המחדל בפתיחת המסך. */
  monthRange(date: IsoDate): Promise<{ from: IsoDate; to: IsoDate }>;
  /** F-90 – ייצוא הטווח. מחזיר את הנתיב שנשמר, או `null` אם בוטל. */
  exportRange(from: IsoDate, to: IsoDate, format: 'csv' | 'xlsx'): Promise<string | null>;
  /**
   * F-90 – הדפסה. `toPrinter: false` שומר PDF ומחזיר את נתיבו;
   * `true` שולח למדפסת ומחזיר `null`.
   */
  printRange(from: IsoDate, to: IsoDate, toPrinter: boolean): Promise<string | null>;
}

export interface LookupsApi {
  occasions(includeInactive?: boolean): Promise<Occasion[]>;
  paymentMethods(includeInactive?: boolean): Promise<PaymentMethod[]>;
  donationTypes(includeInactive?: boolean): Promise<Lookup[]>;
  expenseCategories(includeInactive?: boolean): Promise<Lookup[]>;
}

export interface SettingsApi {
  getAll(): Promise<Record<string, string | null>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

// ---------------------------------------------------------------- חברים

export interface MemberFilterDto {
  search?: string;
  status?: MemberStatus | 'all';
  onlyWithBalance?: boolean;
  minBalanceAgorot?: number;
  /** W-20 – סינון לפי תקינות הנייד. */
  mobileStatus?: 'valid' | 'not_valid' | 'all';
}

export interface MembersKpisDto {
  count: number;
  totalDebtAgorot: number;
  totalCreditAgorot: number;
  withDebt: number;
  averageDebtAgorot: number;
  maxDebtAgorot: number;
}

export interface MemberInputDto {
  firstName: string;
  lastName: string;
  nickname?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface MembersApi {
  list(
    filter?: MemberFilterDto,
  ): Promise<{ rows: MemberWithBalance[]; total: number; kpis: MembersKpisDto }>;
  get(id: number): Promise<MemberWithBalance | null>;
  create(input: MemberInputDto): Promise<MemberWithBalance>;
  update(id: number, input: MemberInputDto): Promise<MemberWithBalance>;
  setStatus(
    id: number,
    status: MemberStatus,
    options?: { confirmedWithBalance?: boolean },
  ): Promise<MemberWithBalance>;
  merge(fromId: number, toId: number): Promise<MemberWithBalance>;
  findDuplicates(
    firstName: string,
    lastName: string,
    excludeId?: number,
  ): Promise<Array<{ id: number; memberNumber: number }>>;
  topDebtors(limit?: number): Promise<MemberWithBalance[]>;
}

// ---------------------------------------------------------------- כרטיסייה

export interface LedgerFilterDto {
  from?: IsoDate;
  to?: IsoDate;
  rowType?: 'charge' | 'payment';
  search?: string;
  onlyWithoutReceipt?: boolean;
}

export interface LedgerKpisDto {
  openingBalanceAgorot: number;
  debitAgorot: number;
  creditAgorot: number;
  closingBalanceAgorot: number;
  rowCount: number;
  chargeCount: number;
  paymentCount: number;
}

export interface LedgerApi {
  get(
    memberId: number,
    filter?: LedgerFilterDto,
  ): Promise<{ rows: LedgerRow[]; kpis: LedgerKpisDto }>;
  recentCharges(memberId: number, limit?: number): Promise<LedgerRow[]>;
  paymentsWithoutReceipt(limit?: number): Promise<
    Array<{
      id: number;
      memberId: number;
      memberName: string;
      memberNumber: number;
      date: IsoDate;
      amountAgorot: number;
      paymentMethod: string;
    }>
  >;
}

// ---------------------------------------------------------------- נדרים

export interface ValidationIssueDto {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface VowInputDto {
  memberId: number;
  chargeDate: IsoDate;
  occasionId: number;
  occasionNote?: string | null;
  amountAgorot: number;
  notes?: string | null;
}

export interface BulkVowInputDto {
  chargeDate: IsoDate;
  occasionId: number;
  lines: Array<{ memberId: number; amountAgorot: number; occasionNote?: string | null }>;
}

export interface CreditInputDto {
  memberId: number;
  chargeDate: IsoDate;
  occasionId: number;
  amountAgorot: number;
  creditReason: string;
  note: string;
  reversalOfId?: number | null;
}

export interface VowsApi {
  validate(input: VowInputDto): Promise<ValidationIssueDto[]>;
  create(input: VowInputDto): Promise<number>;
  createBulk(input: BulkVowInputDto): Promise<{ ids: number[]; totalAgorot: number }>;
  createCredit(input: CreditInputDto): Promise<number>;
  remove(id: number): Promise<void>;
  creditReasons(): Promise<string[]>;
}

// ---------------------------------------------------------------- תשלומים

export interface PaymentInputDto {
  memberId: number;
  paymentDate: IsoDate;
  amountAgorot: number;
  paymentMethodId: number;
  reference?: string | null;
  notes?: string | null;
}

export interface ReceiptDto {
  id: number;
  receiptNumber: number;
  sourceType: ReceiptSourceType;
  sourceId: number;
  payerName: string;
  amountAgorot: number;
  paymentMethodText: string;
  paymentReference: string | null;
  paymentDate: IsoDate;
  purposeText: string;
  hebrewYear: string;
  issuedAt: string;
  pdfPath: string | null;
  printCount: number;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface PaymentResultDto {
  paymentId: number;
  receipt: ReceiptDto | null;
  balanceAfterAgorot: number;
}

export interface PaymentsApi {
  validate(input: PaymentInputDto): Promise<ValidationIssueDto[]>;
  create(input: PaymentInputDto, issueReceipt: boolean): Promise<PaymentResultDto>;
  createBulk(
    input: {
      paymentDate: IsoDate;
      paymentMethodId: number;
      reference?: string | null;
      lines: Array<{ memberId: number; amountAgorot: number; notes?: string | null }>;
    },
    issueReceipts: boolean,
  ): Promise<PaymentResultDto[]>;
  remove(id: number): Promise<void>;
  issueReceipt(paymentId: number): Promise<ReceiptDto>;
}

// ---------------------------------------------------------------- קבלות

export interface ReceiptFilterDto {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  sourceType?: ReceiptSourceType;
  state?: 'all' | 'active' | 'cancelled';
  minNumber?: number;
  maxNumber?: number;
}

export interface ReceiptBookKpisDto {
  count: number;
  totalAgorot: number;
  cancelledCount: number;
  cancelledAgorot: number;
  vowPaymentAgorot: number;
  donationAgorot: number;
  firstNumber: number | null;
  lastNumber: number | null;
}

export interface ReceiptsApi {
  list(
    filter?: ReceiptFilterDto,
  ): Promise<{ rows: ReceiptDto[]; total: number; kpis: ReceiptBookKpisDto }>;
  get(id: number): Promise<ReceiptDto | null>;
  /** מפיק PDF, שומר בארכיון ומעדכן print_count. `toPrinter` שולח גם למדפסת. */
  print(id: number, toPrinter: boolean): Promise<{ pdfPath: string; receipt: ReceiptDto }>;
  /** HTML לתצוגה מקדימה בתוך היישום, בלי לספור הדפסה. */
  previewHtml(id: number): Promise<string>;
  /** פותח את קובץ ה-PDF בתוכנה החיצונית של המשתמש. */
  openPdf(id: number): Promise<void>;
  cancel(id: number, reason: string, sourceAction: 'keep' | 'delete'): Promise<ReceiptDto>;
  continuity(): Promise<{
    nextNumber: number;
    issued: number;
    missing: number[];
    duplicates: number[];
  }>;
  nextNumber(): Promise<number>;
}

// ---------------------------------------------------------------- תרומות

export interface DonationDto {
  id: number;
  donationNumber: number;
  donationDate: IsoDate;
  memberId: number | null;
  memberName: string | null;
  donorName: string;
  donationTypeId: number;
  donationType: string;
  paymentMethodId: number;
  paymentMethod: string;
  reference: string | null;
  amountAgorot: number;
  isReversal: boolean;
  purpose: string | null;
  receiptId: number | null;
  receiptNumber: number | null;
  needsReview: boolean;
}

export interface DonationFilterDto {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  donationTypeId?: number;
  paymentMethodId?: number;
  memberId?: number;
  receiptState?: 'all' | 'with' | 'without';
}

export interface DonationKpisDto {
  count: number;
  totalAgorot: number;
  averageAgorot: number;
  withReceipt: number;
  withoutReceiptAgorot: number;
  linkedToMembers: number;
  largestAgorot: number;
}

export interface DonationInputDto {
  donationDate: IsoDate;
  memberId?: number | null;
  donorName: string;
  donationTypeId: number;
  paymentMethodId: number;
  reference?: string | null;
  amountAgorot: number;
  purpose?: string | null;
}

export interface DonationsApi {
  list(
    filter?: DonationFilterDto,
  ): Promise<{ rows: DonationDto[]; total: number; kpis: DonationKpisDto }>;
  get(id: number): Promise<DonationDto | null>;
  validate(input: DonationInputDto): Promise<ValidationIssueDto[]>;
  create(
    input: DonationInputDto,
    issueReceipt: boolean,
  ): Promise<{ donationId: number; receipt: ReceiptDto | null }>;
  update(id: number, input: DonationInputDto): Promise<DonationDto>;
  remove(id: number): Promise<void>;
  issueReceipt(id: number): Promise<ReceiptDto>;
  forMember(memberId: number): Promise<DonationDto[]>;
}

// ---------------------------------------------------------------- הוצאות

export interface ExpenseDto {
  id: number;
  expenseNumber: number;
  expenseDate: IsoDate;
  amountAgorot: number;
  isRefund: boolean;
  categoryId: number;
  category: string;
  description: string;
  supplier: string | null;
  reference: string | null;
  paymentMethodId: number | null;
  paymentMethod: string | null;
  attachmentPath: string | null;
  notes: string | null;
  needsReview: boolean;
}

export interface ExpenseFilterDto {
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  categoryId?: number;
  supplier?: string;
  paymentMethodId?: number;
  minAmountAgorot?: number;
  maxAmountAgorot?: number;
}

export interface ExpenseKpisDto {
  count: number;
  totalAgorot: number;
  averageAgorot: number;
  largestAgorot: number;
  refundsAgorot: number;
  byCategory: Array<{ category: string; totalAgorot: number; count: number }>;
}

export interface ExpenseInputDto {
  expenseDate: IsoDate;
  amountAgorot: number;
  isRefund?: boolean;
  categoryId: number;
  description: string;
  supplier?: string | null;
  reference?: string | null;
  paymentMethodId?: number | null;
  notes?: string | null;
  attachmentSourcePath?: string | null;
}

export interface ExpensesApi {
  list(
    filter?: ExpenseFilterDto,
  ): Promise<{ rows: ExpenseDto[]; total: number; kpis: ExpenseKpisDto }>;
  get(id: number): Promise<ExpenseDto | null>;
  validate(input: ExpenseInputDto): Promise<ValidationIssueDto[]>;
  create(input: ExpenseInputDto): Promise<number>;
  update(id: number, input: ExpenseInputDto): Promise<ExpenseDto>;
  remove(id: number): Promise<void>;
  suppliers(): Promise<string[]>;
  /** פותח דיאלוג בחירת קובץ ומחזיר את הנתיב שנבחר. */
  pickAttachment(): Promise<string | null>;
  openAttachment(id: number): Promise<void>;
}

// ---------------------------------------------------------------- מאזן ודוחות

export type RangeKindDto = 'fiscal' | 'hebrew' | 'civil' | 'custom' | 'all';

export interface BalanceRangeDto {
  kind: RangeKindDto;
  year?: number;
  from?: IsoDate;
  to?: IsoDate;
}

export interface MonthlyBalanceResultDto {
  rows: MonthlyBalanceRow[];
  openingCumulativeAgorot: number;
  totals: {
    donationsAgorot: number;
    vowPaymentsAgorot: number;
    incomeAgorot: number;
    expensesAgorot: number;
    netAgorot: number;
    closingCumulativeAgorot: number;
  };
  label: string;
}

export interface AccrualRowDto {
  ym: string;
  chargedAgorot: number;
  collectedAgorot: number;
  gapAgorot: number;
}

export interface BalanceApi {
  monthly(range?: BalanceRangeDto): Promise<MonthlyBalanceResultDto>;
  accrual(range?: BalanceRangeDto): Promise<{ rows: AccrualRowDto[]; totals: AccrualRowDto }>;
  availableYears(): Promise<{ civil: number[]; fiscal: number[]; hebrew: number[] }>;
}

export type ReportIdDto =
  'debtors' | 'byOccasion' | 'donations' | 'expenses' | 'byPaymentMethod' | 'memberStatement';

export interface ReportColumnDto {
  key: string;
  label: string;
  format: 'text' | 'money' | 'date' | 'number' | 'hebrewDate';
  align?: 'start' | 'end';
}

export interface ReportResultDto {
  id: ReportIdDto;
  title: string;
  subtitle: string;
  columns: ReportColumnDto[];
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, string | number | null> | null;
  kpis: Array<{ key: string; label: string; value: number; format: ReportColumnDto['format'] }>;
  generatedAt: string;
}

export interface ReportParamsDto {
  range?: BalanceRangeDto;
  memberId?: number;
  minBalanceAgorot?: number;
}

export interface ReportsApi {
  list(): Promise<Array<{ id: ReportIdDto; title: string; needsMember?: boolean }>>;
  run(id: ReportIdDto, params?: ReportParamsDto): Promise<ReportResultDto>;
  /** ייצוא הדוח לקובץ. מחזיר את הנתיב, או null אם המשתמש ביטל. */
  export(id: ReportIdDto, params: ReportParamsDto, format: 'csv' | 'xlsx'): Promise<string | null>;
}

// ---------------------------------------------------------------- הגדרות

export interface SettingSpecDto {
  key: string;
  label: string;
  group: 'synagogue' | 'receipt' | 'finance' | 'system' | 'whatsapp';
  type: 'text' | 'number' | 'money' | 'month' | 'choice' | 'path' | 'image' | 'bool';
  help?: string;
  choices?: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  min?: number;
  max?: number;
}

export interface CountersInfoDto {
  nextReceiptNumber: number;
  maxIssuedReceiptNumber: number;
  nextMemberNumber: number;
  nextDonationNumber: number;
  nextExpenseNumber: number;
}

export interface ConfigurationDto {
  settings: Record<string, string>;
  specs: readonly SettingSpecDto[];
  counters: CountersInfoDto;
  isFirstRun: boolean;
}

export type LookupTableDto = 'occasion' | 'payment_method' | 'donation_type' | 'expense_category';

export interface LookupRowDto {
  id: number;
  name: string;
  isActive: boolean;
  usageCount: number;
  type?: string;
  requiresReference?: boolean;
}

/** F-110 – צעד באשף ההתקנה. */
export interface WizardStepDto {
  id: string;
  title: string;
  intro: string;
  keys: string[];
}

export interface WizardStateDto {
  completed: boolean;
  completedAt: string | null;
  missingRequired: string[];
}

export interface ConfigurationApi {
  get(): Promise<ConfigurationDto>;
  save(patch: Record<string, string>): Promise<ConfigurationDto>;
  setReceiptStartNumber(next: number): Promise<CountersInfoDto>;
  listLookup(table: LookupTableDto): Promise<LookupRowDto[]>;
  addLookup(
    table: LookupTableDto,
    name: string,
    options?: { type?: string; requiresReference?: boolean },
  ): Promise<LookupRowDto[]>;
  renameLookup(table: LookupTableDto, id: number, name: string): Promise<LookupRowDto[]>;
  setLookupActive(table: LookupTableDto, id: number, isActive: boolean): Promise<LookupRowDto[]>;
  /** בוחר קובץ תמונה (לוגו/חתימה) ומחזיר את הנתיב. */
  pickImage(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  /** F-110 – צעדי אשף ההתקנה ומצבו. */
  wizardSteps(): Promise<WizardStepDto[]>;
  wizardState(): Promise<WizardStateDto>;
  /** נכשל כשחסר שדה חובה, כדי שלא תיווצר מערכת "מוגדרת" בלי שם בית כנסת. */
  completeSetup(): Promise<WizardStateDto>;
  /** פותח את האשף מחדש – למשל כשמעבירים את המערכת לבית כנסת אחר. */
  reopenSetup(): Promise<WizardStateDto>;
}

// ---------------------------------------------------------------- מסך ראשי

export interface DashboardDto {
  today: { gregorian: IsoDate; hebrew: string; hebrewYear: string; parasha: string | null };
  cards: {
    openDebtAgorot: number;
    membersWithDebt: number;
    incomeThisMonthAgorot: number;
    vowPaymentsThisMonthAgorot: number;
    donationsThisMonthAgorot: number;
    expensesThisMonthAgorot: number;
    netThisMonthAgorot: number;
    cumulativeBalanceAgorot: number;
    fiscalYearIncomeAgorot: number;
    fiscalYearExpensesAgorot: number;
  };
  topDebtors: MemberWithBalance[];
  pendingReceipts: {
    count: number;
    totalAgorot: number;
    rows: Array<{
      id: number;
      memberId: number;
      memberName: string;
      memberNumber: number;
      date: IsoDate;
      amountAgorot: number;
      paymentMethod: string;
    }>;
  };
  needsReview: { charges: number; payments: number; donations: number; expenses: number };
  trend: Array<{ ym: string; incomeAgorot: number; expensesAgorot: number }>;
}

export interface DashboardApi {
  summary(): Promise<DashboardDto>;
}

/** החוזה המלא שנחשף כ-`window.api`. */

// ---------------------------------------------------------------- אבטחה

export interface AuthUserDto {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  /** true כשעדיין לא נקבעה סיסמה – חובה לקבוע אחת בהתחברות. */
  needsPassword: boolean;
}

export interface SessionDto {
  user: AuthUserDto | null;
  /** האם יש משתמש מחובר כרגע. */
  authenticated: boolean;
  /** דקות חוסר פעילות עד נעילה אוטומטית. 0 = ללא נעילה. */
  idleLockMinutes: number;
  /** האם המערכת דורשת התחברות בכלל (הגדרה `require_login`). */
  loginRequired: boolean;
}

export interface LoginResultDto {
  ok: boolean;
  needsPassword: boolean;
  message?: string;
  session: SessionDto;
}

export interface AuthApi {
  session(): Promise<SessionDto>;
  login(username: string, password: string): Promise<LoginResultDto>;
  /** קביעת סיסמה בהתחברות ראשונה, כשעדיין אין סיסמה למשתמש. */
  setInitialPassword(username: string, password: string): Promise<LoginResultDto>;
  logout(): Promise<SessionDto>;
  /** נעילת המסך – לא מנתקת, רק דורשת סיסמה חוזרת. */
  lock(): Promise<SessionDto>;
  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void>;
  listUsers(): Promise<AuthUserDto[]>;
  createUser(input: {
    username: string;
    displayName: string;
    role: UserRole;
    password: string;
  }): Promise<AuthUserDto[]>;
  updateUser(
    id: number,
    patch: { displayName?: string; role?: UserRole; isActive?: boolean },
  ): Promise<AuthUserDto[]>;
  resetPassword(id: number, password: string): Promise<AuthUserDto[]>;
}

// ---------------------------------------------------------------- גיבוי ושחזור

export interface BackupManifestDto {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  dbSha256: string;
  dbBytes: number;
  counts: {
    members: number;
    charges: number;
    payments: number;
    donations: number;
    expenses: number;
    receipts: number;
  };
  totalBalanceAgorot: number;
  receiptFiles: number;
  attachmentFiles: number;
}

export interface BackupInfoDto {
  path: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  manifest: BackupManifestDto | null;
  valid: boolean;
}

export interface BackupApi {
  /** F-100 – גיבוי לתיקייה הפנימית, או לתיקייה חיצונית שהמשתמש בוחר. */
  create(external: boolean): Promise<BackupInfoDto | null>;
  /** רשימת הגיבויים בתיקייה נתונה (ברירת מחדל: הפנימית). */
  list(dir?: string): Promise<{ dir: string; backups: BackupInfoDto[] }>;
  /** בוחר תיקיית גיבויים ומחזיר את מה שנמצא בה. */
  browse(): Promise<{ dir: string; backups: BackupInfoDto[] } | null>;
  /** F-101 – משחזר ומפעיל את היישום מחדש. */
  restore(backupPath: string): Promise<void>;
  /** F-102 – תזכורת גיבוי חיצוני. */
  reminder(): Promise<{ due: boolean; daysSince: number | null; thresholdDays: number }>;
  /** F-104 – ייצוא מלא של כל הנתונים ל-Excel. */
  exportAll(): Promise<string | null>;
  openFolder(path: string): Promise<void>;
}

// ---------------------------------------------------------------- ייבוא נתונים

export type ImportEntityIdDto =
  | 'payment_method'
  | 'donation_type'
  | 'expense_category'
  | 'occasion'
  | 'member'
  | 'vow_charge'
  | 'vow_payment'
  | 'donation'
  | 'expense';

export type ImportModeDto = 'replace' | 'upsert' | 'insert' | 'enrich';

export interface ImportModeInfoDto {
  mode: ImportModeDto;
  label: string;
  description: string;
  /** אזהרה שמוצגת באדום. `null` = אין סכנה. */
  danger: string | null;
  /** דורש מפתח טבעי כדי לזהות רשומה קיימת. */
  requiresKey: boolean;
}

export interface ImportFieldDto {
  label: string;
  type: 'text' | 'number' | 'money' | 'date' | 'bool' | 'choice';
  required: boolean;
  help: string;
  example: string;
  choices: string[];
  /** השדה מצביע על יישות אחרת – מוצג כך במסך המיפוי. */
  refLabel: string | null;
}

export interface ImportEntityDto {
  id: ImportEntityIdDto;
  label: string;
  sheet: string;
  intro: string;
  fields: ImportFieldDto[];
  /** יישויות שחייבות להיות במערכת לפניה. */
  dependsOn: ImportEntityIdDto[];
}

export interface ImportFieldMappingDto {
  field: string;
  column: number | null;
  quality: 'exact' | 'likely' | 'none';
}

export interface ImportSheetDto {
  index: number;
  sheetName: string;
  entity: ImportEntityIdDto | null;
  detectedBy: 'sheet_name' | 'headers' | null;
  headerRow: number;
  headers: string[];
  dataRows: number;
  mapping: ImportFieldMappingDto[];
  include: boolean;
}

export interface ImportFileDto {
  path: string;
  fileName: string;
  kind: 'workbook' | 'csv';
  sheets: ImportSheetDto[];
}

/** מה שחוזר מבחירת קובץ: קובץ נתונים, תיקיית גיבוי, או ביטול. */
export type ImportChoiceDto =
  | { kind: 'file'; file: ImportFileDto }
  | { kind: 'backup'; path: string }
  /** נבחרה תיקייה שאינה גיבוי – ההודעה מוצגת למשתמש. */
  | { kind: 'invalid'; message: string }
  | { kind: 'cancelled' };

export interface ImportPreflightDto {
  problems: Array<{
    sheetName: string;
    entityLabel: string;
    missingRequired: string[];
    ignoredColumns: string[];
  }>;
  missingDependencies: Array<{ entityLabel: string; needsLabel: string }>;
}

export interface ImportIssueDto {
  sheet: string;
  column: string;
  message: string;
  severity: 'error' | 'warning';
  count: number;
  sampleRows: number[];
}

export interface ImportValidationDto {
  sheets: Array<{
    entity: ImportEntityIdDto;
    entityLabel: string;
    sheetName: string;
    rows: number;
    rejected: number;
    skippedExample: number;
  }>;
  totalRows: number;
  totalRejected: number;
  errors: number;
  warnings: number;
  issues: ImportIssueDto[];
  blocks: Array<{ entityLabel: string; message: string }>;
  canImport: boolean;
  preview: Array<{ entityLabel: string; insert: number; update: number; enrich: number; skip: number }>;
}

export interface ImportResultDto {
  sheets: Array<{
    entityLabel: string;
    insert: number;
    update: number;
    enrich: number;
    skip: number;
    skipped: Array<{ row: number; reason: string }>;
  }>;
  totals: { insert: number; update: number; enrich: number; skip: number };
}

export interface ImportApi {
  /** F-120 – הקטלוג, למסך המיפוי ולבחירת יישות ידנית. */
  catalog(): Promise<ImportEntityDto[]>;
  /** ארבעת מצבי הייבוא והאזהרות שלהם. */
  modes(): Promise<ImportModeInfoDto[]>;
  /** F-122 – הורדת תבנית האקסל. מחזיר את הנתיב שנשמר, או null בביטול. */
  downloadTemplate(): Promise<string | null>;
  /** F-123 – בחירת קובץ נתונים. */
  chooseFile(): Promise<ImportChoiceDto>;
  /**
   * F-127 – בחירת תיקיית גיבוי.
   *
   * נפרד מ-`chooseFile` כי גיבוי הוא **תיקייה**, ודיאלוג של Windows אינו
   * יכול לבחור קובץ ותיקייה באותה פתיחה. שני כפתורים הם המחיר, והחלופה
   * היא מסלול שאי אפשר להגיע אליו.
   */
  chooseBackup(): Promise<ImportChoiceDto>;
  /** הקובץ שנפתח, אם יש. */
  current(): Promise<ImportFileDto | null>;
  /** F-125 – שינוי מיפוי, יישות או הכללה של גיליון. */
  updateSheet(
    index: number,
    patch: {
      entity?: ImportEntityIdDto | null;
      include?: boolean;
      mapping?: ImportFieldMappingDto[];
      headerRow?: number;
    },
  ): Promise<ImportFileDto>;
  /** בדיקת המיפוי לפני האימות. */
  preflight(): Promise<ImportPreflightDto>;
  /** F-124 – אימות מלא, כולל תצוגה מקדימה מהרצה יבשה. */
  validate(mode: ImportModeDto): Promise<ImportValidationDto>;
  /** F-126 – הייבוא עצמו. */
  run(mode: ImportModeDto): Promise<ImportResultDto>;
  /** סגירת האשף. */
  cancel(): Promise<void>;
}

// -------------------------------------------------------------- אזור מסוכן

export interface DeletionScopeDto {
  members: number;
  charges: number;
  payments: number;
  donations: number;
  expenses: number;
  receipts: number;
  synagogueName: string;
}

export interface DangerApi {
  /** F-130 – מה עומד להימחק. מוצג לפני האישור. */
  deletionScope(): Promise<DeletionScopeDto>;
  /**
   * מוחק את בסיס הנתונים. גיבוי נוצר תמיד לפני המחיקה, והנתיב שלו חוזר.
   * `confirmation` חייב להיות שם בית הכנסת.
   */
  deleteDatabase(confirmation: string): Promise<{ backupPath: string }>;
}

// ---------------------------------------------------------------- יומן ביקורת

export interface AuditEntryDto {
  id: number;
  ts: string;
  userId: number | null;
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  beforeJson: string | null;
  afterJson: string | null;
}

export interface AuditFilterDto {
  from?: IsoDate;
  to?: IsoDate;
  userId?: number;
  entity?: string;
  action?: AuditAction;
  search?: string;
  limit?: number;
}

export interface AuditKpisDto {
  count: number;
  byAction: Array<{ action: string; count: number }>;
  users: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface AuditApi {
  /** F-93 – צפייה ביומן. היומן אינו ניתן לעריכה או מחיקה מהממשק. */
  list(filter?: AuditFilterDto): Promise<{
    rows: AuditEntryDto[];
    total: number;
    kpis: AuditKpisDto;
  }>;
  entities(): Promise<string[]>;
  labels(): Promise<{ entities: Record<string, string>; actions: Record<string, string> }>;
  export(filter?: AuditFilterDto): Promise<string | null>;
}

// ---------------------------------------------------------------- וואטסאפ: תבניות

export interface MessageTemplateDto {
  id: number;
  name: string;
  body: string;
  isActive: boolean;
  /** W-81 – האירוע הכספי שהתבנית משמשת לו. `null` = תבנית חופשית. */
  eventKind: NotifyEventKindDto | null;
}

export interface MessageTemplateInputDto {
  id?: number;
  name: string;
  body: string;
  isActive?: boolean;
}

export interface TemplateFieldDto {
  key: string;
  label: string;
  example: string;
}

export interface TemplateValidationDto {
  ok: boolean;
  unknownFields: string[];
  errors: string[];
  warnings: string[];
}

export interface TemplatesApi {
  /**
   * `scope` ברירת מחדל `free` – תבניות אירוע אינן מוצעות באשף הקמפיין,
   * כי `{{amount}}` שלהן ריק בקמפיין רגיל (W-81).
   */
  list(includeInactive?: boolean, scope?: TemplateScopeDto): Promise<MessageTemplateDto[]>;
  save(input: MessageTemplateInputDto): Promise<MessageTemplateDto>;
  remove(id: number): Promise<void>;
  /** W-12 – השדות לצ'יפים בעורך. */
  fields(): Promise<TemplateFieldDto[]>;
  /** W-13 – תצוגה מקדימה על חבר יחיד. */
  render(body: string, memberId: number): Promise<string>;
  validate(body: string): Promise<TemplateValidationDto>;
  /** החבר שמוצע כברירת מחדל לתצוגה המקדימה (הראשון עם חוב). */
  previewMemberId(): Promise<number | null>;
}

// ------------------------------------------------- וואטסאפ: הודעות אירוע

/** W-80 – האירועים הכספיים שמפיקים הודעה. */
export type NotifyEventKindDto = 'vow' | 'credit' | 'payment' | 'donation' | 'receipt';

export type TemplateScopeDto = 'free' | 'event' | 'all';

/**
 * `off` – אין הודעה. `ask` – נפתחת הודעה מוכנה לאישור.
 * `auto` – שליחה ללא אישור; שמור ל-W3 ואינו מוצע עדיין בהגדרות.
 */
export type NotifyModeDto = 'off' | 'ask' | 'auto';

export type NotifySettingsDto = Record<NotifyEventKindDto, NotifyModeDto>;

export interface NotifyEventDefDto {
  kind: NotifyEventKindDto;
  label: string;
}

/**
 * W-86 – הרשומה שנוצרה זה עתה, כדי שהמסך יוכל לבקש עבורה הודעה.
 * מוחזר מדיאלוגי הנדר/התשלום/התרומה אל הדף שמארח אותם.
 */
export interface NotifyRefDto {
  kind: NotifyEventKindDto;
  refId: number;
}

/** W-86 – ההודעה המוכנה שנלווית לאירוע כספי. */
export interface NotificationDraftDto {
  eventKind: NotifyEventKindDto;
  eventLabel: string;
  memberId: number;
  memberName: string;
  mobileE164: string | null;
  templateId: number | null;
  body: string;
  text: string;
  triggerRef: string;
  mode: NotifyModeDto;
}

/** למה לא נבנתה הודעה. `off` ו-`already_sent` הם מצבים תקינים, לא שגיאות. */
export type NotifySkipReasonDto =
  | 'off'
  | 'no_member'
  | 'no_mobile'
  | 'already_sent'
  | 'no_template';

export type NotificationResultDto =
  | { ok: true; draft: NotificationDraftDto }
  | { ok: false; reason: NotifySkipReasonDto; message: string };

export interface NotificationsApi {
  /** מצב השליחה לכל אירוע. */
  settings(): Promise<NotifySettingsDto>;
  setMode(kind: NotifyEventKindDto, mode: NotifyModeDto): Promise<void>;
  /** רשימת האירועים ושמותיהם, למסך ההגדרות. */
  events(): Promise<NotifyEventDefDto[]>;
  /**
   * W-86 – ההודעה לאירוע, או הסיבה שאין הודעה (אירוע כבוי, אין נייד, כבר
   * נשלח). **לעולם אינה זורקת** – כישלון כאן אינו כישלון של הפעולה הכספית
   * שכבר נשמרה.
   *
   * מוחזרת הסיבה ולא `null`, כדי שהמסך יוכל לומר לגבאי *למה* לא נשלחה
   * הודעה. שתיקה מוחלטת הייתה משאירה אותו בלי דרך לדעת.
   *
   * `force` – W-90: הגבאי לחץ "שלח הודעה" על השורה. הכוונה גוברת על
   * ההגדרה ועל "כבר נשלח", אך לא על חוסר נייד.
   */
  draft(
    kind: NotifyEventKindDto,
    refId: number,
    force?: boolean,
  ): Promise<NotificationResultDto>;
  /** W-88 – מזהי החברים בעלי יתרת חוב, לשליחה המונית בלחיצה אחת. */
  debtorIds(minAgorot?: number): Promise<number[]>;
}

// ---------------------------------------------------------------- וואטסאפ: קמפיינים

export type CampaignStatusDto =
  'draft' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export type CampaignItemStatusDto =
  'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown';

export interface PreparedItemDto {
  memberId: number;
  memberNumber: number;
  fullName: string;
  mobile: string | null;
  phoneE164: string | null;
  mobileStatus: 'valid' | 'invalid' | 'missing';
  mobileReason: string | null;
  balanceAgorot: number;
  renderedText: string;
  status: 'pending' | 'skipped';
}

export interface DuplicateWarningDto {
  phoneE164: string;
  members: Array<{ memberId: number; memberNumber: number; fullName: string }>;
}

export interface PreparedCampaignDto {
  name: string;
  body: string;
  templateId: number | null;
  items: PreparedItemDto[];
  sendableCount: number;
  skippedCount: number;
  duplicates: DuplicateWarningDto[];
}

export interface CampaignSummaryDto {
  id: number;
  name: string;
  templateId: number | null;
  templateName: string | null;
  status: CampaignStatusDto;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface CampaignItemDetailDto {
  id: number;
  memberId: number;
  memberNumber: number;
  fullName: string;
  phoneE164: string | null;
  renderedText: string;
  status: CampaignItemStatusDto;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  sentAt: string | null;
  sortOrder: number;
}

export interface CampaignDetailDto extends CampaignSummaryDto {
  body: string;
  items: CampaignItemDetailDto[];
}

export interface SendOneResultDto {
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  /** מזהה הקמפיין שנוצר (קמפיין של פריט אחד). */
  campaignId: number;
}

export interface CampaignProgressDto {
  campaignId: number;
  phase: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  currentItemId: number | null;
  currentName: string | null;
  waitSeconds: number;
  stopReason:
    | 'user_pause'
    | 'user_cancel'
    | 'daily_cap'
    | 'consecutive_failures'
    | 'disconnected'
    | null;
  message: string | null;
}

export interface CampaignsApi {
  /**
   * W-22 – שליחה לחבר יחיד, כקמפיין של פריט אחד.
   * חוסמת עד שהשליחה מסתיימת או נכשלת.
   */
  sendOne(
    memberId: number,
    body: string,
    templateId?: number | null,
    trigger?: { kind: NotifyEventKindDto; ref: string } | null,
  ): Promise<SendOneResultDto>;
  /** W-30 – מרנדר ובודק תקינות, בלי לשמור. */
  prepare(input: {
    memberIds: number[];
    body: string;
    name?: string;
    templateId?: number | null;
  }): Promise<PreparedCampaignDto>;
  /** W-37 – שומר את הקמפיין ואת כל הפריטים בטרנזקציה אחת. */
  create(prepared: PreparedCampaignDto): Promise<number>;
  list(): Promise<CampaignSummaryDto[]>;
  get(id: number): Promise<CampaignDetailDto | null>;
  /** W-47 – קמפיין שנקטע, לבאנר בדשבורד. */
  getUnfinished(): Promise<CampaignSummaryDto | null>;
  /**
   * W3 – מתחיל או ממשיך קמפיין. חוסמת עד שהקמפיין נעצר או מסתיים,
   * ומחזירה את התמונה האחרונה. ההתקדמות בדרך מגיעה דרך `onProgress`.
   */
  start(campaignId: number): Promise<CampaignProgressDto>;
  /** W-43 – עוצר אחרי ההודעה הנוכחית, לא באמצעה. */
  pause(): Promise<void>;
  /** W-43 – מסמן את מה שטרם נשלח כמבוטל. */
  cancel(): Promise<void>;
  /** התמונה האחרונה – למסך שנפתח באמצע קמפיין. */
  progress(): Promise<CampaignProgressDto | null>;
  /** W-44 – אירועי התקדמות חיים. */
  onProgress(callback: (progress: CampaignProgressDto) => void): Unsubscribe;
}

// ---------------------------------------------------------------- וואטסאפ: מודול

export interface WhatsAppModuleStateDto {
  /** ההגדרה `whatsapp_enabled`. */
  enabled: boolean;
  /** מתי אושרה אזהרת השימוש (W-54). ריק = טרם אושרה. */
  consentAcceptedAt: string | null;
  minDelaySec: number;
  maxDelaySec: number;
  dailyCap: number;
  /** כמה נשלחו היום, לאכיפת המכסה. */
  sentToday: number;
}

export interface WhatsAppApi {
  /** מצב המודול וההגדרות שלו. */
  moduleState(): Promise<WhatsAppModuleStateDto>;
  /** W-54 – רישום אישור אזהרת השימוש. מדליק את המודול. */
  acceptConsent(): Promise<WhatsAppModuleStateDto>;

  /** W-51 – מצב החיבור הנוכחי. */
  getStatus(): Promise<WaStatusDto>;
  /** WB-01 – פותח את חלון WhatsApp Web, או מביא אותו לחזית אם כבר פתוח. */
  openWindow(): Promise<WaStatusDto>;
  /** מסתיר את החלון בלי לנתק. */
  hideWindow(): Promise<void>;
  /** WB-05 – ניתוק: מנקה את ה-partition. דורש אישור מהמשתמש לפני הקריאה. */
  logout(): Promise<WaStatusDto>;
  /** W-55 – מנוי לשינויי מצב. מחזיר פונקציית ביטול. */
  onStatus(callback: (status: WaStatusDto) => void): Unsubscribe;
  /** הערכת זמן לקמפיין לפי ההשהיות והמכסה שנותרה (שלב 3 באשף). */
  estimate(recipientCount: number): Promise<CampaignEstimateDto>;
}

export interface CampaignEstimateDto {
  minSeconds: number;
  maxSeconds: number;
  /** כמה עוד אפשר לשלוח היום לפי המכסה. */
  remainingToday: number;
  /** true = הקמפיין ייעצר במכסה ויוכל להמשיך מחר. */
  willExceedCap: boolean;
}

// ---------------------------------------------------------------- אירועי push

/**
 * אירועים שה-main **דוחף** ל-renderer, להבדיל מכל שאר הערוצים שהם בקשה-תשובה.
 *
 * נדרש כי מצב החיבור ל-WhatsApp והתקדמות קמפיין משתנים מעצמם, בלי שהמשתמש
 * ביקש דבר; polling מה-renderer היה מבזבז IPC ומאחר את התגובה.
 *
 * המפה הזו היא החוזה: המפתח הוא שם האירוע, והערך הוא טיפוס ה-payload.
 * `IPC_EVENTS` למטה מבטיח שכל אירוע רשום גם ב-main וגם ב-preload – בדיוק
 * כמו `IPC_CHANNELS`.
 */
export interface IpcEventPayloads {
  'whatsapp:status': WaStatusDto;
  'campaign:progress': CampaignProgressDto;
}

export const IPC_EVENTS = {
  'whatsapp:status': true,
  'campaign:progress': true,
} as const;

export type IpcEvent = keyof typeof IPC_EVENTS;

/** ביטול הרשמה לאירוע. מוחזר מכל `on*` ונקרא ב-cleanup של `useEffect`. */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------- וואטסאפ: חיבור

/**
 * מצב החיבור ל-WhatsApp Web (W-51).
 *
 * - `disconnected` – החלון סגור, או שהדף לא נטען.
 * - `loading` – הדף נטען ועדיין לא ברור אם יש סשן.
 * - `qr` – מוצג קוד QR; צריך לסרוק בטלפון.
 * - `ready` – מחובר, אפשר לשלוח.
 * - `stale` – WhatsApp Web פתוח במקום אחר, או שהדף דורש רענון.
 */
export type WaState = 'disconnected' | 'loading' | 'qr' | 'ready' | 'stale';

export interface WaStatusDto {
  state: WaState;
  /** המספר המחובר, best-effort (W-56). NULL כשלא ניתן לחלץ. */
  phone: string | null;
  /** מתי המצב הנוכחי נקבע. */
  since: string;
  /** האם חלון ה-WhatsApp פתוח כרגע. */
  windowOpen: boolean;
  /** הודעה בעברית להצגה למשתמש כשיש בעיה. */
  message?: string;
}

export interface NedarimApi {
  app: AppApi;
  calendar: CalendarApi;
  lookups: LookupsApi;
  settings: SettingsApi;
  members: MembersApi;
  ledger: LedgerApi;
  vows: VowsApi;
  payments: PaymentsApi;
  receipts: ReceiptsApi;
  donations: DonationsApi;
  expenses: ExpensesApi;
  balance: BalanceApi;
  reports: ReportsApi;
  configuration: ConfigurationApi;
  dashboard: DashboardApi;
  auth: AuthApi;
  backup: BackupApi;
  importer: ImportApi;
  danger: DangerApi;
  audit: AuditApi;
  templates: TemplatesApi;
  notifications: NotificationsApi;
  campaigns: CampaignsApi;
  whatsapp: WhatsAppApi;
}

/**
 * מיפוי שם-ערוץ → קיים. משמש גם ב-preload וגם ב-main, כך שערוץ שנוסף בצד אחד
 * ולא בשני נכשל בקומפילציה.
 */
export const IPC_CHANNELS = {
  'app:info': true,
  'app:currentUser': true,
  'app:legalDoc': true,
  'app:openAppFolder': true,
  'app:checkForUpdate': true,
  'app:openExternal': true,

  'calendar:forDate': true,
  'calendar:defaultOccasionForDate': true,
  'calendar:range': true,
  'calendar:monthRange': true,
  'calendar:exportRange': true,
  'calendar:printRange': true,

  'lookups:occasions': true,
  'lookups:paymentMethods': true,
  'lookups:donationTypes': true,
  'lookups:expenseCategories': true,

  'settings:getAll': true,
  'settings:get': true,
  'settings:set': true,

  'members:list': true,
  'members:get': true,
  'members:create': true,
  'members:update': true,
  'members:setStatus': true,
  'members:merge': true,
  'members:findDuplicates': true,
  'members:topDebtors': true,

  'ledger:get': true,
  'ledger:recentCharges': true,
  'ledger:paymentsWithoutReceipt': true,

  'vows:validate': true,
  'vows:create': true,
  'vows:createBulk': true,
  'vows:createCredit': true,
  'vows:remove': true,
  'vows:creditReasons': true,

  'payments:validate': true,
  'payments:create': true,
  'payments:createBulk': true,
  'payments:remove': true,
  'payments:issueReceipt': true,

  'receipts:list': true,
  'receipts:get': true,
  'receipts:print': true,
  'receipts:previewHtml': true,
  'receipts:openPdf': true,
  'receipts:cancel': true,
  'receipts:continuity': true,
  'receipts:nextNumber': true,

  'donations:list': true,
  'donations:get': true,
  'donations:validate': true,
  'donations:create': true,
  'donations:update': true,
  'donations:remove': true,
  'donations:issueReceipt': true,
  'donations:forMember': true,

  'expenses:list': true,
  'expenses:get': true,
  'expenses:validate': true,
  'expenses:create': true,
  'expenses:update': true,
  'expenses:remove': true,
  'expenses:suppliers': true,
  'expenses:pickAttachment': true,
  'expenses:openAttachment': true,

  'balance:monthly': true,
  'balance:accrual': true,
  'balance:availableYears': true,

  'reports:list': true,
  'reports:run': true,
  'reports:export': true,

  'configuration:get': true,
  'configuration:save': true,
  'configuration:setReceiptStartNumber': true,
  'configuration:listLookup': true,
  'configuration:addLookup': true,
  'configuration:renameLookup': true,
  'configuration:setLookupActive': true,
  'configuration:pickImage': true,
  'configuration:pickFolder': true,
  'configuration:wizardSteps': true,
  'configuration:wizardState': true,
  'configuration:completeSetup': true,
  'configuration:reopenSetup': true,

  'dashboard:summary': true,

  'auth:session': true,
  'auth:login': true,
  'auth:setInitialPassword': true,
  'auth:logout': true,
  'auth:lock': true,
  'auth:changeOwnPassword': true,
  'auth:listUsers': true,
  'auth:createUser': true,
  'auth:updateUser': true,
  'auth:resetPassword': true,

  'backup:create': true,
  'backup:list': true,
  'backup:browse': true,
  'backup:restore': true,
  'backup:reminder': true,
  'backup:exportAll': true,
  'backup:openFolder': true,

  'importer:catalog': true,
  'importer:modes': true,
  'importer:downloadTemplate': true,
  'importer:chooseFile': true,
  'importer:chooseBackup': true,
  'importer:current': true,
  'importer:updateSheet': true,
  'importer:preflight': true,
  'importer:validate': true,
  'importer:run': true,
  'importer:cancel': true,

  'danger:deletionScope': true,
  'danger:deleteDatabase': true,

  'audit:list': true,
  'audit:entities': true,
  'audit:labels': true,
  'audit:export': true,

  'templates:list': true,
  'templates:save': true,
  'templates:remove': true,
  'templates:fields': true,
  'templates:render': true,
  'templates:validate': true,
  'templates:previewMemberId': true,

  'notifications:settings': true,
  'notifications:setMode': true,
  'notifications:events': true,
  'notifications:draft': true,
  'notifications:debtorIds': true,

  'campaigns:prepare': true,
  'campaigns:create': true,
  'campaigns:list': true,
  'campaigns:get': true,
  'campaigns:getUnfinished': true,
  'campaigns:sendOne': true,
  'campaigns:start': true,
  'campaigns:pause': true,
  'campaigns:cancel': true,
  'campaigns:progress': true,

  'whatsapp:moduleState': true,
  'whatsapp:acceptConsent': true,
  'whatsapp:getStatus': true,
  'whatsapp:openWindow': true,
  'whatsapp:hideWindow': true,
  'whatsapp:logout': true,
  'whatsapp:estimate': true,
} as const;

export type IpcChannel = keyof typeof IPC_CHANNELS;

/** טיפוס עזר לחבר (מיוצא כדי שה-renderer לא יצטרך לייבא מ-types ישירות). */
export type { Member, MemberWithBalance };

declare global {
  interface Window {
    api: NedarimApi;
  }
}
