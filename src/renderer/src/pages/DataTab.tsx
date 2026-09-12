import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
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
import type { DeletionScopeDto } from '@shared/api';
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
  /** מעבר ללשונית הגיבויים, לשחזור מגיבוי שנבחר. */
  onGoToBackups: () => void;
}

export function DataTab({ onNotify, onChanged, onGoToBackups }: DataTabProps) {
  const [wizard, setWizard] = useState(false);
  const [scope, setScope] = useState<DeletionScopeDto | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const nameMissing = scope !== null && scope.synagogueName === '';
  // אותה נורמליזציה שב-`dangerZone.confirmationMatches`: כפתור שמושבת
  // בזמן שהשרת היה מקבל את ההקלדה הוא באג שקשה להבין אותו מהמסך.
  const normalize = (v: string): string =>
    v.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
  const matches =
    scope !== null &&
    normalize(typed) !== '' &&
    normalize(typed) === normalize(scope.synagogueName);

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

      <ImportWizard
        open={wizard}
        onClose={() => setWizard(false)}
        onImported={() => {
          onChanged();
          onNotify(he.importer.summaryTitle);
        }}
        onRestoreRequested={() => {
          setWizard(false);
          onGoToBackups();
        }}
      />

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
