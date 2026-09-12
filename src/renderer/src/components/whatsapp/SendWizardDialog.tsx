import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { MessageTemplateDto, PreparedCampaignDto, PreparedItemDto } from '@shared/api';
import { formatAgorot } from '../../lib/format';
import { useWhatsAppStatus } from '../../hooks/useWhatsAppStatus';
import { ConnectionStep } from './ConnectionStep';
import { he } from '../../i18n/he';

export interface SendWizardDialogProps {
  open: boolean;
  memberIds: number[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const ONE_OFF = 'one-off';

/**
 * W-30..W-38 – אשף השליחה.
 *
 * ב-W0 קיימים שני השלבים הראשונים בלבד: נמענים והודעה. שלבי החיבור והשליחה
 * (3–4) נוספים ב-W1/W3, ולכן הכפתור האחרון שומר את הקמפיין כטיוטה במקום
 * להתחיל לשלוח. הצעדים כבר מוצגים ב-Stepper כדי שהמבנה יהיה ברור לגבאי.
 */
export function SendWizardDialog({ open, memberIds, onClose, onSaved }: SendWizardDialogProps) {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<MessageTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState<number | typeof ONE_OFF | ''>('');
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [prepared, setPrepared] = useState<PreparedCampaignDto | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waStatus = useWhatsAppStatus();

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setRemoved(new Set());
    setError(null);
    setPrepared(null);
    void window.api.templates.list(false).then((list) => {
      setTemplates(list);
      const first = list[0];
      if (first) {
        setTemplateId(first.id);
        setBody(first.body);
      } else {
        setTemplateId(ONE_OFF);
        setBody('');
      }
    });
  }, [open]);

  const activeIds = memberIds.filter((id) => !removed.has(id));

  // הרינדור נעשה ב-main בכל שינוי של הטקסט או של רשימת הנמענים.
  useEffect(() => {
    if (!open || activeIds.length === 0) {
      setPrepared(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.api.campaigns
        .prepare({
          memberIds: activeIds,
          body,
          name,
          templateId: typeof templateId === 'number' ? templateId : null,
        })
        .then((p) => {
          setPrepared(p);
          if (name === '') setName(p.name);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => window.clearTimeout(timer);
    // `name` בכוונה אינו בתלויות: הוא נקבע פעם אחת מהתשובה, ותלות בו הייתה
    // יוצרת לולאה.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIds.join(','), body, templateId]);

  const chooseTemplate = (value: string) => {
    if (value === ONE_OFF) {
      setTemplateId(ONE_OFF);
      setBody('');
      return;
    }
    const id = Number(value);
    setTemplateId(id);
    setBody(templates.find((t) => t.id === id)?.body ?? '');
  };

  async function saveDraft(): Promise<void> {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      const id = await window.api.campaigns.create({ ...prepared, name });
      onSaved(he.whatsapp.send.savedDraft(prepared.items.length));
      onClose();
      void id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const items = prepared?.items ?? [];

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{he.whatsapp.send.title}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {[
            he.whatsapp.send.steps.recipients,
            he.whatsapp.send.steps.message,
            he.whatsapp.send.steps.connection,
            he.whatsapp.send.steps.progress,
          ].map((label, i) => (
            <Step key={label} completed={i < step}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error !== null ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {prepared?.duplicates.map((d) => (
          <Alert severity="warning" key={d.phoneE164} sx={{ mb: 2 }}>
            {he.whatsapp.send.duplicateWarning(
              d.phoneE164,
              d.members.map((m) => m.fullName).join(', '),
            )}
          </Alert>
        ))}

        {step === 0 ? (
          <>
            <Typography sx={{ mb: 1 }}>
              {he.whatsapp.send.recipientsSummary(items.length, prepared?.skippedCount ?? 0)}
            </Typography>
            <Box sx={{ maxHeight: '52vh', overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{he.members.number}</TableCell>
                    <TableCell>{he.members.firstName}</TableCell>
                    <TableCell>{he.whatsapp.mobile.column}</TableCell>
                    <TableCell align="right">{he.members.balance}</TableCell>
                    <TableCell>{he.members.status}</TableCell>
                    <TableCell sx={{ width: 48 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => (
                    <RecipientRow
                      key={item.memberId}
                      item={item}
                      onRemove={() => setRemoved((s) => new Set(s).add(item.memberId))}
                    />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        ) : null}

        {step === 2 ? (
          <ConnectionStep status={waStatus} recipientCount={prepared?.sendableCount ?? 0} />
        ) : null}

        {step === 1 ? (
          <>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                select
                label={he.whatsapp.send.chooseTemplate}
                value={templateId === '' ? '' : String(templateId)}
                onChange={(e) => chooseTemplate(e.target.value)}
                sx={{ minWidth: 240 }}
              >
                {templates.map((t) => (
                  <MenuItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </MenuItem>
                ))}
                <MenuItem value={ONE_OFF}>{he.whatsapp.send.oneOff}</MenuItem>
              </TextField>
              <TextField
                label={he.whatsapp.send.campaignName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Box>

            <TextField
              label={he.whatsapp.templates.body}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              minRows={4}
              fullWidth
              sx={{ mb: 2 }}
            />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {he.whatsapp.send.previewTitle}
            </Typography>
            <Box sx={{ maxHeight: '34vh', overflow: 'auto' }}>
              {items.map((item) => (
                <Box key={item.memberId} sx={{ mb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {`${item.memberNumber} · ${item.fullName}`}
                    {item.status === 'skipped' ? ` · ${he.whatsapp.send.willBeSkipped}` : ''}
                  </Typography>
                  <Box
                    sx={{
                      whiteSpace: 'pre-wrap',
                      bgcolor: item.status === 'skipped' ? 'action.hover' : '#dcf8c6',
                      opacity: item.status === 'skipped' ? 0.6 : 1,
                      borderRadius: 2,
                      p: 1.5,
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    {item.renderedText}
                  </Box>
                </Box>
              ))}
            </Box>
          </>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Box sx={{ flex: 1 }} />
        {step > 0 ? (
          <Button onClick={() => setStep((s) => s - 1)} disabled={busy}>
            {he.whatsapp.send.back}
          </Button>
        ) : null}
        {step < 2 ? (
          <Button
            variant="contained"
            onClick={() => setStep((s) => s + 1)}
            disabled={
              busy ||
              (step === 0 && items.length === 0) ||
              (step === 1 && (prepared === null || body.trim() === ''))
            }
          >
            {he.whatsapp.send.next}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void saveDraft()}
            disabled={busy || prepared === null || waStatus?.state !== 'ready'}
          >
            {he.whatsapp.send.saveDraft}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function RecipientRow({ item, onRemove }: { item: PreparedItemDto; onRemove: () => void }) {
  const reasonText =
    item.mobileReason !== null
      ? (he.whatsapp.mobile.reasons as Record<string, string>)[item.mobileReason]
      : undefined;

  return (
    <TableRow sx={{ opacity: item.status === 'skipped' ? 0.6 : 1 }}>
      <TableCell>{item.memberNumber}</TableCell>
      <TableCell>{item.fullName}</TableCell>
      <TableCell sx={{ direction: 'ltr', textAlign: 'start' }}>{item.mobile ?? '—'}</TableCell>
      <TableCell align="right">{formatAgorot(item.balanceAgorot)}</TableCell>
      <TableCell>
        {item.status === 'pending' ? (
          <Chip size="small" color="success" label={he.whatsapp.mobile.valid} />
        ) : (
          <Tooltip title={reasonText ?? ''}>
            <Chip
              size="small"
              color="error"
              label={
                item.mobileStatus === 'missing'
                  ? he.whatsapp.mobile.missing
                  : he.whatsapp.mobile.invalid
              }
            />
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        <Tooltip title={he.whatsapp.send.remove}>
          <IconButton aria-label={he.whatsapp.send.remove} size="small" onClick={onRemove}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}
