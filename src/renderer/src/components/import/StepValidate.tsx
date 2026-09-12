import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ImportPreflightDto, ImportValidationDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * שלב 4 – בדיקת התקינות.
 *
 * **שום דבר לא נכתב עד שכל הקובץ נבדק.** דוח עם 40 שגיאות שהגבאי מתקן
 * בבת אחת עדיף על ייבוא שנעצר בשורה 12 ומשאיר חצי מצב.
 *
 * השגיאות מקובצות לפי צורה ולא מוצגות אחת-אחת: קובץ עם 300 תרומות שבו
 * עמודת התאריך בפורמט שגוי מייצר 300 שגיאות זהות, וזו רשימה שאיש לא
 * קורא.
 */

export interface StepValidateProps {
  preflight: ImportPreflightDto | null;
  validation: ImportValidationDto | null;
  busy: boolean;
}

export function StepValidate({ preflight, validation, busy }: StepValidateProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.importer.validateIntro}
      </Typography>

      {preflight?.problems.map((problem) => (
        <Alert
          key={problem.sheetName}
          severity={problem.missingRequired.length > 0 ? 'error' : 'info'}
        >
          <AlertTitle>{problem.entityLabel}</AlertTitle>
          {problem.missingRequired.length > 0 ? (
            <div>
              {he.importer.missingRequired}: {problem.missingRequired.join(', ')}
            </div>
          ) : null}
          {problem.ignoredColumns.length > 0 ? (
            <div>
              {he.importer.ignoredColumns}: {problem.ignoredColumns.join(', ')}
            </div>
          ) : null}
        </Alert>
      ))}

      {preflight?.missingDependencies.map((dep) => (
        <Alert severity="warning" key={`${dep.entityLabel}-${dep.needsLabel}`}>
          {he.importer.missingDependency
            .replace('{entity}', dep.entityLabel)
            .replace('{needs}', dep.needsLabel)}
        </Alert>
      ))}

      {validation === null ? (
        busy ? (
          <Box>
            <Typography variant="body2">{he.importer.checking}</Typography>
            <LinearProgress sx={{ mt: 1 }} />
          </Box>
        ) : null
      ) : (
        <>
          {validation.blocks.map((block) => (
            <Alert severity="error" key={block.entityLabel}>
              <AlertTitle>
                {he.importer.blocked} – {block.entityLabel}
              </AlertTitle>
              {block.message}
            </Alert>
          ))}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip color="success" label={`${he.importer.rowsOk}: ${validation.totalRows}`} />
            <Chip
              color={validation.totalRejected > 0 ? 'error' : 'default'}
              label={`${he.importer.rowsRejected}: ${validation.totalRejected}`}
            />
            <Chip
              color={validation.errors > 0 ? 'error' : 'default'}
              variant="outlined"
              label={`${he.importer.errors}: ${validation.errors}`}
            />
            <Chip
              color={validation.warnings > 0 ? 'warning' : 'default'}
              variant="outlined"
              label={`${he.importer.warnings}: ${validation.warnings}`}
            />
          </Stack>

          {validation.issues.length === 0 ? (
            <Alert severity="success">{he.importer.noIssues}</Alert>
          ) : (
            <Paper variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{he.importer.sheet}</TableCell>
                    <TableCell>{he.importer.column}</TableCell>
                    <TableCell>{he.importer.issueText}</TableCell>
                    <TableCell sx={{ textAlign: 'start' }}>{he.importer.issueCount}</TableCell>
                    <TableCell>{he.importer.sampleRows}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {validation.issues.map((issue, index) => (
                    <TableRow key={`${issue.sheet}-${issue.column}-${index}`}>
                      <TableCell>{issue.sheet}</TableCell>
                      <TableCell>{issue.column}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            color={issue.severity === 'error' ? 'error' : 'warning'}
                            label={
                              issue.severity === 'error' ? he.importer.errors : he.importer.warnings
                            }
                          />
                          <Typography variant="body2">{issue.message}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ textAlign: 'start' }}>{issue.count}</TableCell>
                      <TableCell>{issue.sampleRows.join(', ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}

          {validation.canImport ? null : <Alert severity="error">{he.importer.cannotImport}</Alert>}
        </>
      )}
    </Stack>
  );
}
