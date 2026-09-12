import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type {
  ImportEntityDto,
  ImportEntityIdDto,
  ImportFieldMappingDto,
  ImportFileDto,
  ImportSheetDto,
} from '@shared/api';
import { he } from '../../i18n/he';

/**
 * שלב 3 – מיפוי השדות.
 *
 * כשהקובץ הוא התבנית כל ההתאמות ודאיות והמסך עובר בלחיצה. הוא קיים
 * בשביל הקובץ שהגבאי ניהל שנים, ולכן מה שהוא מדגיש הוא בדיוק מה שלא
 * ודאי: ניחושים, שדות חובה שלא מופו ועמודות שלא ייובאו.
 */

export interface StepMappingProps {
  file: ImportFileDto;
  catalog: ImportEntityDto[];
  onPatch: (
    index: number,
    patch: {
      entity?: ImportEntityIdDto | null;
      include?: boolean;
      mapping?: ImportFieldMappingDto[];
    },
  ) => void;
}

export function StepMapping({ file, catalog, onPatch }: StepMappingProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.importer.mappingIntro}
      </Typography>

      {file.sheets.map((sheet) => (
        <SheetPanel
          key={sheet.index}
          sheet={sheet}
          catalog={catalog}
          onPatch={(patch) => onPatch(sheet.index, patch)}
        />
      ))}
    </Stack>
  );
}

interface SheetPanelProps {
  sheet: ImportSheetDto;
  catalog: ImportEntityDto[];
  onPatch: (patch: {
    entity?: ImportEntityIdDto | null;
    include?: boolean;
    mapping?: ImportFieldMappingDto[];
  }) => void;
}

function SheetPanel({ sheet, catalog, onPatch }: SheetPanelProps) {
  const entity = catalog.find((e) => e.id === sheet.entity) ?? null;
  const guesses = sheet.mapping.filter((m) => m.quality === 'likely').length;
  const missing =
    entity === null
      ? []
      : entity.fields
          .filter(
            (f) =>
              f.required &&
              sheet.mapping.find((m) => m.field === f.label)?.column == null,
          )
          .map((f) => f.label);

  function setColumn(field: string, column: number | null): void {
    onPatch({
      mapping: sheet.mapping.map((m) =>
        // שינוי ידני הוא תמיד ודאי: המשתמש הכריע, ואין עוד מה לאשר.
        m.field === field ? { ...m, column, quality: column === null ? 'none' : 'exact' } : m,
      ),
    });
  }

  return (
    <Accordion defaultExpanded={sheet.include} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ width: '100%', pe: 2 }}
          flexWrap="wrap"
          useFlexGap
        >
          <FormControlLabel
            onClick={(e) => e.stopPropagation()}
            control={
              <Checkbox
                checked={sheet.include}
                onChange={(e) => onPatch({ include: e.target.checked })}
              />
            }
            label={he.importer.include}
          />
          <Typography variant="subtitle2">{sheet.sheetName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {sheet.dataRows} {he.importer.rowsInSheet}
          </Typography>
          {missing.length > 0 ? (
            <Chip size="small" color="error" label={`${he.importer.missingRequired}: ${missing.length}`} />
          ) : null}
          {guesses > 0 ? (
            <Chip size="small" color="warning" label={`${he.importer.quality.likely}: ${guesses}`} />
          ) : null}
        </Stack>
      </AccordionSummary>

      <AccordionDetails>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            size="small"
            label={he.importer.entity}
            value={sheet.entity ?? ''}
            onChange={(e) =>
              onPatch({ entity: e.target.value === '' ? null : (e.target.value as ImportEntityIdDto) })
            }
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="">{he.importer.notDetected}</MenuItem>
            {catalog.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {e.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {entity === null ? null : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{he.importer.field}</TableCell>
                <TableCell>{he.importer.column}</TableCell>
                <TableCell>{he.importer.matchState}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entity.fields.map((field) => {
                const map = sheet.mapping.find((m) => m.field === field.label);
                return (
                  <TableRow key={field.label}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Tooltip title={field.help} placement="top">
                          <Typography variant="body2">{field.label}</Typography>
                        </Tooltip>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={field.required ? 'error' : 'success'}
                          label={field.required ? he.importer.required : he.importer.optional}
                        />
                        {field.refLabel === null ? null : (
                          <Chip size="small" variant="outlined" label={field.refLabel} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={map?.column ?? ''}
                        onChange={(e) =>
                          setColumn(
                            field.label,
                            e.target.value === '' ? null : Number(e.target.value),
                          )
                        }
                        sx={{ minWidth: 200 }}
                      >
                        <MenuItem value="">{he.importer.notMapped}</MenuItem>
                        {sheet.headers.map((header, index) => (
                          <MenuItem key={`${header}-${index}`} value={index}>
                            {header === '' ? `#${index + 1}` : header}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <QualityChip quality={map?.quality ?? 'none'} required={field.required} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function QualityChip({
  quality,
  required,
}: {
  quality: ImportFieldMappingDto['quality'];
  required: boolean;
}) {
  if (quality === 'exact') {
    return <Chip size="small" color="success" variant="outlined" label={he.importer.quality.exact} />;
  }
  if (quality === 'likely') {
    return <Chip size="small" color="warning" label={he.importer.quality.likely} />;
  }
  // שדה רשות שלא מופה הוא מצב תקין לחלוטין, ואין סיבה לצבוע אותו באדום.
  return (
    <Chip
      size="small"
      color={required ? 'error' : 'default'}
      variant={required ? 'filled' : 'outlined'}
      label={he.importer.quality.none}
    />
  );
}
