import { useEffect, useState } from 'react';
import {
  Alert,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type { NotifyEventDefDto, NotifyModeDto, NotifySettingsDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * W-82 – מה קורה בכל אירוע כספי.
 *
 * הכול כבוי כברירת מחדל (מיגרציה 007): מערכת שמישהו הוריד מ-GitHub לא
 * שולחת הודעות לחברים שלו עד שהוא מחליט על כך במפורש.
 *
 * `auto` מוצג אך חסום: שליחה ללא אישור דורשת מנוע קמפיינים שירוץ ברקע
 * (W3). עדיף להראות שהאפשרות קיימת ומתי היא תגיע, מאשר להסתיר אותה
 * ולהשאיר את הגבאי בהנחה שאין כזו.
 */

const MODES: readonly NotifyModeDto[] = ['off', 'ask', 'auto'];

export interface NotifySettingsPanelProps {
  onNotify: (message: string) => void;
}

export function NotifySettingsPanel({ onNotify }: NotifySettingsPanelProps) {
  const [events, setEvents] = useState<NotifyEventDefDto[]>([]);
  const [settings, setSettings] = useState<NotifySettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([window.api.notifications.events(), window.api.notifications.settings()])
      .then(([e, s]) => {
        setEvents(e);
        setSettings(s);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function change(kind: NotifyEventDefDto['kind'], mode: NotifyModeDto): Promise<void> {
    setError(null);
    try {
      await window.api.notifications.setMode(kind, mode);
      setSettings(await window.api.notifications.settings());
      onNotify(he.settings.saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {he.whatsapp.notify.settingsTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {he.whatsapp.notify.settingsHint}
      </Typography>

      {error !== null ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Table size="small" sx={{ direction: 'rtl' }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ textAlign: 'start' }}>{he.whatsapp.notify.column}</TableCell>
            <TableCell sx={{ textAlign: 'start' }}>{he.whatsapp.notify.modeColumn}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.kind}>
              <TableCell sx={{ textAlign: 'start' }}>{event.label}</TableCell>
              <TableCell sx={{ textAlign: 'start' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    select
                    size="small"
                    sx={{ minWidth: 220 }}
                    value={settings?.[event.kind] ?? 'off'}
                    onChange={(e) => void change(event.kind, e.target.value as NotifyModeDto)}
                  >
                    {MODES.map((mode) => (
                      <MenuItem key={mode} value={mode} disabled={mode === 'auto'}>
                        {he.whatsapp.notify.mode[mode]}
                      </MenuItem>
                    ))}
                  </TextField>
                  {settings?.[event.kind] === 'auto' ? (
                    <Typography variant="caption" color="text.secondary">
                      {he.whatsapp.notify.autoUnavailable}
                    </Typography>
                  ) : null}
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {he.whatsapp.notify.autoUnavailable}
      </Typography>
    </Paper>
  );
}
