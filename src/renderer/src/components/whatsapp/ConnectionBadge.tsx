import { Chip, Tooltip } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import type { WaState, WaStatusDto } from '@shared/api';
import { formatE164ForDisplay } from '@shared/phone';
import { he } from '../../i18n/he';

/**
 * W-52 – מצב החיבור בסרגל העליון. לחיצה פותחת את חלון WhatsApp Web או
 * מביאה אותו לחזית.
 *
 * מוצג רק כשהמודול דלוק – למי שלא משתמש בוואטסאפ אין סיבה לראות אינדיקטור
 * שתמיד אדום.
 */

const TONE: Record<WaState, 'success' | 'warning' | 'error' | 'default'> = {
  ready: 'success',
  qr: 'warning',
  loading: 'warning',
  stale: 'warning',
  disconnected: 'error',
};

export function ConnectionBadge({ status }: { status: WaStatusDto | null }) {
  if (status === null) return null;

  const label = he.whatsapp.state[status.state];
  const phone = status.phone !== null ? formatE164ForDisplay(status.phone) : '';
  const tooltip = [status.message ?? '', phone].filter(Boolean).join(' · ');

  return (
    <Tooltip title={tooltip || he.whatsapp.badge.openWindow}>
      <Chip
        size="small"
        icon={<WhatsAppIcon />}
        color={TONE[status.state]}
        label={status.state === 'ready' && phone !== '' ? phone : label}
        onClick={() => void window.api.whatsapp.openWindow()}
        sx={{ cursor: 'pointer' }}
      />
    </Tooltip>
  );
}
