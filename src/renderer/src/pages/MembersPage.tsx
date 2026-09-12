import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import EditIcon from '@mui/icons-material/Edit';
import ArticleIcon from '@mui/icons-material/Article';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import type { MemberStatus, MemberWithBalance } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { MemberDialog } from '../components/dialogs/MemberDialog';
import { SendWizardDialog } from '../components/whatsapp/SendWizardDialog';
import { useAsync } from '../hooks/useAsync';
import {
  balanceColor,
  formatAgorot,
  formatDate,
  memberFullName,
  parseShekelInput,
  shekelToAgorot,
} from '../lib/format';
import { he } from '../i18n/he';

export interface MembersPageProps {
  onOpenCard: (member: MemberWithBalance) => void;
  onNotify: (message: string) => void;
}

/** F-10..F-13 – מסך החברים. */
export function MembersPage({ onOpenCard, onNotify }: MembersPageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MemberStatus | 'all'>('active');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [minBalance, setMinBalance] = useState('');
  const [mobileStatus, setMobileStatus] = useState<'all' | 'valid' | 'not_valid'>('all');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);

  /**
   * W-88 – בוחר את כל החברים בעלי יתרת חוב ופותח את אשף השליחה.
   *
   * הרשימה נגזרת ב-main מ-`v_member_balance` ולא מהשורות שעל המסך: הטבלה
   * מסוננת, והגבאי שביקש "כל החייבים" מתכוון לכולם ולא רק לנראים.
   */
  async function selectDebtors(): Promise<void> {
    const ids = await window.api.notifications.debtorIds();
    if (ids.length === 0) {
      onNotify(he.whatsapp.notify.debtors.none);
      return;
    }
    setSelected(new Set(ids));
    setWizardOpen(true);
  }
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MemberWithBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const minBalanceAgorot = (() => {
    const parsed = parseShekelInput(minBalance);
    return parsed === null ? undefined : shekelToAgorot(parsed);
  })();

  const query = useAsync(
    () =>
      window.api.members.list({
        search,
        status,
        onlyWithBalance,
        ...(minBalanceAgorot !== undefined ? { minBalanceAgorot } : {}),
        mobileStatus,
      }),
    [search, status, onlyWithBalance, minBalanceAgorot, mobileStatus],
  );

  const moduleState = useAsync(() => window.api.whatsapp.moduleState(), []);

  const rows = query.data?.rows ?? [];
  const k = query.data?.kpis;

  const kpis: readonly Kpi[] = useMemo(
    () =>
      k
        ? [
            { key: 'count', label: he.members.kpis.count, value: String(k.count) },
            {
              key: 'debt',
              label: he.members.kpis.totalDebt,
              value: formatAgorot(k.totalDebtAgorot),
              tone: k.totalDebtAgorot > 0 ? 'negative' : 'default',
              hint: `${k.withDebt} ${he.members.kpis.withDebt}`,
            },
            {
              key: 'avg',
              label: he.members.kpis.averageDebt,
              value: formatAgorot(k.averageDebtAgorot),
            },
            { key: 'max', label: he.members.kpis.maxDebt, value: formatAgorot(k.maxDebtAgorot) },
            {
              key: 'credit',
              label: he.members.kpis.totalCredit,
              value: formatAgorot(k.totalCreditAgorot),
              tone: k.totalCreditAgorot > 0 ? 'positive' : 'default',
            },
          ]
        : [],
    [k],
  );

  async function toggleStatus(m: MemberWithBalance) {
    setError(null);
    const next: MemberStatus = m.status === 'active' ? 'inactive' : 'active';
    try {
      if (next === 'inactive' && m.balanceAgorot !== 0) {
        if (!window.confirm(he.members.deactivateWithBalance)) return;
        await window.api.members.setStatus(m.id, next, { confirmedWithBalance: true });
      } else {
        await window.api.members.setStatus(m.id, next);
      }
      query.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const columns: ReadonlyArray<Column<MemberWithBalance>> = useMemo(
    () => [
      {
        id: 'memberNumber',
        label: he.members.number,
        width: 90,
        sortValue: (r) => r.memberNumber,
        render: (r) => r.memberNumber,
      },
      {
        id: 'name',
        label: he.members.firstName + ' ' + he.members.lastName,
        sortValue: (r) => `${r.lastName} ${r.firstName}`,
        render: (r) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <span>{memberFullName(r)}</span>
            {r.status === 'inactive' ? (
              <Chip size="small" label={he.members.inactive} variant="outlined" />
            ) : null}
          </Stack>
        ),
      },
      {
        id: 'mobile',
        label: he.members.mobile,
        width: 170,
        sortValue: (r) => r.mobile,
        render: (r) => <MobileCell member={r} />,
      },
      {
        id: 'balance',
        label: he.members.balance,
        width: 130,
        align: 'end',
        sortValue: (r) => r.balanceAgorot,
        render: (r) => (
          <Typography
            component="span"
            sx={{ color: balanceColor(r.balanceAgorot), fontWeight: 600 }}
          >
            {formatAgorot(r.balanceAgorot)}
          </Typography>
        ),
      },
      {
        id: 'lastPayment',
        label: he.members.lastPayment,
        width: 130,
        sortValue: (r) => r.lastPaymentDate,
        render: (r) => formatDate(r.lastPaymentDate) || '—',
      },
      {
        id: 'actions',
        label: he.app.actions,
        width: 150,
        notSortable: true,
        render: (r) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={he.members.openCard}>
              <IconButton aria-label={he.members.openCard} size="small" onClick={() => onOpenCard(r)}>
                <ArticleIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={he.members.edit}>
              <IconButton aria-label={he.members.edit}
                size="small"
                onClick={() => {
                  setEditing(r);
                  setDialogOpen(true);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={r.status === 'active' ? he.members.deactivate : he.members.activate}>
              <IconButton aria-label={r.status === 'active' ? he.members.deactivate : he.members.activate} size="small" onClick={() => void toggleStatus(r)}>
                {r.status === 'active' ? (
                  <BlockIcon fontSize="small" />
                ) : (
                  <CheckCircleOutlineIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOpenCard],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <Typography variant="h2">{he.members.title}</Typography>
        <Stack direction="row" spacing={1}>
          {/* W-20 – מושבת כשאין בחירה או כשהמודול כבוי. */}
          <Tooltip
            title={
              moduleState.data?.enabled === false
                ? he.whatsapp.disabled
                : selected.size === 0
                  ? he.whatsapp.send.noSelection
                  : ''
            }
          >
            <span>
              <Button
                startIcon={<WhatsAppIcon />}
                color="success"
                disabled={selected.size === 0 || moduleState.data?.enabled !== true}
                onClick={() => setWizardOpen(true)}
              >
                {selected.size === 0
                  ? he.whatsapp.send.button
                  : he.whatsapp.send.buttonWithCount(selected.size)}
              </Button>
            </span>
          </Tooltip>

          {/*
            W-88 – שליחה לכל החייבים בלחיצה אחת.

            מסמן את החייבים ופותח את אותו אשף בדיוק, ולא מסלול שליחה שני:
            הגבאי עדיין רואה את הרשימה, את מי שאין לו נייד, ואת התצוגה
            המקדימה לפני שנשלחת הודעה כלשהי.
          */}
          <Tooltip title={moduleState.data?.enabled === false ? he.whatsapp.disabled : ''}>
            <span>
              <Button
                startIcon={<WhatsAppIcon />}
                color="success"
                disabled={moduleState.data?.enabled !== true}
                onClick={() => void selectDebtors()}
              >
                {he.whatsapp.notify.debtors.button}
              </Button>
            </span>
          </Tooltip>

          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            {he.members.add}
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {query.error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {query.error}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="members"
        totalBeforeFilter={query.data?.total ?? 0}
        initialSort={{ columnId: 'memberNumber', direction: 'asc' }}
        onRowClick={onOpenCard}
        selection={{
          selectedKeys: selected,
          onChange: setSelected,
          // חבר בלי מספר תקין אינו נבחר – לא ב"בחר הכל" ולא ידנית
          // (החלטת הגבאי, 2026-09-06). הוא עדיין מוצג, עם הסיבה.
          isDisabled: (r) =>
            r.mobileStatus === 'valid'
              ? null
              : r.mobileStatus === 'missing'
                ? he.whatsapp.mobile.missing
                : he.whatsapp.mobile.invalid,
        }}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="members" />}
        filterBar={
          <FilterBar
            storageKey="members"
            active={
              search !== '' ||
              status !== 'active' ||
              onlyWithBalance ||
              minBalance !== '' ||
              mobileStatus !== 'all'
            }
            onClear={() => {
              setSearch('');
              setStatus('active');
              setOnlyWithBalance(false);
              setMinBalance('');
              setMobileStatus('all');
            }}
          >
            <TextField
              label={he.table.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 240 }}
            />
            <TextField
              select
              label={he.members.status}
              value={status}
              onChange={(e) => setStatus(e.target.value as MemberStatus | 'all')}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="active">{he.members.active}</MenuItem>
              <MenuItem value="inactive">{he.members.inactive}</MenuItem>
              <MenuItem value="all">{he.members.allStatuses}</MenuItem>
            </TextField>
            <TextField
              select
              label={he.members.balance}
              value={onlyWithBalance ? 'with' : 'all'}
              onChange={(e) => setOnlyWithBalance(e.target.value === 'with')}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">{he.members.allStatuses}</MenuItem>
              <MenuItem value="with">{he.members.onlyWithBalance}</MenuItem>
            </TextField>
            {/* W-21 – סינון מהיר לפני בחירה לשליחה */}
            <TextField
              label={he.members.minBalance}
              value={minBalance}
              onChange={(e) => setMinBalance(e.target.value)}
              inputMode="decimal"
              sx={{ minWidth: 160 }}
            />
            <TextField
              select
              label={he.whatsapp.mobile.column}
              value={mobileStatus}
              onChange={(e) => setMobileStatus(e.target.value as 'all' | 'valid' | 'not_valid')}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="all">{he.whatsapp.mobile.allMobile}</MenuItem>
              <MenuItem value="valid">{he.whatsapp.mobile.onlyValid}</MenuItem>
              <MenuItem value="not_valid">{he.whatsapp.mobile.onlyInvalid}</MenuItem>
            </TextField>
          </FilterBar>
        }
      />

      <SendWizardDialog
        open={wizardOpen}
        memberIds={[...selected].map(Number)}
        onClose={() => setWizardOpen(false)}
        onSaved={(msg) => {
          onNotify(msg);
          setSelected(new Set());
        }}
      />

      <MemberDialog
        open={dialogOpen}
        member={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={(m) => {
          query.reload();
          onNotify(`${memberFullName(m)} · ${he.members.number} ${m.memberNumber}`);
        }}
      />
    </Box>
  );
}

/**
 * W-20/W-23 – תא הנייד עם מצב התקינות.
 * המספר מוצג כפי שהוזן; האייקון והצבע אומרים אם אפשר לשלוח אליו, ו-tooltip
 * מסביר למה לא.
 */
function MobileCell({ member }: { member: MemberWithBalance }) {
  const reason =
    member.mobileReason !== null
      ? (he.whatsapp.mobile.reasons as Record<string, string>)[member.mobileReason]
      : undefined;

  if (member.mobileStatus === 'valid') {
    const title = reason ?? he.whatsapp.mobile.willSendTo(member.mobileE164 ?? '');
    return (
      <Tooltip title={title}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <CheckCircleOutlineIcon
            fontSize="small"
            color={reason ? 'warning' : 'success'}
            sx={{ fontSize: 16 }}
          />
          <span dir="ltr" style={{ display: 'inline-block' }}>
            {member.mobile ?? '—'}
          </span>
        </Stack>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={reason ?? he.whatsapp.mobile.missing}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'error.main' }}>
        <ErrorOutlineIcon fontSize="small" sx={{ fontSize: 16 }} />
        <span dir="ltr" style={{ display: 'inline-block' }}>
          {member.mobile ?? '—'}
        </span>
      </Stack>
    </Tooltip>
  );
}
