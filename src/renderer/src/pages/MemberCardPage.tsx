import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PostAddIcon from '@mui/icons-material/PostAdd';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PaymentsIcon from '@mui/icons-material/Payments';
import UndoIcon from '@mui/icons-material/Undo';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { LedgerRow, MemberWithBalance } from '@shared/types';
import type { NotifyEventKindDto, NotifyRefDto } from '@shared/api';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { VowDialog } from '../components/dialogs/VowDialog';
import { PaymentDialog } from '../components/dialogs/PaymentDialog';
import { CreditDialog } from '../components/dialogs/CreditDialog';
import { useAsync } from '../hooks/useAsync';
import { SendOneDialog } from '../components/whatsapp/SendOneDialog';
import { useEventNotification } from '../hooks/useEventNotification';
import {
  balanceColor,
  fiscalYearStart,
  formatAgorot,
  formatDate,
  memberFullName,
} from '../lib/format';
import { he } from '../i18n/he';

export interface MemberCardPageProps {
  memberId: number;
  onBack: () => void;
  onOpenReceipt: (receiptId: number) => void;
  onNotify: (message: string) => void;
}

type Period = 'all' | 'fiscal' | 'custom';

const STATUS_LABEL: Record<string, string> = {
  vow: he.card.kinds.vow,
  credit: he.card.kinds.credit,
  opening: he.card.kinds.opening,
  recorded: he.card.kinds.recorded,
  receipted: he.card.kinds.receipted,
  cancelled: he.card.kinds.cancelled,
};

/** F-20..F-25 – כרטיסיית החבר. המסך המרכזי של המערכת. */
export function MemberCardPage({ memberId, onBack, onOpenReceipt, onNotify }: MemberCardPageProps) {
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [rowType, setRowType] = useState<'all' | 'charge' | 'payment'>('all');
  const [error, setError] = useState<string | null>(null);
  // W-86 – הודעת האירוע נפתחת **אחרי** שדיאלוג הנדר/התשלום כבר נסגר.
  const notify = useEventNotification();
  const [dialog, setDialog] = useState<'vow' | 'bulk' | 'payment' | 'credit' | 'whatsapp' | null>(
    null,
  );
  const waModule = useAsync(() => window.api.whatsapp.moduleState(), []);
  const waEnabled = waModule.data?.enabled === true;

  const settings = useAsync(() => window.api.settings.getAll(), []);
  const fiscalMonth = Number(settings.data?.['fiscal_year_start_month'] ?? '9');

  const range = useMemo(() => {
    if (period === 'fiscal') return { from: fiscalYearStart(fiscalMonth), to: undefined };
    if (period === 'custom') return { from: from || undefined, to: to || undefined };
    return { from: undefined, to: undefined };
  }, [period, from, to, fiscalMonth]);

  const member = useAsync(() => window.api.members.get(memberId), [memberId]);
  const ledger = useAsync(
    () =>
      window.api.ledger.get(memberId, {
        ...range,
        ...(rowType === 'all' ? {} : { rowType }),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    [memberId, range.from, range.to, rowType, search],
  );

  const reloadAll = () => {
    member.reload();
    ledger.reload();
  };

  /** W-86 – מציע הודעת וואטסאפ על הפעולה שנשמרה. הכלל ב-`useEventNotification`. */
  const offerNotification = async (
    ref: NotifyRefDto | null,
    options: { force?: boolean } = {},
  ): Promise<void> => {
    if (ref === null) return;
    const message = await notify.offer(ref.kind, ref.refId, options);
    if (message !== null) onNotify(message);
  };

  const m = member.data;
  const k = ledger.data?.kpis;

  const kpis: readonly Kpi[] = useMemo(
    () =>
      k
        ? [
            {
              key: 'opening',
              label: he.card.kpis.opening,
              value: formatAgorot(k.openingBalanceAgorot),
            },
            { key: 'debit', label: he.card.kpis.debit, value: formatAgorot(k.debitAgorot) },
            { key: 'credit', label: he.card.kpis.credit, value: formatAgorot(k.creditAgorot) },
            {
              key: 'closing',
              label: he.card.kpis.closing,
              value: formatAgorot(k.closingBalanceAgorot),
              tone:
                k.closingBalanceAgorot > 0
                  ? 'negative'
                  : k.closingBalanceAgorot < 0
                    ? 'positive'
                    : 'default',
            },
            {
              key: 'rows',
              label: he.card.kpis.rows,
              value: String(k.rowCount),
              hint: `${k.chargeCount} חיובים · ${k.paymentCount} תשלומים`,
            },
          ]
        : [],
    [k],
  );

  async function issueReceipt(row: LedgerRow) {
    setError(null);
    try {
      const receipt = await window.api.payments.issueReceipt(row.id);
      reloadAll();
      onOpenReceipt(receipt.id);
      // קבלה שהופקה בנפרד מהתשלום היא אירוע בפני עצמו (WB-12).
      void offerNotification({ kind: 'receipt', refId: receipt.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openExistingReceipt(row: LedgerRow) {
    if (row.receiptNumber === null) return;
    const list = await window.api.receipts.list({
      minNumber: row.receiptNumber,
      maxNumber: row.receiptNumber,
    });
    const found = list.rows[0];
    if (found) onOpenReceipt(found.id);
  }

  async function removeRow(row: LedgerRow) {
    setError(null);
    try {
      if (row.rowType === 'charge') await window.api.vows.remove(row.id);
      else await window.api.payments.remove(row.id);
      reloadAll();
      onNotify('התנועה נמחקה ונרשמה ביומן הביקורת');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const columns: ReadonlyArray<Column<LedgerRow>> = useMemo(
    () => [
      {
        id: 'date',
        label: he.card.date,
        width: 110,
        sortValue: (r) => r.date,
        render: (r) => formatDate(r.date),
      },
      {
        id: 'hebrewDate',
        label: he.card.hebrewDate,
        width: 150,
        sortValue: (r) => r.date,
        render: (r) => (
          <Typography variant="body2" color="text.secondary">
            {r.hebrewDate}
          </Typography>
        ),
      },
      {
        id: 'occasion',
        label: he.card.occasion,
        sortValue: (r) => r.occasion,
        render: (r) => r.occasion ?? '—',
      },
      {
        id: 'note',
        label: he.card.detail,
        sortValue: (r) => r.note,
        render: (r) => r.note ?? '',
      },
      {
        id: 'debit',
        label: he.card.debit,
        width: 110,
        align: 'end',
        sortValue: (r) => r.debitAgorot,
        render: (r) => (r.debitAgorot ? formatAgorot(r.debitAgorot) : ''),
      },
      {
        id: 'credit',
        label: he.card.credit,
        width: 110,
        align: 'end',
        sortValue: (r) => r.creditAgorot,
        render: (r) =>
          r.creditAgorot ? (
            <Typography component="span" color="success.main">
              {formatAgorot(r.creditAgorot)}
            </Typography>
          ) : (
            ''
          ),
      },
      {
        id: 'running',
        label: he.card.running,
        width: 120,
        align: 'end',
        notSortable: true,
        render: (r) => (
          <Typography
            component="span"
            sx={{ color: balanceColor(r.runningBalanceAgorot), fontWeight: 600 }}
          >
            {formatAgorot(r.runningBalanceAgorot)}
          </Typography>
        ),
      },
      {
        id: 'method',
        label: he.card.method,
        width: 110,
        sortValue: (r) => r.paymentMethod,
        render: (r) => r.paymentMethod ?? '',
      },
      {
        id: 'status',
        label: he.card.status,
        width: 130,
        sortValue: (r) => STATUS_LABEL[r.status] ?? r.status,
        render: (r) => (
          <Chip
            size="small"
            variant="outlined"
            color={
              r.status === 'cancelled' ? 'error' : r.status === 'credit' ? 'success' : 'default'
            }
            label={STATUS_LABEL[r.status] ?? r.status}
          />
        ),
      },
      {
        id: 'receipt',
        label: he.card.receiptNumber,
        width: 130,
        sortValue: (r) => r.receiptNumber,
        render: (r) =>
          r.rowType !== 'payment' ? (
            ''
          ) : r.receiptNumber !== null ? (
            <Button size="small" onClick={() => void openExistingReceipt(r)}>
              {r.receiptNumber}
            </Button>
          ) : (
            <Tooltip title={he.card.actions.issueReceipt}>
              <IconButton aria-label={he.card.actions.issueReceipt} size="small" color="primary" onClick={() => void issueReceipt(r)}>
                <ReceiptLongIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ),
      },
      {
        id: 'actions',
        label: '',
        width: 90,
        notSortable: true,
        render: (r) => {
          // שורת חיוב היא נדר או זיכוי (`status` מחזיק את `ChargeKind`).
          // 'opening' – יתרת פתיחה מהייבוא, לא פעולה שנעשתה מול החבר, ולכן
          // אין עליה מה לדווח.
          const eventKind: NotifyEventKindDto | null =
            r.rowType === 'payment'
              ? 'payment'
              : r.status === 'credit'
                ? 'credit'
                : r.status === 'opening'
                  ? null
                  : 'vow';
          // קבלה חוסמת מחיקה (CLAUDE.md כלל 5) – וה-tooltip מסביר למה.
          const lockedByReceipt = r.rowType === 'payment' && r.receiptNumber !== null;
          return (
          <Stack direction="row" spacing={0.5}>
            {/* W-90 – שליחה יזומה על שורה בודדת ביומן. */}
            {eventKind !== null ? (
              <Tooltip title={he.whatsapp.notify.sendRow}>
                <IconButton aria-label={he.whatsapp.notify.sendRow}
                  size="small"
                  color="success"
                  onClick={() =>
                    void offerNotification({ kind: eventKind, refId: r.id }, { force: true })
                  }
                >
                  <WhatsAppIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          <Tooltip title={lockedByReceipt ? he.card.actions.lockedByReceipt : he.card.actions.deleteRow}>
            <span>
              <IconButton aria-label={lockedByReceipt ? he.card.actions.lockedByReceipt : he.card.actions.deleteRow}
                size="small"
                disabled={lockedByReceipt}
                onClick={() => void removeRow(r)}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          </Stack>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={onBack} aria-label={he.app.back}>
          <ArrowForwardIcon />
        </IconButton>
        <Typography variant="h2" sx={{ flex: 1 }}>
          {he.card.title}
        </Typography>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {m ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
            <div>
              <Typography variant="h2">
                {memberFullName(m)}
                {m.nickname ? ` (${m.nickname})` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {he.members.number} {m.memberNumber}
                {m.mobile ? ` · ` : ''}
                {m.mobile ? <span dir="ltr">{m.mobile}</span> : null}
              </Typography>
            </div>
            <div>
              <Typography variant="caption" color="text.secondary" display="block">
                {he.members.balance}
              </Typography>
              <Typography variant="h1" sx={{ color: balanceColor(m.balanceAgorot) }}>
                {formatAgorot(m.balanceAgorot)}
              </Typography>
            </div>
            <Stack direction="row" spacing={1} sx={{ ms: 'auto' }} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                startIcon={<PostAddIcon />}
                onClick={() => setDialog('vow')}
              >
                {he.card.actions.newVow}
              </Button>
              <Button startIcon={<PlaylistAddIcon />} onClick={() => setDialog('bulk')}>
                {he.card.actions.bulkVow}
              </Button>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<PaymentsIcon />}
                onClick={() => setDialog('payment')}
              >
                {he.card.actions.newPayment}
              </Button>
              <Button startIcon={<UndoIcon />} onClick={() => setDialog('credit')}>
                {he.card.actions.newCredit}
              </Button>
              {/* W-22 – שליחה לחבר יחיד. מוצג רק כשהמודול דלוק. */}
              {waEnabled ? (
                <Tooltip title={m.mobileStatus === 'valid' ? '' : he.whatsapp.sendOne.noMobile}>
                  <span>
                    <Button
                      color="success"
                      startIcon={<WhatsAppIcon />}
                      disabled={m.mobileStatus !== 'valid'}
                      onClick={() => setDialog('whatsapp')}
                    >
                      {he.whatsapp.sendOne.button}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <SendOneDialog
        open={dialog === 'whatsapp' || notify.draft !== null}
        draft={notify.draft}
        member={notify.draft !== null ? notify.member : (m ?? null)}
        onClose={() => {
          setDialog(null);
          notify.close();
        }}
        onSent={onNotify}
      />

      <DataTable
        columns={columns}
        rows={ledger.data?.rows ?? []}
        rowKey={(r) => `${r.rowType}-${r.id}`}
        totalBeforeFilter={ledger.data?.rows.length ?? 0}
        emptyMessage={he.table.noRows}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="member-card" />}
        filterBar={
          <FilterBar
            active={period !== 'all' || search !== '' || rowType !== 'all'}
            onClear={() => {
              setPeriod('all');
              setFrom('');
              setTo('');
              setSearch('');
              setRowType('all');
            }}
          >
            <TextField
              select
              label="תקופה"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">{he.card.period.all}</MenuItem>
              <MenuItem value="fiscal">{he.card.period.fiscal}</MenuItem>
              <MenuItem value="custom">{he.card.period.custom}</MenuItem>
            </TextField>
            {period === 'custom' ? (
              <>
                <TextField
                  type="date"
                  label={he.table.from}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  type="date"
                  label={he.table.to}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </>
            ) : null}
            <TextField
              select
              label={he.card.type}
              value={rowType}
              onChange={(e) => setRowType(e.target.value as 'all' | 'charge' | 'payment')}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="all">{he.members.allStatuses}</MenuItem>
              <MenuItem value="charge">{he.card.debit}</MenuItem>
              <MenuItem value="payment">{he.card.credit}</MenuItem>
            </TextField>
            <TextField
              label={he.table.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 200 }}
            />
          </FilterBar>
        }
      />

      <VowDialog
        open={dialog === 'vow' || dialog === 'bulk'}
        mode={dialog === 'bulk' ? 'bulk' : 'single'}
        member={dialog === 'bulk' ? null : (m as MemberWithBalance | null)}
        onClose={() => setDialog(null)}
        onSaved={(msg, notify) => {
          reloadAll();
          onNotify(msg);
          void offerNotification(notify);
        }}
      />
      <PaymentDialog
        open={dialog === 'payment'}
        member={m as MemberWithBalance | null}
        onClose={() => setDialog(null)}
        onSaved={(msg, receiptId, notify) => {
          reloadAll();
          onNotify(msg);
          if (receiptId !== null) onOpenReceipt(receiptId);
          void offerNotification(notify);
        }}
      />
      <CreditDialog
        open={dialog === 'credit'}
        member={m as MemberWithBalance | null}
        onClose={() => setDialog(null)}
        onSaved={(msg, notify) => {
          reloadAll();
          onNotify(msg);
          void offerNotification(notify);
        }}
      />
    </>
  );
}
