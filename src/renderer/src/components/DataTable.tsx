import { useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Checkbox,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import { he } from '../i18n/he';

export interface Column<TRow> {
  /** מזהה ייחודי, משמש גם כמפתח המיון. */
  id: string;
  label: string;
  /** ערך גולמי למיון. אם לא סופק – העמודה אינה ניתנת למיון משמעותי. */
  sortValue?: (row: TRow) => string | number | null;
  render: (row: TRow) => ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: number | string;
  /** עמודה שלא ניתן למיין לפיה (למשל עמודת פעולות). */
  notSortable?: boolean;
}

export interface DataTableProps<TRow> {
  columns: ReadonlyArray<Column<TRow>>;
  rows: readonly TRow[];
  rowKey: (row: TRow) => string | number;
  /** סרגל הסינון של המסך (כלל-על 15). */
  filterBar?: ReactNode;
  /** סקשן ה-KPI המתכווץ (כלל-על 16). */
  kpiPanel?: ReactNode;
  /** סך השורות לפני סינון, להצגת "מוצגות X מתוך Y". */
  totalBeforeFilter?: number;
  emptyMessage?: string;
  initialSort?: { columnId: string; direction: 'asc' | 'desc' };
  /** מפתח לשמירת המיון לכל מסך (כלל-על 14: "המצב נשמר לכל מסך"). */
  storageKey?: string;
  onRowClick?: (row: TRow) => void;
  footer?: ReactNode;
  dense?: boolean;
  /**
   * true (ברירת מחדל) – הטבלה תופסת את הגובה שנותר, כותרת העמודות מקובעת
   * ורק השורות נגללות. false – הטבלה זורמת עם הדף.
   */
  fillHeight?: boolean;
  /**
   * בחירה מרובה (W-20). אופציונלי לחלוטין – טבלה שלא מעבירה `selection`
   * מתנהגת בדיוק כמו קודם, ולכן שאר המסכים לא מושפעים.
   */
  selection?: SelectionConfig<TRow>;
}

export interface SelectionConfig<TRow> {
  selectedKeys: ReadonlySet<string | number>;
  onChange: (keys: Set<string | number>) => void;
  /**
   * שורה שלא ניתן לבחור, עם הסבר. משמשת לחברים בלי מספר תקין: הם מוצגים
   * ונספרים, אבל אינם נכנסים ל"בחר הכל" ואי אפשר לסמן אותם ידנית
   * (החלטת הגבאי, 2026-09-06).
   */
  isDisabled?: (row: TRow) => string | null;
}

type SortState = { columnId: string; direction: 'asc' | 'desc' } | null;

const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // ריקים תמיד בסוף
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

function readSort(key: string | undefined, fallback: SortState): SortState {
  if (!key) return fallback;
  try {
    const raw = window.localStorage.getItem(`sort:${key}`);
    if (raw === null) return fallback;
    if (raw === 'none') return null;
    const [columnId, direction] = raw.split('|');
    if (!columnId || (direction !== 'asc' && direction !== 'desc')) return fallback;
    return { columnId, direction };
  } catch {
    return fallback;
  }
}

function writeSort(key: string | undefined, sort: SortState): void {
  if (!key) return;
  try {
    window.localStorage.setItem(
      `sort:${key}`,
      sort ? `${sort.columnId}|${sort.direction}` : 'none',
    );
  } catch {
    /* אחסון חסום */
  }
}

/**
 * טבלת הבסיס של המערכת: מיון בלחיצה על כותרת + מקום לסרגל סינון ולסקשן KPI
 * (CLAUDE.md כללי-על 14–16). כל טבלה במערכת נבנית מעל הרכיב הזה.
 *
 * מחזוריות המיון: עולה ← יורד ← ללא מיון (חזרה לסדר המקורי).
 * הכותרת מקובעת: בגלילה נשארים למעלה שמות העמודות, ורק השורות זזות.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  filterBar,
  kpiPanel,
  totalBeforeFilter,
  emptyMessage,
  initialSort,
  storageKey,
  onRowClick,
  footer,
  dense = true,
  fillHeight = true,
  selection,
}: DataTableProps<TRow>) {
  const [sort, setSort] = useState<SortState>(() => readSort(storageKey, initialSort ?? null));

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col?.sortValue) return rows;
    const value = col.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(value(a), value(b)));
  }, [rows, sort, columns]);

  const handleSort = (columnId: string) => {
    setSort((prev) => {
      const next: SortState =
        !prev || prev.columnId !== columnId
          ? { columnId, direction: 'asc' }
          : prev.direction === 'asc'
            ? { columnId, direction: 'desc' }
            : null;
      writeSort(storageKey, next);
      return next;
    });
  };

  const total = totalBeforeFilter ?? rows.length;

  // "בחר הכל" פועל על **השורות המסוננות בלבד** (W-20), ומדלג על שורות
  // שאינן ניתנות לבחירה.
  const selectableKeys = useMemo(() => {
    if (!selection) return [];
    return sorted
      .filter((row) => (selection.isDisabled ? selection.isDisabled(row) === null : true))
      .map((row) => rowKey(row));
  }, [sorted, selection, rowKey]);

  const selectedInView = selectableKeys.filter((k) => selection?.selectedKeys.has(k)).length;
  const allSelected = selectableKeys.length > 0 && selectedInView === selectableKeys.length;
  const someSelected = selectedInView > 0 && !allSelected;

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (allSelected) {
      for (const k of selectableKeys) next.delete(k);
    } else {
      for (const k of selectableKeys) next.add(k);
    }
    selection.onChange(next);
  };

  const toggleOne = (key: string | number) => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  return (
    <Box
      sx={
        fillHeight ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined
      }
    >
      {/* אזור מקובע: KPI וסינון אינם נגללים עם השורות */}
      <Box sx={{ flex: 'none' }}>
        {kpiPanel}
        {filterBar}
      </Box>

      <Paper
        variant="outlined"
        sx={
          fillHeight
            ? {
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                flex: 1,
                overflow: 'hidden',
              }
            : undefined
        }
      >
        <TableContainer sx={fillHeight ? { flex: 1, minHeight: 0 } : undefined}>
          <Table size={dense ? 'small' : 'medium'} stickyHeader>
            <TableHead>
              <TableRow>
                {selection ? (
                  <TableCell padding="checkbox" sx={{ width: 48 }}>
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                      disabled={selectableKeys.length === 0}
                      inputProps={{ 'aria-label': he.table.selectAll }}
                    />
                  </TableCell>
                ) : null}
                {columns.map((col) => {
                  const active = sort?.columnId === col.id;
                  const sortable = !col.notSortable && col.sortValue !== undefined;
                  return (
                    <TableCell
                      key={col.id}
                      sx={{ width: col.width, textAlign: col.align ?? 'start' }}
                      sortDirection={active ? sort.direction : false}
                    >
                      {sortable ? (
                        <TableSortLabel
                          active={active}
                          direction={active ? sort.direction : 'asc'}
                          onClick={() => handleSort(col.id)}
                        >
                          {col.label}
                        </TableSortLabel>
                      ) : (
                        col.label
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (selection ? 1 : 0)}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {emptyMessage ?? he.table.noRows}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    hover={Boolean(onRowClick)}
                    onClick={
                      onRowClick
                        ? (event) => {
                            // לחיצה על כפתור, קישור או תיבת סימון בתוך השורה
                            // היא **פעולה בפני עצמה**, ולא בחירת השורה. בלי
                            // הבדיקה הזו כל לחיצה על אייקון "עריכה" פתחה גם
                            // את הדיאלוג וגם את הכרטיסייה – והניווט ניצח, כך
                            // שהעריכה מעולם לא נראתה.
                            const target = event.target as HTMLElement;
                            if (
                              target.closest(
                                'button, a, input, textarea, [role="button"], [role="checkbox"], [role="combobox"]',
                              ) !== null
                            ) {
                              return;
                            }
                            onRowClick(row);
                          }
                        : undefined
                    }
                    sx={onRowClick ? { cursor: 'pointer' } : undefined}
                  >
                    {selection ? (
                      <TableCell
                        padding="checkbox"
                        onClick={(e) => e.stopPropagation()}
                        sx={{ cursor: 'default' }}
                      >
                        <RowCheckbox
                          row={row}
                          rowKey={rowKey(row)}
                          selection={selection}
                          onToggle={toggleOne}
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((col) => (
                      <TableCell key={col.id} sx={{ textAlign: col.align ?? 'start' }}>
                        {col.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
            {footer}
          </Table>
        </TableContainer>
      </Paper>

      <Stack direction="row" spacing={2} sx={{ mt: 1, flex: 'none' }}>
        <Typography variant="caption" color="text.secondary">
          {he.table.rowsShown(sorted.length, total)}
        </Typography>
        {selection && selection.selectedKeys.size > 0 ? (
          <Typography variant="caption" color="primary">
            {he.table.selectedCount(selection.selectedKeys.size)}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * תא הבחירה של שורה. שורה חסומה מקבלת tooltip עם הסיבה, כדי שהגבאי יבין
 * למה אי אפשר לסמן אותה במקום לנחש.
 */
function RowCheckbox<TRow>({
  row,
  rowKey,
  selection,
  onToggle,
}: {
  row: TRow;
  rowKey: string | number;
  selection: SelectionConfig<TRow>;
  onToggle: (key: string | number) => void;
}) {
  const reason = selection.isDisabled ? selection.isDisabled(row) : null;
  const box = (
    <Checkbox
      size="small"
      checked={selection.selectedKeys.has(rowKey)}
      disabled={reason !== null}
      onChange={() => onToggle(rowKey)}
    />
  );
  return reason === null ? (
    box
  ) : (
    <Tooltip title={reason}>
      <span>{box}</span>
    </Tooltip>
  );
}
