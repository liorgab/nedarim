import { useMemo, useState } from 'react';
import { Autocomplete, TextField, Typography } from '@mui/material';
import type { MemberWithBalance } from '@shared/types';
import { useAsync } from '../hooks/useAsync';
import { formatAgorot, memberFullName } from '../lib/format';
import { he } from '../i18n/he';

export interface MemberPickerProps {
  value: MemberWithBalance | null;
  onChange: (member: MemberWithBalance | null) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  /** חברים שכבר נבחרו במקום אחר (הזנה מרובה) ולכן לא יוצעו שוב. */
  excludeIds?: readonly number[];
}

/**
 * בחירת חבר בחיפוש חופשי (F-30, F-40) – במפורש לא לפי שורה מסומנת,
 * שזו הייתה הסיבה מספר 3 לטעויות בקובץ הישן.
 */
export function MemberPicker({
  value,
  onChange,
  label = he.members.number,
  autoFocus,
  disabled,
  error,
  helperText,
  excludeIds = [],
}: MemberPickerProps) {
  const [input, setInput] = useState('');
  const { data } = useAsync(() => window.api.members.list({ status: 'active' }), []);

  const options = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.filter((m) => !excludeIds.includes(m.id));
  }, [data, excludeIds]);

  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      disabled={disabled}
      openOnFocus
      autoHighlight
      noOptionsText={he.table.noRows}
      getOptionLabel={(m) => `${m.memberNumber} · ${memberFullName(m)}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim();
        if (q === '') return opts.slice(0, 50);
        return opts
          .filter(
            (m) =>
              memberFullName(m).includes(q) ||
              String(m.memberNumber).startsWith(q) ||
              (m.mobile ?? '').includes(q),
          )
          .slice(0, 50);
      }}
      renderOption={(props, m) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
        return (
          <li key={key} {...rest}>
            <span style={{ flex: 1 }}>
              <strong>{m.memberNumber}</strong> · {memberFullName(m)}
            </span>
            <Typography
              variant="caption"
              color={m.balanceAgorot > 0 ? 'error.main' : 'text.secondary'}
            >
              {formatAgorot(m.balanceAgorot)}
            </Typography>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}
