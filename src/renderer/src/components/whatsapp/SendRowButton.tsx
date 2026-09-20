import { IconButton, Tooltip } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { he } from '../../i18n/he';
import type { SendabilityState } from '../../hooks/useSendability';

export interface SendRowButtonProps {
  /** `undefined` = הבדיקה עדיין רצה. */
  state: SendabilityState | undefined;
  onSend: () => void;
}

/**
 * W-91 – אייקון "שלח הודעה" בשורת טבלה.
 *
 * הכלל: **אייקון ירוק פירושו שהשליחה תעבוד.** עד היום הוא היה ירוק תמיד,
 * גם לחבר בלי נייד תקין – הגבאי לחץ וקיבל הודעת מערכת שמסבירה שאי אפשר.
 * אייקון שנראה פעיל ואינו פעיל מתגלה רק אחרי הלחיצה; מואפל עם הסבר ב-
 * tooltip אומר מראש מה חסר ומה לתקן.
 */
export function SendRowButton({ state, onSend }: SendRowButtonProps) {
  const loading = state === undefined;
  const reason =
    state?.mobileReason !== undefined
      ? ((he.whatsapp.mobile.reasons as Record<string, string>)[state.mobileReason] ?? '')
      : '';

  const title = loading
    ? he.whatsapp.notify.sendRowChecking
    : state.ok
      ? he.whatsapp.notify.sendRow
      : [state.message, reason].filter(Boolean).join(' – ');

  return (
    <Tooltip title={title}>
      {/* span – MUI אינו מציג tooltip על כפתור מושבת בלי עוטף */}
      <span>
        <IconButton
          aria-label={title}
          size="small"
          color="success"
          disabled={loading || !state.ok}
          onClick={onSend}
        >
          <WhatsAppIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
