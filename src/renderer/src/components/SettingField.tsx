import {
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import type { SettingSpecDto } from '@shared/api';
import { parseShekelInput, shekelToAgorot } from '@shared/money';
import { he } from '../i18n/he';

/**
 * שדה הגדרה יחיד, נבנה מתוך `SettingSpec` של ה-main.
 *
 * חולץ מ-`SettingsPage` כדי שאשף ההתקנה (F-110) יציג **בדיוק** את אותם
 * שדות. שני רנדררים נפרדים היו מתפצלים – שדה שמקבל טיפול מיוחד במסך
 * ההגדרות ולא באשף, או להפך.
 */

/** שמות החודשים הלועזיים, לשדה חודש תחילת השנה הכספית. */
export const MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
] as const;

export interface SettingFieldProps {
  spec: SettingSpecDto;
  value: string;
  onChange: (value: string) => void;
}

export function SettingField({ spec, value, onChange }: SettingFieldProps) {
const set = (_key: string, v: string) => onChange(v);

  if (spec.type === 'bool') {
    return (
      <FormControlLabel
        key={spec.key}
        control={
          <Switch
            checked={value === '1'}
            onChange={(e) => set(spec.key, e.target.checked ? '1' : '0')}
          />
        }
        label={
          <Stack>
            <Typography variant="body2">{spec.label}</Typography>
            {spec.help ? (
              <Typography variant="caption" color="text.secondary">
                {spec.help}
              </Typography>
            ) : null}
          </Stack>
        }
        sx={{ alignItems: 'flex-start', ml: 0, mr: 0 }}
      />
    );
  }

  if (spec.type === 'choice') {
    return (
      <TextField
        select
        key={spec.key}
        label={spec.label}
        value={value}
        onChange={(e) => set(spec.key, e.target.value)}
        helperText={spec.help ?? ' '}
        sx={{ minWidth: 220 }}
      >
        {(spec.choices ?? []).map((c) => (
          <MenuItem key={c.value} value={c.value}>
            {c.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (spec.type === 'month') {
    return (
      <TextField
        select
        key={spec.key}
        label={spec.label}
        value={value}
        onChange={(e) => set(spec.key, e.target.value)}
        helperText={spec.help ?? ' '}
        sx={{ minWidth: 260 }}
      >
        {MONTHS.map((m, i) => (
          <MenuItem key={m} value={String(i + 1)}>
            {m}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (spec.type === 'money') {
    const shekels = value === '' ? '' : String(Number(value) / 100);
    return (
      <TextField
        key={spec.key}
        label={`${spec.label} (₪)`}
        value={shekels}
        onChange={(e) => {
          const parsed = parseShekelInput(e.target.value);
          set(spec.key, parsed === null ? '' : String(shekelToAgorot(parsed)));
        }}
        helperText={spec.help ?? ' '}
        sx={{ minWidth: 260 }}
        inputMode="decimal"
      />
    );
  }

  if (spec.type === 'image' || spec.type === 'path') {
    const pick = async () => {
      const picked =
        spec.type === 'image'
          ? await window.api.configuration.pickImage()
          : await window.api.configuration.pickFolder();
      if (picked) set(spec.key, picked);
    };
    return (
      <Stack key={spec.key} direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label={spec.label}
          value={value}
          onChange={(e) => set(spec.key, e.target.value)}
          helperText={spec.help ?? ' '}
          sx={{ minWidth: 360 }}
          slotProps={{ htmlInput: { dir: 'ltr' } }}
        />
        <Button
          onClick={() => void pick()}
          startIcon={spec.type === 'image' ? <ImageIcon /> : <FolderOpenIcon />}
          sx={{ mt: 0.5 }}
        >
          {he.settings.browse}
        </Button>
        {value ? (
          <Button color="inherit" onClick={() => set(spec.key, '')} sx={{ mt: 0.5 }}>
            {he.settings.clearValue}
          </Button>
        ) : null}
      </Stack>
    );
  }

  return (
    <TextField
      key={spec.key}
      label={spec.label}
      value={value}
      onChange={(e) => set(spec.key, e.target.value)}
      required={spec.required}
      error={spec.required === true && value.trim() === ''}
      helperText={spec.help ?? ' '}
      type={spec.type === 'number' ? 'number' : 'text'}
      sx={{ minWidth: spec.type === 'number' ? 220 : 360 }}
    />
  );
}