import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';
import type { VowItemDto, VowItemScopeDto } from '@shared/api';
import type { Occasion } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { useAsync } from '../hooks/useAsync';
import { he } from '../i18n/he';

/**
 * F-140..F-143 – מסך רשימת הנדרים למכירה.
 *
 * זה הקטלוג של פנקס הגבאי: מה נמכר, מתי הוא נמכר, ולאיזה מועד הוא שייך.
 * הסינון לפי מועד הוא מה שהופך את הרשימה לשימושית בזמן אמת, ולכן הוא
 * בסרגל ולא מוסתר (כללים 14–15).
 */

export interface VowItemsTabProps {
  onNotify: (message: string) => void;
}

const SCOPE_LABEL: Record<VowItemScopeDto, string> = {
  shabbat: he.vowItems.scopes.shabbat,
  occasion: he.vowItems.scopes.occasion,
  always: he.vowItems.scopes.always,
};

const emptyDraft = (): VowItemDraft => ({
  id: null,
  name: '',
  category: '',
  duration: '',
  saleTiming: '',
  performanceTiming: '',
  scope: 'always',
  notes: '',
  isActive: true,
  occasionIds: [],
});

interface VowItemDraft {
  id: number | null;
  name: string;
  category: string;
  duration: string;
  saleTiming: string;
  performanceTiming: string;
  scope: VowItemScopeDto;
  notes: string;
  isActive: boolean;
  occasionIds: number[];
}

export function VowItemsTab({ onNotify }: VowItemsTabProps) {
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [occasionId, setOccasionId] = useState<number | ''>('');
  /** סינון רשימת המועדים עצמה: 54 פרשות מקשות למצוא חג. */
  const [occasionKind, setOccasionKind] = useState<'all' | 'parasha' | 'holiday' | 'event'>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [draft, setDraft] = useState<VowItemDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VowItemDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useAsync(
    () =>
      window.api.vowItems.list({
        search: search.trim() === '' ? undefined : search.trim(),
        category: category === '' ? undefined : category,
        occasionId: occasionId === '' ? undefined : occasionId,
        includeInactive,
      }),
    [search, category, occasionId, includeInactive, reload],
  );
  const categories = useAsync(() => window.api.vowItems.categories(), [reload]);
  const occasions = useAsync(() => window.api.lookups.occasions(), []);

  const rows = items.data ?? [];

  const filtered =
    search !== '' || category !== '' || occasionId !== '' || occasionKind !== 'all' || includeInactive;

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setOccasionId('');
    setOccasionKind('all');
    setIncludeInactive(false);
  };

  async function run(fn: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await fn();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const save = (d: VowItemDraft) =>
    void run(async () => {
      const input = {
        name: d.name,
        category: d.category || null,
        duration: d.duration || null,
        saleTiming: d.saleTiming || null,
        performanceTiming: d.performanceTiming || null,
        scope: d.scope,
        notes: d.notes || null,
        isActive: d.isActive,
        occasionIds: d.scope === 'occasion' ? d.occasionIds : [],
      };
      if (d.id === null) {
        await window.api.vowItems.create(input);
        onNotify(he.vowItems.created(d.name));
      } else {
        await window.api.vowItems.update(d.id, input);
        onNotify(he.vowItems.updated(d.name));
      }
      setDraft(null);
    });

  /**
   * F-143 – שכפול כיבוד.
   *
   * שבעת ההקפות נבדלות זו מזו במילה אחת, וכך גם עליות החג בין יום א'
   * ליום ב'. הקלדת כל השדות מחדש בשביל שינוי אחד היא בדיוק מה שגורם
   * לגבאי לוותר ולהשאיר את הרשימה חלקית.
   */
  const duplicate = (item: VowItemDto) =>
    void run(async () => {
      const name = he.vowItems.copySuffix(item.name);
      await window.api.vowItems.create({
        name,
        category: item.category,
        duration: item.duration,
        saleTiming: item.saleTiming,
        performanceTiming: item.performanceTiming,
        scope: item.scope,
        notes: item.notes,
        isActive: item.isActive,
        occasionIds: item.occasionIds,
      });
      onNotify(he.vowItems.duplicated(name));
    });

  const remove = (item: VowItemDto) =>
    void run(async () => {
      const result = await window.api.vowItems.remove(item.id);
      onNotify(
        result.deleted ? he.vowItems.deleted(item.name) : he.vowItems.deactivated(result.usedBy),
      );
      setConfirmDelete(null);
    });

  // בלי `useMemo`: הגדרות העמודות סוגרות על `duplicate` ועל `remove`,
  // ושמירתן בין רינדורים הייתה מקפיאה גרסה ישנה שלהן. 103 שורות אינן
  // סיבה לסכן פעולה שפועלת על נתון מיושן.
  const columns: Array<Column<VowItemDto>> = [
      {
        id: 'name',
        label: he.vowItems.name,
        sortValue: (r) => r.name,
        render: (r) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ opacity: r.isActive ? 1 : 0.5 }}>
              {r.name}
            </Typography>
            {r.isActive ? null : <Chip size="small" label={he.vowItems.inactive} />}
          </Stack>
        ),
      },
      {
        id: 'category',
        label: he.vowItems.category,
        sortValue: (r) => r.category ?? '',
        render: (r) => r.category ?? '—',
      },
      {
        id: 'saleTiming',
        label: he.vowItems.saleTiming,
        sortValue: (r) => r.saleTiming ?? '',
        render: (r) => r.saleTiming ?? '—',
      },
      {
        id: 'scope',
        label: he.vowItems.scope,
        sortValue: (r) => r.scope,
        render: (r) => (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={SCOPE_LABEL[r.scope]} />
            {r.occasionNames.map((name) => (
              <Chip key={name} size="small" color="primary" variant="outlined" label={name} />
            ))}
          </Stack>
        ),
      },
      {
        id: 'duration',
        label: he.vowItems.duration,
        sortValue: (r) => r.duration ?? '',
        render: (r) => r.duration ?? '—',
      },
      {
        id: 'actions',
        label: '',
        width: 150,
        render: (r) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={he.vowItems.edit}>
              <IconButton
                size="small"
                aria-label={he.vowItems.edit}
                onClick={() =>
                  setDraft({
                    id: r.id,
                    name: r.name,
                    category: r.category ?? '',
                    duration: r.duration ?? '',
                    saleTiming: r.saleTiming ?? '',
                    performanceTiming: r.performanceTiming ?? '',
                    scope: r.scope,
                    notes: r.notes ?? '',
                    isActive: r.isActive,
                    occasionIds: r.occasionIds,
                  })
                }
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={he.vowItems.duplicate}>
              <IconButton
                size="small"
                aria-label={he.vowItems.duplicate}
                onClick={() => duplicate(r)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={he.vowItems.remove}>
              <IconButton
                size="small"
                color="error"
                aria-label={he.vowItems.remove}
                onClick={() => setConfirmDelete(r)}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.vowItems.intro}
      </Typography>

      {error !== null ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField
            size="small"
            label={he.vowItems.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
          />
          <TextField
            select
            size="small"
            label={he.vowItems.category}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">{he.vowItems.all}</MenuItem>
            {(categories.data ?? []).map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={he.vowItems.occasionKind}
            value={occasionKind}
            onChange={(e) => {
              setOccasionKind(e.target.value as typeof occasionKind);
              // המועד שנבחר עשוי לא להיות ברשימה החדשה, ובחירה שאי אפשר
              // לראות היא בדיוק סינון שנראה שבור.
              setOccasionId('');
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="all">{he.vowItems.occasionKinds.all}</MenuItem>
            <MenuItem value="holiday">{he.vowItems.occasionKinds.holiday}</MenuItem>
            <MenuItem value="parasha">{he.vowItems.occasionKinds.parasha}</MenuItem>
            <MenuItem value="event">{he.vowItems.occasionKinds.event}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={he.vowItems.filterByOccasion}
            value={occasionId === '' ? '' : String(occasionId)}
            onChange={(e) => setOccasionId(e.target.value === '' ? '' : Number(e.target.value))}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{he.vowItems.all}</MenuItem>
            {(occasions.data ?? [])
              .filter((o: Occasion) => occasionKind === 'all' || o.type === occasionKind)
              .map((o: Occasion) => (
                <MenuItem key={o.id} value={String(o.id)}>
                  {o.name}
                </MenuItem>
              ))}
          </TextField>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
            }
            label={he.vowItems.showInactive}
          />
          <Tooltip title={he.vowItems.clearFilter}>
            <span>
              <IconButton
                aria-label={he.vowItems.clearFilter}
                size="small"
                disabled={!filtered}
                onClick={clearFilters}
              >
                <FilterAltOffIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDraft(emptyDraft())}>
            {he.vowItems.add}
          </Button>
        </Stack>
      </Paper>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        storageKey="vow-items"
        emptyMessage={he.vowItems.empty}
        fillHeight={false}
        footer={
          <Typography variant="caption" color="text.secondary">
            {he.vowItems.count(rows.length)}
          </Typography>
        }
      />

      <VowItemDialog
        draft={draft}
        occasions={occasions.data ?? []}
        onClose={() => setDraft(null)}
        onSave={save}
        onDuplicate={(d) =>
          void run(async () => {
            // משכפלים את מה שמוצג בדיאלוג, כולל שינויים שטרם נשמרו:
            // הגבאי פתח כיבוד, שינה מילה, ורוצה שהעותק ייקח את השינוי.
            const name = he.vowItems.copySuffix(d.name);
            await window.api.vowItems.create({
              name,
              category: d.category || null,
              duration: d.duration || null,
              saleTiming: d.saleTiming || null,
              performanceTiming: d.performanceTiming || null,
              scope: d.scope,
              notes: d.notes || null,
              isActive: d.isActive,
              occasionIds: d.scope === 'occasion' ? d.occasionIds : [],
            });
            onNotify(he.vowItems.duplicated(name));
            setDraft(null);
          })
        }
      />

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>{he.vowItems.deleteTitle}</DialogTitle>
        <DialogContent>
          <Typography>{he.vowItems.deleteWarning(confirmDelete?.name ?? '')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>{he.app.cancel}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => confirmDelete !== null && remove(confirmDelete)}
          >
            {he.vowItems.remove}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function VowItemDialog({
  draft,
  occasions,
  onClose,
  onSave,
  onDuplicate,
}: {
  draft: VowItemDraft | null;
  occasions: Occasion[];
  onClose: () => void;
  onSave: (draft: VowItemDraft) => void;
  onDuplicate: (draft: VowItemDraft) => void;
}) {
  const [local, setLocal] = useState<VowItemDraft>(emptyDraft());
  const [key, setKey] = useState<number | null | undefined>(undefined);

  // סנכרון מהפרופס בלי `useEffect`: הדיאלוג נפתח עם טיוטה חדשה, ומיד
  // אחר כך העריכה היא מקומית בלבד.
  if (draft !== null && key !== draft.id) {
    setKey(draft.id);
    setLocal(draft);
  }

  const set = <K extends keyof VowItemDraft>(field: K, value: VowItemDraft[K]) =>
    setLocal((d) => ({ ...d, [field]: value }));

  return (
    <Dialog open={draft !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{local.id === null ? he.vowItems.add : he.vowItems.edit}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={he.vowItems.name}
            value={local.name}
            onChange={(e) => set('name', e.target.value)}
            required
            autoFocus
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={he.vowItems.category}
              value={local.category}
              onChange={(e) => set('category', e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label={he.vowItems.duration}
              value={local.duration}
              onChange={(e) => set('duration', e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label={he.vowItems.saleTiming}
            helperText={he.vowItems.saleTimingHelp}
            value={local.saleTiming}
            onChange={(e) => set('saleTiming', e.target.value)}
            fullWidth
          />
          <TextField
            label={he.vowItems.performanceTiming}
            value={local.performanceTiming}
            onChange={(e) => set('performanceTiming', e.target.value)}
            fullWidth
          />

          <TextField
            select
            label={he.vowItems.scope}
            value={local.scope}
            onChange={(e) => set('scope', e.target.value as VowItemScopeDto)}
            helperText={he.vowItems.scopeHelp}
            fullWidth
          >
            {(['shabbat', 'occasion', 'always'] as const).map((s) => (
              <MenuItem key={s} value={s}>
                {SCOPE_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>

          {local.scope === 'occasion' ? (
            <TextField
              select
              label={he.vowItems.occasions}
              value={local.occasionIds.map(String)}
              onChange={(e) =>
                set(
                  'occasionIds',
                  (typeof e.target.value === 'string'
                    ? e.target.value.split(',')
                    : (e.target.value as unknown as string[])
                  )
                    .filter((v) => v !== '')
                    .map(Number),
                )
              }
              slotProps={{ select: { multiple: true } }}
              fullWidth
            >
              {occasions.map((o) => (
                <MenuItem key={o.id} value={String(o.id)}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}

          <TextField
            label={he.vowItems.notes}
            value={local.notes}
            onChange={(e) => set('notes', e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch checked={local.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            }
            label={he.vowItems.active}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{he.app.cancel}</Button>
        <Box sx={{ flex: 1 }} />
        {/*
          שכפול קיים רק בעריכה: על כיבוד חדש שטרם נשמר אין מה לשכפל.
          שבעת ההקפות נבדלות במילה אחת, וכך גם עליות יום א' ויום ב' של חג.
        */}
        {local.id === null ? null : (
          <Button
            startIcon={<ContentCopyIcon />}
            onClick={() => onDuplicate(local)}
            disabled={local.name.trim() === ''}
          >
            {he.vowItems.duplicate}
          </Button>
        )}
        <Button variant="contained" onClick={() => onSave(local)} disabled={local.name.trim() === ''}>
          {he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
