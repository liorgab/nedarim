import createCache from '@emotion/cache';
import { createTheme } from '@mui/material/styles';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

/** Cache של emotion עם היפוך RTL – חובה כדי ש-MUI ייצר CSS מימין לשמאל. */
export const rtlCache = createCache({
  key: 'nedarim-rtl',
  stylisPlugins: [prefixer, rtlPlugin],
});

/**
 * גופן: Assistant נארז מקומית (@fontsource) – אין תלות ברשת (CLAUDE.md כלל 11).
 * גודל בסיס 15px לפי דרישת הנגישות (≥12pt).
 */
const FONT_STACK = ['Assistant', 'Segoe UI', 'Arial', 'sans-serif'].join(', ');

export const theme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'light',
    primary: { main: '#1b4965' },
    secondary: { main: '#5fa8d3' },
    error: { main: '#b3261e' },
    success: { main: '#2e7d32' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
  typography: {
    fontFamily: FONT_STACK,
    fontSize: 15,
    h1: { fontSize: '1.8rem', fontWeight: 700 },
    h2: { fontSize: '1.45rem', fontWeight: 700 },
    h3: { fontSize: '1.2rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    // אין להגדיר כאן `body: { direction: 'rtl' }`!
    // stylis-plugin-rtl הופך ערכי `direction`, כלומר `rtl` היה נכתב ל-CSS כ-`ltr`,
    // דורס את `<html dir="rtl">` וכל היישום היה מתהפך ל-LTR. הכיווניות נקבעת
    // אך ורק ב-`src/renderer/index.html` (`<html lang="he" dir="rtl">`).
    MuiTableCell: {
      styleOverrides: {
        // ב-RTL תמיד `start`, אף פעם לא `right` (CLAUDE.md כלל 9)
        root: { textAlign: 'start' },
        head: { fontWeight: 700, whiteSpace: 'nowrap' },
      },
    },
    // Stack ברירת מחדל משתמש ב-margin מכוון-כיווניות, ו-stylis-plugin-rtl הופך אותו שוב
    // (היפוך כפול → הרווח נופל בצד הלא נכון). `gap` חסין להיפוך.
    MuiStack: { defaultProps: { useFlexGap: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
