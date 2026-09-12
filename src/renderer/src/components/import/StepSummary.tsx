import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ImportResultDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * שלב 6 – סיכום.
 *
 * השורות שדולגו מוצגות עם הסיבה ועם מספר השורה. "דולגו 12 שורות" בלי
 * לומר אילו ולמה משאיר את הגבאי בלי שום דרך לדעת מה חסר לו.
 */

export interface StepSummaryProps {
  result: ImportResultDto | null;
}

export function StepSummary({ result }: StepSummaryProps) {
  if (result === null) return <Alert severity="error">{he.importer.summaryFailed}</Alert>;

  const skipped = result.sheets.filter((s) => s.skipped.length > 0);

  return (
    <Stack spacing={2}>
      <Alert severity="success">
        {he.importer.summaryTitle}: {he.importer.done.insert} {result.totals.insert},{' '}
        {he.importer.done.update} {result.totals.update}, {he.importer.done.enrich}{' '}
        {result.totals.enrich}, {he.importer.done.skip} {result.totals.skip}
      </Alert>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{he.importer.entity}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.done.insert}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.done.update}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.done.enrich}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>{he.importer.done.skip}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.sheets.map((sheet) => (
              <TableRow key={sheet.entityLabel}>
                <TableCell>{sheet.entityLabel}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{sheet.insert}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{sheet.update}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{sheet.enrich}</TableCell>
                <TableCell sx={{ textAlign: 'start' }}>{sheet.skip}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {skipped.map((sheet) => (
        <Accordion key={sheet.entityLabel} disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              {sheet.entityLabel} – {he.importer.skippedRows}: {sheet.skipped.length}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Table size="small">
              <TableBody>
                {sheet.skipped.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell sx={{ width: 100 }}>{row.row}</TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}
