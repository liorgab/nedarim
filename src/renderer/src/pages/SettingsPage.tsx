import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import type {
  ConfigurationDto,
  LookupRowDto,
  LookupTableDto,
  SessionDto,
  SettingSpecDto,
} from '@shared/api';
import { BackupTab } from './BackupTab';
import { DataTab } from './DataTab';
import { VowItemsTab } from './VowItemsTab';
import { UsersTab } from './UsersTab';
import { useAsync } from '../hooks/useAsync';
import { he } from '../i18n/he';
import { NotifySettingsPanel } from '../components/whatsapp/NotifySettingsPanel';
import { SettingField } from '../components/SettingField';
import { AboutTab } from './AboutTab';

export interface SettingsPageProps {
  onNotify: (message: string) => void;
  onChanged: () => void;
  session: SessionDto;
  /** לשונית פתיחה, מתוך ה-hash (`#/settings/backup`). */
  initialTab?: string;
}

const GROUP_ORDER: ReadonlyArray<{ id: SettingSpecDto['group']; label: string }> = [
  { id: 'synagogue', label: he.settings.groups.synagogue },
  { id: 'receipt', label: he.settings.groups.receipt },
  { id: 'finance', label: he.settings.groups.finance },
  { id: 'system', label: he.settings.groups.system },
  { id: 'whatsapp', label: he.settings.groups.whatsapp },
];

const LOOKUP_TABS: ReadonlyArray<{ id: LookupTableDto; label: string }> = [
  { id: 'occasion', label: he.lookups.occasions },
  { id: 'payment_method', label: he.lookups.paymentMethods },
  { id: 'donation_type', label: he.lookups.donationTypes },
  { id: 'expense_category', label: he.lookups.expenseCategories },
];


/**
 * F-90..F-92 – מסך ההגדרות.
 *
 * זהו המסך שבו כל גבאי שמתקין את המערכת מגדיר אותה לבית הכנסת שלו.
 * השדות נבנים מתוך `specs` שמגיע מה-main, ולא מקוד קשיח כאן – הוספת הגדרה
 * חדשה בשרת מופיעה במסך מאליה (CLAUDE.md כלל 12).
 */
type SettingsTab =
  | 'settings'
  | 'counters'
  | 'lookups'
  | 'vowItems'
  | 'users'
  | 'backup'
  | 'data'
  | 'about';

const SETTINGS_TABS: readonly SettingsTab[] = [
  'settings',
  'counters',
  'lookups',
  'vowItems',
  'users',
  'backup',
  'data',
];

export function SettingsPage({ onNotify, onChanged, session, initialTab }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>(() =>
    SETTINGS_TABS.includes(initialTab as SettingsTab) ? (initialTab as SettingsTab) : 'settings',
  );
  const config = useAsync<ConfigurationDto>(() => window.api.configuration.get(), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config.data) setDraft({ ...config.data.settings });
  }, [config.data]);

  const dirty = useMemo(() => {
    if (!config.data) return false;
    return Object.entries(draft).some(([k, v]) => (config.data!.settings[k] ?? '') !== v);
  }, [draft, config.data]);

  async function save() {
    if (!config.data) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, string> = {};
      for (const spec of config.data.specs) {
        const value = draft[spec.key] ?? '';
        if ((config.data.settings[spec.key] ?? '') !== value) patch[spec.key] = value;
      }
      await window.api.configuration.save(patch);
      config.reload();
      onChanged();
      onNotify(he.settings.saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const renderField = (spec: SettingSpecDto) => (
    <SettingField
      key={spec.key}
      spec={spec}
      value={draft[spec.key] ?? ''}
      onChange={(v) => set(spec.key, v)}
    />
  );


  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <Typography variant="h2">{he.settings.title}</Typography>
        {tab === 'settings' ? (
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void save()}
            disabled={busy || !dirty}
          >
            {busy ? he.app.saving : he.app.save}
          </Button>
        ) : null}
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {config.data?.isFirstRun ? (
        <Alert severity="info" sx={{ mb: 2, flex: 'none' }}>
          {he.settings.firstRunHint}
        </Alert>
      ) : null}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, flex: 'none' }}>
        <Tab value="settings" label={he.settings.tabs.settings} />
        <Tab value="counters" label={he.settings.tabs.counters} />
        <Tab value="lookups" label={he.settings.tabs.lookups} />
        <Tab value="vowItems" label={he.vowItems.tab} />
        <Tab value="users" label={he.auth.users} />
        <Tab value="backup" label={he.backup.title} />
        <Tab value="data" label={he.settings.tabs.data} />
        <Tab value="about" label={he.about.tab} />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pb: 2 }}>
        {tab === 'settings' && config.data
          ? GROUP_ORDER.map((group) => {
              const specs = config.data!.specs.filter((s) => s.group === group.id);
              // קבוצת הוואטסאפ מציגה גם את הודעות האירוע, שאינן שדות
              // רגילים אלא מצב לכל אירוע כספי (W-82).
              const isWhatsApp = group.id === 'whatsapp';
              if (specs.length === 0 && !isWhatsApp) return null;
              return (
                <Box key={group.id}>
                  {specs.length > 0 ? (
                    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                      <Typography variant="h3" sx={{ mb: 2 }}>
                        {group.label}
                      </Typography>
                      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                        {specs.map(renderField)}
                      </Stack>
                    </Paper>
                  ) : null}
                  {isWhatsApp ? <NotifySettingsPanel onNotify={onNotify} /> : null}
                </Box>
              );
            })
          : null}

        {tab === 'counters' && config.data ? (
          <CountersTab
            config={config.data}
            onNotify={onNotify}
            onChanged={() => {
              config.reload();
              onChanged();
            }}
          />
        ) : null}

        {tab === 'lookups' ? <LookupsTab onNotify={onNotify} /> : null}

        {tab === 'vowItems' ? <VowItemsTab onNotify={onNotify} /> : null}

        {tab === 'users' ? <UsersTab session={session} onNotify={onNotify} /> : null}

        {tab === 'backup' ? <BackupTab onNotify={onNotify} /> : null}

        {tab === 'data' ? (
          <DataTab
            onNotify={onNotify}
            onChanged={() => {
              config.reload();
              onChanged();
            }}
          />
        ) : null}

        {tab === 'about' ? <AboutTab onNotify={onNotify} /> : null}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------- מונים

function CountersTab({
  config,
  onNotify,
  onChanged,
}: {
  config: ConfigurationDto;
  onNotify: (m: string) => void;
  onChanged: () => void;
}) {
  const [next, setNext] = useState(String(config.counters.nextReceiptNumber));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const min = config.counters.maxIssuedReceiptNumber + 1;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await window.api.configuration.setReceiptStartNumber(Number(next));
      onChanged();
      onNotify(he.settings.counters.saved(Number(next)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {he.settings.counters.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {he.settings.counters.explanation}
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: 3 }}>
        <TextField
          label={he.settings.counters.nextReceipt}
          value={next}
          onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          sx={{ width: 200 }}
          helperText={
            config.counters.maxIssuedReceiptNumber > 0
              ? he.settings.counters.minAllowed(min)
              : he.settings.counters.noneIssued
          }
        />
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={() => void save()}
          disabled={busy || next === '' || Number(next) === config.counters.nextReceiptNumber}
          sx={{ mt: 0.5 }}
        >
          {he.app.save}
        </Button>
      </Stack>

      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {he.settings.counters.others}
      </Typography>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
        <Chip label={`${he.settings.counters.member}: ${config.counters.nextMemberNumber}`} />
        <Chip label={`${he.settings.counters.donation}: ${config.counters.nextDonationNumber}`} />
        <Chip label={`${he.settings.counters.expense}: ${config.counters.nextExpenseNumber}`} />
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------- רשימות

function LookupsTab({ onNotify }: { onNotify: (m: string) => void }) {
  const [table, setTable] = useState<LookupTableDto>('occasion');
  const [rows, setRows] = useState<LookupRowDto[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useAsync(() => window.api.configuration.listLookup(table), [table]);
  useEffect(() => {
    if (query.data) setRows(query.data);
  }, [query.data]);

  const run = async (fn: () => Promise<LookupRowDto[]>, message: string) => {
    setError(null);
    try {
      setRows(await fn());
      onNotify(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Tabs
        value={table}
        onChange={(_, v: LookupTableDto) => setTable(v)}
        variant="scrollable"
        sx={{ mb: 2 }}
      >
        {LOOKUP_TABS.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          label={he.settings.lookups.newValue}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          disabled={newName.trim() === ''}
          onClick={() =>
            void run(
              () => window.api.configuration.addLookup(table, newName.trim()),
              he.settings.lookups.added(newName.trim()),
            ).then(() => setNewName(''))
          }
          sx={{ mt: 0.5 }}
        >
          {he.settings.lookups.add}
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        {he.settings.lookups.noDeleteHint}
      </Alert>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{he.settings.lookups.name}</TableCell>
            <TableCell sx={{ width: 120 }}>{he.settings.lookups.usage}</TableCell>
            <TableCell sx={{ width: 120 }}>{he.members.status}</TableCell>
            <TableCell sx={{ width: 110 }}>{he.app.actions}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{row.name}</span>
                  {row.type ? <Chip size="small" variant="outlined" label={row.type} /> : null}
                </Stack>
              </TableCell>
              <TableCell>{row.usageCount}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  color={row.isActive ? 'default' : 'warning'}
                  variant="outlined"
                  label={row.isActive ? he.members.active : he.members.inactive}
                />
              </TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title={he.settings.lookups.rename}>
                    <IconButton aria-label={he.settings.lookups.rename}
                      size="small"
                      onClick={() => {
                        const name = window.prompt(he.settings.lookups.rename, row.name);
                        if (name && name.trim() !== '' && name !== row.name) {
                          void run(
                            () => window.api.configuration.renameLookup(table, row.id, name.trim()),
                            he.settings.lookups.renamed,
                          );
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={row.isActive ? he.members.deactivate : he.members.activate}>
                    <IconButton aria-label={row.isActive ? he.members.deactivate : he.members.activate}
                      size="small"
                      onClick={() =>
                        void run(
                          () =>
                            window.api.configuration.setLookupActive(table, row.id, !row.isActive),
                          row.isActive
                            ? he.settings.lookups.deactivated
                            : he.settings.lookups.activated,
                        )
                      }
                    >
                      {row.isActive ? (
                        <BlockIcon fontSize="small" />
                      ) : (
                        <CheckCircleOutlineIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {he.settings.lookups.count(rows.length)}
      </Typography>
    </Paper>
  );
}
