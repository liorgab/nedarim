import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import type { MemberWithBalance, MessageTemplateDto, NotificationDraftDto } from '@shared/api';
import { formatE164ForDisplay } from '@shared/phone';
import { useWhatsAppStatus } from '../../hooks/useWhatsAppStatus';
import { he } from '../../i18n/he';

export interface SendOneDialogProps {
  open: boolean;
  member: MemberWithBalance | null;
  onClose: () => void;
  onSent: (message: string) => void;
  /**
   * W-86 – הודעה שנובעת מאירוע כספי (נדר, תשלום, קבלה...).
   *
   * כשהיא קיימת הדיאלוג נפתח עם הטקסט המוכן במקום בורר תבניות: הגבאי כבר
   * ביצע פעולה, והשאלה היחידה שנותרה היא "לשלוח?" ולא "איזו תבנית?".
   * הוא עדיין רשאי לערוך את הטקסט לפני השליחה.
   */
  draft?: NotificationDraftDto | null;
}

/**
 * W-22 – שליחת הודעה לחבר יחיד מהכרטיסייה.
 *
 * מאחורי הקלעים זה קמפיין של פריט אחד, בדיוק כמו קמפיין של 90 – ולכן
 * ההיסטוריה, המכסה היומית ויומן הביקורת מתנהגים זהה, ואין מסלול שני
 * שצריך לתחזק.
 */
export function SendOneDialog({
  open,
  member,
  onClose,
  onSent,
  draft = null,
}: SendOneDialogProps) {
  const [templates, setTemplates] = useState<MessageTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useWhatsAppStatus();

  useEffect(() => {
    if (!open) return;
    setError(null);

    // הודעת אירוע: הטקסט כבר מרונדר בצד ה-main עם נתוני האירוע
    // (`{{amount}}`, `{{receipt_number}}`), ואין מה לבחור.
    if (draft !== null) {
      setTemplates([]);
      setTemplateId('');
      setBody(draft.text);
      setPreview(draft.text);
      return;
    }

    void window.api.templates.list(false).then((list) => {
      setTemplates(list);
      const first = list[0];
      if (first) {
        setTemplateId(first.id);
        setBody(first.body);
      }
    });
  }, [open, draft]);

  useEffect(() => {
    // בהודעת אירוע `body` הוא כבר הטקסט הסופי – רינדור נוסף היה מחפש
    // `{{...}}` שכבר הוחלפו, ובעיקר היה מאבד את נתוני האירוע.
    if (draft !== null) {
      setPreview(body);
      return;
    }
    if (!open || member === null || body.trim() === '') {
      setPreview('');
      return;
    }
    const timer = window.setTimeout(() => {
      void window.api.templates
        .render(body, member.id)
        .then(setPreview)
        .catch(() => setPreview(''));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, member, body, draft]);

  async function send(): Promise<void> {
    if (member === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.campaigns.sendOne(
        member.id,
        body,
        draft !== null ? draft.templateId : typeof templateId === 'number' ? templateId : null,
        // מקור האירוע נשמר על הקמפיין, וזה מה שמונע הודעה שנייה על אותה
        // רשומה אם הגבאי יפתח שוב את אותו מסך.
        draft !== null ? { kind: draft.eventKind, ref: draft.triggerRef } : null,
      );
      if (result.ok) {
        onSent(he.whatsapp.sendOne.sent(member.firstName));
        onClose();
      } else {
        setError(result.errorMessage ?? he.app.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * החלון סגור **אינו** חסם: השליחה פותחת אותו בעצמה. חוסמים רק כשנדרשת
   * פעולה של הגבאי – סריקת QR, או WhatsApp שפתוח במקום אחר.
   */
  const state = status?.state ?? 'disconnected';
  const needsUserAction = state === 'qr' || state === 'stale';
  const canSend =
    !needsUserAction && member?.mobileStatus === 'valid' && body.trim() !== '' && !busy;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {draft !== null ? he.whatsapp.notify.dialogTitle(draft.eventLabel) : he.whatsapp.sendOne.title}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {member !== null ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">{`${member.firstName} ${member.lastName}`}</Typography>
              {member.mobileStatus === 'valid' ? (
                <Chip
                  size="small"
                  color="success"
                  label={formatE164ForDisplay(member.mobileE164)}
                />
              ) : (
                <Chip size="small" color="error" label={he.whatsapp.mobile.missing} />
              )}
            </Stack>
          ) : null}

          {needsUserAction ? (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => void window.api.whatsapp.openWindow()}
                >
                  {he.whatsapp.connection.open}
                </Button>
              }
            >
              {state === 'qr' ? he.whatsapp.connection.scanHint : he.whatsapp.connection.staleHint}
            </Alert>
          ) : state !== 'ready' ? (
            <Alert severity="info">{he.whatsapp.sendOne.willOpenWindow}</Alert>
          ) : null}

          {member !== null && member.mobileStatus !== 'valid' ? (
            <Alert severity="error">{he.whatsapp.sendOne.noMobile}</Alert>
          ) : null}

          {error !== null ? <Alert severity="error">{error}</Alert> : null}

          {draft !== null ? (
            <Alert severity="info">{he.whatsapp.notify.dialogHint}</Alert>
          ) : (
          <TextField
            select
            label={he.whatsapp.send.chooseTemplate}
            value={templateId === '' ? '' : String(templateId)}
            onChange={(e) => {
              const id = Number(e.target.value);
              setTemplateId(id);
              setBody(templates.find((t) => t.id === id)?.body ?? '');
            }}
          >
            {templates.map((t) => (
              <MenuItem key={t.id} value={String(t.id)}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          )}

          <TextField
            label={he.whatsapp.templates.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={3}
          />

          {preview !== '' ? (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {he.whatsapp.send.previewTitle}
              </Typography>
              <Box
                sx={{
                  whiteSpace: 'pre-wrap',
                  bgcolor: '#dcf8c6',
                  borderRadius: 2,
                  p: 1.5,
                  fontSize: 14,
                  lineHeight: 1.6,
                  mt: 0.5,
                }}
              >
                {preview}
              </Box>
            </Box>
          ) : null}

          {busy ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">{he.whatsapp.sendOne.sending}</Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={<WhatsAppIcon />}
          disabled={!canSend}
          onClick={() => void send()}
        >
          {he.whatsapp.sendOne.send}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
