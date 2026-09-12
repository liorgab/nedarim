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
import type {
  CampaignDetailDto,
  CampaignProgressDto,
  MessageTemplateDto,
  PreparedCampaignDto,
  PreparedItemDto,
} from '@shared/api';
import { formatAgorot } from '../../lib/format';
import { useWhatsAppStatus } from '../../hooks/useWhatsAppStatus';
import { ConnectionStep } from './ConnectionStep';
import { ProgressPanel } from './ProgressPanel';
import { he } from '../../i18n/he';

export interface SendWizardDialogProps {
  open: boolean;
  memberIds: number[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const ONE_OFF = 'one-off';

/**
 * W-30..W-38, W-40..W-43 – אשף השליחה, ארבעה שלבים.
 *
 * שלב 4 אינו "עוד מסך": ברגע שהוא נפתח הקמפיין כבר רץ ב-main, והמסך רק
 * מציג את מה שנדחף אליו. לכן אין ממנו "אחורה" (W-38) – אי אפשר לחזור
 * ולערוך טקסט של הודעות שכבר יצאו.
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
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [progress, setProgress] = useState<CampaignProgressDto | null>(null);
  const [detail, setDetail] = useState<CampaignDetailDto | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const waStatus = useWhatsAppStatus();

  /**
   * W-44 – ההתקדמות מגיעה ב-push מ-main.
   *
   * הפירוט נטען מחדש רק כשמונה משתנה, ולא בכל אירוע: ספירה לאחור דוחפת
   * אירוע כל שנייה, ושאילתה על 90 פריטים בכל אחת מהן היא בזבוז.
   */
  useEffect(() => {
    if (!open) return;
    return window.api.campaigns.onProgress((p) => {
      setProgress((previous) => {
        const changed =
          previous === null ||
          previous.sent !== p.sent ||
          previous.failed !== p.failed ||
          previous.skipped !== p.skipped;
        if (changed) void window.api.campaigns.get(p.campaignId).then(setDetail);
        return p;
      });
    });
  }, [open]);

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
      await window.api.campaigns.create({ ...prepared, name });
      onSaved(he.whatsapp.send.savedDraft(prepared.items.length));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * יוצר את הקמפיין ומתחיל לשלוח.
   *
   * הקמפיין נשמר **לפני** השליחה ולא בסופה: כך הפריטים שכבר יצאו נשארים
   * רשומים גם אם היישום נסגר באמצע, וזה מה שמאפשר להמשיך אחר כך.
   */
  async function startSending(): Promise<void> {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      const id = await window.api.campaigns.create({ ...prepared, name });
      setCampaignId(id);
      setDetail(await window.api.campaigns.get(id));
      setStep(3);
      // לא ממתינים לסיום: `start` חוזרת רק כשהקמפיין נעצר, וההתקדמות
      // בינתיים מגיעה באירועים.
      void window.api.campaigns
        .start(id)
        .then(async (final) => {
          setProgress(final);
          setDetail(await window.api.campaigns.get(id));
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    if (campaignId === null) return;
    setBusy(true);
    setError(null);
    try {
      const final = await window.api.campaigns.start(campaignId);
      setProgress(final);
      setDetail(await window.api.campaigns.get(campaignId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const running = progress?.phase === 'running';
  const finished = progress?.phase === 'completed' || progress?.phase === 'cancelled';

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

        {step === 3 ? <ProgressPanel progress={progress} detail={detail} /> : null}

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
        {/* W-38 – בשלב 4 אין סגירה בשקט בזמן שהקמפיין רץ. */}
        <Button onClick={onClose} disabled={busy || running}>
          {step === 3 ? he.whatsapp.progress.close : he.app.cancel}
        </Button>
        <Box sx={{ flex: 1 }} />

        {step > 0 && step < 3 ? (
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
        ) : null}

        {step === 2 ? (
          <>
            <Button onClick={() => void saveDraft()} disabled={busy || prepared === null}>
              {he.whatsapp.send.saveForLater}
            </Button>
            <Button
              variant="contained"
              onClick={() => void startSending()}
              disabled={busy || prepared === null || waStatus?.state !== 'ready'}
            >
              {he.whatsapp.send.startSending}
            </Button>
          </>
        ) : null}

        {step === 3 && !finished ? (
          <>
            <Button color="error" onClick={() => setConfirmCancel(true)} disabled={!running}>
              {he.whatsapp.progress.cancel}
            </Button>
            {running ? (
              <Button variant="contained" onClick={() => void window.api.campaigns.pause()}>
                {he.whatsapp.progress.pause}
              </Button>
            ) : (
              <Button variant="contained" onClick={() => void resume()} disabled={busy}>
                {he.whatsapp.progress.resume}
              </Button>
            )}
          </>
        ) : null}
      </DialogActions>

      {/* W-43 – ביטול דורש אישור: ההודעות שכבר יצאו אינן חוזרות. */}
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)}>
        <DialogTitle>{he.whatsapp.progress.cancel}</DialogTitle>
        <DialogContent>
          <Typography>{he.whatsapp.progress.confirmCancel}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCancel(false)}>
            {he.whatsapp.progress.confirmCancelNo}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmCancel(false);
              void window.api.campaigns.cancel();
            }}
          >
            {he.whatsapp.progress.confirmCancelYes}
          </Button>
        </DialogActions>
      </Dialog>
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
