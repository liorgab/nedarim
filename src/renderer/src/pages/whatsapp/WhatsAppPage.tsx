import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { WhatsAppModuleStateDto } from '@shared/api';
import { useAsync } from '../../hooks/useAsync';
import { formatDateTime } from '../../lib/format';
import { he } from '../../i18n/he';
import { TemplatesPage } from './TemplatesPage';

export interface WhatsAppPageProps {
  onNotify: (message: string) => void;
  isAdmin: boolean;
  onGoToSettings: () => void;
}

/**
 * מסך המודול. ב-W0 יש בו לשונית אחת (תבניות); לשונית הקמפיינים נוספת ב-W4.
 *
 * כשהמודול כבוי מוצג מסך ההסכמה (W-54) במקום התוכן – אין טעם לתת לגבאי לבנות
 * תבניות לפני שהוא יודע שהשליחה עלולה לחסום את המספר שלו.
 */
export function WhatsAppPage({ onNotify, isAdmin, onGoToSettings }: WhatsAppPageProps) {
  const [reload, setReload] = useState(0);
  const state = useAsync<WhatsAppModuleStateDto>(() => window.api.whatsapp.moduleState(), [reload]);
  const [consentOpen, setConsentOpen] = useState(false);
  const [tab, setTab] = useState<'templates'>('templates');

  if (state.data && !state.data.enabled) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <Typography variant="h2" sx={{ mb: 2 }}>
          {he.whatsapp.title}
        </Typography>
        <Alert
          severity="warning"
          icon={<WarningAmberIcon />}
          action={
            isAdmin ? (
              <Button color="inherit" size="small" onClick={() => setConsentOpen(true)}>
                {he.whatsapp.consent.accept}
              </Button>
            ) : (
              <Button color="inherit" size="small" onClick={onGoToSettings}>
                {he.whatsapp.goToSettings}
              </Button>
            )
          }
        >
          {he.whatsapp.disabled}
        </Alert>

        <ConsentDialog
          open={consentOpen}
          onClose={() => setConsentOpen(false)}
          onAccepted={() => {
            setConsentOpen(false);
            setReload((n) => n + 1);
          }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1, flex: 'none' }}>
        <Typography variant="h2">{he.whatsapp.title}</Typography>
        {state.data?.consentAcceptedAt ? (
          <Typography variant="caption" color="text.secondary">
            {he.whatsapp.consent.accepted(formatDateTime(state.data.consentAcceptedAt))}
          </Typography>
        ) : null}
      </Stack>

      <Tabs value={tab} onChange={(_, v: 'templates') => setTab(v)} sx={{ mb: 2, flex: 'none' }}>
        <Tab value="templates" label={he.whatsapp.tabs.templates} />
      </Tabs>

      <TemplatesPage onNotify={onNotify} canEdit={isAdmin} />
    </Box>
  );
}

/** W-54 – אזהרת השימוש. מוצגת פעם אחת, ונרשמת ב-audit עם המשתמש והשעה. */
export function ConsentDialog({
  open,
  onClose,
  onAccepted,
}: {
  open: boolean;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.whatsapp.acceptConsent();
      setChecked(false);
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{he.whatsapp.consent.title}</DialogTitle>
      <DialogContent>
        {error !== null ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <DialogContentText sx={{ mb: 2 }}>{he.whatsapp.consent.body}</DialogContentText>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {he.whatsapp.consent.recommendation}
        </Alert>
        <FormControlLabel
          control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
          label={he.whatsapp.consent.checkbox}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {he.app.cancel}
        </Button>
        <Button variant="contained" disabled={!checked || busy} onClick={() => void accept()}>
          {he.whatsapp.consent.accept}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
