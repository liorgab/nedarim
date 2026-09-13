import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import type { DeletionScopeDto, UninstallInfoDto } from '@shared/api';
import { ImportWizard } from '../components/import/ImportWizard';
import { he } from '../i18n/he';

/**
 * לשונית הנתונים: ייבוא מקובץ, ומחיקת בסיס הנתונים.
 *
 * השתיים יושבות יחד כי הן שני הקצוות של אותו דבר – מה שנכנס למערכת ומה
 * שיוצא ממנה בשלמותו – ומכיוון שהמחיקה מובילה ישירות לייבוא: אחריה
 * המערכת ריקה, וזה בדיוק הרגע שבו מתחילים מחדש.
 */

export interface DataTabProps {
  onNotify: (message: string) => void;
  /** נדרש רענון של כל המסכים – הנתונים השתנו מתחת לרגליים. */
  onChanged: () => void;
}

export function DataTab({ onNotify, onChanged }: DataTabProps) {
  const [wizard, setWizard] = useState(false);
  const [scope, setScope] = useState<DeletionScopeDto | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uninstallInfo, setUninstallInfo] = useState<UninstallInfoDto | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [uninstallTyped, setUninstallTyped] = useState('');

  /** שם בית הכנסת נדרש לאישור ההסרה, ולכן נטען מראש ולא רק בפתיחת הדיאלוג. */
  const [scopeName, setScopeName] = useState('');

  useEffect(() => {
    void window.api.danger.uninstallInfo().then(setUninstallInfo);
    void window.api.danger.deletionScope().then((s) => setScopeName(s.synagogueName));
  }, []);

  async function openDeleteDialog(): Promise<void> {
    setError(null);
    setTyped('');
    setScope(await window.api.danger.deletionScope());
  }

  async function confirmDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { backupPath } = await window.api.danger.deleteDatabase(typed);
      setScope(null);
      onNotify(he.danger.done.replace('{path}', backupPath));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmUninstall(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.danger.uninstall(wipe, uninstallTyped);
      // ה-main סוגר את היישום; מה שמוצג כאן הוא רק לרגעים שעד אז.
      setUninstallOpen(false);
      onNotify(he.uninstall.closing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const nameMissing = scope !== null && scope.synagogueName === '';
  // אותה נורמליזציה שב-`dangerZone.confirmationMatches`: כפתור שמושבת
  // בזמן שהשרת היה מקבל את ההקלדה הוא באג שקשה להבין אותו מהמסך.
  const normalize = (v: string): string =>
    v.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
  const matches =
    scope !== null &&
    normalize(typed) !== '' &&
    normalize(typed) === normalize(scope.synagogueName);
  const uninstallMatches =
    normalize(uninstallTyped) !== '' && normalize(uninstallTyped) === normalize(scopeName);

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {he.importer.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {he.importer.fileIntro}
        </Typography>
        <Button
          variant="contained"
          startIcon={<UploadFileIcon />}
          onClick={() => setWizard(true)}
        >
          {he.importer.open}
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderColor: 'error.main' }}>
        <Typography variant="h3" color="error" sx={{ mb: 1 }}>
          {he.danger.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {he.danger.intro}
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<DeleteForeverIcon />}
          onClick={() => void openDeleteDialog()}
        >
          {he.danger.button}
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderColor: 'error.main' }}>
        <Typography variant="h3" color="error" sx={{ mb: 1 }}>
          {he.uninstall.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {he.uninstall.intro}
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<PowerSettingsNewIcon />}
          disabled={uninstallInfo?.available !== true}
          onClick={() => {
            setWipe(false);
            setUninstallTyped('');
            setError(null);
            setUninstallOpen(true);
          }}
        >
          {he.uninstall.button}
        </Button>
        {uninstallInfo !== null && !uninstallInfo.available ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {he.uninstall.unavailable}: {uninstallInfo.reason}
          </Typography>
        ) : null}
      </Paper>

      <ImportWizard
        open={wizard}
        onClose={() => setWizard(false)}
        onImported={() => {
          onChanged();
          onNotify(he.importer.summaryTitle);
        }}
      />

      <Dialog
        open={uninstallOpen}
        onClose={() => (busy ? null : setUninstallOpen(false))}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle color="error">{he.uninstall.title}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <RadioGroup
              value={wipe ? 'delete' : 'keep'}
              onChange={(e) => setWipe(e.target.value === 'delete')}
            >
              <FormControlLabel value="keep" control={<Radio />} label={he.uninstall.keepData} />
              <Typography variant="caption" color="text.secondary" sx={{ ms: 4, mb: 1 }}>
                {he.uninstall.keepDataHint}
              </Typography>
              <FormControlLabel
                value="delete"
                control={<Radio color="error" />}
                label={he.uninstall.deleteData}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ms: 4 }}>
                {he.uninstall.deleteDataHint}
              </Typography>
            </RadioGroup>

            <Divider />

            <Typography variant="caption" color="text.secondary" sx={{ direction: 'ltr', textAlign: 'start' }}>
              {he.uninstall.dataFolder}: {uninstallInfo?.userDataDir ?? ''}
            </Typography>

            {wipe ? (
              <>
                {/*
                  גיבוי חיצוני ולא פנימי: גיבוי בתוך תיקיית הנתונים היה
                  נמחק יחד איתה, וזה בדיוק מה שנראה כמו רשת ביטחון ואינו.
                */}
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const made = await window.api.backup.create(true);
                      if (made) onNotify(he.uninstall.backupDone);
                    })()
                  }
                >
                  {he.uninstall.backupFirst}
                </Button>
                <TextField
                  label={he.uninstall.confirmLabel}
                  helperText={`"${scopeName}"`}
                  value={uninstallTyped}
                  onChange={(e) => setUninstallTyped(e.target.value)}
                  fullWidth
                />
              </>
            ) : null}

            {error !== null ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUninstallOpen(false)} disabled={busy}>
            {he.importer.cancel}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || (wipe && !uninstallMatches)}
            onClick={() => void confirmUninstall()}
          >
            {he.uninstall.confirm}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={scope !== null} onClose={() => (busy ? null : setScope(null))} maxWidth="sm" fullWidth>
        <DialogTitle color="error">{he.danger.title}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="error">
              <AlertTitle>{he.danger.scope}</AlertTitle>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip size="small" label={`${he.danger.counts.members}: ${scope?.members ?? 0}`} />
                <Chip size="small" label={`${he.danger.counts.charges}: ${scope?.charges ?? 0}`} />
                <Chip size="small" label={`${he.danger.counts.payments}: ${scope?.payments ?? 0}`} />
                <Chip size="small" label={`${he.danger.counts.donations}: ${scope?.donations ?? 0}`} />
                <Chip size="small" label={`${he.danger.counts.expenses}: ${scope?.expenses ?? 0}`} />
                <Chip size="small" label={`${he.danger.counts.receipts}: ${scope?.receipts ?? 0}`} />
              </Stack>
            </Alert>

            <Alert severity="info">
              <AlertTitle>{he.danger.keepsTitle}</AlertTitle>
              {he.danger.keeps}
            </Alert>

            {nameMissing ? (
              <Alert severity="warning">{he.danger.noName}</Alert>
            ) : (
              <TextField
                label={he.danger.confirmLabel}
                helperText={`${he.danger.confirmHelp} – "${scope?.synagogueName ?? ''}"`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                fullWidth
              />
            )}

            {error !== null ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScope(null)} disabled={busy}>
            {he.importer.cancel}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!matches || busy}
            onClick={() => void confirmDelete()}
          >
            {he.danger.confirmButton}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
