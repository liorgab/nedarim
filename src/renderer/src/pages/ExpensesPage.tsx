import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { ExpenseDto, ExpenseFilterDto } from '@shared/api';
import type { Lookup } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { ExpenseDialog } from '../components/dialogs/ExpenseDialog';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatDate, parseShekelInput, shekelToAgorot } from '../lib/format';
import { he } from '../i18n/he';

export interface ExpensesPageProps {
  onNotify: (message: string) => void;
}

/** F-60..F-62 – יומן ההוצאות, עם סיכום דינמי לפי הסינון במקום שורת סיכום ידנית. */
export function ExpensesPage({ onNotify }: ExpensesPageProps) {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useAsync<Lookup[]>(() => window.api.lookups.expenseCategories(true), []);

  const filter: ExpenseFilterDto = useMemo(() => {
    const min = parseShekelInput(minAmount);
    const max = parseShekelInput(maxAmount);
    return {
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(categoryId === '' ? {} : { categoryId }),
      ...(min === null ? {} : { minAmountAgorot: shekelToAgorot(min) }),
      ...(max === null ? {} : { maxAmountAgorot: shekelToAgorot(max) }),
    };
  }, [search, from, to, categoryId, minAmount, maxAmount]);

  const query = useAsync(() => window.api.expenses.list(filter), [filter]);
  const k = query.data?.kpis;

  const activeCount = Object.keys(filter).length;

  const kpis: readonly Kpi[] = useMemo(
    () =>
      k
        ? [
            { key: 'count', label: he.expenses.kpis.count, value: String(k.count) },
            {
              key: 'total',
              label: he.expenses.kpis.total,
              value: formatAgorot(k.totalAgorot),
              tone: 'negative',
            },
            { key: 'avg', label: he.expenses.kpis.average, value: formatAgorot(k.averageAgorot) },
            { key: 'max', label: he.expenses.kpis.largest, value: formatAgorot(k.largestAgorot) },
            {
              key: 'refunds',
              label: he.expenses.kpis.refunds,
              value: formatAgorot(k.refundsAgorot),
              tone: k.refundsAgorot < 0 ? 'positive' : 'default',
            },
            {
              key: 'topCategory',
              label: he.expenses.kpis.topCategory,
              value: k.byCategory[0]?.category ?? '—',
              hint: k.byCategory[0] ? formatAgorot(k.byCategory[0].totalAgorot) : undefined,
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

  const columns: ReadonlyArray<Column<ExpenseDto>> = useMemo(
    () => [
      {
        id: 'expenseNumber',
        label: he.expenses.number,
        width: 80,
        sortValue: (r) => r.expenseNumber,
        render: (r) => r.expenseNumber,
      },
      {
        id: 'date',
        label: he.expenses.date,
        width: 115,
        sortValue: (r) => r.expenseDate,
        render: (r) => formatDate(r.expenseDate),
      },
      {
        id: 'category',
        label: he.expenses.category,
        width: 150,
        sortValue: (r) => r.category,
        render: (r) => r.category,
      },
      {
        id: 'description',
        label: he.expenses.description,
        sortValue: (r) => r.description,
        render: (r) => r.description,
      },
      {
        id: 'supplier',
        label: he.expenses.supplier,
        width: 150,
        sortValue: (r) => r.supplier,
        render: (r) => r.supplier ?? '',
      },
      {
        id: 'reference',
        label: he.expenses.reference,
        width: 160,
        sortValue: (r) => r.reference,
        render: (r) => r.reference ?? '',
      },
      {
        id: 'amount',
        label: he.expenses.amount,
        width: 120,
        align: 'end',
        sortValue: (r) => r.amountAgorot,
        render: (r) => (
          <Typography
            component="span"
            sx={{ fontWeight: 600, color: r.amountAgorot < 0 ? 'success.main' : undefined }}
          >
            {formatAgorot(r.amountAgorot)}
          </Typography>
        ),
      },
      {
        id: 'actions',
        label: he.app.actions,
        width: 130,
        notSortable: true,
        render: (r) => (
          <Stack direction="row" spacing={0.5}>
            {r.attachmentPath ? (
              <Tooltip title={he.expenses.openAttachment}>
                <IconButton aria-label={he.expenses.openAttachment}
                  size="small"
                  onClick={() => void act(() => window.api.expenses.openAttachment(r.id))}
                >
                  <AttachFileIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={he.expenses.edit}>
              <IconButton aria-label={he.expenses.edit}
                size="small"
                onClick={() => {
                  setEditing(r);
                  setDialogOpen(true);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={he.app.actions}>
              <IconButton aria-label={he.app.actions}
                size="small"
                onClick={() => {
                  if (window.confirm(he.expenses.deleteConfirm)) {
                    void act(async () => {
                      await window.api.expenses.remove(r.id);
                      onNotify(he.expenses.deleted);
                    });
                  }
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <Typography variant="h2">{he.expenses.title}</Typography>
        <Button
          variant="contained"
          startIcon={<ReceiptIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {he.expenses.add}
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
        storageKey="expenses"
        totalBeforeFilter={query.data?.total ?? 0}
        initialSort={{ columnId: 'date', direction: 'desc' }}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="expenses" />}
        filterBar={
          <FilterBar
            storageKey="expenses"
            activeCount={activeCount}
            onClear={() => {
              setSearch('');
              setFrom('');
              setTo('');
              setCategoryId('');
              setMinAmount('');
              setMaxAmount('');
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
              label={he.expenses.category}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">{he.members.allStatuses}</MenuItem>
              {(categories.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={he.expenses.minAmount}
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 120 }}
            />
            <TextField
              label={he.expenses.maxAmount}
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 120 }}
            />
          </FilterBar>
        }
      />

      <ExpenseDialog
        open={dialogOpen}
        expense={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={(msg) => {
          query.reload();
          onNotify(msg);
        }}
      />
    </Box>
  );
}
