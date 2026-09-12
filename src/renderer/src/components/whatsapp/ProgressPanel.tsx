import { useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import type { CampaignDetailDto, CampaignProgressDto } from '@shared/api';
import { he } from '../../i18n/he';

/**
 * W-40..W-43 – מודאל ההתקדמות.
 *
 * הרכיב **מציג בלבד**: המצב מגיע מ-main דרך `campaign:progress`, ולא
 * מחושב כאן. חישוב מקומי היה מתפצל ממה שקורה בפועל ברגע שמשהו נכשל, וזה
 * בדיוק הרגע שבו הגבאי מסתכל על המסך.
 */

export interface ProgressPanelProps {
  progress: CampaignProgressDto | null;
  /** פירוט הפריטים, לרשימה החיה. נטען מחדש כשהמונים משתנים. */
  detail: CampaignDetailDto | null;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  pending: 'default',
  sending: 'info',
  sent: 'success',
  failed: 'error',
  skipped: 'warning',
  unknown: 'warning',
};

export function ProgressPanel({ progress, detail }: ProgressPanelProps) {
  const currentRow = useRef<HTMLTableRowElement | null>(null);

  // הפריט הנוכחי נגלל לתצוגה: ברשימה של 90 חברים הוא יוצא מהמסך אחרי
  // כמה הודעות, והמסך נראה תקוע.
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' });
  }, [progress?.currentItemId]);

  if (progress === null) return <LinearProgress />;

  const done = progress.sent + progress.failed + progress.skipped;
  const percent = progress.total === 0 ? 0 : Math.round((done / progress.total) * 100);

  return (
    <Stack spacing={2}>
      <Box>
        <LinearProgress variant="determinate" value={percent} sx={{ height: 10, borderRadius: 5 }} />
        <Typography variant="caption" color="text.secondary">
          {percent}% · {done}/{progress.total}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip color="success" label={`${he.whatsapp.progress.counters.sent}: ${progress.sent}`} />
        <Chip
          color={progress.failed > 0 ? 'error' : 'default'}
          label={`${he.whatsapp.progress.counters.failed}: ${progress.failed}`}
        />
        <Chip
          color={progress.skipped > 0 ? 'warning' : 'default'}
          label={`${he.whatsapp.progress.counters.skipped}: ${progress.skipped}`}
        />
        <Chip label={`${he.whatsapp.progress.counters.pending}: ${progress.pending}`} />
      </Stack>

      {/* W-41 – שורת הסטאטוס החיה. */}
      <Typography variant="body2" sx={{ minHeight: 24 }}>
        {progress.waitSeconds > 0
          ? he.whatsapp.progress.waiting(progress.waitSeconds)
          : progress.currentName !== null
            ? he.whatsapp.progress.sendingTo(progress.currentName, done + 1, progress.total)
            : ''}
      </Typography>

      {progress.message !== null ? (
        <Alert severity={progress.phase === 'cancelled' ? 'warning' : 'info'}>
          {progress.message}
        </Alert>
      ) : null}

      {progress.phase === 'completed' ? (
        <Alert severity="success">{he.whatsapp.progress.done}</Alert>
      ) : null}

      {/* W-42 – רשימת הפריטים, הנוכחי מודגש. */}
      <Box sx={{ maxHeight: '38vh', overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableBody>
            {(detail?.items ?? []).map((item) => {
              const isCurrent = item.id === progress.currentItemId;
              return (
                <TableRow
                  key={item.id}
                  ref={isCurrent ? currentRow : undefined}
                  sx={{ bgcolor: isCurrent ? 'action.selected' : undefined }}
                >
                  <TableCell sx={{ width: 220 }}>{item.fullName}</TableCell>
                  <TableCell sx={{ width: 120 }}>
                    <Chip
                      size="small"
                      color={STATUS_COLOR[item.status] ?? 'default'}
                      label={
                        (he.whatsapp.progress.itemStatus as Record<string, string>)[item.status] ??
                        item.status
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="error">
                      {item.errorMessage ?? ''}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
