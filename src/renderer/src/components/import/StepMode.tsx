import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import type { ImportModeDto, ImportModeInfoDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * שלב 1 – שיטת הייבוא.
 *
 * ארבע האפשרויות מוצגות כארבעה כרטיסים ולא כרשימה נפתחת: ההבדל ביניהן
 * הוא ההבדל בין "יתווספו 90 חברים" לבין "ימחקו 90 חברים ויתווספו 90",
 * והוא חייב להיות קריא לפני הבחירה ולא אחריה.
 */

export interface StepModeProps {
  modes: ImportModeInfoDto[];
  value: ImportModeDto;
  onChange: (mode: ImportModeDto) => void;
}

export function StepMode({ modes, value, onChange }: StepModeProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {he.importer.modeIntro}
      </Typography>

      <Stack spacing={1.5}>
        {modes.map((info) => {
          const selected = info.mode === value;
          return (
            <Card
              key={info.mode}
              variant="outlined"
              sx={{
                borderColor: selected ? 'primary.main' : undefined,
                borderWidth: selected ? 2 : 1,
              }}
            >
              <CardActionArea onClick={() => onChange(info.mode)}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1">{info.label}</Typography>
                    {info.danger !== null ? (
                      <Chip size="small" color="error" label={he.importer.irreversible} />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {info.description}
                  </Typography>
                  {info.danger !== null && selected ? (
                    <Alert severity="error" sx={{ mt: 1.5 }}>
                      {info.danger}
                    </Alert>
                  ) : null}
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
}
