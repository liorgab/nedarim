import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { BackupInfoDto, ImportEntityDto, ImportFileDto } from '@shared/api';
import { formatAgorot, formatBytes, formatDateTime } from '../../lib/format';
import { he } from '../../i18n/he';

/**
 * שלב 2 – בחירת הקובץ.
 *
 * הורדת התבנית נמצאת כאן, לפני הבחירה, ולא במסך נפרד: זה הרגע שבו מתברר
 * שאין מה לבחור.
 */

export interface StepFileProps {
  file: ImportFileDto | null;
  catalog: ImportEntityDto[];
  /** הגיבויים שנמצאו בתיקייה שנבחרה, אם נבחרה. */
  backups: BackupInfoDto[] | null;
  onChoose: () => void;
  onChooseBackup: () => void;
  onRestore: (backup: BackupInfoDto) => void;
  onDownloadTemplate: () => void;
}

export function StepFile({
  file,
  catalog,
  backups,
  onChoose,
  onChooseBackup,
  onRestore,
  onDownloadTemplate,
}: StepFileProps) {
  const labelOf = (id: string): string =>
    catalog.find((e) => e.id === id)?.label ?? id;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.importer.fileIntro}
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="outlined" onClick={onDownloadTemplate}>
            {he.importer.downloadTemplate}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 260 }}>
            {he.importer.templateHelp}
          </Typography>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" onClick={onChoose}>
          {file === null ? he.importer.chooseFile : he.importer.replaceFile}
        </Button>
        <Button variant="text" onClick={onChooseBackup}>
          {he.importer.chooseBackup}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {he.importer.backupHelp}
      </Typography>

      {backups === null ? null : (
        <Paper variant="outlined">
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="subtitle2">
              {he.importer.backupsFound}: {backups.length}
            </Typography>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{he.importer.backupContents}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{he.backup.balance}</TableCell>
                <TableCell sx={{ textAlign: 'start' }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {backups.map((backup) => (
                <TableRow key={backup.path}>
                  <TableCell>
                    <Typography variant="body2">{formatDateTime(backup.createdAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {backup.manifest === null
                        ? backup.name
                        : `${backup.manifest.counts.members} ${he.backup.members} · ` +
                          `${backup.manifest.counts.receipts} ${he.backup.receipts} · ` +
                          formatBytes(backup.sizeBytes)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: 'start' }}>
                    {backup.manifest === null
                      ? '—'
                      : formatAgorot(backup.manifest.totalBalanceAgorot)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'start' }}>
                    {backup.valid ? (
                      <Button size="small" variant="outlined" onClick={() => onRestore(backup)}>
                        {he.importer.restore}
                      </Button>
                    ) : (
                      <Chip size="small" color="error" label={he.importer.backupInvalid} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {file === null ? null : (
        <Paper variant="outlined">
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="subtitle2">
              {he.importer.chosenFile}: {file.fileName}
            </Typography>
          </Box>

          {file.sheets.length === 0 ? (
            <Alert severity="warning" sx={{ m: 2 }}>
              {he.importer.noSheets}
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{he.importer.sheet}</TableCell>
                  <TableCell>{he.importer.entity}</TableCell>
                  <TableCell sx={{ textAlign: 'start' }}>{he.importer.rowsInSheet}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {file.sheets.map((sheet) => (
                  <TableRow key={sheet.index}>
                    <TableCell>{sheet.sheetName}</TableCell>
                    <TableCell>
                      {sheet.entity === null ? (
                        <Chip size="small" color="warning" label={he.importer.notDetected} />
                      ) : (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2">{labelOf(sheet.entity)}</Typography>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={sheet.detectedBy === 'sheet_name' ? 'success' : 'default'}
                            label={
                              sheet.detectedBy === 'sheet_name'
                                ? he.importer.detectedByName
                                : he.importer.detectedByHeaders
                            }
                          />
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell sx={{ textAlign: 'start' }}>{sheet.dataRows}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}
    </Stack>
  );
}
