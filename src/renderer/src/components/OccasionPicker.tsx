import { useMemo } from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';
import type { Occasion } from '@shared/types';
import { useAsync } from '../hooks/useAsync';
import { he } from '../i18n/he';

const TYPE_LABEL: Record<Occasion['type'], string> = {
  parasha: 'פרשה',
  holiday: 'חג',
  event: 'אירוע',
  credit: 'זיכוי',
  opening: 'פתיחה',
  other: 'אחר',
};

export interface OccasionPickerProps {
  value: number | null;
  onChange: (occasionId: number | null) => void;
  /** לצמצם לסוגים מסוימים – למשל רק 'credit' בטופס הזיכוי. */
  types?: ReadonlyArray<Occasion['type']>;
  label?: string;
  error?: boolean;
  helperText?: string;
}

/** רשימה נפתחת עם חיפוש (F-31). ערך חובה מרשימה סגורה – אין יותר טקסט חופשי. */
export function OccasionPicker({
  value,
  onChange,
  types,
  label = he.card.occasion,
  error,
  helperText,
}: OccasionPickerProps) {
  const { data } = useAsync(() => window.api.lookups.occasions(false), []);

  const options = useMemo(() => {
    const all = data ?? [];
    return types ? all.filter((o) => types.includes(o.type)) : all;
  }, [data, types]);

  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_, v) => onChange(v?.id ?? null)}
      openOnFocus
      autoHighlight
      groupBy={(o) => TYPE_LABEL[o.type]}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText={he.table.noRows}
      renderOption={(props, o) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
        return (
          <li key={key} {...rest}>
            <span style={{ flex: 1 }}>{o.name}</span>
            <Chip size="small" variant="outlined" label={TYPE_LABEL[o.type]} />
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={label} error={error} helperText={helperText} />
      )}
    />
  );
}
