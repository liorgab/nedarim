import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Backup';
import UsbIcon from '@mui/icons-material/Usb';
import RestoreIcon from '@mui/icons-material/Restore';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import TableViewIcon from '@mui/icons-material/TableView';
import type { BackupInfoDto } from '@shared/api';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, formatBytes, formatDateTime } from '../lib/format';
import { he } from '../i18n/he';

export interface BackupTabProps {
  onNotify: (message: string) => void;
}

/**
 * F-100..F-102, F-104 – גיבוי, שחזור וייצוא מלא.
 *
 * המניפסט של כל גיבוי מוצג בטבלה (כמה חברים, כמה קבלות, סך היתרות) יחד עם
 * תוצאת בדיקת ה-checksum, כדי שהגבאי יראה **לפני** השחזור לאיזה מצב הוא חוזר.
 * גיבוי שה-checksum שלו אינו תואם לא ניתן לשחזור בכלל.
 */
export function BackupTab({ onNotify }: BackupTabProps) {
  const [dir, setDir] = useState<string | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<BackupInfoDto | null>(null);
  const [confirmWord, setConfirmWord] = useState('');

  const list = useAsync(() => window.api.backup.list(dir), [dir, reload]);
  const reminder = useAsync(() => window.api.backup.reminder(), [reload]);

  const backups = list.data?.backups ?? [];

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const create = (external: boolean) =>
    void run(async () => {
      const made = await window.api.backup.create(external);
      if (made) {
        onNotify(he.backup.created(made.name));
        setReload((n) => n + 1);
      }
    });

  const browse = () =>
    void run(async () => {
      const picked = await window.api.backup.browse();
      if (picked) setDir(picked.dir);
    });

  const exportAll = () =>
    void run(async () => {
      const path = await window.api.backup.exportAll();
      if (path !== null) onNotify(he.backup.exported(path));
    });

  const restore = () =>
    void run(async () => {
      if (!confirm) return;
      await window.api.backup.restore(confirm.path);
      // ה-main כבר פתח את בסיס הנתונים המשוחזר. רענון המסך הוא כל מה שנדרש
      // כדי שכל הדפים יטענו את הנתונים החדשים – בלי להפעיל את היישום מחדש.
      window.location.reload();
    });

  return (
    <Stack spacing={2}>
      {error !== null ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {reminder.data?.due === true ? (
        <Alert severity="warning">{he.backup.reminderDue(reminder.data.daysSince)}</Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<BackupIcon />}
            disabled={busy}
            onClick={() => create(false)}
          >
            {he.backup.createInternal}
          </Button>
          <Button startIcon={<UsbIcon />} disabled={busy} onClick={() => create(true)}>
            {he.backup.createExternal}
          </Button>
          <Button startIcon={<FolderOpenIcon />} disabled={busy} onClick={browse}>
            {he.backup.browse}
          </Button>
          <Divider orientation="vertical" flexItem />
          <Button startIcon={<TableViewIcon />} disabled={busy} onClick={exportAll}>
            {he.backup.exportAll}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {he.backup.exportHint}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">{he.backup.folder}:</Typography>
          <Typography variant="body2" sx={{ direction: 'ltr', textAlign: 'start', flexGrow: 1 }}>
            {list.data?.dir ?? ''}
          </Typography>
          {list.data?.dir ? (
            <Tooltip title={he.backup.openFolder}>
              <IconButton aria-label={he.backup.openFolder}
                size="small"
                onClick={() => void window.api.backup.openFolder(list.data!.dir)}
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>

        {backups.length === 0 ? (
          <Alert severity="info">{he.backup.noBackups}</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{he.backup.date}</TableCell>
                <TableCell>{he.backup.contents}</TableCell>
                <TableCell align="right">{he.backup.balance}</TableCell>
                <TableCell align="right">{he.backup.size}</TableCell>
                <TableCell>{he.backup.integrity}</TableCell>
                <TableCell sx={{ width: 120 }}>{he.app.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.path} hover>
                  <TableCell>{formatDateTime(b.createdAt)}</TableCell>
                  <TableCell>
                    {b.manifest
                      ? `${b.manifest.counts.members} ${he.backup.members} · ${b.manifest.counts.receipts} ${he.backup.receipts}`
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {b.manifest ? formatAgorot(b.manifest.totalBalanceAgorot) : '—'}
                  </TableCell>
                  <TableCell align="right">{formatBytes(b.sizeBytes)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={b.valid ? 'success' : 'error'}
                      label={b.valid ? he.backup.valid : he.backup.invalid}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      startIcon={<RestoreIcon />}
                      disabled={!b.valid || busy}
                      onClick={() => {
                        setConfirm(b);
                        setConfirmWord('');
                      }}
                    >
                      {he.backup.restore}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{he.backup.restoreTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{he.backup.restoreWarning}</DialogContentText>
          {confirm?.manifest ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {`${formatDateTime(confirm.createdAt)} · ${confirm.manifest.counts.members} ${he.backup.members} · ${confirm.manifest.counts.receipts} ${he.backup.receipts} · ${he.backup.balance} ${formatAgorot(confirm.manifest.totalBalanceAgorot)}`}
            </Alert>
          ) : null}
          <TextField
            label={he.backup.restoreTypeToConfirm}
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{he.app.cancel}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy || confirmWord.trim() !== he.backup.restoreConfirmWord}
            onClick={restore}
          >
            {he.backup.restoreConfirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
