# NEDARIM – מערכת ניהול נדרים, תרומות והוצאות לבית כנסת

יישום שולחני Standalone (Windows) שמחליף חוברת Excel/VBA. משתמש יחיד בפועל: הגבאי. עברית מלאה, RTL, Offline.

## מסמכי המקור – לקרוא לפני כל עבודה

| קובץ | תוכן |
|---|---|
| `docs/SPEC.md` | האיפיון המלא: ניתוח הקובץ הישן, ישויות, דרישות F-xx, כללים B-xx, הרשאות, הסבה |
| `docs/DATA-MODEL.md` | **סכימת SQLite המחייבת** + Views + פרוטוקול הקצאת מספר קבלה |
| `docs/legacy/WORKBOOK-STRUCTURE.md` | מבנה חוברת ה-Excel לכלי הייבוא (מיקומי עמודות, פורמטים, מלכודות) |
| `docs/legacy/vba_source.txt` | קוד ה-VBA המקורי (לוגיקה עסקית לשימור) |
| `ROADMAP.md` | שלבי פיתוח עם Definition of Done ורשימות משימות – **לעדכן סטאטוס בסיום כל משימה** |
| `data/legacy/*.xlsm` | הקובץ המקורי עם נתוני האמת – קריאה בלבד, לא לשנות |

## סטאק

Electron (electron-vite) · React 18 + TypeScript · MUI (RTL) · better-sqlite3 · @hebcal/core · Vitest · electron-builder (NSIS).

## מבנה

```
src/main/        Electron main: db/ (migrations, repositories), services/ (receipts, balance, backup, hebrewCalendar, import), ipc/
src/preload/     חשיפת window.api בלבד
src/renderer/    React: pages/, components/, hooks/, theme (RTL)
src/shared/      טיפוסים וחוזה ה-IPC (api.ts) – מקור אמת יחיד לשני הצדדים
tools/import/    כלי ייבוא חד-פעמי מה-Excel + occasion-map.json
docs/            איפיון ומסמכים
data/legacy/     הקובץ המקורי
```

## כללי ברזל

1. **סכומים באגורות (INTEGER)** – אף פעם לא float. המרה לתצוגה רק ב-renderer.
2. **תאריכים ISO `YYYY-MM-DD`** ב-DB וב-IPC. תצוגה `dd/mm/yyyy` + תאריך עברי. חותמות זמן `YYYY-MM-DDTHH:mm:ss` **בשעון מקומי** – תמיד דרך `nowIso()`/`todayIso()` מ-`src/shared/datetime.ts`. אסור `new Date().toISOString()`: הוא מחזיר UTC, מציג שעה שקרית ביומן ובקבלה, ובשעות הלילה אף נותן תאריך שונה מהתאריך העסקי.
3. **יתרות מחושבות, לא נשמרות.** להשתמש ב-`v_member_balance` / `v_ledger`.
4. **מספר קבלה מוקצה רק בטרנזקציה `BEGIN IMMEDIATE`** לפי DATA-MODEL. לעולם לא משוחרר, לעולם לא נערך.
5. **קבלה = Immutable.** תיקון = ביטול + חדש.
6. **מחיקה לוגית בלבד** (`deleted_at`) + רשומת `audit_log` לכל שינוי בנתון כספי.
7. ה-renderer לא ניגש ל-DB. כל גישה דרך `window.api` עם טיפוסים מ-`src/shared/api.ts`.
8. כל שירות ב-`src/main/services` מגיע עם בדיקות Vitest. שירותים כספיים (יתרה, קבלות, מאזן, סכום במילים) – חובה 100% כיסוי לוגי.
9. RTL: `AlignmentType`/`textAlign: start`, לא `right`. טבלאות MUI עם `direction: rtl`. לבדוק כל מסך חדש בעין.
10. טקסט UI בעברית, מרוכז בקובץ `src/renderer/i18n/he.ts` (לא מפוזר במחרוזות).
11. לא להוסיף תלות ברשת. לא Telemetry. לא שירותי ענן.

## כללי-על למוצר (חלים על כל שלב ומסך)

12. **מודולריות ופרמטרים:** אין ערכים עסקיים קשיחים בקוד. שם בית הכנסת, יישוב, מספר קבלה מתחיל, חודש תחילת שנה כספית, ספי אישור, גדלי נייר, רשימות ערכים – הכל ב-`setting` / seed / קובץ קונפיגורציה. המערכת מיועדת לשחרור כקוד פתוח ב-GitHub; כל מוריד מקבל מערכת ריקה שהוא מגדיר לעצמו.
13. **התקנה אחת = בית כנסת אחד.** אין multi-tenancy, אין בורר ארגון. מזהה הארגון הוא ה-DB עצמו.
14. **טבלאות – מיון:** בכל טבלה במערכת, לחיצה על כותרת עמודה ממיינת (עולה/יורד/ללא). המצב נשמר לכל מסך.
15. **טבלאות – סינון:** בכל טבלה סרגל סינון עם השדות הרלוונטיים לאותה טבלה (טווח תאריכים, חבר, קטגוריה, אמצעי תשלום, סטאטוס, טווח סכומים, חיפוש חופשי). הסינון משפיע גם על הסיכומים ועל הייצוא.
16. **טבלאות עם ערכים אגרגטיביים:** מעל הטבלה סקשן סטטיסטי **מתכווץ** (collapsible, נסגר/נפתח ונשמר) עם KPIs רלוונטיים לאותו מסך – מחושבים לפי הסינון הפעיל, לא על כל הנתונים.
17. **בדיקות ידניות:** בסוף כל שלב – דיווח מה בוצע ומה על הגבאי לבדוק, והרצה חיה (`npm run dev` או שרת מקומי לתצוגת רכיבים/דוחות) כדי לאפשר בדיקה בעיניים.

## פקודות

```
npm run dev        # הרצה בפיתוח
npm run check      # tsc + eslint
npm test           # vitest
npm run import -- data/legacy/<file>.xlsm   # ייבוא (שלב 1)
npm run build      # installer
```

## דרך עבודה

- עובדים לפי `ROADMAP.md` שלב אחרי שלב. לא מתחילים שלב לפני DoD של הקודם.
- לפני מימוש דרישה – לצטט את מספרה (F-xx / B-xx) ב-commit message.
- כל שאלה עסקית פתוחה נרשמת ב-`ROADMAP.md` תחת "החלטות פתוחות", לא ממציאים תשובה.
- commit קטן וממוקד אחרי כל משימה; לעדכן את ה-checkbox ב-ROADMAP באותו commit.
