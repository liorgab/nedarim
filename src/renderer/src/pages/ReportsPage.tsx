import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TableCell,
  TableFooter,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import TableViewIcon from '@mui/icons-material/TableView';
import type {
  BalanceRangeDto,
  RangeKindDto,
  ReportColumnDto,
  ReportIdDto,
  ReportResultDto,
} from '@shared/api';
import type { MemberWithBalance } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { MemberPicker } from '../components/MemberPicker';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatDate } from '../lib/format';
import { he } from '../i18n/he';

type Row = Record<string, string | number | null>;

function renderCell(value: string | number | null, column: ReportColumnDto): string {
  if (value === null || value === undefined) return '';
  if (column.format === 'money' && typeof value === 'number') return formatAgorot(value);
  if (column.format === 'date' && typeof value === 'string') return formatDate(value);
  return String(value);
}

/** F-81..F-87 – מסך הדוחות. כל דוח מוצג ומיוצא מאותו מבנה אחיד. */
export function ReportsPage({ onNotify }: { onNotify: (message: string) => void }) {
  const [reportId, setReportId] = useState<ReportIdDto>('debtors');
  const [kind, setKind] = useState<RangeKindDto>('all');
  const [year, setYear] = useState<number | ''>('');
  const [member, setMember] = useState<MemberWithBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reports = useAsync(() => window.api.reports.list(), []);
  const years = useAsync(() => window.api.balance.availableYears(), []);

  const definition = reports.data?.find((r) => r.id === reportId);
  const needsMember = definition?.needsMember === true;

  const range: BalanceRangeDto = useMemo(
    () => ({ kind, ...(year === '' ? {} : { year }) }),
    [kind, year],
  );

  const params = useMemo(
    () => ({ range, ...(member ? { memberId: member.id } : {}) }),
    [range, member],
  );

  const result = useAsync<ReportResultDto | null>(
    () =>
      needsMember && !member ? Promise.resolve(null) : window.api.reports.run(reportId, params),
    [reportId, params, needsMember],
  );

  useEffect(() => {
    if (!needsMember) setMember(null);
  }, [needsMember]);

  const yearOptions = useMemo(() => {
    if (!years.data) return [];
    if (kind === 'hebrew') return years.data.hebrew;
    if (kind === 'civil') return years.data.civil;
    if (kind === 'fiscal') return years.data.fiscal;
    return [];
  }, [years.data, kind]);

  const report = result.data;

  const columns: ReadonlyArray<Column<Row>> = useMemo(
    () =>
      (report?.columns ?? []).map((c) => ({
        id: c.key,
        label: c.label,
        align: c.align ?? (c.format === 'money' || c.format === 'number' ? 'end' : 'start'),
        sortValue: (row: Row) => row[c.key] ?? null,
        render: (row: Row) => renderCell(row[c.key] ?? null, c),
      })),
    [report],
  );

  const kpis: readonly Kpi[] = useMemo(
    () =>
      (report?.kpis ?? []).map((k) => ({
        key: k.key,
        label: k.label,
        value: k.format === 'money' ? formatAgorot(k.value) : String(k.value),
      })),
    [report],
  );

  async function exportTo(format: 'csv' | 'xlsx') {
    setError(null);
    setBusy(true);
    try {
      const path = await window.api.reports.export(reportId, params, format);
      if (path) onNotify(he.reports.exported(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <div>
          <Typography variant="h2">{report?.title ?? he.reports.title}</Typography>
          {report?.subtitle ? (
            <Typography variant="body2" color="text.secondary">
              {report.subtitle}
            </Typography>
          ) : null}
        </div>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<DownloadIcon />}
            onClick={() => void exportTo('csv')}
            disabled={busy || !report}
          >
            {he.reports.exportCsv}
          </Button>
          <Button
            variant="contained"
            startIcon={<TableViewIcon />}
            onClick={() => void exportTo('xlsx')}
            disabled={busy || !report}
          >
            {he.reports.exportExcel}
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {result.error ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }}>
          {result.error}
        </Alert>
      ) : null}
      {needsMember && !member ? (
        <Alert severity="info" sx={{ mb: 2, flex: 'none' }}>
          {he.reports.pickMemberFirst}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={(report?.rows ?? []) as Row[]}
        rowKey={(_row) => (report?.rows ?? []).indexOf(_row)}
        storageKey={`report-${reportId}`}
        emptyMessage={he.table.noRows}
        kpiPanel={kpis.length > 0 ? <KpiPanel kpis={kpis} storageKey="reports" /> : undefined}
        filterBar={
          <FilterBar
            storageKey="reports"
            activeCount={(kind === 'all' ? 0 : 1) + (member ? 1 : 0)}
            onClear={() => {
              setKind('all');
              setYear('');
              setMember(null);
            }}
          >
            <TextField
              select
              label={he.reports.select}
              value={reportId}
              onChange={(e) => setReportId(e.target.value as ReportIdDto)}
              sx={{ minWidth: 240 }}
            >
              {(reports.data ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.title}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label={he.balance.range.label}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as RangeKindDto);
                setYear('');
              }}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">{he.balance.range.all}</MenuItem>
              <MenuItem value="fiscal">{he.balance.range.fiscal}</MenuItem>
              <MenuItem value="hebrew">{he.balance.range.hebrew}</MenuItem>
              <MenuItem value="civil">{he.balance.range.civil}</MenuItem>
            </TextField>

            {yearOptions.length > 0 ? (
              <TextField
                select
                label={he.balance.range.label}
                value={year}
                onChange={(e) => setYear(e.target.value === '' ? '' : Number(e.target.value))}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="">—</MenuItem>
                {yearOptions.map((y) => (
                  <MenuItem key={y} value={y}>
                    {kind === 'fiscal' ? `${y}/${y + 1}` : y}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}

            {needsMember ? (
              <Box sx={{ minWidth: 280 }}>
                <MemberPicker value={member} onChange={setMember} label={he.reports.member} />
              </Box>
            ) : null}
          </FilterBar>
        }
        footer={
          report?.totals ? (
            <TableFooter>
              <TableRow>
                {report.columns.map((c) => (
                  <TableCell
                    key={c.key}
                    sx={{
                      fontWeight: 700,
                      textAlign: c.align ?? (c.format === 'money' ? 'end' : 'start'),
                    }}
                  >
                    {renderCell(report.totals![c.key] ?? null, c)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null
        }
      />
    </Box>
  );
}
