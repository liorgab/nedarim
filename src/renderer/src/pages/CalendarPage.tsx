import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableViewIcon from '@mui/icons-material/TableView';
import TodayIcon from '@mui/icons-material/Today';
import type { CalendarDayDto } from '@shared/api';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { KpiPanel, type Kpi } from '../components/KpiPanel';
import { formatDate, todayIso } from '../lib/format';
import { he } from '../i18n/he';

/**
 * F-90 – לוח שנה: תאריך לועזי, תאריך עברי מקביל, יום בשבוע, חג ופרשה.
 *
 * הכול נגזר ב-main מהתאריך הלועזי (אין טבלת לוח ב-DB), והמסך הוא תצוגה
 * בלבד. הייצוא וההדפסה נבנים גם הם ב-main מאותו טווח בדיוק, כדי שמה
 * שמודפס יהיה מה שנראה על המסך ולא חישוב שני.
 */

type RowFilter = 'all' | 'shabbat' | 'holiday' | 'shabbatOrHoliday';

export interface CalendarPageProps {
  onNotify: (message: string) => void;
}

export function CalendarPage({ onNotify }: CalendarPageProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [rows, setRows] = useState<CalendarDayDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ברירת המחדל בפתיחה: החודש הלועזי הנוכחי. הגבולות מחושבים ב-main כדי
  // שלא יהיו שני חישובי "סוף חודש" במערכת.
  useEffect(() => {
    void window.api.calendar
      .monthRange(todayIso())
      .then((r) => {
        setFrom(r.from);
        setTo(r.to);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (from === '' || to === '') return;
    setError(null);
    void window.api.calendar
      .range(from, to)
      .then(setRows)
      .catch((e: unknown) => {
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [from, to]);

  /** מזיז את הטווח בחודשים שלמים, כדי שדפדוף יהיה לחיצה אחת. */
  function shiftMonths(delta: number): void {
    if (from === '') return;
    const d = new Date(`${from}T00:00:00`);
    const moved = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    const iso = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-01`;
    void window.api.calendar.monthRange(iso).then((r) => {
      setFrom(r.from);
      setTo(r.to);
    });
  }

  function goToday(): void {
    void window.api.calendar.monthRange(todayIso()).then((r) => {
      setFrom(r.from);
      setTo(r.to);
    });
  }

  async function run(action: () => Promise<string | null>, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const path = await action();
      // `null` = הגבאי ביטל את הדיאלוג. זו לא שגיאה ולא הצלחה.
      if (path !== null) onNotify(`${done}: ${path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (rowFilter === 'shabbat' && !r.isShabbat) return false;
      if (rowFilter === 'holiday' && !r.isHoliday) return false;
      if (rowFilter === 'shabbatOrHoliday' && !r.isShabbat && !r.isHoliday) return false;
      if (q === '') return true;
      return [r.hebrew, r.parasha, r.holiday, r.occasion, r.dayOfWeek]
        .filter((v): v is string => v !== null)
        .some((v) => v.includes(q));
    });
  }, [rows, search, rowFilter]);

  const kpis: readonly Kpi[] = useMemo(() => {
    const shabbatot = filtered.filter((r) => r.isShabbat).length;
    const holidays = filtered.filter((r) => r.isHoliday).length;
    const parashot = new Set(
      filtered.filter((r) => r.parasha !== null).map((r) => r.parasha),
    ).size;
    const years = new Set(filtered.map((r) => r.hebrewYear));
    return [
      { key: 'days', label: he.calendar.kpis.days, value: String(filtered.length) },
      { key: 'shabbatot', label: he.calendar.kpis.shabbatot, value: String(shabbatot) },
      { key: 'holidays', label: he.calendar.kpis.holidays, value: String(holidays) },
      { key: 'parashot', label: he.calendar.kpis.parashot, value: String(parashot) },
      { key: 'years', label: he.calendar.kpis.hebrewYears, value: [...years].join(', ') || '—' },
    ];
  }, [filtered]);

  const columns: ReadonlyArray<Column<CalendarDayDto>> = useMemo(
    () => [
      {
        id: 'gregorian',
        label: he.calendar.columns.gregorian,
        width: 120,
        sortValue: (r) => r.gregorian,
        render: (r) => (
          <Typography
            component="span"
            sx={{ fontWeight: r.isShabbat || r.isHoliday ? 700 : 400 }}
          >
            {formatDate(r.gregorian)}
          </Typography>
        ),
      },
      {
        id: 'dayOfWeek',
        label: he.calendar.columns.dayOfWeek,
        width: 80,
        sortValue: (r) => r.gregorian,
        render: (r) => r.dayOfWeek,
      },
      {
        id: 'hebrew',
        label: he.calendar.columns.hebrew,
        width: 190,
        // ממוין לפי התאריך הלועזי: מיון אלפביתי של 'כ״ט באלול' הוא חסר משמעות.
        sortValue: (r) => r.gregorian,
        render: (r) => r.hebrew,
      },
      {
        id: 'parasha',
        label: he.calendar.columns.parasha,
        sortValue: (r) => r.parasha,
        render: (r) => r.parasha ?? '',
      },
      {
        id: 'holiday',
        label: he.calendar.columns.holiday,
        sortValue: (r) => r.holiday,
        render: (r) =>
          r.holiday === null ? (
            ''
          ) : (
            <Chip size="small" color="warning" variant="outlined" label={r.holiday} />
          ),
      },
      {
        id: 'occasion',
        label: he.calendar.columns.occasion,
        sortValue: (r) => r.occasion,
        render: (r) => (
          <Typography component="span" variant="body2" color="text.secondary">
            {r.occasion ?? ''}
          </Typography>
        ),
      },
    ],
    [],
  );

  const canAct = rows.length > 0 && !busy;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
        flexWrap="wrap"
        gap={1}
      >
        <Typography variant="h2">{he.calendar.title}</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title={he.calendar.exportCsvHint}>
            <span>
              <Button
                startIcon={<TableViewIcon />}
                disabled={!canAct}
                onClick={() =>
                  void run(
                    () => window.api.calendar.exportRange(from, to, 'csv'),
                    he.calendar.exported,
                  )
                }
              >
                CSV
              </Button>
            </span>
          </Tooltip>
          <Button
            startIcon={<TableViewIcon />}
            disabled={!canAct}
            onClick={() =>
              void run(
                () => window.api.calendar.exportRange(from, to, 'xlsx'),
                he.calendar.exported,
              )
            }
          >
            Excel
          </Button>
          <Button
            startIcon={<PictureAsPdfIcon />}
            disabled={!canAct}
            onClick={() =>
              void run(() => window.api.calendar.printRange(from, to, false), he.calendar.savedPdf)
            }
          >
            PDF
          </Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            disabled={!canAct}
            onClick={() => void run(() => window.api.calendar.printRange(from, to, true), '')}
          >
            {he.calendar.print}
          </Button>
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flex: 'none' }}>
        {he.calendar.hint}
      </Typography>

      {error !== null ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.gregorian}
        storageKey="calendar"
        totalBeforeFilter={rows.length}
        emptyMessage={he.calendar.empty}
        initialSort={{ columnId: 'gregorian', direction: 'asc' }}
        kpiPanel={<KpiPanel kpis={kpis} storageKey="calendar" />}
        filterBar={
          <FilterBar
            storageKey="calendar"
            active={search !== '' || rowFilter !== 'all'}
            activeCount={(search !== '' ? 1 : 0) + (rowFilter !== 'all' ? 1 : 0)}
            onClear={() => {
              setSearch('');
              setRowFilter('all');
            }}
          >
            <TextField
              label={he.calendar.from}
              type="date"
              size="small"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label={he.calendar.to}
              type="date"
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button size="small" onClick={() => shiftMonths(-1)}>
              {he.calendar.prevMonth}
            </Button>
            <Button size="small" startIcon={<TodayIcon />} onClick={goToday}>
              {he.calendar.thisMonth}
            </Button>
            <Button size="small" onClick={() => shiftMonths(1)}>
              {he.calendar.nextMonth}
            </Button>
            <TextField
              label={he.calendar.search}
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <TextField
              select
              label={he.calendar.show}
              size="small"
              sx={{ minWidth: 160 }}
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value as RowFilter)}
            >
              <MenuItem value="all">{he.calendar.filters.all}</MenuItem>
              <MenuItem value="shabbat">{he.calendar.filters.shabbat}</MenuItem>
              <MenuItem value="holiday">{he.calendar.filters.holiday}</MenuItem>
              <MenuItem value="shabbatOrHoliday">{he.calendar.filters.shabbatOrHoliday}</MenuItem>
            </TextField>
          </FilterBar>
        }
      />
    </Box>
  );
}
