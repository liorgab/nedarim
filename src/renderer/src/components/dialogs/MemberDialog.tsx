import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import type { MemberWithBalance } from '@shared/types';
import { formatE164ForDisplay, normalizeMobile } from '@shared/phone';
import { he } from '../../i18n/he';
import { useMemberNameMode } from '../../hooks/useMemberNameMode';
import {
  nameForForm,
  nameForSave,
  nameIsComplete,
  type StoredName,
} from '../../lib/memberNameForm';

export interface MemberDialogProps {
  open: boolean;
  /** null = הוספה, אחרת עריכה. */
  member: MemberWithBalance | null;
  onClose: () => void;
  onSaved: (member: MemberWithBalance) => void;
}

const EMPTY = {
  firstName: '',
  lastName: '',
  nickname: '',
  mobile: '',
  email: '',
  address: '',
  notes: '',
};

/** F-11, F-12 – הוספה ועריכה של חבר, עם אזהרת כפילות שם (SPEC 6.2). */
export function MemberDialog({ open, member, onClose, onSaved }: MemberDialogProps) {
  const nameMode = useMemberNameMode();
  const [form, setForm] = useState(EMPTY);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * F-13 – השם כפי שהוא שמור, לפני שהטופס נגע בו.
   *
   * דרוש כדי להבחין בין "הגבאי שינה את השם" לבין "הגבאי פתח את החבר כדי
   * לעדכן טלפון". במצב "שם מלא" ההבחנה הזו היא ההבדל בין שמירת הפיצול
   * הקיים לבין מיזוג שאיש לא ביקש.
   */
  const storedName = useRef<StoredName | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!member) {
      storedName.current = null;
      setForm(EMPTY);
    } else {
      const stored = { firstName: member.firstName, lastName: member.lastName };
      storedName.current = stored;
      const shown = nameForForm(nameMode, stored);
      setForm({
        firstName: shown.firstName,
        lastName: shown.lastName,
        nickname: member.nickname ?? '',
        mobile: member.mobile ?? '',
        email: member.email ?? '',
        address: member.address ?? '',
        notes: member.notes ?? '',
      });
    }
    setDuplicateWarning(null);
    setError(null);
    // nameMode מגיע מהגדרה שנקראת אסינכרונית, ובפתיחה הראשונה הוא עדיין
    // 'split'. בלעדיו בתלויות הטופס היה נשאר עם שני שדות עד לפתיחה הבאה.
  }, [open, member, nameMode]);

  useEffect(() => {
    // במצב "שם מלא" יש שדה אחד בלבד, ולכן שם המשפחה אינו נדרש.
    if (!nameIsComplete(nameMode, { firstName: form.firstName, lastName: form.lastName })) {
      setDuplicateWarning(null);
      return;
    }
    let cancelled = false;
    void window.api.members
      .findDuplicates(form.firstName.trim(), form.lastName.trim(), member?.id)
      .then((dups) => {
        if (!cancelled) {
          setDuplicateWarning(
            dups.length > 0 ? he.members.duplicateWarning(dups[0]!.memberNumber) : null,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.firstName, form.lastName, member?.id, nameMode]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const name = nameForSave(
        nameMode,
        { firstName: form.firstName, lastName: form.lastName },
        storedName.current,
      );
      const input = {
        firstName: name.firstName,
        lastName: name.lastName,
        nickname: form.nickname.trim() || null,
        mobile: form.mobile.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      };
      const saved = member
        ? await window.api.members.update(member.id, input)
        : await window.api.members.create(input);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * W0 – תצוגה חיה של המספר שאליו תישלח ההודעה.
   *
   * הבדיקה נעשית באותה פונקציה שה-main משתמש בה בשמירה, ולא בביטוי רגולרי
   * מקומי: ביטוי נפרד דחה מספרים שהמערכת בעצם מקבלת (למשל "0501234567 של
   * הבן", או מספר שאיבד אפס מוביל ב-Excel), והגבאי היה מתקן מספר תקין.
   */
  const normalized = normalizeMobile(form.mobile);
  const mobileInvalid = normalized.status === 'invalid';
  const reasonText =
    normalized.reason !== undefined
      ? ((he.whatsapp.mobile.reasons as Record<string, string>)[normalized.reason] ?? '')
      : '';
  const mobileHelper =
    form.mobile.trim() === ''
      ? ' '
      : normalized.status === 'valid'
        ? [he.whatsapp.mobile.willSendTo(formatE164ForDisplay(normalized.e164)), reasonText]
            .filter(Boolean)
            .join(' · ')
        : reasonText || he.whatsapp.mobile.invalid;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{member ? he.members.edit : he.members.add}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {duplicateWarning ? <Alert severity="warning">{duplicateWarning}</Alert> : null}

          {/*
            F-13 – שדה אחד או שניים, לפי ההגדרה. במצב "שם מלא" הערך נשמר
            ב-firstName ושם המשפחה נשאר ריק, ולכן מעבר בין המצבים אינו
            מאבד דבר: מי שינהל אחר כך בנפרד ימלא את שם המשפחה חבר-חבר.
          */}
          {nameMode === 'full' ? (
            <TextField
              label={he.memberName.full}
              helperText={he.memberName.fullHelp}
              value={form.firstName}
              onChange={set('firstName')}
              required
              autoFocus
              fullWidth
            />
          ) : (
            <Stack direction="row" spacing={2}>
              <TextField
                label={he.members.firstName}
                value={form.firstName}
                onChange={set('firstName')}
                required
                autoFocus
                sx={{ flex: 1 }}
              />
              <TextField
                label={he.members.lastName}
                value={form.lastName}
                onChange={set('lastName')}
                required
                sx={{ flex: 1 }}
              />
            </Stack>
          )}
          <Stack direction="row" spacing={2}>
            <TextField
              label={he.members.nickname}
              value={form.nickname}
              onChange={set('nickname')}
              sx={{ flex: 1 }}
            />
            <TextField
              label={he.members.mobile}
              value={form.mobile}
              onChange={set('mobile')}
              error={mobileInvalid}
              helperText={mobileHelper}
              slotProps={{
                formHelperText: {
                  sx: {
                    color: mobileInvalid
                      ? 'error.main'
                      : normalized.reason
                        ? 'warning.main'
                        : 'success.main',
                  },
                },
              }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label={he.members.email}
              value={form.email}
              onChange={set('email')}
              sx={{ flex: 1 }}
            />
            <TextField
              label={he.members.address}
              value={form.address}
              onChange={set('address')}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label={he.members.notes}
            value={form.notes}
            onChange={set('notes')}
            multiline
            minRows={2}
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
          disabled={
            busy || !nameIsComplete(nameMode, { firstName: form.firstName, lastName: form.lastName })
          }
        >
          {busy ? he.app.saving : he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
