import { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import type { ReceiptDto, ReceiptFilterDto } from '@shared/api';
import type { ReceiptSourceType } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatDate } from '../lib/format';
import { he } from '../i18n/he';

export interface ReceiptsPageProps {
  onOpenReceipt: (id: number) => void;
  reloadToken: number;
}

/** F-74 – ספר הקבלות עם סינון, KPIs ובדיקת רציפות. */
export function ReceiptsPage({ onOpenReceipt, reloadToken }: ReceiptsPageProps) {
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'all' | 'active' | 'cancelled'>('all');
  const [sourceType, setSourceType] = useState<ReceiptSourceType | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [continuityMsg, setContinuityMsg] = useState<string | null>(null);

  const filter: ReceiptFilterDto = useMemo(
    () => ({
      ...(search.trim() ? { search: search.trim() } : {}),
      state,
      ...(sourceType === 'all' ? {} : { sourceType }),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [search, state, sourceType, from, to],
  );

  const query = useAsync(() => window.api.receipts.list(filter), [filter, reloadToken]);
  const k = query.data?.kpis;

  const kpis: readonly Kpi[] = useMemo(
    () =>
      k
        ? [
            { key: 'count', label: he.receipts.kpis.count, value: String(k.count) },
            { key: 'total', label: he.receipts.kpis.total, value: formatAgorot(k.totalAgorot) },
            {
              key: 'vow',
              label: he.receipts.kpis.vowPayments,
              value: formatAgorot(k.vowPaymentAgorot),
            },
            {
              key: 'donation',
              label: he.receipts.kpis.donations,
              value: formatAgorot(k.donationAgorot),
            },
            {
              key: 'cancelled',
              label: he.receipts.kpis.cancelled,
              value: String(k.cancelledCount),
              hint: k.cancelledCount > 0 ? formatAgorot(k.cancelledAgorot) : undefined,
              tone: k.cancelledCount > 0 ? 'negative' : 'default',
            },
            {
              key: 'range',
              label: he.receipts.kpis.range,
              value: k.firstNumber === null ? '—' : `${k.firstNumber}–${k.lastNumber}`,
            },
          ]
        : [],
    [k],
  );

  async function checkContinuity() {
    const res = await window.api.receipts.continuity();
    setContinuityMsg(
      res.missing.length === 0
        ? he.receipts.continuityOk
        : he.receipts.continuityMissing(res.missing.join(', ')),
    );
  }

  const columns: ReadonlyArray<Column<ReceiptDto>> = useMemo(
    () => [
      {
        id: 'receiptNumber',
        label: he.receipts.number,
        width: 100,
        sortValue: (r) => r.receiptNumber,
        render: (r) => <strong>{String(r.receiptNumber).padStart(4, '0')}</strong>,
      },
      {
        id: 'payerName',
        label: he.receipts.payer,
        sortValue: (r) => r.payerName,
        render: (r) => r.payerName,
      },
      {
        id: 'amount',
        label: he.receipts.amount,
        width: 120,
        align: 'end',
        sortValue: (r) => r.amountAgorot,
        render: (r) => formatAgorot(r.amountAgorot),
      },
      {
        id: 'method',
        label: he.receipts.method,
        width: 120,
        sortValue: (r) => r.paymentMethodText,
        render: (r) => r.paymentMethodText,
      },
      {
        id: 'purpose',
        label: he.receipts.purpose,
        sortValue: (r) => r.purposeText,
        render: (r) => r.purposeText,
      },
      {
        id: 'paymentDate',
        label: he.receipts.paymentDate,
        width: 115,
        sortValue: (r) => r.paymentDate,
        render: (r) => formatDate(r.paymentDate),
      },
      {
        id: 'hebrewYear',
        label: he.receipts.hebrewYear,
        width: 100,
        sortValue: (r) => r.hebrewYear,
        render: (r) => r.hebrewYear,
      },
      {
        id: 'prints',
        label: he.receipts.prints,
        width: 90,
        align: 'end',
        sortValue: (r) => r.printCount,
        render: (r) => r.printCount,
      },
      {
        id: 'state',
        label: he.receipts.state,
        width: 110,
        sortValue: (r) => (r.cancelledAt ? 1 : 0),
        render: (r) =>
          r.cancelledAt ? (
            <Chip size="small" color="error" label={he.receipts.cancelled} />
          ) : (
            <Chip size="small" variant="outlined" label={he.receipts.active} />
          ),
      },
    ],
    [],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <Typography variant="h2">{he.receipts.title}</Typography>
        <Button startIcon={<FactCheckIcon />} onClick={() => void checkContinuity()}>
          {he.receipts.continuity}
        </Button>
      </Stack>

      {continuityMsg ? (
        <Alert
          severity={continuityMsg === he.receipts.continuityOk ? 'success' : 'warning'}
          sx={{ mb: 2 }}
          onClose={() => setContinuityMsg(null)}
        >
          {continuityMsg}
        </Alert>
      ) : null}
      {query.error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {query.error}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        storageKey="receipts"
        totalBeforeFilter={query.data?.total ?? 0}
        initialSort={{ columnId: 'receiptNumber', direction: 'desc' }}
        onRowClick={(r) => onOpenReceipt(r.id)}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="receipts" />}
        filterBar={
          <FilterBar
            storageKey="receipts"
            active={
              search !== '' || state !== 'all' || sourceType !== 'all' || from !== '' || to !== ''
            }
            onClear={() => {
              setSearch('');
              setState('all');
              setSourceType('all');
              setFrom('');
              setTo('');
            }}
          >
            <TextField
              label={he.table.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
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
              label={he.receipts.purpose}
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as ReceiptSourceType | 'all')}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">{he.members.allStatuses}</MenuItem>
              <MenuItem value="vow_payment">{he.receipts.sourceVow}</MenuItem>
              <MenuItem value="donation">{he.receipts.sourceDonation}</MenuItem>
            </TextField>
            <TextField
              select
              label={he.receipts.state}
              value={state}
              onChange={(e) => setState(e.target.value as 'all' | 'active' | 'cancelled')}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="all">{he.receipts.allStates}</MenuItem>
              <MenuItem value="active">{he.receipts.active}</MenuItem>
              <MenuItem value="cancelled">{he.receipts.cancelled}</MenuItem>
            </TextField>
          </FilterBar>
        }
      />
    </Box>
  );
}
