import {
  Alert,
  AlertTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ImportModeDto, ImportModeInfoDto, ImportValidationDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * שלב 5 – הייבוא.
 *
 * המסך מציג את **מה שייכתב**, ולא "לחץ לייבוא". המספרים כאן מגיעים
 * מהרצה יבשה שהריצה את הקוד האמיתי והתגלגלה אחורה, ולכן הם מה שיקרה.
 */

export interface StepRunProps {
  mode: ImportModeDto;
  modes: ImportModeInfoDto[];
  validation: ImportValidationDto | null;
}

export function StepRun({ mode, modes, validation }: StepRunProps) {
  const info = modes.find((m) => m.mode === mode) ?? null;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.importer.runIntro}
      </Typography>

      {info === null ? null : (
        <Alert severity={info.danger === null ? 'info' : 'error'}>
          <AlertTitle>{info.label}</AlertTitle>
          {info.danger ?? info.description}
        </Alert>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{he.importer.preview}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.willInsert}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.willUpdate}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.willEnrich}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.willSkip}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(validation?.preview ?? []).map((row) => (
              <TableRow key={row.entityLabel}>
                <TableCell>{row.entityLabel}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{row.insert}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{row.update}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{row.enrich}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{row.skip}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
