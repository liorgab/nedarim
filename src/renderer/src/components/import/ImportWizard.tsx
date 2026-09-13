import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import type {
  BackupInfoDto,
  ImportEntityDto,
  ImportFileDto,
  ImportModeDto,
  ImportModeInfoDto,
  ImportPreflightDto,
  ImportResultDto,
  ImportValidationDto,
} from '@shared/api';
import { he } from '../../i18n/he';
import { StepMode } from './StepMode';
import { StepFile } from './StepFile';
import { StepMapping } from './StepMapping';
import { StepValidate } from './StepValidate';
import { StepRun } from './StepRun';
import { StepSummary } from './StepSummary';

/**
 * F-121 – אשף ייבוא הנתונים, שישה שלבים.
 *
 * המצב האמיתי – הקובץ שנפתח והמיפוי – יושב בתהליך הראשי, ולא כאן.
 * הרכיב מחזיק רק את מה שהמסך צריך להציג. זו הסיבה שכל צעד קדימה הוא
 * קריאה ל-IPC ולא חישוב מקומי: חישוב מקומי היה מתפצל מהחישוב שיקרה
 * בייבוא עצמו, ואז המספרים שהוצגו אינם מה שקרה.
 */

const STEPS = [
  he.importer.steps.mode,
  he.importer.steps.file,
  he.importer.steps.mapping,
  he.importer.steps.validate,
  he.importer.steps.run,
  he.importer.steps.summary,
] as const;

export interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
  /** הושלם ייבוא – המסכים שמאחורי האשף צריכים להיטען מחדש. */
  onImported: (result: ImportResultDto) => void;
}

export function ImportWizard({ open, onClose, onImported }: ImportWizardProps) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modes, setModes] = useState<ImportModeInfoDto[]>([]);
  const [catalog, setCatalog] = useState<ImportEntityDto[]>([]);
  const [mode, setMode] = useState<ImportModeDto>('upsert');
  const [file, setFile] = useState<ImportFileDto | null>(null);
  const [backups, setBackups] = useState<BackupInfoDto[] | null>(null);
  const [restoring, setRestoring] = useState<BackupInfoDto | null>(null);
  const [preflight, setPreflight] = useState<ImportPreflightDto | null>(null);
  const [validation, setValidation] = useState<ImportValidationDto | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    setFile(null);
    setBackups(null);
    setRestoring(null);
    setPreflight(null);
    setValidation(null);
    setResult(null);
    void Promise.all([window.api.importer.modes(), window.api.importer.catalog()]).then(
      ([m, c]) => {
        setModes(m);
        setCatalog(c);
      },
    );
  }, [open]);

  /** עוטף כל קריאה ל-main: busy, ושגיאה בעברית במקום חלון קפוא. */
  const guard = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function close(): Promise<void> {
    await window.api.importer.cancel();
    onClose();
  }

  async function advance(): Promise<void> {
    // כל מעבר בין השלבים מחשב מחדש מול הקובץ האמיתי. חזרה אחורה ושינוי
    // מיפוי חייבים לבטל בדיקה שכבר רצה, אחרת מוצג דוח של מצב קודם.
    if (step === 2) {
      await guard(async () => {
        setPreflight(await window.api.importer.preflight());
        setStep(3);
        setValidation(await window.api.importer.validate(mode));
      });
      return;
    }
    setStep((s) => s + 1);
  }

  function back(): void {
    if (step === 3) setValidation(null);
    setStep((s) => Math.max(0, s - 1));
  }

  /** האם אפשר להתקדם מהשלב הנוכחי. */
  const canAdvance = (): boolean => {
    if (busy) return false;
    switch (step) {
      case 0:
        return true;
      case 1:
        return file !== null && file.sheets.some((s) => s.include);
      case 2:
        return file !== null && file.sheets.some((s) => s.include && s.entity !== null);
      case 3:
        return validation?.canImport === true;
      default:
        return false;
    }
  };

  return (
    <Dialog open={open} maxWidth="lg" fullWidth>
      <DialogTitle>{he.importer.title}</DialogTitle>
      {busy ? <LinearProgress /> : null}

      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error !== null ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {step === 0 ? <StepMode modes={modes} value={mode} onChange={setMode} /> : null}

        {step === 1 ? (
          <StepFile
            file={file}
            catalog={catalog}
            backups={backups}
            onChoose={() =>
              guard(async () => {
                const choice = await window.api.importer.chooseFile();
                if (choice.kind === 'cancelled') return;
                if (choice.kind === 'invalid') throw new Error(choice.message);
                if (choice.kind === 'backup') {
                  setBackups(choice.backups);
                  return;
                }
                setFile(choice.file);
                setBackups(null);
                setValidation(null);
              })
            }
            onChooseBackup={() =>
              guard(async () => {
                const choice = await window.api.importer.chooseBackup();
                if (choice.kind === 'cancelled') return;
                if (choice.kind === 'invalid') throw new Error(choice.message);
                if (choice.kind === 'backup') setBackups(choice.backups);
              })
            }
            onRestore={setRestoring}
            onDownloadTemplate={() =>
              guard(async () => {
                await window.api.importer.downloadTemplate();
              })
            }
          />
        ) : null}

        {step === 2 && file !== null ? (
          <StepMapping
            file={file}
            catalog={catalog}
            onPatch={(index, patch) =>
              guard(async () => {
                setFile(await window.api.importer.updateSheet(index, patch));
                setValidation(null);
              })
            }
          />
        ) : null}

        {step === 3 ? (
          <StepValidate preflight={preflight} validation={validation} busy={busy} />
        ) : null}

        {step === 4 ? <StepRun mode={mode} modes={modes} validation={validation} /> : null}

        {step === 5 ? <StepSummary result={result} /> : null}
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={() => void close()} disabled={busy}>
          {step === 5 ? he.importer.close : he.importer.cancel}
        </Button>

        <Stack direction="row" spacing={1}>
          {step > 0 && step < 4 ? (
            <Button onClick={back} disabled={busy}>
              {he.importer.back}
            </Button>
          ) : null}

          {step < 4 ? (
            <Button variant="contained" disabled={!canAdvance()} onClick={() => void advance()}>
              {he.importer.next}
            </Button>
          ) : null}

          {step === 4 ? (
            <Button
              variant="contained"
              color="warning"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  const outcome = await window.api.importer.run(mode);
                  setResult(outcome);
                  setStep(5);
                  onImported(outcome);
                })
              }
            >
              {busy ? he.importer.running : he.importer.runNow}
            </Button>
          ) : null}
        </Stack>
      </DialogActions>
      {/*
        F-101 – השחזור נעשה **כאן** ולא במסך אחר. גבאי שהגיע לאשף עם גיבוי
        ביד אינו אמור להישלח למסך ההגדרות כדי למצוא אותו שוב ברשימה.
      */}
      <Dialog open={restoring !== null} onClose={() => setRestoring(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{he.importer.restoreTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="warning">{he.importer.restoreWarning}</Alert>
            {restoring?.manifest === null || restoring === null ? null : (
              <Typography variant="body2">
                {`${restoring.manifest.counts.members} ${he.backup.members} · ` +
                  `${restoring.manifest.counts.receipts} ${he.backup.receipts}`}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoring(null)} disabled={busy}>
            {he.importer.cancel}
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                await window.api.backup.restore(restoring!.path);
                // ה-main כבר פתח את בסיס הנתונים המשוחזר; רענון המסך הוא כל
                // מה שנדרש כדי שכל הדפים יטענו את הנתונים החדשים.
                window.location.reload();
              })
            }
          >
            {he.importer.restoreConfirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
