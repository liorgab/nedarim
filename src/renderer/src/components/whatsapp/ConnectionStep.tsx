import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import type { CampaignEstimateDto, WaStatusDto } from '@shared/api';
import { formatE164ForDisplay } from '@shared/phone';
import { he } from '../../i18n/he';

export interface ConnectionStepProps {
  status: WaStatusDto | null;
  recipientCount: number;
}

/**
 * שלב 3 באשף – חיבור וקצב (W-3x).
 *
 * המעבר לשלב הבא חסום עד `ready`. זו לא הקפדה טכנית: התחלת קמפיין בלי
 * חיבור פירושה שכל הפריטים ייכשלו ב-`not_connected` אחד אחרי השני.
 */
export function ConnectionStep({ status, recipientCount }: ConnectionStepProps) {
  const [estimate, setEstimate] = useState<CampaignEstimateDto | null>(null);

  useEffect(() => {
    void window.api.whatsapp.estimate(recipientCount).then(setEstimate);
  }, [recipientCount]);

  const state = status?.state ?? 'disconnected';
  const phone = status?.phone !== null && status?.phone !== undefined ? status.phone : null;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
          <Chip
            icon={<WhatsAppIcon />}
            color={state === 'ready' ? 'success' : state === 'disconnected' ? 'error' : 'warning'}
            label={he.whatsapp.state[state]}
          />
          {state === 'ready' && phone !== null ? (
            <Typography variant="body2">
              {he.whatsapp.connection.connectedAs(formatE164ForDisplay(phone))}
            </Typography>
          ) : null}
        </Stack>

        {state === 'ready' ? (
          phone !== null ? (
            <Alert severity="info">{he.whatsapp.connection.confirmNumber}</Alert>
          ) : (
            <Alert severity="warning">{he.whatsapp.connection.noPhone}</Alert>
          )
        ) : null}

        {state === 'qr' ? <Alert severity="info">{he.whatsapp.connection.scanHint}</Alert> : null}
        {state === 'stale' ? (
          <Alert severity="warning">{he.whatsapp.connection.staleHint}</Alert>
        ) : null}
        {state === 'disconnected' ? (
          <Alert severity="error">{he.whatsapp.connection.mustConnect}</Alert>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={<WhatsAppIcon />}
            onClick={() => void window.api.whatsapp.openWindow()}
          >
            {he.whatsapp.connection.open}
          </Button>
          {status?.windowOpen ? (
            <Button onClick={() => void window.api.whatsapp.hideWindow()}>
              {he.whatsapp.connection.hide}
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button
            color="error"
            startIcon={<LinkOffIcon />}
            onClick={() => {
              if (window.confirm(he.whatsapp.connection.logoutConfirm)) {
                void window.api.whatsapp.logout();
              }
            }}
          >
            {he.whatsapp.connection.logout}
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {he.whatsapp.rate.title}
        </Typography>
        {estimate === null ? null : (
          <Stack spacing={0.5}>
            <Typography variant="body2">
              {he.whatsapp.rate.estimate(
                `${formatSeconds(estimate.minSeconds)} – ${formatSeconds(estimate.maxSeconds)}`,
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {he.whatsapp.rate.remaining(estimate.remainingToday)}
            </Typography>
            {estimate.willExceedCap ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {he.whatsapp.rate.exceeds(recipientCount, estimate.remainingToday)}
              </Alert>
            ) : null}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

/** ניסוח משך בעברית. מקביל ל-`formatDuration` ב-main, לתצוגה בלבד. */
function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} שנ׳`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} שע׳` : `${hours} שע׳ ${rest} דק׳`;
}
