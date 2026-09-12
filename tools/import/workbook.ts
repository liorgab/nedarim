import { readFileSync } from 'node:fs';
import { read as readXlsx, utils, type WorkSheet } from 'xlsx';
import type { RawCell } from './dates';

/**
 * קריאת חוברת ה-Excel הישנה למבנה גולמי, לפי `docs/legacy/WORKBOOK-STRUCTURE.md`.
 * שכבה זו לא מפרשת ולא מנקה – רק מוציאה תאים. כל הפירוש נעשה ב-importer.
 *
 * `cellDates: false` בכוונה: המרה אוטומטית ל-Date מזיזה תאריכים ביום בגלל אזור זמן.
 * הסריאלים מומרים ב-`dates.ts` ב-UTC.
 */

export const SHEETS = {
  members: 'חברי בית הכנסת',
  ledgers: 'כרטיסיות',
  summary: 'סיכום נדרים',
  donations: 'תרומות',
  receiptTemplate: 'קבלות',
  receiptCounter: 'מספר קבלה',
  expenses: 'הוצאות',
  balance: 'מאזן שנתי',
} as const;

/** מבנה בלוק הכרטיסייה: 10 עמודות לחבר, `base = (n-1)*10` (1-based). */
export const LEDGER = {
  blockWidth: 10,
  firstDataRow: 6,
  lastDataRow: 201,
  totalsRow: 202,
  /** היסטים יחסיים ל-base (1-based) */
  chargeDate: 2,
  chargeOccasion: 3,
  chargeAmount: 4,
  paymentDate: 5,
  paymentAmount: 6,
  paymentStatus: 7,
  paymentMethod: 8,
  receiptNumber: 9,
  receiptIssueDate: 10,
} as const;

export interface RawMember {
  memberNumber: number;
  firstName: string;
  lastName: string;
  mobile: string | null;
  notes: string | null;
  sourceRef: string;
}

export interface RawCharge {
  memberNumber: number;
  row: number;
  date: RawCell | null;
  occasion: string;
  amount: number;
  sourceRef: string;
}

export interface RawPayment {
  memberNumber: number;
  row: number;
  date: RawCell | null;
  amount: number;
  status: string;
  method: unknown;
  receiptNumber: number | null;
  receiptIssueDate: RawCell | null;
  sourceRef: string;
}

export interface RawDonation {
  donationNumber: number;
  row: number;
  date: RawCell | null;
  donorText: string;
  type: unknown;
  method: unknown;
  amount: number;
  notes: string | null;
  receiptNumber: number | null;
  receiptIssueDate: RawCell | null;
  sourceRef: string;
}

export interface RawExpense {
  expenseNumber: number;
  row: number;
  date: RawCell | null;
  amount: number;
  description: string;
  notes: string | null;
  sourceRef: string;
}

export interface LegacyWorkbook {
  members: RawMember[];
  charges: RawCharge[];
  payments: RawPayment[];
  donations: RawDonation[];
  expenses: RawExpense[];
  /** מספרי הקבלות שבגיליון המונה. */
  receiptCounter: number[];
  /** שורות המאזן הישן: 37 חודשים החל מ-09/2023. */
  legacyBalance: Array<{ ym: string; donations: number; vowPayments: number; expenses: number }>;
  /** סכומי D202/F202 לכל חבר – היעד של בדיקת ההתאמה מול E3. */
  ledgerTotals: Map<number, { charges: number; payments: number }>;
  /** פרטי בית הכנסת מתבנית הקבלה. */
  settings: { synagogueName: string; synagogueCity: string; receiptFooter: string };
}

function cellOf(ws: WorkSheet, row: number, col: number): RawCell | null {
  const c = ws[utils.encode_cell({ r: row - 1, c: col - 1 })] as RawCell | undefined;
  return c ?? null;
}

function str(cell: RawCell | null): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
}

function num(cell: RawCell | null): number | null {
  if (!cell || cell.t !== 'n' || typeof cell.v !== 'number') return null;
  return cell.v;
}

function colLetter(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function readLegacyWorkbook(path: string): LegacyWorkbook {
  // קוראים את הקובץ בעצמנו: ה-build של xlsx ב-ESM אינו ניגש ל-fs בלי set_fs.
  const wb = readXlsx(readFileSync(path), {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
    cellFormula: false,
  });

  for (const name of Object.values(SHEETS)) {
    if (!wb.Sheets[name]) throw new Error(`גיליון חסר בקובץ: "${name}"`);
  }

  // ---------- חברים ----------
  const wsMembers = wb.Sheets[SHEETS.members]!;
  const members: RawMember[] = [];
  for (let row = 2; row <= 10_000; row++) {
    const numberCell = num(cellOf(wsMembers, row, 1));
    if (numberCell === null) break;
    members.push({
      memberNumber: numberCell,
      firstName: str(cellOf(wsMembers, row, 2)),
      lastName: str(cellOf(wsMembers, row, 3)),
      mobile: str(cellOf(wsMembers, row, 4)) || null,
      notes: str(cellOf(wsMembers, row, 5)) || null,
      sourceRef: `${SHEETS.members}!A${row}`,
    });
  }

  // ---------- כרטיסיות ----------
  const wsLedger = wb.Sheets[SHEETS.ledgers]!;
  const charges: RawCharge[] = [];
  const payments: RawPayment[] = [];
  const ledgerTotals = new Map<number, { charges: number; payments: number }>();

  for (const m of members) {
    const base = (m.memberNumber - 1) * LEDGER.blockWidth;
    // חשוב: סורקים את כל 196 השורות ולא עוצרים בשורה ריקה –
    // בקובץ נמצאו שתי שורות חיוב אחרי רווח ריק (חבר 3 שורה 10, חבר 25 שורה 16).
    for (let row = LEDGER.firstDataRow; row <= LEDGER.lastDataRow; row++) {
      const chargeAmount = num(cellOf(wsLedger, row, base + LEDGER.chargeAmount));
      if (chargeAmount !== null) {
        charges.push({
          memberNumber: m.memberNumber,
          row,
          date: cellOf(wsLedger, row, base + LEDGER.chargeDate),
          occasion: str(cellOf(wsLedger, row, base + LEDGER.chargeOccasion)),
          amount: chargeAmount,
          sourceRef: `${SHEETS.ledgers}!${colLetter(base + LEDGER.chargeAmount)}${row}`,
        });
      }
      const paymentAmount = num(cellOf(wsLedger, row, base + LEDGER.paymentAmount));
      if (paymentAmount !== null) {
        const receiptCell = num(cellOf(wsLedger, row, base + LEDGER.receiptNumber));
        payments.push({
          memberNumber: m.memberNumber,
          row,
          date: cellOf(wsLedger, row, base + LEDGER.paymentDate),
          amount: paymentAmount,
          status: str(cellOf(wsLedger, row, base + LEDGER.paymentStatus)),
          method: cellOf(wsLedger, row, base + LEDGER.paymentMethod)?.v ?? null,
          receiptNumber: receiptCell,
          receiptIssueDate: cellOf(wsLedger, row, base + LEDGER.receiptIssueDate),
          sourceRef: `${SHEETS.ledgers}!${colLetter(base + LEDGER.paymentAmount)}${row}`,
        });
      }
    }
    ledgerTotals.set(m.memberNumber, {
      charges: num(cellOf(wsLedger, LEDGER.totalsRow, base + LEDGER.chargeAmount)) ?? 0,
      payments: num(cellOf(wsLedger, LEDGER.totalsRow, base + LEDGER.paymentAmount)) ?? 0,
    });
  }

  // ---------- תרומות ----------
  const wsDon = wb.Sheets[SHEETS.donations]!;
  const donations: RawDonation[] = [];
  for (let row = 2; row <= 10_000; row++) {
    const n = num(cellOf(wsDon, row, 1));
    if (n === null) break;
    donations.push({
      donationNumber: n,
      row,
      date: cellOf(wsDon, row, 2),
      donorText: str(cellOf(wsDon, row, 3)),
      type: cellOf(wsDon, row, 4)?.v ?? null,
      method: cellOf(wsDon, row, 5)?.v ?? null,
      amount: num(cellOf(wsDon, row, 6)) ?? 0,
      notes: str(cellOf(wsDon, row, 7)) || null,
      receiptNumber: num(cellOf(wsDon, row, 8)),
      receiptIssueDate: cellOf(wsDon, row, 9),
      sourceRef: `${SHEETS.donations}!A${row}`,
    });
  }

  // ---------- הוצאות ----------
  // השורה האחרונה בגיליון היא שורת סיכום ללא מס"ד – מדולגת (WORKBOOK-STRUCTURE).
  const wsExp = wb.Sheets[SHEETS.expenses]!;
  const expenses: RawExpense[] = [];
  const expRange = utils.decode_range(wsExp['!ref'] ?? 'A1:E1');
  for (let row = 2; row <= expRange.e.r + 1; row++) {
    const n = num(cellOf(wsExp, row, 1));
    if (n === null) continue; // שורת הסיכום
    expenses.push({
      expenseNumber: n,
      row,
      date: cellOf(wsExp, row, 2),
      amount: num(cellOf(wsExp, row, 3)) ?? 0,
      description: str(cellOf(wsExp, row, 4)),
      notes: str(cellOf(wsExp, row, 5)) || null,
      sourceRef: `${SHEETS.expenses}!A${row}`,
    });
  }

  // ---------- מונה הקבלות ----------
  const wsCounter = wb.Sheets[SHEETS.receiptCounter]!;
  const counterRange = utils.decode_range(wsCounter['!ref'] ?? 'A1:A1');
  const receiptCounter: number[] = [];
  for (let row = 1; row <= counterRange.e.r + 1; row++) {
    const n = num(cellOf(wsCounter, row, 1));
    if (n !== null) receiptCounter.push(n);
  }

  // ---------- מאזן שנתי (לבדיקת התאמה) ----------
  // שורות 3–39, החל מ-09/2023. עמודות: B תרומות, C נדרים (=תשלומים), E הוצאות.
  const wsBal = wb.Sheets[SHEETS.balance]!;
  const legacyBalance: LegacyWorkbook['legacyBalance'] = [];
  let year = 2023;
  let month = 9;
  for (let i = 0; i < 37; i++) {
    const row = 3 + i;
    legacyBalance.push({
      ym: `${year}-${String(month).padStart(2, '0')}`,
      donations: num(cellOf(wsBal, row, 2)) ?? 0,
      vowPayments: num(cellOf(wsBal, row, 3)) ?? 0,
      expenses: num(cellOf(wsBal, row, 5)) ?? 0,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  // ---------- הגדרות מתבנית הקבלה ----------
  const wsTpl = wb.Sheets[SHEETS.receiptTemplate]!;
  const settings = {
    synagogueName: str(cellOf(wsTpl, 2, 2)),
    synagogueCity: str(cellOf(wsTpl, 3, 2)),
    receiptFooter: str(cellOf(wsTpl, 13, 2)),
  };

  return {
    members,
    charges,
    payments,
    donations,
    expenses,
    receiptCounter,
    legacyBalance,
    ledgerTotals,
    settings,
  };
}
