import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import type { ConfigurationDto, SettingSpecDto, WizardStepDto } from '@shared/api';
import { SettingField } from './SettingField';
import { he } from '../i18n/he';

/**
 * F-110..F-114 – אשף ההתקנה הראשונה.
 *
 * עד היום התקנה חדשה הציגה באנר שמפנה למסך הגדרות עם 25 שדות בחמש
 * קבוצות. הגבאי מילא את שם בית הכנסת – השדה היחיד שסומן חובה – ויצא.
 * מספר הקבלה הראשון נשאר על ברירת המחדל, וזו טעות שאי אפשר לתקן אחרי
 * שהופקה קבלה ראשונה (כלל 4 – מספר לעולם אינו נערך).
 *
 * האשף אינו חוסם: אפשר לדלג על כל שדה שאינו חובה ולהשלים בהגדרות. מה
 * שהוא כן עושה הוא **לשאול**.
 */

export interface SetupWizardProps {
  open: boolean;
  config: ConfigurationDto;
  onDone: () => void;
}

export function SetupWizard({ open, config, onDone }: SetupWizardProps) {
  const [steps, setSteps] = useState<WizardStepDto[]>([]);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [receiptStart, setReceiptStart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setError(null);
    setDraft({ ...config.settings });
    setReceiptStart(String(config.counters.nextReceiptNumber));
    void window.api.configuration.wizardSteps().then(setSteps);
  }, [open, config]);

  const specByKey = new Map<string, SettingSpecDto>(config.specs.map((s) => [s.key, s]));
  const step = steps[index];
  const isLast = index === steps.length - 1;

  /** שדות חובה שעדיין ריקים – בצעד הנוכחי בלבד. */
  const missingHere = (step?.keys ?? []).filter((k) => {
    const spec = specByKey.get(k);
    return spec?.required === true && (draft[k] ?? '').trim() === '';
  });

  async function saveAndAdvance(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // שומרים בכל צעד ולא רק בסוף: גבאי שסוגר את החלון באמצע לא מאבד
      // את מה שכבר הקליד.
      const patch: Record<string, string> = {};
      for (const key of step?.keys ?? []) patch[key] = draft[key] ?? '';
      await window.api.configuration.save(patch);

      if (step?.id === 'receipt') {
        const next = Number(receiptStart);
        if (Number.isInteger(next) && next > 0 && next !== config.counters.nextReceiptNumber) {
          await window.api.configuration.setReceiptStartNumber(next);
        }
      }

      if (isLast) {
        await window.api.configuration.completeSetup();
        onDone();
        return;
      }
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} maxWidth="md" fullWidth disableEscapeKeyDown>
      <DialogTitle>{he.wizard.title}</DialogTitle>
      {busy ? <LinearProgress /> : null}

      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {he.wizard.intro}
        </Typography>

        <Stepper activeStep={index} sx={{ mb: 3 }}>
          {steps.map((s) => (
            <Step key={s.id}>
              <StepLabel>{s.title}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error !== null ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {step === undefined ? null : (
          <Box>
            <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.7 }}>
              {step.intro}
            </Typography>

            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {step.keys.map((key) => {
                const spec = specByKey.get(key);
                if (spec === undefined) return null;
                return (
                  <SettingField
                    key={key}
                    spec={spec}
                    value={draft[key] ?? ''}
                    onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                  />
                );
              })}
            </Stack>

            {/*
              מספר הקבלה הבא הוא מונה ולא הגדרה, ולכן הוא מוצג כאן במפורש
              ולא מגיע מרשימת המפתחות. זה גם השדה שהכי קשה לתקן בדיעבד.
            */}
            {step.id === 'receipt' ? (
              <>
                <Divider sx={{ my: 2 }} />
                <TextField
                  label={he.wizard.nextReceipt}
                  value={receiptStart}
                  onChange={(e) => setReceiptStart(e.target.value)}
                  type="number"
                  helperText={he.wizard.nextReceiptHelp}
                  sx={{ minWidth: 260 }}
                />
              </>
            ) : null}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button disabled={index === 0 || busy} onClick={() => setIndex((i) => i - 1)}>
          {he.wizard.back}
        </Button>
        <Stack direction="row" spacing={1} alignItems="center">
          {missingHere.length > 0 ? (
            <Typography variant="caption" color="error">
              {he.wizard.missingRequired}
            </Typography>
          ) : null}
          <Button
            variant="contained"
            disabled={busy || missingHere.length > 0 || step === undefined}
            onClick={() => void saveAndAdvance()}
          >
            {isLast ? he.wizard.finish : he.wizard.next}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
