import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  AuditFilterDto,
  MessageTemplateInputDto,
  NotifyEventKindDto,
  NotifyModeDto,
  TemplateScopeDto,
  BalanceRangeDto,
  BulkVowInputDto,
  CreditInputDto,
  DonationFilterDto,
  DonationInputDto,
  ExpenseFilterDto,
  ExpenseInputDto,
  ImportModeDto,
  IpcChannel,
  LedgerFilterDto,
  LookupTableDto,
  MemberFilterDto,
  MemberInputDto,
  PaymentInputDto,
  ReceiptFilterDto,
  ReportIdDto,
  ReportParamsDto,
  VowInputDto,
  VowItemFilterDto,
  VowItemInputDto,
} from '@shared/api';
import { IPC_CHANNELS } from '@shared/api';
import type { IsoDate, MemberStatus, UserRole } from '@shared/types';
import {
  closeDatabase,
  getDb,
  getDbPath,
  getSchemaVersion,
  getUserDataDir,
  initDatabase,
} from '../db';
import { LATEST_SCHEMA_VERSION } from '../db/migrations';
import { IMPORT_ENTITIES, importEntity } from '../import/catalog';
import { IMPORT_MODES, MODE_INFO } from '../import/modes';
import { TEMPLATE_FILE_NAME, writeTemplate } from '../import/template';
import { isBackupFolder } from '../import/detect';
import {
  clearSession,
  currentSession,
  openImportFile,
  preflight,
  runImport,
  updateSheet,
  validateSession,
} from '../import/session';
import { confirmationMatches, deleteDatabase, deletionScope } from '../services/dangerZone';
import { findUninstaller, writeUninstallScript } from '../services/uninstall';
import {
  createVowItem,
  deleteVowItem,
  listVowItems,
  updateVowItem,
  vowItemCategories,
} from '../services/vowItems';
import {
  changeOwnPassword,
  createUser as createUserSvc,
  listUsers as listUsersSvc,
  login as loginSvc,
  setPassword,
  updateUser as updateUserSvc,
} from '../services/auth';
import { ACTION_LABEL, ENTITY_LABEL, auditEntities, listAudit } from '../services/auditLog';
import { writeAudit } from '../services/audit';
import {
  applyRestore,
  createBackup,
  defaultBackupDir,
  findBackups,
  externalBackupReminder,
  listBackups,
  prepareRestore,
  restoreReceiptsTo,
} from '../services/backup';
import { exportEverything } from '../services/fullExport';
import {
  listTemplates,
  previewMemberId,
  removeTemplate,
  renderForMember,
  saveTemplate,
  templateFields,
  validateTemplateBody,
} from '../services/templates';
import {
  buildNotification,
  debtorIds,
  notifySettings,
  setNotifyMode,
} from '../services/notifications';
import { NOTIFY_EVENTS } from '../whatsapp/notifyEvents';
import {
  createCampaign,
  getCampaign,
  getUnfinishedCampaign,
  listCampaigns,
  prepareCampaign,
  type PreparedCampaign,
} from '../services/campaigns';
import { acceptWhatsAppConsent, whatsappModuleState } from '../services/whatsappModule';
import {
  currentStatus,
  hideWhatsAppWindow,
  logoutWhatsApp,
  onStatusChange,
  openWhatsAppWindow,
} from '../whatsapp/WhatsAppWindow';
import { estimateSeconds } from '../whatsapp/sessionState';
import { sendCampaignItem, firstPendingItem } from '../services/sendMessage';
import { sendOne as sendOneMessage } from '../whatsapp/MessageSender';
import {
  cancelCampaign,
  configureRunnerHost,
  latestProgress,
  pauseCampaign,
  startCampaign,
} from '../whatsapp/runnerHost';
import { whatsAppWindow } from '../whatsapp/WhatsAppWindow';
import { errorText } from '../whatsapp/sendOutcome';
import { sendUrl } from '../whatsapp/selectors';
import {
  currentUser,
  lock as lockSession,
  session as readSession,
  setCurrentUser,
} from '../services/session';
import { CREDIT_REASONS } from '../db/seed-data';
import { accrualByMonth, availableYears, monthlyBalance } from '../services/balance';
import {
  addLookupValue,
  getConfiguration,
  listLookup,
  renameLookupValue,
  saveSettings,
  setLookupActive,
  setReceiptStartNumber,
} from '../services/configuration';
import { dashboardSummary } from '../services/dashboard';
import {
  createDonation,
  deleteDonation,
  donationsForMember,
  getDonation,
  issueReceiptForDonation,
  listDonations,
  updateDonation,
  validateDonation,
} from '../services/donations';
import {
  createExpense,
  deleteExpense,
  getExpense,
  knownSuppliers,
  listExpenses,
  updateExpense,
  validateExpense,
} from '../services/expenses';
import { writeCsv, writeFullExport, writeXlsx } from '../services/exporters';
import { calendarRange, monthRange } from '../services/calendarRange';
import {
  calendarFileName,
  calendarTable,
  calendarTitle,
  formatDisplayDate,
  renderCalendarHtml,
} from '../services/calendarPrint';
import { htmlToPdf, printHtml } from '../services/htmlPrint';
import { legalDoc, type LegalDocId } from '../services/legalDocs';
import { checkForUpdate } from '../services/updates';
import {
  WIZARD_STEPS,
  completeSetup,
  reopenSetup,
  wizardState,
} from '../services/setupWizard';
import { hebrewInfo } from '../services/hebrewCalendar';
import { getLedger, paymentsWithoutReceipt, recentCharges } from '../services/ledger';
import {
  listDonationTypes,
  listExpenseCategories,
  listOccasions,
  listPaymentMethods,
} from '../services/lookups';
import {
  createMember,
  findDuplicateNames,
  getMember,
  listMembers,
  mergeMembers,
  setMemberStatus,
  topDebtors,
  updateMember,
} from '../services/members';
import {
  createPayment,
  createPaymentsBulk,
  deletePayment,
  issueReceiptForPayment,
  validatePayment,
} from '../services/payments';
import { printReceipt, receiptsRoot, synagogueDetails } from '../services/receiptPdf';
import { renderReceiptHtml } from '../services/receiptTemplate';
import {
  cancelReceipt,
  getReceipt,
  listReceipts,
  peekNextReceiptNumber,
  receiptContinuity,
} from '../services/receipts';
import { REPORTS, runReport } from '../services/reports';
import { getAllSettings, getSetting, setSetting } from '../services/settings';
import { nowIso, todayIso } from '@shared/datetime';
import {
  createCredit,
  createVow,
  createVowsBulk,
  defaultOccasionFor,
  deleteVowCharge,
  validateVow,
} from '../services/vows';

type Handler = (...args: never[]) => unknown;

/** המשתמש הפעיל, מ-`services/session`. עוטף כדי לא להעביר `getDb()` בכל קריאה. */
const actor = (): { id: number; displayName: string; role: UserRole } => currentUser(getDb());

/**
 * טבלת ה-handlers. הטיפוס `Record<IpcChannel, Handler>` מבטיח שכל ערוץ שהוגדר
 * ב-`src/shared/api.ts` אכן ממומש כאן – ערוץ חסר נכשל בקומפילציה.
 */
const handlers: Record<IpcChannel, Handler> = {
  // ---------------------------------------------------------- תשתית
  'app:info': () => ({
    version: app.getVersion(),
    dbPath: getDbPath(),
    schemaVersion: getSchemaVersion(),
  }),
  'app:currentUser': () => actor(),
  'app:legalDoc': ((id: LegalDocId) => legalDoc(id)) as Handler,
  'app:openAppFolder': (async () => {
    await shell.openPath(app.getAppPath());
  }) as Handler,
  'app:checkForUpdate': (async () => {
    const result = await checkForUpdate();
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    const release = 'release' in result.decision ? result.decision.release : undefined;
    return {
      ok: true,
      kind: result.decision.kind,
      currentVersion: result.currentVersion,
      repo: result.repo,
      release,
    };
  }) as Handler,
  'app:openExternal': (async (url: string) => {
    // רק https, ורק כשהמשתמש לחץ. כתובת שמגיעה מ-GitHub אינה אמורה
    // להיות מסוגלת לפתוח קובץ מקומי.
    if (/^https:\/\//i.test(url)) await shell.openExternal(url);
  }) as Handler,

  'calendar:forDate': ((date: IsoDate) => hebrewInfo(date)) as Handler,
  'calendar:defaultOccasionForDate': ((date: IsoDate) => {
    const found = defaultOccasionFor(getDb(), date);
    return found
      ? { occasionId: found.occasionId, name: found.name }
      : { occasionId: null, name: null };
  }) as Handler,

  // F-90 – לוח שנה
  'calendar:range': ((from: IsoDate, to: IsoDate) =>
    calendarRange(getDb(), { from, to })) as Handler,
  'calendar:monthRange': ((date: IsoDate) => monthRange(date)) as Handler,
  'calendar:exportRange': (async (from: IsoDate, to: IsoDate, format: 'csv' | 'xlsx') => {
    const db = getDb();
    const rows = calendarRange(db, { from, to });
    const table = calendarTable(rows, calendarTitle(from, to));
    const res = await dialog.showSaveDialog({
      title: 'ייצוא לוח שנה',
      defaultPath: join(app.getPath('documents'), `${calendarFileName(from, to)}.${format}`),
      filters:
        format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return format === 'csv' ? writeCsv(table, res.filePath) : writeXlsx(table, res.filePath);
  }) as Handler,
  'calendar:printRange': (async (from: IsoDate, to: IsoDate, toPrinter: boolean) => {
    const db = getDb();
    const rows = calendarRange(db, { from, to });
    const title = calendarTitle(from, to);
    const html = renderCalendarHtml({
      rows,
      title,
      subtitle: `${rows.length} ימים · הופק ${formatDisplayDate(todayIso())}`,
      synagogueName: synagogueDetails(db).name,
    });

    if (toPrinter) {
      await printHtml(html);
      return null;
    }

    const res = await dialog.showSaveDialog({
      title: 'שמירת לוח שנה כ-PDF',
      defaultPath: join(app.getPath('documents'), `${calendarFileName(from, to)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return htmlToPdf(html, res.filePath);
  }) as Handler,

  'lookups:occasions': ((includeInactive?: boolean) =>
    listOccasions(getDb(), includeInactive)) as Handler,
  'lookups:paymentMethods': ((includeInactive?: boolean) =>
    listPaymentMethods(getDb(), includeInactive)) as Handler,
  'lookups:donationTypes': ((includeInactive?: boolean) =>
    listDonationTypes(getDb(), includeInactive)) as Handler,
  'lookups:expenseCategories': ((includeInactive?: boolean) =>
    listExpenseCategories(getDb(), includeInactive)) as Handler,

  'settings:getAll': () => getAllSettings(getDb()),
  'settings:get': ((key: string) => getSetting(getDb(), key)) as Handler,
  'settings:set': ((key: string, value: string | null) => {
    setSetting(getDb(), key, value);
  }) as Handler,

  // ---------------------------------------------------------- חברים
  'members:list': ((filter?: MemberFilterDto) => listMembers(getDb(), filter ?? {})) as Handler,
  'members:get': ((id: number) => getMember(getDb(), id)) as Handler,
  'members:create': ((input: MemberInputDto) =>
    createMember(getDb(), input, actor().id)) as Handler,
  'members:update': ((id: number, input: MemberInputDto) =>
    updateMember(getDb(), id, input, actor().id)) as Handler,
  'members:setStatus': ((
    id: number,
    status: MemberStatus,
    options?: { confirmedWithBalance?: boolean },
  ) => setMemberStatus(getDb(), id, status, actor().id, options ?? {})) as Handler,
  'members:merge': ((fromId: number, toId: number) =>
    mergeMembers(getDb(), fromId, toId, actor().id)) as Handler,
  'members:findDuplicates': ((firstName: string, lastName: string, excludeId?: number) =>
    findDuplicateNames(getDb(), firstName, lastName, excludeId)) as Handler,
  'members:topDebtors': ((limit?: number) => topDebtors(getDb(), limit ?? 10)) as Handler,

  // ---------------------------------------------------------- כרטיסייה
  'ledger:get': ((memberId: number, filter?: LedgerFilterDto) =>
    getLedger(getDb(), memberId, filter ?? {})) as Handler,
  'ledger:recentCharges': ((memberId: number, limit?: number) =>
    recentCharges(getDb(), memberId, limit ?? 5)) as Handler,
  'ledger:paymentsWithoutReceipt': ((limit?: number) =>
    paymentsWithoutReceipt(getDb(), limit ?? 50)) as Handler,

  // ---------------------------------------------------------- נדרים
  'vows:validate': ((input: VowInputDto) => validateVow(getDb(), input)) as Handler,
  'vows:create': ((input: VowInputDto) => createVow(getDb(), input, actor().id)) as Handler,
  'vows:createBulk': ((input: BulkVowInputDto) =>
    createVowsBulk(getDb(), input, actor().id)) as Handler,
  'vows:createCredit': ((input: CreditInputDto) => {
    const user = actor();
    return createCredit(getDb(), input, user.id, user.role);
  }) as Handler,
  'vows:remove': ((id: number) => {
    const user = actor();
    deleteVowCharge(getDb(), id, user.id, user.role);
  }) as Handler,
  'vows:creditReasons': () => [...CREDIT_REASONS],

  // ---------------------------------------------------------- תשלומים
  'payments:validate': ((input: PaymentInputDto) => validatePayment(getDb(), input)) as Handler,
  'payments:create': ((input: PaymentInputDto, issue: boolean) =>
    createPayment(getDb(), input, actor().id, { issueReceipt: issue })) as Handler,
  'payments:createBulk': ((
    input: Parameters<typeof createPaymentsBulk>[1],
    issueReceipts: boolean,
  ) => createPaymentsBulk(getDb(), input, actor().id, { issueReceipts })) as Handler,
  'payments:remove': ((id: number) => {
    const user = actor();
    deletePayment(getDb(), id, user.id, user.role);
  }) as Handler,
  'payments:issueReceipt': ((paymentId: number) =>
    issueReceiptForPayment(getDb(), paymentId, actor().id)) as Handler,

  // ---------------------------------------------------------- קבלות
  'receipts:list': ((filter?: ReceiptFilterDto) => listReceipts(getDb(), filter ?? {})) as Handler,
  'receipts:get': ((id: number) => getReceipt(getDb(), id)) as Handler,
  'receipts:print': (async (id: number, toPrinter: boolean) => {
    const db = getDb();
    const receipt = getReceipt(db, id);
    if (!receipt) throw new Error('קבלה לא נמצאה');
    const printerName = getSetting(db, 'default_printer') ?? undefined;
    return printReceipt(db, receipt, actor().id, {
      userDataDir: getUserDataDir(),
      toPrinter,
      ...(printerName ? { printerName } : {}),
    });
  }) as Handler,
  'receipts:previewHtml': ((id: number) => {
    const db = getDb();
    const receipt = getReceipt(db, id);
    if (!receipt) throw new Error('קבלה לא נמצאה');
    const paper = (getSetting(db, 'receipt_paper_size') ?? 'A5') === 'A4' ? 'A4' : 'A5';
    return renderReceiptHtml({
      receipt,
      synagogue: synagogueDetails(db),
      isCopy: receipt.printCount > 0,
      paperSize: paper,
    });
  }) as Handler,
  'receipts:openPdf': (async (id: number) => {
    const receipt = getReceipt(getDb(), id);
    if (!receipt?.pdfPath) throw new Error('לקבלה עדיין אין קובץ PDF – יש להפיק אותה תחילה');
    const error = await shell.openPath(receipt.pdfPath);
    if (error) throw new Error(error);
  }) as Handler,
  'receipts:cancel': ((id: number, reason: string, sourceAction: 'keep' | 'delete') => {
    const user = actor();
    return cancelReceipt(getDb(), id, reason, user.id, user.role, sourceAction);
  }) as Handler,
  'receipts:continuity': () => receiptContinuity(getDb()),
  'receipts:nextNumber': () => peekNextReceiptNumber(getDb()),

  // ---------------------------------------------------------- תרומות
  'donations:list': ((filter?: DonationFilterDto) =>
    listDonations(getDb(), filter ?? {})) as Handler,
  'donations:get': ((id: number) => getDonation(getDb(), id)) as Handler,
  'donations:validate': ((input: DonationInputDto) => validateDonation(getDb(), input)) as Handler,
  'donations:create': ((input: DonationInputDto, issue: boolean) =>
    createDonation(getDb(), input, actor().id, { issueReceipt: issue })) as Handler,
  'donations:update': ((id: number, input: DonationInputDto) =>
    updateDonation(getDb(), id, input, actor().id)) as Handler,
  'donations:remove': ((id: number) => {
    const user = actor();
    deleteDonation(getDb(), id, user.id, user.role);
  }) as Handler,
  'donations:issueReceipt': ((id: number) =>
    issueReceiptForDonation(getDb(), id, actor().id)) as Handler,
  'donations:forMember': ((memberId: number) => donationsForMember(getDb(), memberId)) as Handler,

  // ---------------------------------------------------------- הוצאות
  'expenses:list': ((filter?: ExpenseFilterDto) => listExpenses(getDb(), filter ?? {})) as Handler,
  'expenses:get': ((id: number) => getExpense(getDb(), id)) as Handler,
  'expenses:validate': ((input: ExpenseInputDto) => validateExpense(getDb(), input)) as Handler,
  'expenses:create': ((input: ExpenseInputDto) =>
    createExpense(getDb(), input, actor().id, { userDataDir: getUserDataDir() })) as Handler,
  'expenses:update': ((id: number, input: ExpenseInputDto) =>
    updateExpense(getDb(), id, input, actor().id, {
      userDataDir: getUserDataDir(),
    })) as Handler,
  'expenses:remove': ((id: number) => {
    const user = actor();
    deleteExpense(getDb(), id, user.id, user.role);
  }) as Handler,
  'expenses:suppliers': () => knownSuppliers(getDb()),
  'expenses:pickAttachment': (async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחירת קובץ לצירוף',
      properties: ['openFile'],
      filters: [
        { name: 'מסמכים ותמונות', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'כל הקבצים', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }) as Handler,
  'expenses:openAttachment': (async (id: number) => {
    const expense = getExpense(getDb(), id);
    if (!expense?.attachmentPath) throw new Error('לא צורף קובץ להוצאה זו');
    const error = await shell.openPath(expense.attachmentPath);
    if (error) throw new Error(error);
  }) as Handler,

  // ---------------------------------------------------------- מאזן
  'balance:monthly': ((range?: BalanceRangeDto) =>
    monthlyBalance(getDb(), range ?? { kind: 'all' })) as Handler,
  'balance:accrual': ((range?: BalanceRangeDto) =>
    accrualByMonth(getDb(), range ?? { kind: 'all' })) as Handler,
  'balance:availableYears': () => availableYears(getDb()),

  // ---------------------------------------------------------- דוחות
  'reports:list': () => REPORTS.map((r) => ({ ...r })),
  'reports:run': ((id: ReportIdDto, params?: ReportParamsDto) =>
    runReport(getDb(), id, params ?? {})) as Handler,
  'reports:export': (async (id: ReportIdDto, params: ReportParamsDto, format: 'csv' | 'xlsx') => {
    const report = runReport(getDb(), id, params ?? {});
    const suggested = `${report.title.replace(/[\\/:*?"<>|]/g, ' ').trim()}.${format}`;
    const res = await dialog.showSaveDialog({
      title: 'ייצוא דוח',
      defaultPath: join(app.getPath('documents'), suggested),
      filters:
        format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return format === 'csv' ? writeCsv(report, res.filePath) : writeXlsx(report, res.filePath);
  }) as Handler,

  // ---------------------------------------------------------- הגדרות
  'configuration:get': () => getConfiguration(getDb()),
  'configuration:save': ((patch: Record<string, string>) => {
    const user = actor();
    return saveSettings(getDb(), patch, user.id, user.role);
  }) as Handler,
  'configuration:setReceiptStartNumber': ((next: number) => {
    const user = actor();
    return setReceiptStartNumber(getDb(), next, user.id, user.role);
  }) as Handler,
  'configuration:listLookup': ((table: LookupTableDto) => listLookup(getDb(), table)) as Handler,
  'configuration:addLookup': ((
    table: LookupTableDto,
    name: string,
    options?: { type?: string; requiresReference?: boolean },
  ) => addLookupValue(getDb(), table, name, actor().id, options ?? {})) as Handler,
  'configuration:renameLookup': ((table: LookupTableDto, id: number, name: string) =>
    renameLookupValue(getDb(), table, id, name, actor().id)) as Handler,
  'configuration:setLookupActive': ((table: LookupTableDto, id: number, isActive: boolean) =>
    setLookupActive(getDb(), table, id, isActive, actor().id)) as Handler,
  'configuration:pickImage': (async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחירת תמונה',
      properties: ['openFile'],
      filters: [{ name: 'תמונות', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }) as Handler,
  'configuration:wizardSteps': () => WIZARD_STEPS.map((s) => ({ ...s, keys: [...s.keys] })),
  'configuration:wizardState': () => wizardState(getDb()),
  'configuration:completeSetup': () => completeSetup(getDb()),
  'configuration:reopenSetup': () => reopenSetup(getDb()),
  'configuration:pickFolder': (async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחירת תיקייה',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }) as Handler,

  // ---------------------------------------------------------- מסך ראשי
  'dashboard:summary': () => dashboardSummary(getDb()),

  // ---------------------------------------------------------- אבטחה
  'auth:session': () => readSession(getDb()),
  'auth:login': ((username: string, password: string) => {
    const res = loginSvc(getDb(), username, password);
    if (res.ok && !res.needsPassword && res.user) setCurrentUser(res.user.id);
    const out = {
      ok: res.ok,
      needsPassword: res.needsPassword,
      session: readSession(getDb()),
    } as Record<string, unknown>;
    if (res.message !== undefined) out['message'] = res.message;
    return out;
  }) as Handler,
  'auth:setInitialPassword': ((username: string, password: string) => {
    const db = getDb();
    const res = loginSvc(db, username, '');
    if (!res.ok || !res.user || !res.needsPassword) {
      throw new Error('למשתמש הזה כבר קיימת סיסמה');
    }
    setPassword(db, res.user.id, password, res.user.id);
    setCurrentUser(res.user.id);
    return { ok: true, needsPassword: false, session: readSession(db) };
  }) as Handler,
  'auth:logout': (() => {
    setCurrentUser(null);
    return readSession(getDb());
  }) as Handler,
  'auth:lock': (() => {
    lockSession();
    return readSession(getDb());
  }) as Handler,
  'auth:changeOwnPassword': ((currentPassword: string, newPassword: string) => {
    changeOwnPassword(getDb(), actor().id, currentPassword, newPassword);
  }) as Handler,
  'auth:listUsers': () => listUsersSvc(getDb()),
  'auth:createUser': ((input: {
    username: string;
    displayName: string;
    role: UserRole;
    password: string;
  }) => {
    const user = actor();
    createUserSvc(getDb(), input, user.id, user.role);
    return listUsersSvc(getDb());
  }) as Handler,
  'auth:updateUser': ((
    id: number,
    patch: { displayName?: string; role?: UserRole; isActive?: boolean },
  ) => {
    const user = actor();
    return updateUserSvc(getDb(), id, patch, user.id, user.role);
  }) as Handler,
  'auth:resetPassword': ((id: number, password: string) => {
    const user = actor();
    if (user.role !== 'admin') throw new Error('איפוס סיסמה מותר למנהל בלבד');
    setPassword(getDb(), id, password, user.id);
    return listUsersSvc(getDb());
  }) as Handler,

  // ---------------------------------------------------------- גיבוי ושחזור
  'backup:create': (async (external: boolean) => {
    let targetDir = defaultBackupDir(getUserDataDir());
    if (external) {
      const configured = getSetting(getDb(), 'backup_dir');
      if (configured && configured.trim() !== '') {
        targetDir = configured;
      } else {
        const res = await dialog.showOpenDialog({
          title: 'בחירת תיקיית גיבוי חיצונית',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (res.canceled || !res.filePaths[0]) return null;
        targetDir = res.filePaths[0];
      }
    }
    return createBackup(getDb(), {
      userDataDir: getUserDataDir(),
      targetDir,
      appVersion: app.getVersion(),
      schemaVersion: getSchemaVersion(),
      external,
      receiptsDir: receiptsRoot(getDb(), getUserDataDir()),
      userId: actor().id,
    });
  }) as Handler,
  'backup:list': ((dir?: string) => {
    const target = dir && dir.trim() !== '' ? dir : defaultBackupDir(getUserDataDir());
    return { dir: target, backups: listBackups(target) };
  }) as Handler,
  'backup:browse': (async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחירת תיקיית גיבויים',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { dir: res.filePaths[0], backups: listBackups(res.filePaths[0]) };
  }) as Handler,
  'backup:restore': (async (backupPath: string) => {
    // F-101. הסדר קריטי: אימות + גיבוי בטיחות → סגירת ה-DB → החלפת קבצים →
    // פתיחה מחדש. אסור להחליף קובץ DB פתוח.
    //
    // **בלי `app.relaunch()`.** הפעלה מחדש של התהליך השאירה את החלון לבן
    // לדקות ארוכות (במיוחד בפיתוח, שבו electron-vite מנהל את התהליך), ולא
    // נתנה שום דבר בתמורה: פתיחת ה-DB המשוחזר באותו תהליך היא מיידית,
    // ורענון ה-renderer מספיק כדי שכל המסכים יטענו את הנתונים החדשים.
    const userDataDir = getUserDataDir();
    const plan = await prepareRestore(getDb(), {
      backupPath,
      userDataDir,
      appVersion: app.getVersion(),
      schemaVersion: LATEST_SCHEMA_VERSION,
      userId: actor().id,
    });
    closeDatabase();
    applyRestore(backupPath, userDataDir);
    try {
      initDatabase(userDataDir);
      // ההגדרה `receipts_dir` יושבת בתוך ה-DB ששוחזר, ולכן רק עכשיו אפשר
      // לדעת לאן ארכיון הקבלות שייך.
      const target = receiptsRoot(getDb(), userDataDir);
      if (target !== join(userDataDir, 'receipts')) restoreReceiptsTo(backupPath, target);
    } catch (e) {
      // הקובץ ששוחזר לא נפתח (פגום, או סכימה שלא ניתן לשדרג). מחזירים את
      // המצב הקודם מגיבוי הבטיחות, כדי שההתקנה לא תישאר בלי בסיס נתונים.
      applyRestore(plan.safetyBackupPath, userDataDir);
      initDatabase(userDataDir);
      throw new Error(
        `השחזור נכשל והמצב הקודם הוחזר: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }) as Handler,
  'backup:reminder': () => externalBackupReminder(getDb()),
  'backup:exportAll': (async () => {
    const stamp = todayIso();
    const res = await dialog.showSaveDialog({
      title: 'ייצוא כל הנתונים',
      defaultPath: join(app.getPath('documents'), `נדרים-ייצוא-מלא-${stamp}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return exportEverything(getDb(), res.filePath, actor().id);
  }) as Handler,
  'backup:openFolder': ((path: string) => {
    shell.showItemInFolder(path);
  }) as Handler,

  // ------------------------------------------------------- רשימת נדרים
  'vowItems:list': ((filter?: VowItemFilterDto) =>
    listVowItems(getDb(), filter ?? {})) as Handler,
  'vowItems:categories': () => vowItemCategories(getDb()),
  'vowItems:create': ((input: VowItemInputDto) =>
    createVowItem(getDb(), input, actor().id)) as Handler,
  'vowItems:update': ((id: number, input: VowItemInputDto) =>
    updateVowItem(getDb(), id, input, actor().id)) as Handler,
  'vowItems:remove': ((id: number) => deleteVowItem(getDb(), id, actor().id)) as Handler,

  // -------------------------------------------------------------- ייבוא
  'importer:catalog': () =>
    IMPORT_ENTITIES.map((entity) => ({
      id: entity.id,
      label: entity.label,
      sheet: entity.sheet,
      intro: entity.intro,
      dependsOn: [...entity.dependsOn],
      fields: entity.fields.map((field) => ({
        label: field.label,
        type: field.type,
        required: field.required,
        help: field.help ?? '',
        example: field.example ?? '',
        choices: field.choices === undefined ? [] : [...field.choices],
        refLabel: field.ref === undefined ? null : importEntity(field.ref.entity).label,
      })),
    })),
  'importer:modes': () => IMPORT_MODES.map((id) => MODE_INFO[id]),
  'importer:downloadTemplate': (async () => {
    const res = await dialog.showSaveDialog({
      title: 'שמירת תבנית הייבוא',
      defaultPath: join(app.getPath('documents'), TEMPLATE_FILE_NAME),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return writeTemplate(res.filePath);
  }) as Handler,
  'importer:chooseFile': (async () => {
    // עזר בדיקות: NEDARIM_IMPORT_FILE=<נתיב> מדלג על הדיאלוג הנייטיב, שאי
    // אפשר להפעיל אותו מתוך תסריט. מאפשר אימות ויזואלי של כל שלבי האשף
    // (CLAUDE.md כלל-על 17). אותו דפוס כמו NEDARIM_SCREENSHOT.
    const forced = process.env['NEDARIM_IMPORT_FILE'];
    if (forced !== undefined && forced !== '') {
      // אותה הבחנה בדיוק כמו במסלול האמיתי: תיקייה שיש בה גיבויים מוחזרת
      // כגיבויים, וכל השאר כקובץ נתונים.
      const found = findBackups(forced);
      if (found.length > 0) return { kind: 'backup', dir: forced, backups: found };
      return { kind: 'file', file: await openImportFile(forced) };
    }

    const res = await dialog.showOpenDialog({
      title: 'בחירת קובץ לייבוא',
      properties: ['openFile'],
      filters: [
        { name: 'קובץ נתונים', extensions: ['xlsx', 'xlsm', 'csv'] },
        { name: 'Excel', extensions: ['xlsx', 'xlsm'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
    });
    const path = res.canceled ? undefined : res.filePaths[0];
    if (path === undefined) return { kind: 'cancelled' };
    // גיבוי מוחזר כגיבוי ולא כקובץ: שחזור מחזיר גם את הקבלות והקבצים
    // המצורפים, וייבוא לא.
    if (isBackupFolder(path)) {
      return { kind: 'backup', dir: path, backups: findBackups(path) };
    }
    return { kind: 'file', file: await openImportFile(path) };
  }) as Handler,
  'importer:chooseBackup': (async () => {
    const res = await dialog.showOpenDialog({
      title: 'בחירת תיקיית גיבוי',
      properties: ['openDirectory'],
    });
    const path = res.canceled ? undefined : res.filePaths[0];
    if (path === undefined) return { kind: 'cancelled' };

    // מתקבלת גם תיקיית הגיבוי עצמה וגם תיקייה שמכילה גיבויים: הגבאי רואה
    // `backups/auto/nedarim-backup-…` ובוחר את מה שנראה לו נכון.
    const backups = findBackups(path);
    if (backups.length === 0) {
      return {
        kind: 'invalid',
        message:
          'לא נמצא גיבוי בתיקייה שנבחרה. תיקיית גיבוי מכילה את הקבצים nedarim.db ו-manifest.json, או תיקיות בשם "nedarim-backup-…".',
      };
    }
    return { kind: 'backup', dir: path, backups };
  }) as Handler,
  'importer:current': () => currentSession(),
  'importer:updateSheet': ((index: number, patch: Parameters<typeof updateSheet>[1]) =>
    updateSheet(index, patch)) as Handler,
  'importer:preflight': () => {
    const session = currentSession();
    if (session === null) throw new Error('לא נפתח קובץ ייבוא');
    return preflight(getDb(), session.sheets);
  },
  'importer:validate': ((mode: ImportModeDto) =>
    validateSession(getDb(), mode, actor().id)) as Handler,
  'importer:run': ((mode: ImportModeDto) => {
    const result = runImport(getDb(), mode, actor().id);
    return {
      totals: result.totals,
      sheets: result.sheets.map((sheet) => ({
        entityLabel: sheet.label,
        ...sheet.counts,
        skipped: sheet.skipped,
      })),
    };
  }) as Handler,
  'importer:cancel': () => {
    clearSession();
  },

  // -------------------------------------------------------- אזור מסוכן
  'danger:deletionScope': () => deletionScope(getDb()),
  'danger:deleteDatabase': (async (confirmation: string) => {
    // הבדיקה נעשית גם כאן וגם בשירות. שכפול מכוון: ה-IPC הוא הגבול, ושירות
    // שסומך על כך שהקורא בדק הוא שירות שאפשר לקרוא לו בטעות בלי לבדוק.
    if (!confirmationMatches(getDb(), confirmation)) {
      throw new Error('שם בית הכנסת שהוקלד אינו תואם. המחיקה בוטלה.');
    }
    const userDataDir = getUserDataDir();
    const result = await deleteDatabase(getDb(), {
      userDataDir,
      backupDir: defaultBackupDir(userDataDir),
      confirmation,
      userId: actor().id,
      appVersion: app.getVersion(),
      schemaVersion: getSchemaVersion(),
    });
    // `deleteDatabase` סוגר את החיבור. פתיחה מחדש יוצרת בסיס נתונים ריק
    // עם הסכימה והזרעים – המצב שאשף הייבוא מצפה לו.
    closeDatabase();
    initDatabase(userDataDir);
    return { backupPath: result.backup.path };
  }) as Handler,

  'danger:uninstallInfo': () => {
    const installDir = dirname(app.getPath('exe'));
    const uninstaller = app.isPackaged ? findUninstaller(installDir) : null;
    // עזר בדיקות: מאפשר לפתוח את מסך ההסרה בפיתוח כדי לראות אותו. ההסרה
    // עצמה עדיין מסורבת כשהיישום אינו ארוז – אין כאן דרך להסיר בטעות.
    const preview = !app.isPackaged && process.env['NEDARIM_UNINSTALL_PREVIEW'] === '1';
    return {
      available: uninstaller !== null || preview,
      reason: app.isPackaged
        ? uninstaller === null
          ? 'לא נמצא קובץ ההסרה בתיקיית ההתקנה. אפשר להסיר דרך הגדרות Windows ← אפליקציות.'
          : null
        : preview
          ? null
          : 'הרצת פיתוח – אין מה להסיר.',
      userDataDir: getUserDataDir(),
    };
  },
  'danger:uninstall': ((deleteData: boolean, confirmation: string) => {
    const installDir = dirname(app.getPath('exe'));
    const uninstaller = app.isPackaged ? findUninstaller(installDir) : null;
    if (uninstaller === null) {
      throw new Error(
        app.isPackaged
          ? 'לא נמצא קובץ ההסרה. אפשר להסיר דרך הגדרות Windows ← אפליקציות.'
          : 'הרצת פיתוח – אין מה להסיר. המסך מוצג לצורכי בדיקה בלבד.',
      );
    }
    // מחיקת נתונים דורשת את אותו אישור כמו מחיקת בסיס הנתונים. הסרה בלי
    // מחיקה היא הפיכה – הנתונים נשארים והתקנה חוזרת מוצאת אותם.
    if (deleteData && !confirmationMatches(getDb(), confirmation)) {
      throw new Error('שם בית הכנסת שהוקלד אינו תואם. ההסרה בוטלה.');
    }

    const userDataDir = getUserDataDir();
    const { scriptPath } = writeUninstallScript(app.getPath('temp'), {
      uninstaller,
      userDataDir,
      deleteData,
    });

    writeAudit(getDb(), {
      userId: actor().id,
      entity: 'app',
      entityId: 0,
      action: 'delete',
      before: { event: 'uninstall', deleteData, at: nowIso() },
    });

    // סוגרים את ה-DB לפני היציאה, אחרת קובץ ה-WAL נשאר נעול והמחיקה
    // בתסריט תיכשל בשקט.
    closeDatabase();
    spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }) as Handler,

  // ---------------------------------------------------------- יומן ביקורת
  'audit:list': ((filter?: AuditFilterDto) => listAudit(getDb(), filter ?? {})) as Handler,
  'audit:entities': () => auditEntities(getDb()),
  'audit:labels': () => ({ entities: ENTITY_LABEL, actions: ACTION_LABEL }),
  // ---------------------------------------------------------- וואטסאפ: תבניות
  'templates:list': ((includeInactive?: boolean, scope?: TemplateScopeDto) =>
    listTemplates(getDb(), includeInactive ?? true, scope ?? 'free')) as Handler,
  'templates:save': ((input: MessageTemplateInputDto) => {
    const user = actor();
    return saveTemplate(getDb(), input, user.id, user.role);
  }) as Handler,
  'templates:remove': ((id: number) => {
    const user = actor();
    removeTemplate(getDb(), id, user.id, user.role);
  }) as Handler,
  'templates:fields': () => templateFields(),
  'templates:render': ((body: string, memberId: number) =>
    renderForMember(getDb(), body, memberId)) as Handler,
  'templates:validate': ((body: string) => validateTemplateBody(body)) as Handler,
  'templates:previewMemberId': () => previewMemberId(getDb()),

  // ----------------------------------------------------- וואטסאפ: הודעות אירוע
  'notifications:settings': () => notifySettings(getDb()),
  'notifications:setMode': ((kind: NotifyEventKindDto, mode: NotifyModeDto) => {
    setNotifyMode(getDb(), kind, mode, actor().id);
  }) as Handler,
  'notifications:events': () => NOTIFY_EVENTS.map((e) => ({ kind: e.kind, label: e.label })),
  'notifications:draft': ((kind: NotifyEventKindDto, refId: number, force?: boolean) => {
    // W-86 – **לעולם לא זורק**: הרשומה הכספית כבר נשמרה, ותקלה בבניית
    // ההודעה אינה אמורה להציג למשתמש שגיאה על פעולה שהצליחה.
    try {
      return buildNotification(getDb(), kind, refId, { force: force === true });
    } catch (e) {
      return {
        ok: false,
        reason: 'no_template',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }) as Handler,
  'notifications:debtorIds': ((minAgorot?: number) =>
    debtorIds(getDb(), minAgorot ?? 1)) as Handler,

  // ---------------------------------------------------------- וואטסאפ: קמפיינים
  'campaigns:prepare': ((input: {
    memberIds: number[];
    body: string;
    name?: string;
    templateId?: number | null;
  }) => prepareCampaign(getDb(), input)) as Handler,
  'campaigns:create': ((prepared: PreparedCampaign) =>
    createCampaign(getDb(), prepared, actor().id)) as Handler,
  'campaigns:list': () => listCampaigns(getDb()),
  'campaigns:get': ((id: number) => getCampaign(getDb(), id)) as Handler,
  'campaigns:getUnfinished': () => getUnfinishedCampaign(getDb()),
  'campaigns:start': (async (campaignId: number) =>
    startCampaign(getDb(), campaignId, actor().id)) as Handler,
  'campaigns:pause': () => {
    pauseCampaign();
  },
  'campaigns:cancel': () => {
    cancelCampaign();
  },
  'campaigns:progress': () => latestProgress(),
  'campaigns:sendOne': (async (
    memberId: number,
    body: string,
    templateId?: number | null,
    // W-86 – מקור האירוע, כשהשליחה נובעת מנדר/תשלום/קבלה. נשמר על הקמפיין
    // וזה מה שמונע הודעה שנייה על אותה רשומה.
    trigger?: { kind: NotifyEventKindDto; ref: string } | null,
  ) => {
    const db = getDb();
    const user = actor();

    // W-22 – קמפיין של פריט אחד. אותו מסלול בדיוק כמו קמפיין גדול, ולכן
    // ההיסטוריה, המכסה והיומן מתנהגים זהה.
    const prepared = prepareCampaign(db, {
      memberIds: [memberId],
      body,
      templateId: templateId ?? null,
    });
    const campaignId = createCampaign(db, prepared, user.id, trigger ?? null);
    const itemId = firstPendingItem(db, campaignId);

    if (itemId === null) {
      return {
        ok: false,
        errorCode: 'invalid_number',
        errorMessage: errorText('invalid_number'),
        campaignId,
      };
    }

    // הגבאי לחץ "שלח" – הכוונה ברורה. אם החלון סגור פותחים אותו במקום
    // להחזיר שגיאה ולדרוש ממנו ללחוץ פעם נוספת. הסשן שרד, ולכן זו טעינה
    // ולא התחברות מחדש.
    const item = db
      .prepare('SELECT phone_e164, rendered_text FROM message_campaign_item WHERE id = ?')
      .get(itemId) as { phone_e164: string; rendered_text: string };

    let win = whatsAppWindow();
    if (win === null) {
      // פותחים ישר על כתובת השליחה, ולא על דף הבית: אחרת WhatsApp Web
      // נטען פעמיים והמתנה של 15 שניות הופכת ל-30.
      openWhatsAppWindow(sendUrl(item.phone_e164, item.rendered_text));
      win = whatsAppWindow();
    }

    // המתנה קצרה עד שהחיבור מוכן. בלעדיה שליחה מיד אחרי פתיחת החלון
    // הייתה נכשלת תמיד.
    const readyDeadline = Date.now() + 45_000;
    while (Date.now() < readyDeadline && currentStatus().state !== 'ready') {
      if (currentStatus().state === 'qr') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const status = currentStatus();
    if (win === null || status.state !== 'ready') {
      const message =
        status.state === 'qr'
          ? 'יש לסרוק את קוד ה-QR בחלון שנפתח'
          : (status.message ?? errorText('not_connected'));
      db.prepare("UPDATE message_campaign SET status = 'failed', finished_at = ? WHERE id = ?").run(
        nowIso(),
        campaignId,
      );
      return { ok: false, errorCode: 'not_connected', errorMessage: message, campaignId };
    }

    const { outcome } = await sendCampaignItem(
      db,
      itemId,
      {
        send: (request) => sendOneMessage(request, { window: win, userDataDir: getUserDataDir() }),
      },
      user.id,
    );

    db.prepare('UPDATE message_campaign SET status = ?, finished_at = ? WHERE id = ?').run(
      outcome.ok ? 'completed' : 'failed',
      nowIso(),
      campaignId,
    );

    return {
      ok: outcome.ok,
      errorCode: outcome.ok ? null : outcome.errorCode,
      errorMessage: outcome.ok ? null : outcome.errorMessage,
      campaignId,
    };
  }) as Handler,

  // ---------------------------------------------------------- וואטסאפ: מודול
  'whatsapp:moduleState': () => whatsappModuleState(getDb()),
  'whatsapp:acceptConsent': () => {
    const user = actor();
    return acceptWhatsAppConsent(getDb(), user.id, user.role);
  },
  'whatsapp:getStatus': () => currentStatus(),
  'whatsapp:openWindow': () => openWhatsAppWindow(),
  'whatsapp:hideWindow': () => {
    hideWhatsAppWindow();
  },
  'whatsapp:logout': (async () => {
    const user = actor();
    const status = await logoutWhatsApp();
    writeAudit(getDb(), {
      userId: user.id,
      entity: 'setting',
      entityId: null,
      action: 'update',
      after: { whatsapp: 'logout' },
    });
    return status;
  }) as Handler,
  'whatsapp:estimate': ((recipientCount: number) => {
    const state = whatsappModuleState(getDb());
    const { minSeconds, maxSeconds } = estimateSeconds(
      recipientCount,
      state.minDelaySec,
      state.maxDelaySec,
    );
    const remainingToday = Math.max(0, state.dailyCap - state.sentToday);
    return {
      minSeconds,
      maxSeconds,
      remainingToday,
      willExceedCap: recipientCount > remainingToday,
    };
  }) as Handler,

  'audit:export': (async (filter?: AuditFilterDto) => {
    const { rows } = listAudit(getDb(), { ...(filter ?? {}), limit: 100_000 });
    const res = await dialog.showSaveDialog({
      title: 'ייצוא יומן ביקורת',
      defaultPath: join(app.getPath('documents'), 'יומן-ביקורת.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const header = ['מועד', 'משתמש', 'ישות', 'מזהה', 'פעולה', 'לפני', 'אחרי'];
    const matrix: Array<Array<string | number | null>> = [header];
    for (const r of rows) {
      matrix.push([
        r.ts.replace('T', ' '),
        r.userName,
        ENTITY_LABEL[r.entity] ?? r.entity,
        r.entityId,
        ACTION_LABEL[r.action] ?? r.action,
        r.beforeJson,
        r.afterJson,
      ]);
    }
    await writeFullExport([{ name: 'יומן ביקורת', matrix }], res.filePath);
    return res.filePath;
  }) as Handler,
};

/**
 * דוחף אירועי `whatsapp:status` לכל החלונות הפתוחים.
 *
 * נרשם פעם אחת בהפעלה. `webContents.send` לכל חלון ולא לחלון ספציפי, כי
 * ה-main אינו אמור לדעת מי מאזין.
 */
function registerPushEvents(): void {
  onStatusChange((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('whatsapp:status', status);
    }
  });
}

export function registerIpcHandlers(): void {
  registerPushEvents();
  // `MessageSender` צריך את תיקיית הנתונים; המודול עצמו אינו מכיר את `app`.
  configureRunnerHost(getUserDataDir());
  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    const handler = handlers[channel];
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await (handler as (...a: unknown[]) => unknown)(...args);
      } catch (error) {
        // שגיאות עסקיות מגיעות ל-renderer כהודעה בעברית, בלי stack trace.
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    });
  }
}
