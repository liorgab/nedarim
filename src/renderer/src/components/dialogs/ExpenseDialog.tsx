import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { ExpenseDto } from '@shared/api';
import type { Lookup, PaymentMethod } from '@shared/types';
import { useAsync } from '../../hooks/useAsync';
import { parseShekelInput, shekelToAgorot, todayIso } from '../../lib/format';
import { he } from '../../i18n/he';

export interface ExpenseDialogProps {
  open: boolean;
  expense: ExpenseDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** F-61 – הזנת הוצאה, כולל צירוף סריקה של החשבונית. */
export function ExpenseDialog({ open, expense, onClose, onSaved }: ExpenseDialogProps) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [methodId, setMethodId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useAsync<Lookup[]>(() => window.api.lookups.expenseCategories(false), []);
  const methods = useAsync<PaymentMethod[]>(() => window.api.lookups.paymentMethods(false), []);
  const suppliers = useAsync<string[]>(() => window.api.expenses.suppliers(), [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAttachment(null);
    if (expense) {
      setDate(expense.expenseDate);
      setAmount(String(Math.abs(expense.amountAgorot) / 100));
      setIsRefund(expense.isRefund);
      setCategoryId(expense.categoryId);
      setDescription(expense.description);
      setSupplier(expense.supplier ?? '');
      setReference(expense.reference ?? '');
      setMethodId(expense.paymentMethodId ?? '');
      setNotes(expense.notes ?? '');
    } else {
      setDate(todayIso());
      setAmount('');
      setIsRefund(false);
      setDescription('');
      setSupplier('');
      setReference('');
      setNotes('');
    }
  }, [open, expense]);

  useEffect(() => {
    if (categoryId === '' && categories.data && categories.data.length > 0) {
      setCategoryId(categories.data[0]!.id);
    }
  }, [categories.data, categoryId]);

  async function pickFile() {
    const picked = await window.api.expenses.pickAttachment();
    if (picked) setAttachment(picked);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const value = parseShekelInput(amount);
      if (value === null || value === 0) throw new Error(he.validation.invalidAmount);
      if (categoryId === '') throw new Error(he.validation.fixErrors);

      const magnitude = shekelToAgorot(Math.abs(value));
      const input = {
        expenseDate: date,
        amountAgorot: isRefund ? -magnitude : magnitude,
        isRefund,
        categoryId,
        description: description.trim(),
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        paymentMethodId: methodId === '' ? null : methodId,
        notes: notes.trim() || null,
        attachmentSourcePath: attachment,
      };

      if (expense) await window.api.expenses.update(expense.id, input);
      else await window.api.expenses.create(input);

      onSaved(he.expenses.saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{expense ? he.expenses.edit : he.expenses.add}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Stack direction="row" spacing={2}>
            <TextField
              type="date"
              label={he.expenses.date}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 175 }}
            />
            <TextField
              label={he.expenses.amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 150 }}
            />
            <TextField
              select
              label={he.expenses.category}
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              sx={{ flex: 1 }}
            >
              {(categories.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <FormControlLabel
            control={
              <Checkbox checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
            }
            label={he.expenses.isRefund}
          />

          <TextField
            label={he.expenses.description}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            error={description.trim() === ''}
          />

          <Stack direction="row" spacing={2}>
            <Autocomplete
              freeSolo
              options={suppliers.data ?? []}
              value={supplier}
              onInputChange={(_, v) => setSupplier(v)}
              sx={{ flex: 1 }}
              renderInput={(params) => <TextField {...params} label={he.expenses.supplier} />}
            />
            <TextField
              label={he.expenses.reference}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              select
              label={he.expenses.method}
              value={methodId}
              onChange={(e) => setMethodId(e.target.value === '' ? '' : Number(e.target.value))}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">—</MenuItem>
              {(methods.data ?? []).map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
            <Button startIcon={<AttachFileIcon />} onClick={() => void pickFile()}>
              {he.expenses.attach}
            </Button>
            {attachment ? (
              <Typography
                variant="caption"
                color="text.secondary"
                dir="ltr"
                noWrap
                sx={{ flex: 1 }}
              >
                {attachment}
              </Typography>
            ) : expense?.attachmentPath ? (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                {he.expenses.attachment}: ✓
              </Typography>
            ) : null}
          </Stack>

          <TextField
            label={he.expenses.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            required={isRefund}
            helperText={isRefund ? he.expenses.refundNeedsNote : ' '}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || description.trim() === ''}
        >
          {busy ? he.app.saving : he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
