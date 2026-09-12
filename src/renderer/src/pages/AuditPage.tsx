import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import type { AuditEntryDto, AuditFilterDto, AuthUserDto } from '@shared/api';
import type { AuditAction } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { useAsync } from '../hooks/useAsync';
import { formatDateTime } from '../lib/format';
import { he } from '../i18n/he';

export interface AuditPageProps {
  onNotify: (message: string) => void;
}

const EMPTY: AuditFilterDto = {};

/**
 * F-93 – יומן הביקורת.
 *
 * לקריאה בלבד: אין כאן עריכה, אין מחיקה ואין "ניקוי יומן". זו כל הנקודה של
 * הדרישה – הגבאי, וכל מבקר אחריו, יכול לראות מי שינה מה ומתי, בלי שאפשר יהיה
 * למחוק את העקבות מתוך היישום.
 */
export function AuditPage({ onNotify }: AuditPageProps) {
  const [filter, setFilter] = useState<AuditFilterDto>(EMPTY);
  const [detail, setDetail] = useState<AuditEntryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useAsync(() => window.api.audit.list(filter), [JSON.stringify(filter)]);
  const labels = useAsync(() => window.api.audit.labels(), []);
  const entities = useAsync<string[]>(() => window.api.audit.entities(), []);
  const users = useAsync<AuthUserDto[]>(() => window.api.auth.listUsers(), []);

  const entityLabel = (key: string): string => labels.data?.entities[key] ?? key;
  const actionLabel = (key: string): string => labels.data?.actions[key] ?? key;

  function set<K extends keyof AuditFilterDto>(key: K, value: AuditFilterDto[K]): void {
    setFilter((f) => {
      const next = { ...f };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  const activeCount = Object.keys(filter).length;
  const rows = data.data?.rows ?? [];
  const kpisRaw = data.data?.kpis;
  const total = data.data?.total ?? 0;

  const kpis: Kpi[] = useMemo(() => {
    if (!kpisRaw) return [];
    const top = kpisRaw.byAction
      .slice(0, 3)
      .map((a) => `${actionLabel(a.action)} ${a.count}`)
      .join(' · ');
    return [
      { key: 'shown', label: he.audit.kpiEntries, value: String(kpisRaw.count), hint: top },
      { key: 'total', label: he.audit.kpiTotal, value: String(total) },
      { key: 'users', label: he.audit.kpiUsers, value: String(kpisRaw.users) },
      {
        key: 'range',
        label: he.audit.kpiRange,
        value:
          kpisRaw.firstAt === null
            ? '—'
            : `${formatDateTime(kpisRaw.firstAt)} – ${formatDateTime(kpisRaw.lastAt)}`,
      },
    ];
    // actionLabel נגזר מ-labels.data ולכן הוא כבר בתלויות.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpisRaw, total, labels.data]);

  const columns: ReadonlyArray<Column<AuditEntryDto>> = [
    {
      id: 'ts',
      label: he.audit.ts,
      width: 150,
      sortValue: (r) => r.ts,
      render: (r) => formatDateTime(r.ts),
    },
    {
      id: 'user',
      label: he.audit.user,
      width: 130,
      sortValue: (r) => r.userName ?? '',
      render: (r) => r.userName ?? '—',
    },
    {
      id: 'entity',
      label: he.audit.entity,
      width: 130,
      sortValue: (r) => r.entity,
      render: (r) => entityLabel(r.entity),
    },
    {
      id: 'entityId',
      label: he.audit.entityId,
      width: 80,
      align: 'end',
      sortValue: (r) => r.entityId,
      render: (r) => r.entityId ?? '—',
    },
    {
      id: 'action',
      label: he.audit.action,
      width: 110,
      sortValue: (r) => r.action,
      render: (r) => <Chip size="small" label={actionLabel(r.action)} />,
    },
    {
      id: 'details',
      label: he.audit.details,
      sortValue: (r) => r.afterJson ?? r.beforeJson ?? '',
      render: (r) => (
        <Typography
          variant="body2"
          sx={{
            maxWidth: 520,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            direction: 'ltr',
            textAlign: 'start',
          }}
        >
          {r.afterJson ?? r.beforeJson ?? ''}
        </Typography>
      ),
    },
    {
      id: 'open',
      label: he.app.actions,
      width: 60,
      notSortable: true,
      render: (r) => (
        <Tooltip title={he.audit.details}>
          <IconButton aria-label={he.audit.details} size="small" onClick={() => setDetail(r)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  async function exportLog(): Promise<void> {
    try {
      const path = await window.api.audit.export(filter);
      if (path !== null) onNotify(he.audit.exported);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const limit = filter.limit ?? 1000;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1, flex: 'none' }}
      >
        <Box>
          <Typography variant="h2">{he.audit.title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {he.audit.subtitle}
          </Typography>
        </Box>
        <Button startIcon={<DownloadIcon />} onClick={() => void exportLog()}>
          {he.audit.export}
        </Button>
      </Stack>

      {error !== null ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {rows.length >= limit ? (
        <Alert severity="info" sx={{ mb: 2, flex: 'none' }}>
          {he.audit.limitHint(limit)}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="audit"
        initialSort={{ columnId: 'ts', direction: 'desc' }}
        emptyMessage={he.audit.empty}
        totalBeforeFilter={total}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="audit" />}
        filterBar={
          <FilterBar
            storageKey="audit"
            activeCount={activeCount}
            active={activeCount > 0}
            onClear={() => setFilter(EMPTY)}
          >
            <TextField
              label={he.table.from}
              type="date"
              value={filter.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 150 }}
            />
            <TextField
              label={he.table.to}
              type="date"
              value={filter.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 150 }}
            />
            <TextField
              select
              label={he.audit.entity}
              value={filter.entity ?? ''}
              onChange={(e) => set('entity', e.target.value)}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">{he.audit.allEntities}</MenuItem>
              {(entities.data ?? []).map((name) => (
                <MenuItem key={name} value={name}>
                  {entityLabel(name)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={he.audit.action}
              value={filter.action ?? ''}
              onChange={(e) =>
                set('action', e.target.value === '' ? undefined : (e.target.value as AuditAction))
              }
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{he.audit.allActions}</MenuItem>
              {Object.entries(labels.data?.actions ?? {}).map(([key, value]) => (
                <MenuItem key={key} value={key}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={he.audit.user}
              value={filter.userId === undefined ? '' : String(filter.userId)}
              onChange={(e) =>
                set('userId', e.target.value === '' ? undefined : Number(e.target.value))
              }
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{he.audit.allUsers}</MenuItem>
              {(users.data ?? []).map((u) => (
                <MenuItem key={u.id} value={String(u.id)}>
                  {u.displayName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={he.audit.search}
              value={filter.search ?? ''}
              onChange={(e) => set('search', e.target.value)}
              sx={{ minWidth: 220 }}
            />
          </FilterBar>
        }
      />

      <AuditDetailDialog entry={detail} onClose={() => setDetail(null)} label={entityLabel} />
    </Box>
  );
}

function pretty(json: string | null): string {
  if (json === null) return '—';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function AuditDetailDialog({
  entry,
  onClose,
  label,
}: {
  entry: AuditEntryDto | null;
  onClose: () => void;
  label: (key: string) => string;
}) {
  return (
    <Dialog open={entry !== null} onClose={onClose} maxWidth="md" fullWidth>
      {entry !== null ? (
        <>
          <DialogTitle>
            {`${label(entry.entity)} ${entry.entityId ?? ''} · ${formatDateTime(entry.ts)}`}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="subtitle2">{he.audit.before}</Typography>
            <Box
              component="pre"
              sx={{
                direction: 'ltr',
                textAlign: 'start',
                fontSize: 12,
                bgcolor: 'action.hover',
                p: 1,
                overflow: 'auto',
              }}
            >
              {pretty(entry.beforeJson)}
            </Box>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              {he.audit.after}
            </Typography>
            <Box
              component="pre"
              sx={{
                direction: 'ltr',
                textAlign: 'start',
                fontSize: 12,
                bgcolor: 'action.hover',
                p: 1,
                overflow: 'auto',
              }}
            >
              {pretty(entry.afterJson)}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{he.app.close}</Button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  );
}
