import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { MemberWithBalance } from '@shared/types';
import { MemberPicker } from '../MemberPicker';
import { OccasionPicker } from '../OccasionPicker';
import { VowItemPicker } from '../VowItemPicker';
import { useAsync } from '../../hooks/useAsync';
import { formatAgorot, parseShekelInput, shekelToAgorot, todayIso } from '../../lib/format';
import { he } from '../../i18n/he';
import type { NotifyRefDto, VowItemDto } from '@shared/api';

export interface VowDialogProps {
  open: boolean;
  mode: 'single' | 'bulk';
  /** חבר מוגדר מראש כשנפתח מהכרטיסייה (F-30). */
  member?: MemberWithBalance | null;
  onClose: () => void;
  /**
   * `notify` – הרשומה שנוצרה, כדי שהדף יוכל להציע הודעת וואטסאפ (W-86).
   * `null` בהזנה מרובה: הודעה לכל חבר בנפרד דורשת את מנוע הקמפיינים (W3).
   */
  onSaved: (message: string, notify: NotifyRefDto | null) => void;
}

interface BulkLine {
  key: number;
  member: MemberWithBalance | null;
  amount: string;
  note: string;
}

let lineKey = 0;
const newLine = (): BulkLine => ({ key: lineKey++, member: null, amount: '', note: '' });

/**
 * F-30..F-34 – הזנת נדר.
 * במצב `bulk` (F-33) התאריך והפרשה משותפים וכל השורות נשמרות בטרנזקציה אחת –
 * זה מחליף פתיחת טופס נפרד לכל נדר אחרי שבת.
 */
export function VowDialog({ open, mode, member, onClose, onSaved }: VowDialogProps) {
  const [date, setDate] = useState(todayIso());
  const [occasionId, setOccasionId] = useState<number | null>(null);
  const [selected, setSelected] = useState<MemberWithBalance | null>(member ?? null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [vowItem, setVowItem] = useState<VowItemDto | null>(null);
  const [lines, setLines] = useState<BulkLine[]>([newLine(), newLine(), newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hebrew = useAsync(
    () =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) ? window.api.calendar.forDate(date) : Promise.resolve(null),
    [date],
  );

  // ברירת מחדל: הפרשה של השבת האחרונה לפי התאריך (F-31)
  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    void window.api.calendar.defaultOccasionForDate(date).then((res) => {
      if (!cancelled && res.occasionId !== null) setOccasionId(res.occasionId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, date]);

  useEffect(() => {
    if (open) {
      setSelected(member ?? null);
      setAmount('');
      setNote('');
      setVowItem(null);
      setLines([newLine(), newLine(), newLine()]);
      setError(null);
    }
  }, [open, member]);

  const bulkTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const v = parseShekelInput(l.amount);
        return sum + (v === null || !l.member ? 0 : shekelToAgorot(v));
      }, 0),
    [lines],
  );

  const filledLines = lines.filter((l) => l.member !== null && parseShekelInput(l.amount) !== null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (occasionId === null) throw new Error(`${he.card.occasion}: ${he.validation.required}`);
      if (mode === 'single') {
        if (!selected) throw new Error(`${he.vow.member}: ${he.validation.required}`);
        const value = parseShekelInput(amount);
        if (value === null || value <= 0) throw new Error(he.validation.invalidAmount);
        const vowId = await window.api.vows.create({
          memberId: selected.id,
          chargeDate: date,
          occasionId,
          occasionNote: note.trim() || null,
          amountAgorot: shekelToAgorot(value),
          vowItemId: vowItem?.id ?? null,
        });
        const updated = await window.api.members.get(selected.id);
        onSaved(he.vow.saved(formatAgorot(updated?.balanceAgorot ?? 0)), {
          kind: 'vow',
          refId: vowId,
        });
      } else {
        if (filledLines.length === 0) throw new Error(he.validation.fixErrors);
        const res = await window.api.vows.createBulk({
          chargeDate: date,
          occasionId,
          lines: filledLines.map((l) => ({
            memberId: l.member!.id,
            amountAgorot: shekelToAgorot(parseShekelInput(l.amount)!),
            occasionNote: l.note.trim() || null,
          })),
        });
        onSaved(he.vow.bulkSaved(res.ids.length, formatAgorot(res.totalAgorot)), null);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth={mode === 'bulk' ? 'md' : 'sm'}
      fullWidth
    >
      <DialogTitle>{mode === 'bulk' ? he.vow.bulkTitle : he.vow.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              type="date"
              label={he.vow.date}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={hebrew.data?.hebrew ?? ' '}
              sx={{ minWidth: 190 }}
            />
            <Box sx={{ flex: 1 }}>
              <OccasionPicker value={occasionId} onChange={setOccasionId} />
            </Box>
          </Stack>

          {mode === 'single' ? (
            <>
              <MemberPicker
                value={selected}
                onChange={setSelected}
                label={he.vow.member}
                autoFocus={!member}
                disabled={Boolean(member)}
              />
              {selected ? (
                <Typography variant="caption" color="text.secondary">
                  {he.payment.currentBalance}: {formatAgorot(selected.balanceAgorot)}
                </Typography>
              ) : null}
              {/*
                F-142 – בחירת הכיבוד מהרשימה. הבחירה ממלאת את הפירוט, אבל
                אינה נועלת אותו: יש כיבודים שנמכרים עם תוספת ("עליית שלישי
                – לרפואת..."), והקלדה חופשית חייבת להישאר אפשרית.
              */}
              <VowItemPicker
                occasionId={occasionId}
                value={vowItem}
                onChange={(item) => {
                  setVowItem(item);
                  if (item !== null) setNote(item.name);
                }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label={he.vow.amount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus={Boolean(member)}
                  sx={{ width: 180 }}
                  inputMode="decimal"
                />
                <TextField
                  label={he.vow.occasionNote}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  sx={{ flex: 1 }}
                />
              </Stack>
            </>
          ) : (
            <>
              <Alert severity="info">{he.vow.bulkHint}</Alert>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '42%' }}>{he.vow.member}</TableCell>
                    <TableCell sx={{ width: 150 }}>{he.vow.amount}</TableCell>
                    <TableCell>{he.vow.occasionNote}</TableCell>
                    <TableCell sx={{ width: 48 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={line.key}>
                      <TableCell>
                        <MemberPicker
                          value={line.member}
                          onChange={(m) =>
                            setLines((ls) =>
                              ls.map((l, i) => (i === idx ? { ...l, member: m } : l)),
                            )
                          }
                          label=""
                          excludeIds={lines
                            .filter((_, i) => i !== idx)
                            .map((l) => l.member?.id)
                            .filter((x): x is number => x !== undefined)}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          value={line.amount}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) => (i === idx ? { ...l, amount: e.target.value } : l)),
                            )
                          }
                          inputMode="decimal"
                          fullWidth
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          value={line.note}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) => (i === idx ? { ...l, note: e.target.value } : l)),
                            )
                          }
                          fullWidth
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip title={he.vow.removeLine}>
                          <span>
                            <IconButton aria-label={he.vow.removeLine}
                              size="small"
                              disabled={lines.length === 1}
                              onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button
                  startIcon={<AddIcon />}
                  onClick={() => setLines((ls) => [...ls, newLine()])}
                >
                  {he.vow.addLine}
                </Button>
                <Typography variant="h3">
                  {he.vow.total}: {formatAgorot(bulkTotal)} ({filledLines.length})
                </Typography>
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy}>
          {busy ? he.app.saving : he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
