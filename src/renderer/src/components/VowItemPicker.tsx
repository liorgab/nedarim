import { useEffect, useState } from 'react';
import {
  Autocomplete,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { VowItemDto } from '@shared/api';
import { he } from '../i18n/he';

/**
 * F-142 – בחירת כיבוד מרשימת הנדרים.
 *
 * הרשימה נטענת **מסוננת לפי המועד שנבחר** ולא במלואה: בשבת רגילה יש 18
 * כיבודים רלוונטיים מתוך 103, וגלילה בכל השאר בזמן שהקהל ממתין היא בדיוק
 * מה שגורם לגבאי לוותר ולהקליד בעצמו.
 *
 * המתג "כל הרשימה" קיים כי הסינון הוא עזרה ולא כלוב: כיבוד שהגבאי מוכר
 * במועד לא שגרתי חייב להיות נגיש בלי לערוך קודם את ההגדרות.
 */

export interface VowItemPickerProps {
  /** המועד שנבחר בטופס. `null` = אין סינון אפשרי, מוצגת כל הרשימה. */
  occasionId: number | null;
  value: VowItemDto | null;
  onChange: (item: VowItemDto | null) => void;
  disabled?: boolean;
  /**
   * מצב טבלה: רק הקומבובוקס, בלי המתג ובלי המונה.
   *
   * בהזנה מרובה יש שורה לכל חבר, ומתג נפרד בכל שורה היה גם רועש וגם
   * מטעה – הבחירה "כל הרשימה" היא החלטה אחת לכל הטבלה.
   */
  dense?: boolean;
  /** במצב `dense` – האם להציג את כל הרשימה. נשלט מבחוץ. */
  showAll?: boolean;
}

export function VowItemPicker({
  occasionId,
  value,
  onChange,
  disabled,
  dense = false,
  showAll = false,
}: VowItemPickerProps) {
  const [ownAll, setOwnAll] = useState(false);
  const all = dense ? showAll : ownAll;
  const setAll = setOwnAll;
  const [items, setItems] = useState<VowItemDto[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const filter = all || occasionId === null ? {} : { occasionId };
    let cancelled = false;
    void window.api.vowItems.list(filter).then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [occasionId, all]);

  // כיבוד שנבחר ואינו ברשימה המסוננת חייב להישאר מוצג, אחרת שינוי המועד
  // היה מוחק בשקט בחירה שהגבאי כבר עשה.
  const options =
    value !== null && !items.some((i) => i.id === value.id) ? [value, ...items] : items;

  return (
    <Stack spacing={0.5} sx={dense ? undefined : { flex: 1, minWidth: 260 }}>
      <Autocomplete
        size={dense ? 'small' : 'medium'}
        options={options}
        value={value}
        onChange={(_, v) => onChange(v)}
        inputValue={input}
        onInputChange={(_, v) => setInput(v)}
        disabled={disabled}
        openOnFocus
        autoHighlight
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        noOptionsText={he.vowItems.noneForOccasion}
        renderOption={(props, option) => {
          const { key, ...rest } = props as { key: string } & Record<string, unknown>;
          return (
            <li key={key} {...rest}>
              <Stack sx={{ width: '100%' }}>
                <Typography variant="body2">{option.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[option.category, option.saleTiming].filter(Boolean).join(' · ')}
                </Typography>
              </Stack>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField {...params} label={he.vowItems.pick} placeholder={he.vowItems.searchItem} />
        )}
      />

      {dense ? null : (
      <Stack direction="row" spacing={1} alignItems="center">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
              disabled={disabled || occasionId === null}
            />
          }
          label={<Typography variant="caption">{he.vowItems.showAll}</Typography>}
        />
        <Chip size="small" variant="outlined" label={`${items.length}`} />
      </Stack>
      )}
    </Stack>
  );
}
