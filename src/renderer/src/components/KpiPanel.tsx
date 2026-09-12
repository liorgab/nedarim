import { useState } from 'react';
import {
  Box,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { he } from '../i18n/he';
import { readPanelState, writePanelState } from '../lib/panelState';

export interface Kpi {
  key: string;
  label: string;
  value: string;
  /** ערך משני קטן מתחת לערך הראשי (למשל "12 תנועות"). */
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
}

export interface KpiPanelProps {
  kpis: readonly Kpi[];
  title?: string;
  /** מפתח לשמירת מצב הפתיחה ב-localStorage – מסך אחד, מפתח אחד. */
  storageKey?: string;
  defaultOpen?: boolean;
}

const toneColor = (tone: Kpi['tone']): string | undefined => {
  if (tone === 'positive') return 'success.main';
  if (tone === 'negative') return 'error.main';
  return undefined;
};

/**
 * סקשן סטטיסטי מתכווץ מעל טבלה אגרגטיבית (CLAUDE.md כלל-על 16).
 * ה-KPIs מגיעים מבחוץ ומחושבים תמיד לפי הסינון הפעיל.
 */
export function KpiPanel({ kpis, title, storageKey, defaultOpen = true }: KpiPanelProps) {
  const [open, setOpen] = useState(() => readPanelState(`kpi:${storageKey}`, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      writePanelState(`kpi:${storageKey}`, next);
      return next;
    });
  };

  return (
    <Paper variant="outlined" sx={{ mb: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1, cursor: 'pointer' }}
        onClick={toggle}
      >
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="h3">{title ?? he.kpi.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {he.kpi.filteredNote}
          </Typography>
        </Stack>
        <Tooltip title={open ? he.kpi.collapse : he.kpi.expand}>
          <IconButton size="small" aria-label={open ? he.kpi.collapse : he.kpi.expand}>
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Divider />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 2,
            p: 2,
          }}
        >
          {kpis.map((k) => (
            <Box key={k.key}>
              <Typography variant="caption" color="text.secondary" display="block">
                {k.label}
              </Typography>
              <Typography variant="h2" sx={{ color: toneColor(k.tone) }}>
                {k.value}
              </Typography>
              {k.hint ? (
                <Typography variant="caption" color="text.secondary">
                  {k.hint}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}
