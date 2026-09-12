import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { he } from '../i18n/he';
import { readPanelState, writePanelState } from '../lib/panelState';

export interface FilterBarProps {
  children: ReactNode;
  onClear?: () => void;
  /** האם יש סינון פעיל – מפעיל את כפתור הניקוי. */
  active?: boolean;
  /** כמה שדות סינון פעילים – מוצג כתג כשהסרגל מכווץ. */
  activeCount?: number;
  /** מפתח לשמירת מצב הפתיחה. מסך אחד, מפתח אחד. */
  storageKey?: string;
  defaultOpen?: boolean;
}

/**
 * מעטפת אחידה לסרגל הסינון שמעל כל טבלה (CLAUDE.md כלל-על 15).
 * מתכווץ ונפתח כמו סקשן ה-KPI, והמצב נשמר לכל מסך – כדי לפנות גובה לטבלה.
 */
export function FilterBar({
  children,
  onClear,
  active = false,
  activeCount,
  storageKey,
  defaultOpen = true,
}: FilterBarProps) {
  const [open, setOpen] = useState(() => readPanelState(`filters:${storageKey}`, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      writePanelState(`filters:${storageKey}`, next);
      return next;
    });
  };

  const count = activeCount ?? (active ? 1 : 0);

  return (
    <Paper variant="outlined" sx={{ mb: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: open ? 1 : 0.5, cursor: 'pointer' }}
        onClick={toggle}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Badge badgeContent={count} color="secondary" invisible={count === 0 || open}>
            <FilterAltIcon fontSize="small" color={count > 0 ? 'secondary' : 'disabled'} />
          </Badge>
          <Typography variant="subtitle2" color="text.secondary">
            {he.table.filters}
          </Typography>
          {!open && count > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {he.table.activeFilters(count)}
            </Typography>
          ) : null}
        </Stack>
        <Tooltip title={open ? he.table.collapseFilters : he.table.expandFilters}>
          <IconButton
            size="small"
            aria-label={open ? he.table.collapseFilters : he.table.expandFilters}
          >
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Divider />
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ px: 2, py: 2 }}
        >
          {children}
          <Button
            size="small"
            startIcon={<FilterAltOffIcon />}
            onClick={onClear}
            disabled={count === 0 || !onClear}
          >
            {he.table.clearFilters}
          </Button>
        </Stack>
      </Collapse>
    </Paper>
  );
}
