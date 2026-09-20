import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { DataTable, type Column } from '../components/DataTable';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatDate } from '../lib/format';
import { he } from '../i18n/he';
import { SendOneDialog } from '../components/whatsapp/SendOneDialog';
import { useEventNotification } from '../hooks/useEventNotification';


interface PendingRow {
  id: number;
  memberId: number;
  memberName: string;
  memberNumber: number;
  date: string;
  amountAgorot: number;
  paymentMethod: string;
  receiptName: string | null;
}

export interface PendingReceiptsPageProps {
  onOpenReceipt: (receiptId: number) => void;
  onOpenMember: (memberId: number) => void;
  onNotify: (message: string) => void;
}

/** F-03 – תשלומים שנרשמו ללא קבלה, עם הפקה בלחיצה אחת. */
export function PendingReceiptsPage({
  onOpenReceipt,
  onOpenMember,
  onNotify,
}: PendingReceiptsPageProps) {
  const [error, setError] = useState<string | null>(null);
  // W-86 – הודעת הקבלה שממתינה לאישור.
  const notify = useEventNotification();
  const query = useAsync<PendingRow[]>(() => window.api.ledger.paymentsWithoutReceipt(200), []);
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const kpis: readonly Kpi[] = useMemo(
    () => [
      { key: 'count', label: 'תשלומים ממתינים', value: String(rows.length) },
      {
        key: 'sum',
        label: 'סה״כ סכום',
        value: formatAgorot(rows.reduce((s, r) => s + r.amountAgorot, 0)),
      },
      {
        key: 'oldest',
        label: 'הוותיק ביותר',
        value: rows.length === 0 ? '—' : formatDate(rows[rows.length - 1]!.date),
      },
    ],
    [rows],
  );

  /** W-86 – מציע הודעת וואטסאפ על הקבלה שהופקה. */
  async function offerNotification(receiptId: number): Promise<void> {
    const message = await notify.offer('receipt', receiptId);
    if (message !== null) onNotify(message);
  }

  /**
   * F-76 – הפקה מאוחרת עם אפשרות לשם אחר.
   *
   * זה המסלול הנפוץ: הגבאי רשם תשלום במהירות ב"שמור בלי
   * קבלה", ורק אחר כך התברר שהקבלה צריכה לצאת על שם חברה. בלי
   * השאלה כאן הוא היה צריך למחוק את התשלום ולהזין אותו מחדש.
   */
  const [issuing, setIssuing] = useState<PendingRow | null>(null);
  const [otherName, setOtherName] = useState(false);
  const [receiptName, setReceiptName] = useState('');

  async function issue(row: PendingRow, name: string): Promise<void> {
    setError(null);
    try {
      const receipt = await window.api.payments.issueReceipt(row.id, name);
      setIssuing(null);
      query.reload();
      onNotify(he.payment.savedWithReceipt(receipt.receiptNumber));
      onOpenReceipt(receipt.id);
      await offerNotification(receipt.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const columns: ReadonlyArray<Column<PendingRow>> = useMemo(
    () => [
      {
        id: 'date',
        label: he.card.date,
        width: 120,
        sortValue: (r) => r.date,
        render: (r) => formatDate(r.date),
      },
      {
        id: 'memberNumber',
        label: he.members.number,
        width: 90,
        sortValue: (r) => r.memberNumber,
        render: (r) => r.memberNumber,
      },
      {
        id: 'memberName',
        label: he.vow.member,
        sortValue: (r) => r.memberName,
        render: (r) => (
          <Button size="small" onClick={() => onOpenMember(r.memberId)}>
            {r.memberName}
          </Button>
        ),
      },
      {
        id: 'amount',
        label: he.payment.amount,
        width: 130,
        align: 'end',
        sortValue: (r) => r.amountAgorot,
        render: (r) => formatAgorot(r.amountAgorot),
      },
      {
        id: 'method',
        label: he.payment.method,
        width: 130,
        sortValue: (r) => r.paymentMethod,
        render: (r) => r.paymentMethod,
      },
      {
        id: 'actions',
        label: he.app.actions,
        width: 150,
        notSortable: true,
        render: (r) => (
          <Button
            size="small"
            variant="contained"
            startIcon={<ReceiptLongIcon />}
            onClick={() => {
              setIssuing(r);
              // שם שכבר נשמר על התשלום מוצג מסומן, כדי שההפקה לא תבטל אותו בשתיקה.
              setOtherName(r.receiptName !== null);
              setReceiptName(r.receiptName ?? '');
            }}
          >
            {he.pending.issue}
          </Button>
        ),
      },
    ],
    [onOpenMember],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2, flex: 'none' }}>
        <Typography variant="h2">{he.pending.title}</Typography>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="pending"
        totalBeforeFilter={rows.length}
        emptyMessage={he.pending.empty}
        initialSort={{ columnId: 'date', direction: 'desc' }}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="pending" />}
      />

      <SendOneDialog
        open={notify.draft !== null}
        draft={notify.draft}
        member={notify.member}
        onClose={notify.close}
        onSent={onNotify}
      />
      {/* F-76 – שם אחר על הקבלה, ברגע ההפקה. */}
      <Dialog open={issuing !== null} onClose={() => setIssuing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{he.receiptName.issueTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography variant="body2">
              {he.receiptName.defaultName(issuing?.memberName ?? '')}
            </Typography>
            <FormControlLabel
              control={
                <Checkbox checked={otherName} onChange={(e) => setOtherName(e.target.checked)} />
              }
              label={he.receiptName.toggle}
            />
            {otherName ? (
              <TextField
                label={he.receiptName.label}
                helperText={he.receiptName.help}
                value={receiptName}
                onChange={(e) => setReceiptName(e.target.value)}
                autoFocus
                fullWidth
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssuing(null)}>{he.app.cancel}</Button>
          <Button
            variant="contained"
            startIcon={<ReceiptLongIcon />}
            onClick={() => {
              if (issuing === null) return;
              // מחרוזת ריקה ולא undefined: אי-סימון התיבה הוא בקשה
              // מפורשת לקבלה על שם החבר, גם אם נשמר קודם שם אחר.
              void issue(issuing, otherName ? receiptName.trim() : '');
            }}
          >
            {he.receiptName.issue}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
