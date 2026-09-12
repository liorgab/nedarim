import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  MenuItem,
  Stack,
  Tab,
  TableCell,
  TableFooter,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import type { AccrualRowDto, BalanceRangeDto, RangeKindDto } from '@shared/api';
import type { MonthlyBalanceRow } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { useAsync } from '../hooks/useAsync';
import { balanceColor, formatAgorot } from '../lib/format';
import { he } from '../i18n/he';

/** מציג 2026-03 כ-03/2026. */
function formatMonth(ym: string): string {
  return `${ym.slice(5)}/${ym.slice(0, 4)}`;
}

/** F-80 – מאזן חודשי דינמי + דוח צבירה מול גבייה. */
export function BalancePage() {
  const [tab, setTab] = useState<'balance' | 'accrual'>('balance');
  const [kind, setKind] = useState<RangeKindDto>('all');
  const [year, setYear] = useState<number | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const years = useAsync(() => window.api.balance.availableYears(), []);

  const range: BalanceRangeDto = useMemo(
    () => ({
      kind,
      ...(year === '' ? {} : { year }),
      ...(kind === 'custom' && from ? { from } : {}),
      ...(kind === 'custom' && to ? { to } : {}),
    }),
    [kind, year, from, to],
  );

  const balance = useAsync(() => window.api.balance.monthly(range), [range]);
  const accrual = useAsync(() => window.api.balance.accrual(range), [range]);

  const yearOptions = useMemo(() => {
    if (!years.data) return [];
    if (kind === 'hebrew') return years.data.hebrew;
    if (kind === 'civil') return years.data.civil;
    if (kind === 'fiscal') return years.data.fiscal;
    return [];
  }, [years.data, kind]);

  const totals = balance.data?.totals;
  const kpis: readonly Kpi[] = useMemo(
    () =>
      totals
        ? [
            {
              key: 'income',
              label: he.balance.kpis.income,
              value: formatAgorot(totals.incomeAgorot),
            },
            {
              key: 'expenses',
              label: he.balance.kpis.expenses,
              value: formatAgorot(totals.expensesAgorot),
              tone: 'negative',
            },
            {
              key: 'net',
              label: he.balance.kpis.net,
              value: formatAgorot(totals.netAgorot),
              tone: totals.netAgorot >= 0 ? 'positive' : 'negative',
            },
            {
              key: 'cumulative',
              label: he.balance.kpis.cumulative,
              value: formatAgorot(totals.closingCumulativeAgorot),
              tone: totals.closingCumulativeAgorot >= 0 ? 'positive' : 'negative',
            },
            {
              key: 'months',
              label: he.balance.kpis.months,
              value: String(balance.data?.rows.length ?? 0),
              hint: balance.data?.label,
            },
          ]
        : [],
    [totals, balance.data],
  );

  const balanceColumns: ReadonlyArray<Column<MonthlyBalanceRow>> = useMemo(
    () => [
      {
        id: 'ym',
        label: he.balance.month,
        width: 120,
        sortValue: (r) => r.ym,
        render: (r) => formatMonth(r.ym),
      },
      {
        id: 'donations',
        label: he.balance.donations,
        align: 'end',
        sortValue: (r) => r.donationsAgorot,
        render: (r) => formatAgorot(r.donationsAgorot),
      },
      {
        id: 'vowPayments',
        label: he.balance.vowPayments,
        align: 'end',
        sortValue: (r) => r.vowPaymentsAgorot,
        render: (r) => formatAgorot(r.vowPaymentsAgorot),
      },
      {
        id: 'income',
        label: he.balance.income,
        align: 'end',
        sortValue: (r) => r.incomeAgorot,
        render: (r) => <strong>{formatAgorot(r.incomeAgorot)}</strong>,
      },
      {
        id: 'expenses',
        label: he.balance.expenses,
        align: 'end',
        sortValue: (r) => r.expensesAgorot,
        render: (r) => formatAgorot(r.expensesAgorot),
      },
      {
        id: 'net',
        label: he.balance.net,
        align: 'end',
        sortValue: (r) => r.netAgorot,
        render: (r) => (
          <Typography
            component="span"
            sx={{ color: r.netAgorot >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}
          >
            {formatAgorot(r.netAgorot)}
          </Typography>
        ),
      },
      {
        id: 'cumulative',
        label: he.balance.cumulative,
        align: 'end',
        sortValue: (r) => r.cumulativeAgorot,
        render: (r) => (
          <Typography component="span" sx={{ color: balanceColor(-r.cumulativeAgorot) }}>
            {formatAgorot(r.cumulativeAgorot)}
          </Typography>
        ),
      },
    ],
    [],
  );

  const accrualColumns: ReadonlyArray<Column<AccrualRowDto>> = useMemo(
    () => [
      {
        id: 'ym',
        label: he.balance.month,
        width: 120,
        sortValue: (r) => r.ym,
        render: (r) => formatMonth(r.ym),
      },
      {
        id: 'charged',
        label: he.balance.charged,
        align: 'end',
        sortValue: (r) => r.chargedAgorot,
        render: (r) => formatAgorot(r.chargedAgorot),
      },
      {
        id: 'collected',
        label: he.balance.collected,
        align: 'end',
        sortValue: (r) => r.collectedAgorot,
        render: (r) => formatAgorot(r.collectedAgorot),
      },
      {
        id: 'gap',
        label: he.balance.gap,
        align: 'end',
        sortValue: (r) => r.gapAgorot,
        render: (r) => (
          <Typography component="span" sx={{ color: balanceColor(r.gapAgorot), fontWeight: 600 }}>
            {formatAgorot(r.gapAgorot)}
          </Typography>
        ),
      },
    ],
    [],
  );

  const filterBar = (
    <FilterBar
      storageKey="balance"
      activeCount={kind === 'all' ? 0 : 1}
      onClear={() => {
        setKind('all');
        setYear('');
        setFrom('');
        setTo('');
      }}
    >
      <TextField
        select
        label={he.balance.range.label}
        value={kind}
        onChange={(e) => {
          const next = e.target.value as RangeKindDto;
          setKind(next);
          setYear('');
        }}
        sx={{ minWidth: 170 }}
      >
        <MenuItem value="all">{he.balance.range.all}</MenuItem>
        <MenuItem value="fiscal">{he.balance.range.fiscal}</MenuItem>
        <MenuItem value="hebrew">{he.balance.range.hebrew}</MenuItem>
        <MenuItem value="civil">{he.balance.range.civil}</MenuItem>
        <MenuItem value="custom">{he.balance.range.custom}</MenuItem>
      </TextField>

      {kind === 'fiscal' || kind === 'hebrew' || kind === 'civil' ? (
        <TextField
          select
          label={he.balance.range.label}
          value={year}
          onChange={(e) => setYear(e.target.value === '' ? '' : Number(e.target.value))}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">—</MenuItem>
          {yearOptions.map((y) => (
            <MenuItem key={y} value={y}>
              {kind === 'fiscal' ? `${y}/${y + 1}` : y}
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      {kind === 'custom' ? (
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
    </FilterBar>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1, flex: 'none' }}>
        <Typography variant="h2">{he.balance.title}</Typography>
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, flex: 'none' }}>
        <Tab value="balance" label={he.balance.balanceTab} />
        <Tab value="accrual" label={he.balance.accrualTab} />
      </Tabs>

      <Alert severity="info" sx={{ mb: 2, flex: 'none' }}>
        {tab === 'balance' ? he.balance.cashBasis : he.balance.accrualHint}
      </Alert>

      {balance.error ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }}>
          {balance.error}
        </Alert>
      ) : null}

      {tab === 'balance' ? (
        <DataTable
          columns={balanceColumns}
          rows={balance.data?.rows ?? []}
          rowKey={(r) => r.ym}
          storageKey="balance"
          initialSort={{ columnId: 'ym', direction: 'asc' }}
          kpiPanel={<KpiPanel kpis={kpis} storageKey="balance" />}
          filterBar={filterBar}
          footer={
            totals ? (
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>{he.reports.totals}</TableCell>
                  <TableCell sx={{ textAlign: 'end' }}>
                    {formatAgorot(totals.donationsAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end' }}>
                    {formatAgorot(totals.vowPaymentsAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end', fontWeight: 700 }}>
                    {formatAgorot(totals.incomeAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end' }}>
                    {formatAgorot(totals.expensesAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end', fontWeight: 700 }}>
                    {formatAgorot(totals.netAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end', fontWeight: 700 }}>
                    {formatAgorot(totals.closingCumulativeAgorot)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null
          }
        />
      ) : (
        <DataTable
          columns={accrualColumns}
          rows={accrual.data?.rows ?? []}
          rowKey={(r) => r.ym}
          storageKey="accrual"
          initialSort={{ columnId: 'ym', direction: 'asc' }}
          filterBar={filterBar}
          footer={
            accrual.data ? (
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>{he.reports.totals}</TableCell>
                  <TableCell sx={{ textAlign: 'end' }}>
                    {formatAgorot(accrual.data.totals.chargedAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end' }}>
                    {formatAgorot(accrual.data.totals.collectedAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'end', fontWeight: 700 }}>
                    {formatAgorot(accrual.data.totals.gapAgorot)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null
          }
        />
      )}
    </Box>
  );
}
