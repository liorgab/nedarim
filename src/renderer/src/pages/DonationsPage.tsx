import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { DonationDto, DonationFilterDto, NotifyRefDto } from '@shared/api';
import type { Lookup, PaymentMethod } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { DonationDialog } from '../components/dialogs/DonationDialog';
import { SendOneDialog } from '../components/whatsapp/SendOneDialog';
import { useEventNotification } from '../hooks/useEventNotification';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatDate } from '../lib/format';
import { he } from '../i18n/he';

export interface DonationsPageProps {
  onOpenReceipt: (id: number) => void;
  onNotify: (message: string) => void;
}

/** F-50..F-52 – יומן התרומות. */
export function DonationsPage({ onOpenReceipt, onNotify }: DonationsPageProps) {
  // W-86 – הודעת התרומה שממתינה לאישור.
  const notify = useEventNotification();
  /**
   * F-76 – הפקה מאוחרת של קבלה לתרומה שנשמרה בלעדיה.
   *
   * בלי השאלה כאן אין שום דרך לקבוע שם אחר אחרי השמירה, והקבלה
   * היא Immutable – כלומר טעות כאן עולה ביטול קבלה.
   */
  const [issuing, setIssuing] = useState<DonationDto | null>(null);
  const [otherName, setOtherName] = useState(false);
  const [receiptName, setReceiptName] = useState('');

  async function issueFor(donation: DonationDto, name: string): Promise<void> {
    await act(async () => {
      const receipt = await window.api.donations.issueReceipt(donation.id, name);
      setIssuing(null);
      onNotify(he.donations.savedWithReceipt(receipt.receiptNumber));
      onOpenReceipt(receipt.id);
      await offerNotification({ kind: 'receipt', refId: receipt.id });
    });
  }
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typeId, setTypeId] = useState<number | ''>('');
  const [methodId, setMethodId] = useState<number | ''>('');
  const [receiptState, setReceiptState] = useState<'all' | 'with' | 'without'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DonationDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const types = useAsync<Lookup[]>(() => window.api.lookups.donationTypes(true), []);
  const methods = useAsync<PaymentMethod[]>(() => window.api.lookups.paymentMethods(true), []);

  const filter: DonationFilterDto = useMemo(
    () => ({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(typeId === '' ? {} : { donationTypeId: typeId }),
      ...(methodId === '' ? {} : { paymentMethodId: methodId }),
      receiptState,
    }),
    [search, from, to, typeId, methodId, receiptState],
  );

  const query = useAsync(() => window.api.donations.list(filter), [filter]);

  /** W-86 – מציע הודעת וואטסאפ. הכלל "מתי מדווחים" ב-`useEventNotification`. */
  const offerNotification = async (
    ref: NotifyRefDto | null,
    options: { force?: boolean } = {},
  ): Promise<void> => {
    if (ref === null) return;
    const message = await notify.offer(ref.kind, ref.refId, options);
    if (message !== null) onNotify(message);
  };
  const k = query.data?.kpis;

  const activeCount =
    (search ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (typeId === '' ? 0 : 1) +
    (methodId === '' ? 0 : 1) +
    (receiptState === 'all' ? 0 : 1);

  const kpis: readonly Kpi[] = useMemo(
    () =>
      k
        ? [
            { key: 'count', label: he.donations.kpis.count, value: String(k.count) },
            { key: 'total', label: he.donations.kpis.total, value: formatAgorot(k.totalAgorot) },
            { key: 'avg', label: he.donations.kpis.average, value: formatAgorot(k.averageAgorot) },
            { key: 'max', label: he.donations.kpis.largest, value: formatAgorot(k.largestAgorot) },
            {
              key: 'withReceipt',
              label: he.donations.kpis.withReceipt,
              value: String(k.withReceipt),
            },
            {
              key: 'withoutReceipt',
              label: he.donations.kpis.withoutReceipt,
              value: formatAgorot(k.withoutReceiptAgorot),
              tone: k.withoutReceiptAgorot > 0 ? 'negative' : 'default',
            },
          ]
        : [],
    [k],
  );

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      query.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const columns: ReadonlyArray<Column<DonationDto>> = useMemo(
    () => [
      {
        id: 'donationNumber',
        label: he.donations.number,
        width: 80,
        sortValue: (r) => r.donationNumber,
        render: (r) => r.donationNumber,
      },
      {
        id: 'date',
        label: he.donations.date,
        width: 115,
        sortValue: (r) => r.donationDate,
        render: (r) => formatDate(r.donationDate),
      },
      {
        id: 'donor',
        label: he.donations.donor,
        sortValue: (r) => r.donorName,
        render: (r) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <span>{r.donorName}</span>
            {r.memberId !== null ? (
              <Chip size="small" variant="outlined" label={he.donations.isMember} />
            ) : null}
          </Stack>
        ),
      },
      {
        id: 'type',
        label: he.donations.type,
        width: 130,
        sortValue: (r) => r.donationType,
        render: (r) => r.donationType,
      },
      {
        id: 'method',
        label: he.donations.method,
        width: 120,
        sortValue: (r) => r.paymentMethod,
        render: (r) => r.paymentMethod,
      },
      {
        id: 'purpose',
        label: he.donations.purpose,
        sortValue: (r) => r.purpose,
        render: (r) => r.purpose ?? '',
      },
      {
        id: 'amount',
        label: he.donations.amount,
        width: 120,
        align: 'end',
        sortValue: (r) => r.amountAgorot,
        render: (r) => (
          <Typography component="span" sx={{ fontWeight: 600 }}>
            {formatAgorot(r.amountAgorot)}
          </Typography>
        ),
      },
      {
        id: 'receipt',
        label: he.donations.receipt,
        width: 120,
        sortValue: (r) => r.receiptNumber,
        render: (r) =>
          r.receiptNumber !== null ? (
            <Button
              size="small"
              onClick={() => {
                if (r.receiptId !== null) onOpenReceipt(r.receiptId);
              }}
            >
              {r.receiptNumber}
            </Button>
          ) : (
            <Tooltip title={he.pending.issue}>
              <IconButton aria-label={he.pending.issue}
                size="small"
                color="primary"
                onClick={() => {
                  setIssuing(r);
                  setOtherName(r.receiptName !== null);
                  setReceiptName(r.receiptName ?? '');
                }}
              >
                <ReceiptLongIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ),
      },
      {
        id: 'actions',
        label: he.app.actions,
        width: 100,
        notSortable: true,
        render: (r) => {
          // CLAUDE.md כלל 5 – קבלה היא Immutable, ולכן תרומה שהופקה עליה
          // קבלה נעולה. ה-tooltip **חייב** להסביר את זה: כפתור מושבת בלי
          // הסבר נראה למשתמש כתקלה, לא כמדיניות.
          const locked = r.receiptId !== null;
          return (
          <Stack direction="row" spacing={0.5}>
            {/* W-90 – שליחה יזומה, בלי תלות בהגדרת ההודעה האוטומטית. */}
            <Tooltip title={r.memberId === null ? he.whatsapp.notify.sendRowDisabled : he.whatsapp.notify.sendRow}>
              <span>
                <IconButton aria-label={r.memberId === null ? he.whatsapp.notify.sendRowDisabled : he.whatsapp.notify.sendRow}
                  size="small"
                  color="success"
                  disabled={r.memberId === null}
                  onClick={() => void offerNotification({ kind: 'donation', refId: r.id }, { force: true })}
                >
                  <WhatsAppIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={locked ? he.donations.lockedByReceipt : he.donations.edit}>
              <span>
                <IconButton aria-label={locked ? he.donations.lockedByReceipt : he.donations.edit}
                  size="small"
                  disabled={locked}
                  onClick={() => {
                    setEditing(r);
                    setDialogOpen(true);
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={locked ? he.donations.lockedByReceipt : he.donations.deleteAction}>
              <span>
                <IconButton aria-label={locked ? he.donations.lockedByReceipt : he.donations.deleteAction}
                  size="small"
                  disabled={locked}
                  onClick={() => {
                    if (window.confirm(he.donations.deleteConfirm)) {
                      void act(async () => {
                        await window.api.donations.remove(r.id);
                        onNotify(he.donations.deleted);
                      });
                    }
                  }}
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
    [onOpenReceipt],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <Typography variant="h2">{he.donations.title}</Typography>
        <Button
          variant="contained"
          startIcon={<VolunteerActivismIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {he.donations.add}
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        storageKey="donations"
        totalBeforeFilter={query.data?.total ?? 0}
        initialSort={{ columnId: 'date', direction: 'desc' }}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="donations" />}
        filterBar={
          <FilterBar
            storageKey="donations"
            activeCount={activeCount}
            onClear={() => {
              setSearch('');
              setFrom('');
              setTo('');
              setTypeId('');
              setMethodId('');
              setReceiptState('all');
            }}
          >
            <TextField
              label={he.table.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 200 }}
            />
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
            <TextField
              select
              label={he.donations.type}
              value={typeId}
              onChange={(e) => setTypeId(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{he.members.allStatuses}</MenuItem>
              {(types.data ?? []).map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={he.donations.method}
              value={methodId}
              onChange={(e) => setMethodId(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{he.members.allStatuses}</MenuItem>
              {(methods.data ?? []).map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={he.donations.receipt}
              value={receiptState}
              onChange={(e) => setReceiptState(e.target.value as 'all' | 'with' | 'without')}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="all">{he.members.allStatuses}</MenuItem>
              <MenuItem value="with">{he.donations.withReceipt}</MenuItem>
              <MenuItem value="without">{he.donations.withoutReceipt}</MenuItem>
            </TextField>
          </FilterBar>
        }
      />

      <DonationDialog
        open={dialogOpen}
        donation={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={(msg, receiptId, notify) => {
          query.reload();
          onNotify(msg);
          if (receiptId !== null) onOpenReceipt(receiptId);
          void offerNotification(notify);
        }}
      />

      {/* F-76 – שם אחר על הקבלה, ברגע ההפקה. */}
      <Dialog open={issuing !== null} onClose={() => setIssuing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{he.receiptName.issueTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography variant="body2">
              {he.receiptName.defaultName(issuing?.donorName ?? '')}
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
              // מחרוזת ריקה ולא undefined: הסרת הסימון היא בקשה
              // מפורשת לחזור לשם התורם, ולא "אל תגע".
              void issueFor(issuing, otherName ? receiptName.trim() : '');
            }}
          >
            {he.receiptName.issue}
          </Button>
        </DialogActions>
      </Dialog>

      {/* W-86 – הודעת התרומה, אחרי שדיאלוג התרומה כבר נסגר. */}
      <SendOneDialog
        open={notify.draft !== null}
        draft={notify.draft}
        member={notify.member}
        onClose={notify.close}
        onSent={onNotify}
      />
    </Box>
  );
}
