import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { MemberWithBalance } from '@shared/types';
import { OccasionPicker } from '../OccasionPicker';
import { MemberPicker } from '../MemberPicker';
import { useAsync } from '../../hooks/useAsync';
import { formatAgorot, parseShekelInput, shekelToAgorot, todayIso } from '../../lib/format';
import { he } from '../../i18n/he';
import type { NotifyRefDto } from '@shared/api';

export interface CreditDialogProps {
  open: boolean;
  member?: MemberWithBalance | null;
  onClose: () => void;
  onSaved: (message: string, notify: NotifyRefDto | null) => void;
}

/**
 * F-35 – זיכוי/תיקון. הערה היא שדה חובה, וזיכוי מעל הסף שבהגדרות
 * נחסם בשירות ה-main אם למשתמש אין הרשאת מנהל.
 */
export function CreditDialog({ open, member, onClose, onSaved }: CreditDialogProps) {
  const [selected, setSelected] = useState<MemberWithBalance | null>(member ?? null);
  const [date, setDate] = useState(todayIso());
  const [occasionId, setOccasionId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reasons = useAsync(() => window.api.vows.creditReasons(), []);
  const threshold = useAsync(
    () => window.api.settings.get('credit_approval_threshold_agorot'),
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(member ?? null);
    setDate(todayIso());
    setAmount('');
    setNote('');
    setError(null);
    if (reasons.data && reasons.data.length > 0) setReason(reasons.data[0]!);
  }, [open, member, reasons.data]);

  // ברירת מחדל: ה-occasion מסוג 'credit' שתואם לסיבה שנבחרה
  const occasions = useAsync(() => window.api.lookups.occasions(false), []);
  useEffect(() => {
    if (occasionId !== null || !occasions.data) return;
    const match = occasions.data.find((o) => o.type === 'credit');
    if (match) setOccasionId(match.id);
  }, [occasions.data, occasionId]);

  const thresholdAgorot = Number(threshold.data ?? '50000');

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (!selected) throw new Error(`${he.vow.member}: ${he.validation.required}`);
      if (occasionId === null) throw new Error(`${he.card.occasion}: ${he.validation.required}`);
      if (note.trim() === '') throw new Error(`${he.credit.note}: ${he.validation.required}`);
      const value = parseShekelInput(amount);
      if (value === null || value <= 0) throw new Error(he.validation.invalidAmount);

      const creditId = await window.api.vows.createCredit({
        memberId: selected.id,
        chargeDate: date,
        occasionId,
        amountAgorot: shekelToAgorot(value),
        creditReason: reason,
        note: note.trim(),
      });
      onSaved(he.credit.saved, { kind: 'credit', refId: creditId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const value = parseShekelInput(amount);
  const aboveThreshold = value !== null && shekelToAgorot(value) > thresholdAgorot;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{he.credit.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {aboveThreshold ? (
            <Alert severity="warning">
              זיכוי מעל {formatAgorot(thresholdAgorot)} מחייב הרשאת מנהל
            </Alert>
          ) : null}

          <MemberPicker
            value={selected}
            onChange={setSelected}
            label={he.vow.member}
            disabled={Boolean(member)}
          />
          {selected ? (
            <Typography variant="caption" color="text.secondary">
              {he.payment.currentBalance}: {formatAgorot(selected.balanceAgorot)}
            </Typography>
          ) : null}

          <Stack direction="row" spacing={2}>
            <TextField
              type="date"
              label={he.credit.date}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label={he.credit.amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 160 }}
            />
            <TextField
              select
              label={he.credit.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              sx={{ flex: 1 }}
            >
              {(reasons.data ?? []).map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <OccasionPicker value={occasionId} onChange={setOccasionId} />

          <TextField
            label={he.credit.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            multiline
            minRows={2}
          />
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
