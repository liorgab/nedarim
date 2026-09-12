# רישיונות של רכיבי צד שלישי

NEDARIM מופצת תחת **GPL-3.0-or-later** (ראו `LICENSE`). המסמך הזה מרכז את
הרכיבים שנארזים בהתקנה ואת הרישיונות שלהם. הוא **נוצר אוטומטית** מתוך
`node_modules` – `npm run licenses`.

## למה GPL ולא MIT

`@hebcal/core` – הרכיב שמחשב את כל התאריכים העבריים, הפרשות והחגים –
מופץ תחת GPL, וכותרות המקור שלו קובעות במפורש:

> _"This program is free software; you can redistribute it and/or modify it
> under the terms of the GNU General Public License as published by the Free
> Software Foundation; **either version 2 of the License, or (at your option)
> any later version**."_

כלומר רישיון מתירני לא עמד על הפרק מרגע שנבחר hebcal, והצהרת MIT הקודמת
לא הייתה נכונה. מימוש אופציית ה-"or later" ל-GPLv3 נעשה בכוונה: תחת GPLv2
בלבד, רכיב Apache-2.0 (`cssjanus`, שמגיע עם תמיכת ה-RTL) נחשב בלתי תואם;
תחת GPLv3 הוא תואם.

**מה זה אומר למי שמוריד:** מותר להשתמש, לשנות ולהפיץ – בחינם, לכל מטרה,
כולל מסחרית. התנאי היחיד: מי שמפיץ גרסה שונה חייב לשחרר גם את המקור שלה
תחת GPL. שימוש פנימי בבית הכנסת שלך אינו "הפצה" ואינו מחייב דבר.

## רכיבים שאינם MIT/ISC

| רכיב | גרסה | רישיון | הערה |
|---|---|---|---|
| `@fontsource/assistant` | 5.3.0 | OFL-1.1 | גופן – יצירה נפרדת, נשאר תחת OFL |
| `@hebcal/core` | 5.10.1 | GPL-2.0 | כותרות המקור מצהירות "or later" – ראו ההסבר למעלה |
| `@hebcal/hdate` | 0.14.5 | GPL-2.0 | כותרות המקור מצהירות "or later" – ראו ההסבר למעלה |
| `@hebcal/noaa` | 0.9.2 | LGPL-2.1 | תואם GPL |
| `cssjanus` | 2.3.1 | Apache-2.0 | תואם GPLv3 (אינו תואם GPLv2) |
| `hoist-non-react-statics` | 3.3.2 | BSD-3-Clause |  |
| `react-transition-group` | 4.4.5 | BSD-3-Clause |  |
| `source-map` | 0.5.7 | BSD-3-Clause |  |
| `tslib` | 2.8.1 | 0BSD |  |

## סיכום כל העץ הנארז

- **MIT** — 86
- **BSD-3-Clause** — 3
- **ISC** — 3
- **GPL-2.0** — 2
- **OFL-1.1** — 1
- **LGPL-2.1** — 1
- **Apache-2.0** — 1
- **0BSD** — 1

_98 חבילות._

## כלים שאינם נארזים

`xlsx` (Apache-2.0) משמש **רק** את כלי הייבוא החד-פעמי ב-`tools/import/`,
ולכן הוא ב-`devDependencies` ואינו חלק מההתקנה. גרסת ה-npm שלו נטושה ויש
לה התראת אבטחה ללא תיקון; הוא קורא אך ורק קובץ Excel שהמשתמש עצמו מספק.
כתיבת קובצי Excel מהיישום עצמו נעשית ב-`write-excel-file` (MIT).
