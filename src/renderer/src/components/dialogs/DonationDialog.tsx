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
} from '@mui/material';
import type { DonationDto,
  NotifyRefDto,
} from '@shared/api';
import type { Lookup, MemberWithBalance, PaymentMethod } from '@shared/types';
import { MemberPicker } from '../MemberPicker';
import { useAsync } from '../../hooks/useAsync';
import { parseShekelInput, shekelToAgorot, todayIso } from '../../lib/format';
import { he } from '../../i18n/he';

export interface DonationDialogProps {
  open: boolean;
  /** null = הזנה חדשה. */
  donation: DonationDto | null;
  onClose: () => void;
  onSaved: (message: string, receiptId: number | null, notify: NotifyRefDto | null) => void;
}

/** F-51 – הזנת תרומה. תורם יכול להיות חבר או שם חופשי. */
export function DonationDialog({ open, donation, onClose, onSaved }: DonationDialogProps) {
  const [date, setDate] = useState(todayIso());
  const [member, setMember] = useState<MemberWithBalance | null>(null);
  const [donorName, setDonorName] = useState('');
  const [typeId, setTypeId] = useState<number | ''>('');
  const [methodId, setMethodId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const types = useAsync<Lookup[]>(() => window.api.lookups.donationTypes(false), []);
  const methods = useAsync<PaymentMethod[]>(() => window.api.lookups.paymentMethods(false), []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (donation) {
      setDate(donation.donationDate);
      setDonorName(donation.donorName);
      setTypeId(donation.donationTypeId);
      setMethodId(donation.paymentMethodId);
      setAmount(String(donation.amountAgorot / 100));
      setPurpose(donation.purpose ?? '');
      setReference(donation.reference ?? '');
      if (donation.memberId !== null) {
        void window.api.members.get(donation.memberId).then(setMember);
      } else {
        setMember(null);
      }
    } else {
      setDate(todayIso());
      setMember(null);
      setDonorName('');
      setAmount('');
      setPurpose('');
      setReference('');
    }
  }, [open, donation]);

  useEffect(() => {
    if (typeId === '' && types.data && types.data.length > 0) setTypeId(types.data[0]!.id);
  }, [types.data, typeId]);
  useEffect(() => {
    if (methodId === '' && methods.data && methods.data.length > 0)
      setMethodId(methods.data[0]!.id);
  }, [methods.data, methodId]);

  // בחירת חבר ממלאת את שם התורם, וניתן לערוך אותו אחר כך (SPEC 4.5)
  useEffect(() => {
    if (member && donorName.trim() === '') {
      setDonorName(`${member.firstName} ${member.lastName}`.trim());
    }
  }, [member, donorName]);

  const selectedMethod = methods.data?.find((m) => m.id === methodId);

  async function submit(withReceipt: boolean) {
    setError(null);
    setBusy(true);
    try {
      const value = parseShekelInput(amount);
      if (value === null || value <= 0) throw new Error(he.validation.invalidAmount);
      if (typeId === '' || methodId === '') throw new Error(he.validation.fixErrors);

      const input = {
        donationDate: date,
        memberId: member?.id ?? null,
        donorName: donorName.trim(),
        donationTypeId: typeId,
        paymentMethodId: methodId,
        reference: reference.trim() || null,
        amountAgorot: shekelToAgorot(value),
        purpose: purpose.trim() || null,
      };

      if (donation) {
        await window.api.donations.update(donation.id, input);
        // עריכת תרומה קיימת אינה אירוע חדש ולכן אינה מפיקה הודעה.
        onSaved(he.donations.saved, null, null);
      } else {
        const res = await window.api.donations.create(input, withReceipt);
        onSaved(
          res.receipt
            ? he.donations.savedWithReceipt(res.receipt.receiptNumber)
            : he.donations.saved,
          res.receipt?.id ?? null,
          { kind: 'donation', refId: res.donationId },
        );
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{donation ? he.donations.edit : he.donations.add}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <MemberPicker value={member} onChange={setMember} label={he.donations.linkMember} />
          <TextField
            label={he.donations.donor}
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            required
            helperText={he.donations.donorHelp}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              type="date"
              label={he.donations.date}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 175 }}
            />
            <TextField
              label={he.donations.amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              sx={{ width: 150 }}
            />
            <TextField
              select
              label={he.donations.type}
              value={typeId}
              onChange={(e) => setTypeId(Number(e.target.value))}
              sx={{ flex: 1 }}
            >
              {(types.data ?? []).map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label={he.donations.method}
              value={methodId}
              onChange={(e) => setMethodId(Number(e.target.value))}
              sx={{ minWidth: 180 }}
            >
              {(methods.data ?? []).map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={he.donations.reference}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required={selectedMethod?.requiresReference}
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            label={he.donations.purpose}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button onClick={() => void submit(false)} disabled={busy}>
          {donation ? he.app.save : he.donations.saveOnly}
        </Button>
        {donation ? null : (
          <Button variant="contained" onClick={() => void submit(true)} disabled={busy}>
            {busy ? he.app.saving : he.donations.saveAndPrint}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
