import { contextBridge, ipcRenderer } from 'electron';
import type { IpcEvent, IpcEventPayloads, NedarimApi, Unsubscribe } from '@shared/api';

/**
 * הגשר היחיד בין ה-renderer ל-main (CLAUDE.md כלל 7).
 * ה-renderer לא מקבל גישה ל-Node, ל-fs או ל-DB – רק לפונקציות שמופיעות כאן.
 */
const invoke = ipcRenderer.invoke.bind(ipcRenderer);

/**
 * מנוי לאירוע push מה-main. עוטף את `ipcRenderer.on` כדי שה-renderer יקבל
 * רק את ה-payload – בלי אובייקט האירוע של Electron, שאסור שיזלוג אליו.
 */
function subscribe<K extends IpcEvent>(
  event: K,
  callback: (payload: IpcEventPayloads[K]) => void,
): Unsubscribe {
  const handler = (_e: unknown, payload: IpcEventPayloads[K]) => callback(payload);
  ipcRenderer.on(event, handler);
  return () => {
    ipcRenderer.off(event, handler);
  };
}

const api: NedarimApi = {
  app: {
    info: () => invoke('app:info'),
    currentUser: () => invoke('app:currentUser'),
    legalDoc: (id) => invoke('app:legalDoc', id),
    openAppFolder: () => invoke('app:openAppFolder'),
    checkForUpdate: () => invoke('app:checkForUpdate'),
    openExternal: (url) => invoke('app:openExternal', url),
  },
  calendar: {
    forDate: (date) => invoke('calendar:forDate', date),
    defaultOccasionForDate: (date) => invoke('calendar:defaultOccasionForDate', date),
    range: (from, to) => invoke('calendar:range', from, to),
    monthRange: (date) => invoke('calendar:monthRange', date),
    exportRange: (from, to, format) => invoke('calendar:exportRange', from, to, format),
    printRange: (from, to, toPrinter) => invoke('calendar:printRange', from, to, toPrinter),
  },
  lookups: {
    occasions: (includeInactive) => invoke('lookups:occasions', includeInactive),
    paymentMethods: (includeInactive) => invoke('lookups:paymentMethods', includeInactive),
    donationTypes: (includeInactive) => invoke('lookups:donationTypes', includeInactive),
    expenseCategories: (includeInactive) => invoke('lookups:expenseCategories', includeInactive),
  },
  settings: {
    getAll: () => invoke('settings:getAll'),
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value),
  },
  members: {
    list: (filter) => invoke('members:list', filter),
    get: (id) => invoke('members:get', id),
    create: (input) => invoke('members:create', input),
    update: (id, input) => invoke('members:update', id, input),
    setStatus: (id, status, options) => invoke('members:setStatus', id, status, options),
    merge: (fromId, toId) => invoke('members:merge', fromId, toId),
    findDuplicates: (firstName, lastName, excludeId) =>
      invoke('members:findDuplicates', firstName, lastName, excludeId),
    topDebtors: (limit) => invoke('members:topDebtors', limit),
  },
  ledger: {
    get: (memberId, filter) => invoke('ledger:get', memberId, filter),
    recentCharges: (memberId, limit) => invoke('ledger:recentCharges', memberId, limit),
    paymentsWithoutReceipt: (limit) => invoke('ledger:paymentsWithoutReceipt', limit),
  },
  vows: {
    validate: (input) => invoke('vows:validate', input),
    create: (input) => invoke('vows:create', input),
    createBulk: (input) => invoke('vows:createBulk', input),
    createCredit: (input) => invoke('vows:createCredit', input),
    remove: (id) => invoke('vows:remove', id),
    creditReasons: () => invoke('vows:creditReasons'),
  },
  payments: {
    validate: (input) => invoke('payments:validate', input),
    create: (input, issueReceipt) => invoke('payments:create', input, issueReceipt),
    createBulk: (input, issueReceipts) => invoke('payments:createBulk', input, issueReceipts),
    remove: (id) => invoke('payments:remove', id),
    issueReceipt: (paymentId) => invoke('payments:issueReceipt', paymentId),
  },
  receipts: {
    list: (filter) => invoke('receipts:list', filter),
    get: (id) => invoke('receipts:get', id),
    print: (id, toPrinter) => invoke('receipts:print', id, toPrinter),
    previewHtml: (id) => invoke('receipts:previewHtml', id),
    openPdf: (id) => invoke('receipts:openPdf', id),
    cancel: (id, reason, sourceAction) => invoke('receipts:cancel', id, reason, sourceAction),
    continuity: () => invoke('receipts:continuity'),
    nextNumber: () => invoke('receipts:nextNumber'),
  },
  donations: {
    list: (filter) => invoke('donations:list', filter),
    get: (id) => invoke('donations:get', id),
    validate: (input) => invoke('donations:validate', input),
    create: (input, issueReceipt) => invoke('donations:create', input, issueReceipt),
    update: (id, input) => invoke('donations:update', id, input),
    remove: (id) => invoke('donations:remove', id),
    issueReceipt: (id) => invoke('donations:issueReceipt', id),
    forMember: (memberId) => invoke('donations:forMember', memberId),
  },
  expenses: {
    list: (filter) => invoke('expenses:list', filter),
    get: (id) => invoke('expenses:get', id),
    validate: (input) => invoke('expenses:validate', input),
    create: (input) => invoke('expenses:create', input),
    update: (id, input) => invoke('expenses:update', id, input),
    remove: (id) => invoke('expenses:remove', id),
    suppliers: () => invoke('expenses:suppliers'),
    pickAttachment: () => invoke('expenses:pickAttachment'),
    openAttachment: (id) => invoke('expenses:openAttachment', id),
  },
  balance: {
    monthly: (range) => invoke('balance:monthly', range),
    accrual: (range) => invoke('balance:accrual', range),
    availableYears: () => invoke('balance:availableYears'),
  },
  reports: {
    list: () => invoke('reports:list'),
    run: (id, params) => invoke('reports:run', id, params),
    export: (id, params, format) => invoke('reports:export', id, params, format),
  },
  configuration: {
    get: () => invoke('configuration:get'),
    save: (patch) => invoke('configuration:save', patch),
    setReceiptStartNumber: (next) => invoke('configuration:setReceiptStartNumber', next),
    listLookup: (table) => invoke('configuration:listLookup', table),
    addLookup: (table, name, options) => invoke('configuration:addLookup', table, name, options),
    renameLookup: (table, id, name) => invoke('configuration:renameLookup', table, id, name),
    setLookupActive: (table, id, isActive) =>
      invoke('configuration:setLookupActive', table, id, isActive),
    pickImage: () => invoke('configuration:pickImage'),
    pickFolder: () => invoke('configuration:pickFolder'),
    wizardSteps: () => invoke('configuration:wizardSteps'),
    wizardState: () => invoke('configuration:wizardState'),
    completeSetup: () => invoke('configuration:completeSetup'),
    reopenSetup: () => invoke('configuration:reopenSetup'),
  },
  dashboard: {
    summary: () => invoke('dashboard:summary'),
  },
  auth: {
    session: () => invoke('auth:session'),
    login: (username, password) => invoke('auth:login', username, password),
    setInitialPassword: (username, password) =>
      invoke('auth:setInitialPassword', username, password),
    logout: () => invoke('auth:logout'),
    lock: () => invoke('auth:lock'),
    changeOwnPassword: (currentPassword, newPassword) =>
      invoke('auth:changeOwnPassword', currentPassword, newPassword),
    listUsers: () => invoke('auth:listUsers'),
    createUser: (input) => invoke('auth:createUser', input),
    updateUser: (id, patch) => invoke('auth:updateUser', id, patch),
    resetPassword: (id, password) => invoke('auth:resetPassword', id, password),
  },
  backup: {
    create: (external) => invoke('backup:create', external),
    list: (dir) => invoke('backup:list', dir),
    browse: () => invoke('backup:browse'),
    restore: (backupPath) => invoke('backup:restore', backupPath),
    reminder: () => invoke('backup:reminder'),
    exportAll: () => invoke('backup:exportAll'),
    openFolder: (path) => invoke('backup:openFolder', path),
  },
  audit: {
    list: (filter) => invoke('audit:list', filter),
    entities: () => invoke('audit:entities'),
    labels: () => invoke('audit:labels'),
    export: (filter) => invoke('audit:export', filter),
  },
  templates: {
    list: (includeInactive, scope) => invoke('templates:list', includeInactive, scope),
    save: (input) => invoke('templates:save', input),
    remove: (id) => invoke('templates:remove', id),
    fields: () => invoke('templates:fields'),
    render: (body, memberId) => invoke('templates:render', body, memberId),
    validate: (body) => invoke('templates:validate', body),
    previewMemberId: () => invoke('templates:previewMemberId'),
  },
  notifications: {
    settings: () => invoke('notifications:settings'),
    setMode: (kind, mode) => invoke('notifications:setMode', kind, mode),
    events: () => invoke('notifications:events'),
    draft: (kind, refId, force) => invoke('notifications:draft', kind, refId, force),
    debtorIds: (minAgorot) => invoke('notifications:debtorIds', minAgorot),
  },
  campaigns: {
    prepare: (input) => invoke('campaigns:prepare', input),
    create: (prepared) => invoke('campaigns:create', prepared),
    list: () => invoke('campaigns:list'),
    get: (id) => invoke('campaigns:get', id),
    getUnfinished: () => invoke('campaigns:getUnfinished'),
    sendOne: (memberId, body, templateId, trigger) =>
      invoke('campaigns:sendOne', memberId, body, templateId, trigger),
  },
  whatsapp: {
    moduleState: () => invoke('whatsapp:moduleState'),
    acceptConsent: () => invoke('whatsapp:acceptConsent'),
    getStatus: () => invoke('whatsapp:getStatus'),
    openWindow: () => invoke('whatsapp:openWindow'),
    hideWindow: () => invoke('whatsapp:hideWindow'),
    logout: () => invoke('whatsapp:logout'),
    estimate: (recipientCount) => invoke('whatsapp:estimate', recipientCount),
    onStatus: (callback) => subscribe('whatsapp:status', callback),
  },
};

contextBridge.exposeInMainWorld('api', api);
