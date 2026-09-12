import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { LedgerRow, MemberWithBalance, PaymentMethod } from '@shared/types';
import type { ValidationIssueDto,
  NotifyRefDto,
} from '@shared/api';
import { MemberPicker } from '../MemberPicker';
import { useAsync } from '../../hooks/useAsync';
import {
  formatAgorot,
  formatDate,
  parseShekelInput,
  shekelToAgorot,
  todayIso,
} from '../../lib/format';
import { he } from '../../i18n/he';

export interface PaymentDialogProps {
  open: boolean;
  member?: MemberWithBalance | null;
  onClose: () => void;
  onSaved: (message: string, receiptId: number | null, notify: NotifyRefDto | null) => void;
}

/**
 * F-40..F-43 – קבלת תשלום. שני כפתורי שמירה: עם קבלה (ברירת מחדל) ובלי.
 * זה מקצר את הזרימה הישנה של שלושה מסכים לפעולה אחת.
 */
export function PaymentDialog({ open, member, onClose, onSaved }: PaymentDialogProps) {
  const [selected, setSelected] = useState<MemberWithBalance | null>(member ?? null);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState<number | ''>('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState<ValidationIssueDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const methods = useAsync<PaymentMethod[]>(() => window.api.lookups.paymentMethods(false), []);
  const nextNumber = useAsync(() => window.api.receipts.nextNumber(), [open]);
  const recent = useAsync<LedgerRow[]>(
    () => (selected ? window.api.ledger.recentCharges(selected.id, 5) : Promise.resolve([])),
    [selected?.id],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(member ?? null);
    setDate(todayIso());
    setAmount(member && member.balanceAgorot > 0 ? String(member.balanceAgorot / 100) : '');
    setReference('');
    setNotes('');
    setIssues([]);
    setError(null);
  }, [open, member]);

  useEffect(() => {
    if (methodId === '' && methods.data && methods.data.length > 0)
      setMethodId(methods.data[0]!.id);
  }, [methods.data, methodId]);

  // אימות חי מול ה-main (מקור אמת אחד לכללים, SPEC 6.2)
  useEffect(() => {
    const value = parseShekelInput(amount);
    if (!selected || value === null || methodId === '') {
      setIssues([]);
      return;
    }
    let cancelled = false;
    void window.api.payments
      .validate({
        memberId: selected.id,
        paymentDate: date,
        amountAgorot: shekelToAgorot(value),
        paymentMethodId: methodId,
        reference: reference || null,
      })
      .then((res) => {
        if (!cancelled) setIssues(res);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, date, amount, methodId, reference]);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const selectedMethod = methods.data?.find((m) => m.id === methodId);

  async function submit(withReceipt: boolean) {
    setError(null);
    setBusy(true);
    try {
      if (!selected) throw new Error(`${he.vow.member}: ${he.validation.required}`);
      const value = parseShekelInput(amount);
      if (value === null || value <= 0) throw new Error(he.validation.invalidAmount);
      if (methodId === '') throw new Error(`${he.payment.method}: ${he.validation.required}`);

      const result = await window.api.payments.create(
        {
          memberId: selected.id,
          paymentDate: date,
          amountAgorot: shekelToAgorot(value),
          paymentMethodId: methodId,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        },
        withReceipt,
      );
      onSaved(
        result.receipt
          ? he.payment.savedWithReceipt(result.receipt.receiptNumber)
          : he.payment.savedNoReceipt,
        result.receipt?.id ?? null,
        // WB-12 – גם כשהופקה קבלה, האירוע המדווח הוא `payment` אחד:
        // פעולה אחת של הגבאי = הודעה אחת לחבר.
        { kind: 'payment', refId: result.paymentId },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{he.payment.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {errors.map((i) => (
            <Alert key={i.field + i.message} severity="error">
              {i.message}
            </Alert>
          ))}
          {warnings.map((i) => (
            <Alert key={i.field + i.message} severity="warning">
              {i.message}
            </Alert>
          ))}

          <MemberPicker
            value={selected}
            onChange={setSelected}
            label={he.vow.member}
            autoFocus={!member}
            disabled={Boolean(member)}
          />

          {selected ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                color={selected.balanceAgorot > 0 ? 'error' : 'default'}
                label={`${he.payment.currentBalance}: ${formatAgorot(selected.balanceAgorot)}`}
              />
              {selected.lastPaymentDate ? (
                <Chip
                  variant="outlined"
                  label={`${he.payment.lastPayment}: ${formatDate(selected.lastPaymentDate)}`}
                />
              ) : null}
              <Button
                size="small"
                onClick={() => setAmount(String(Math.max(0, selected.balanceAgorot) / 100))}
                disabled={selected.balanceAgorot <= 0}
              >
                {he.payment.fullBalance}
              </Button>
            </Stack>
          ) : null}

          <Stack direction="row" spacing={2}>
            <TextField
              type="date"
              label={he.payment.date}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label={he.payment.amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 160 }}
              autoFocus={Boolean(member)}
            />
            <TextField
              select
              label={he.payment.method}
              value={methodId}
              onChange={(e) => setMethodId(Number(e.target.value))}
              sx={{ flex: 1 }}
            >
              {(methods.data ?? []).map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              label={he.payment.reference}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required={selectedMethod?.requiresReference}
              sx={{ width: 220 }}
            />
            <TextField
              label={he.payment.notes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          {recent.data && recent.data.length > 0 ? (
            <>
              <Divider />
              <Typography variant="subtitle2" color="text.secondary">
                {he.payment.recentCharges}
              </Typography>
              <Stack spacing={0.5}>
                {recent.data.map((r) => (
                  <Typography key={r.id} variant="body2">
                    {formatDate(r.date)} · {r.occasion ?? ''} {r.note ? `– ${r.note}` : ''} ·{' '}
                    <strong>{formatAgorot(r.debitAgorot || r.creditAgorot)}</strong>
                  </Typography>
                ))}
              </Stack>
            </>
          ) : null}

          {nextNumber.data !== null ? (
            <Typography variant="caption" color="text.secondary">
              {he.payment.nextReceipt(nextNumber.data)}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button onClick={() => void submit(false)} disabled={busy || errors.length > 0}>
          {he.payment.saveOnly}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit(true)}
          disabled={busy || errors.length > 0}
        >
          {busy ? he.app.saving : he.payment.saveAndPrint}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
