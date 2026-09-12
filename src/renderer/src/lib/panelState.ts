/**
 * שמירת מצב פתוח/מכווץ של סקשנים מתכווצים, לכל מסך בנפרד
 * (CLAUDE.md כללי-על 15–16: "נסגר/נפתח ונשמר").
 *
 * אחסון מקומי בלבד – זו העדפת תצוגה, לא נתון עסקי, ולכן היא לא נשמרת ב-DB.
 */
export function readPanelState(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const raw = window.localStorage.getItem(`panel:${key}`);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function writePanelState(key: string | undefined, open: boolean): void {
  if (!key) return;
  try {
    window.localStorage.setItem(`panel:${key}`, open ? '1' : '0');
  } catch {
    /* אחסון חסום (מצב פרטי) – ההעדפה פשוט לא תישמר */
  }
}
