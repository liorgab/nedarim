# מודול WhatsApp – שליחה המונית מתוך NEDARIM

**גרסה:** 1.1 · **תאריך:** 2026-09-06 · **סטאטוס:** מאושר לפיתוח
**תלות:** שלב 2 ב-`ROADMAP.md` (שורש הריפו) הושלם – אומת: `npm run check` ירוק, 406 בדיקות. המיגרציה האחרונה בריפו היא 004 → המודול מתחיל ב-**005**. `member.mobile_e164` **אינו קיים עדיין** ונוסף במיגרציה 005 כחלק מ-W0 (ראו §3.0).
מספרי דרישות: `W-xx` (פונקציונלי), `WB-xx` (כללים עסקיים/טכניים). מסמך זה נכנס לריפו כ-`docs/WHATSAPP-SPEC.md`.

---

## 1. מטרה ותכולה

הגבאי בוחר קבוצת חברים (למשל כל מי שיתרת החוב שלו מעל 100 ₪), בוחר תבנית הודעה עם שדות דינמיים, והמערכת שולחת לכל אחד הודעת WhatsApp אישית מהמספר של בית הכנסת – דרך WhatsApp Web שרץ **בתוך** האפליקציה (חלון Electron ייעודי), בלי תוסף כרום ובלי שירות ענן.

**בתכולה:** ניהול תבניות, בחירה מרובה של חברים, אשף שליחה, חלון WhatsApp Web עם סריקת QR, מנוע שליחה עם קצב מבוקר, מודאל התקדמות חי, היסטוריית קמפיינים, ניסיון חוזר לכשלים, המשך קמפיין אחרי סגירת האפליקציה.

**מחוץ לתכולה (גרסה זו):** קבלת הודעות/תשובות, צירוף קבצים (קבלה כ-PDF – שלב הבא), קבוצות, שליחה מתוזמנת, WhatsApp Business API.

### 1.1 אזהרה מקצועית (חובה להציג למשתמש)

אוטומציה של WhatsApp Web מנוגדת לתנאי השימוש של WhatsApp. מספר ששולח הודעות זהות בקצב גבוה עלול להיחסם, לפעמים לצמיתות. המערכת מקטינה את הסיכון (השהיות אקראיות, מכסה יומית, הודעות מותאמות אישית), אבל לא מבטלת אותו. **המלצה מחייבת: SIM ייעודי לבית הכנסת, לא המספר האישי של הגבאי.** הודעת הסכמה מוצגת פעם אחת בהפעלה הראשונה של המודול ונרשמת ב-`audit_log`.

---

## 2. ארכיטקטורה

```
┌─────────────────────────────── Electron main ───────────────────────────────┐
│  src/main/whatsapp/                                                          │
│   ├─ WhatsAppWindow.ts      BrowserWindow ייעודי, partition 'persist:whatsapp'│
│   │                          UA של Chrome אמיתי, טוען web.whatsapp.com         │
│   ├─ SessionMonitor.ts      מזהה מצב: disconnected / qr / ready / stale       │
│   ├─ selectors.ts           כל ה-selectors של DOM במקום אחד + fallbacks       │
│   ├─ MessageSender.ts       שליחת הודעה אחת (navigate → wait → Enter → verify) │
│   ├─ CampaignRunner.ts      מכונת מצבים, תור, השהיות, pause/resume/cancel      │
│   └─ TemplateRenderer.ts    {{field}} → טקסט, עם ערכי חבר + הגדרות             │
│  src/main/services/PhoneNormalizer.ts   טהור, (db לא נדרש); משמש repository+backfill│
│  src/main/db/migrations/005_whatsapp.sql + backfill TS חד-פעמי                  │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ IPC (src/shared/api.ts)
┌──────────────────────────────────┴───────────────────────────────────────────┐
│  src/renderer/src/pages/whatsapp/   TemplatesPage, CampaignsHistoryPage        │
│  src/renderer/src/components/whatsapp/  SendWizardDialog, ProgressPanel,        │
│                                          ConnectionBadge                        │
│  src/renderer/src/hooks/useWhatsAppStatus.ts, useCampaignProgress.ts            │
│  src/renderer/src/i18n/he.ts   כל המחרוזות (אין טקסט קשיח ברכיבים)              │
│  App.tsx – טאב "וואטסאפ" חדש                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 החלטות טכניות (WB)

| # | החלטה | נימוק |
|---|-------|-------|
| WB-01 | **חלון WhatsApp Web נפרד וגלוי** (`BrowserWindow`), לא `<webview>` ולא חלון נסתר | הגבאי רואה את ה-QR ואת השליחה בזמן אמת, כמו בתוסף ב-ד.יוחאי. ניתן למזער, לא ניתן לסגור בזמן קמפיין (מוסתר במקום נסגר). |
| WB-02 | **בלי whatsapp-web.js / Puppeteer / Baileys** | Puppeteer מריץ Chromium שני (200MB+); Baileys אינו "WhatsApp Web שרואים". השליטה היא דרך `webContents.executeJavaScript` של Electron עצמו. |
| WB-03 | **שליחה בשיטת URL + DOM**: `web.whatsapp.com/send?phone=<E164>&text=<encoded>` → המתנה לתיבת הכתיבה → Enter → אימות בועת הודעה עם ✓ | עמידה לשינויים ב-Store הפנימי של WhatsApp (שמשתנה כל כמה שבועות). איטי יותר (5–10 שנ' להודעה) – לא רלוונטי כי ממילא יש השהיה מכוונת. |
| WB-04 | **UA של Chrome אמיתי** (`session.setUserAgent`), ללא המחרוזת `Electron/` | WhatsApp Web חוסם/מגביל UA לא מוכר. |
| WB-05 | **`partition: 'persist:whatsapp'`** בתוך `userData` | הסשן שורד הפעלות; "התנתק" = `session.clearStorageData()`. הגיבוי (F-100) **לא** כולל את התיקייה הזאת. |
| WB-06 | **כל ה-selectors בקובץ אחד** עם רשימת fallbacks ותאריך אימות אחרון | כשהם נשברים – תיקון בקובץ אחד, בלי לגעת בלוגיקה. |
| WB-07 | **השהיה אקראית** בין הודעות: ברירת מחדל 8–20 שנ' (הגדרה), **מכסה יומית** ברירת מחדל 50 (הגדרה, מקסימום 200), **עצירה אוטומטית** אחרי 3 כשלים רצופים | הפחתת סיכון חסימה. |
| WB-08 | **מצב פריט לפני שליחה = `sending`**, ורק אחרי אימות ✓ = `sent`. קריסה באמצע → `unknown` (לא נשלח שוב אוטומטית) | מניעת שליחה כפולה, שגרועה מהודעה חסרה. |
| WB-09 | ה-renderer **לא** ניגש ל-`webContents` של חלון WhatsApp – רק דרך IPC | עקביות עם עקרון ה-IPC הקיים. |
| WB-10 | **פעולת שליחה מותרת ל-`admin` ול-`clerk`**; ניהול תבניות והגדרות קצב – `admin` בלבד | לפי מודל התפקידים (SPEC 6.3). |
| WB-11 | **נרמול נייד נשמר ב-DB (`mobile_e164`, `mobile_status`), לא מחושב בזמן שליחה** | סינון "ללא מספר תקין", זיהוי כפילויות ואייקון במסך החברים דורשים עמודה ואינדקס; בעיה במספר צריכה להתגלות פעם אחת במסך החברים, לא בכל קמפיין מחדש. |

---

## 3. מודל נתונים – מיגרציה `005_whatsapp.sql`

מיגרציות 001–004 קפואות. כל מה שלמטה נכנס לקובץ 005 אחד, בטרנזקציה אחת.

### 3.0 תוספת לטבלת `member` (נרמול נייד)

```sql
ALTER TABLE member ADD COLUMN mobile_e164 TEXT;                 -- '972501234567' או NULL
ALTER TABLE member ADD COLUMN mobile_status TEXT NOT NULL DEFAULT 'missing'
  CHECK (mobile_status IN ('valid','invalid','missing'));
CREATE INDEX idx_member_mobile_e164 ON member(mobile_e164) WHERE mobile_e164 IS NOT NULL;

CREATE VIEW v_member_duplicate_mobile AS
SELECT mobile_e164, COUNT(*) AS cnt, GROUP_CONCAT(member_number) AS member_numbers
FROM member WHERE deleted_at IS NULL AND mobile_e164 IS NOT NULL
GROUP BY mobile_e164 HAVING COUNT(*) > 1;
```

`v_member_balance` מורחב (DROP + CREATE באותה מיגרציה) עם `mobile_e164, mobile_status`.

**Backfill (WB-11):** SQL לא יכול להריץ את `PhoneNormalizer`, לכן אחרי החלת 005 רץ צעד TypeScript חד-פעמי ואידמפוטנטי `backfillMobileE164(db)`: לכל חבר עם `mobile IS NOT NULL AND mobile_e164 IS NULL` מחשב `e164`/`status`. הצעד נרשם ב-`audit_log` (`action='backfill_mobile'`) עם סיכום: כמה valid / invalid / missing / כפולים. `mobile` המקורי **לא** נדרס. מכאן והלאה ה-repository של `member` מחשב את שני השדות בכל `create/update` – אין מסלול שכותב `mobile` בלי לחשב `mobile_e164`.

נתוני האמת בריפו: 55/90 חברים עם נייד בפורמט `05XXXXXXXX`, 35 ללא נייד. אחרי backfill הצפי: ~55 valid, 35 missing. חבר `invalid`/כפול מוצג במסך החברים עם אייקון אדום וסינון "ללא מספר תקין".

### 3.1 טבלאות המודול

```sql
CREATE TABLE message_template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,                       -- טקסט עם {{שדות}}
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);

CREATE TABLE message_campaign (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                       -- ברירת מחדל: "<שם תבנית> – <תאריך>"
  template_id INTEGER REFERENCES message_template(id),
  template_body_snapshot TEXT NOT NULL,     -- הגוף בזמן היצירה (התבנית עלולה להשתנות אח"כ)
  status TEXT NOT NULL CHECK (status IN ('draft','running','paused','completed','cancelled','failed')),
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, finished_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);

CREATE TABLE message_campaign_item (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES message_campaign(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES member(id),
  phone_e164 TEXT,                          -- snapshot של member.mobile_e164; NULL → status='skipped'
  rendered_text TEXT NOT NULL,              -- ההודעה הסופית ששלחנו/נשלח
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed','skipped','unknown')),
  error_code TEXT,                          -- invalid_number|not_on_whatsapp|timeout|not_connected|selector|cancelled
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_campaign_item ON message_campaign_item(campaign_id, status);

CREATE TABLE whatsapp_daily_counter (      -- אכיפת מכסה יומית גם אחרי הפעלה מחדש
  day TEXT PRIMARY KEY,                     -- YYYY-MM-DD
  sent_count INTEGER NOT NULL DEFAULT 0
);

-- setting keys חדשים:
-- whatsapp_enabled ('0'|'1'), whatsapp_consent_accepted_at,
-- whatsapp_min_delay_sec (8), whatsapp_max_delay_sec (20), whatsapp_daily_cap (50),
-- default_country_code ('972'), whatsapp_stop_after_consecutive_failures (3),
-- gabbai_phone_display (לשימוש בתבניות)
```

`audit_log.action` מקבל ערכים חדשים: `whatsapp_connect`, `whatsapp_logout`, `campaign_start`, `campaign_pause`, `campaign_cancel`, `campaign_complete`, `template_*`.

---

## 4. דרישות פונקציונליות

### 4.1 תבניות הודעה (W-10..W-16)

| # | דרישה |
|---|-------|
| W-10 | מסך "תבניות וואטסאפ" תחת הגדרות: רשימה, הוספה, עריכה, שכפול, השבתה. |
| W-11 | עורך: `TextField` רב-שורות RTL + שורת צ'יפים של שדות; לחיצה על צ'יפ מכניסה `{{field}}` במיקום הסמן. |
| W-12 | **שדות זמינים:** `first_name`, `last_name`, `full_name`, `nickname_or_first` (כינוי אם קיים, אחרת שם פרטי), `member_number`, `balance` (יתרה מעוצבת, למשל `350 ₪`; שלילית = זכות), `balance_abs`, `last_payment_date` (dd/mm/yyyy או "—"), `today` (לועזי), `today_hebrew`, `parasha` (פרשת השבוע הקרובה), `hebrew_year`, `synagogue_name`, `gabbai_phone`, **`open_charges`** (פירוט החיובים שטרם כוסו – שורה לכל חיוב: תאריך · פרשה · סכום), **`open_charges_count`**. |
| W-12א | **פירוט החוב נגזר, לא נשמר.** `vow_payment` אינו מחזיק `charge_id` – המערכת עובדת balance-forward, ולכן "אילו נדרים לא שולמו" אינה שאלה שאפשר לשלוף. הגזירה היא **FIFO**: תשלומים וזיכויים סוגרים את החיובים הישנים ביותר. סכום השורות שווה תמיד ל-`balance_agorot`, ולכן ההודעה תמיד מסתכמת למספר שהחבר רואה. יתרת הפתיחה היא הפריט הישן ביותר. ההגדרה `whatsapp_open_charges_max_lines` (ברירת מחדל 10, 0 = הכול) חותכת את הרשימה ומסכמת את השאר בשורה אחת – בנתוני האמת יש חבר עם 33 חיובים פתוחים. |
| W-13 | תצוגה מקדימה חיה בצד העורך על חבר לדוגמה (בחירה מרשימה; ברירת מחדל – החבר הראשון עם יתרת חוב). |
| W-14 | ולידציה בשמירה: שדה לא מוכר `{{xyz}}` → שגיאה עם שם השדה; גוף ריק → שגיאה; אורך > 1,000 תווים → אזהרה. |
| W-15 | Seed של 3 תבניות: "תזכורת יתרה", "תודה על התשלום", "הודעה כללית". |
| W-16 | תמיכה בשורות חדשות ובאימוג'י; `*מודגש*` ו-`_נטוי_` של WhatsApp עוברים כמו שהם. |

### 4.2 בחירת נמענים (W-20..W-24)

| # | דרישה |
|---|-------|
| W-20 | במסך החברים: עמודת checkbox, "בחר הכל (מסונן)", מונה "נבחרו N". פעולה בסרגל: **"שלח וואטסאפ"** (מושבת כש-0 נבחרו או כשהמודול כבוי). "בחר הכל" מדלג כברירת מחדל על `mobile_status <> 'valid'` ומציג "N נבחרו, M ללא נייד לא נבחרו" עם אפשרות לכלול. |
| W-21 | סינון מהיר לפני בחירה: "יתרת חוב מעל ___ ₪", "ללא תשלום מאז ___", "סטאטוס פעיל". |
| W-22 | אותה פעולה זמינה מדוח "יתרות חוב" (F-81) ומכרטיסיית חבר בודד (שליחה ל-1). |
| W-23 | חברים עם `mobile_status <> 'valid'` נכללים ברשימה עם סימון אדום "אין מספר / מספר לא תקין" (לפי `mobile_status`) ונספרים כ-`skipped` – **לא חוסמים** את הקמפיין. קישור "תקן" פותח את טופס החבר. |
| W-24 | מספר כפול (`v_member_duplicate_mobile`) → אזהרה עם שמות החברים, שליחה לשניהם רק באישור מפורש. |

### 4.3 אשף שליחה – `SendWizardDialog` (W-30..W-38)

מודאל מלא (`fullWidth`, `maxWidth="lg"`), לא ניתן לסגירה בלחיצה מחוץ בזמן שליחה.

| שלב | תוכן |
|-----|------|
| **1 – נמענים** | טבלה: שם, מס' חבר, נייד (מנורמל), יתרה, מצב תקינות. הסרה של שורות בודדות. סיכום: "N נמענים, מתוכם M ללא מספר". |
| **2 – הודעה** | בחירת תבנית (או "הודעה חד-פעמית" – טקסט חופשי עם אותם שדות). טבלת תצוגה מקדימה: לכל נמען הטקסט המרונדר המלא, ניתן לגלילה. כפתור "ערוך הודעה לנמען זה" (עריכה ידנית של `rendered_text` בודד). שדה "שם קמפיין". |
| **3 – חיבור** | `ConnectionBadge` גדול. אם `disconnected` – כפתור "פתח WhatsApp Web" שפותח את החלון (WB-01) ומציג הנחיות סריקה; המעבר לשלב 4 מתאפשר רק ב-`ready`. מציג את מספר הטלפון המחובר (אם ניתן לחלץ) לאישור "זה המספר הנכון". סיכום קצב: "השהיה 8–20 שנ', זמן משוער ~X דקות, נותרו היום Y מתוך המכסה". אם N > המכסה שנותרה – הודעה ברורה שהקמפיין ייעצר אוטומטית ויוכל להמשיך מחר. |
| **4 – התקדמות** | ראו 4.4. |

W-37: לחיצה על "התחל שליחה" יוצרת `message_campaign` (status `running`) + כל הפריטים בטרנזקציה אחת **לפני** ההודעה הראשונה.
W-38: אין "אחורה" משלב 4. סגירת האשף בזמן ריצה = "השהה והסתר" (הקמפיין ממשיך ברקע? **לא** – מושהה; ראו WB-08).

### 4.4 מודאל התקדמות – `ProgressPanel` (W-40..W-47)

| # | דרישה |
|---|-------|
| W-40 | פס התקדמות + `sent / failed / skipped / pending` כארבעה מונים צבעוניים + אחוז. |
| W-41 | שורת סטאטוס חיה: "שולח ל-ישראל ישראלי (12/48)… ממתין 14 שנ'…" עם ספירה לאחור. |
| W-42 | רשימת פריטים חיה (וירטואלית), הפריט הנוכחי מודגש וגלול לתצוגה; לכל פריט אייקון מצב וסיבת כשל בעברית. |
| W-43 | כפתורים: **השהה / המשך / בטל** (ביטול דורש אישור; פריטים שטרם נשלחו → `failed` עם `cancelled`). |
| W-44 | אירועי התקדמות מגיעים מ-main ב-IPC push (`campaign:progress`) בכל שינוי מצב פריט ובכל שנייה של ספירה לאחור. |
| W-45 | ניתוק WhatsApp באמצע → הקמפיין עובר ל-`paused` אוטומטית עם הודעה "החיבור נותק – סרוק מחדש והמשך". |
| W-46 | סיום: מסך סיכום עם המונים, כפתור "נסה שוב כשלים" (יוצר קמפיין המשך עם הפריטים שנכשלו ב-`timeout`/`selector`/`not_connected` – **לא** `not_on_whatsapp`/`invalid_number`), "ייצא ל-Excel", "סגור". |
| W-47 | בהפעלת האפליקציה: אם קיים קמפיין `running`/`paused` – באנר בדשבורד "יש קמפיין שלא הסתיים – המשך / בטל". פריטים ב-`sending` בזמן הקריסה → `unknown` והם מוצגים לבדיקה ידנית. |

### 4.5 חלון WhatsApp וסשן (W-50..W-56)

| # | דרישה |
|---|-------|
| W-50 | חלון 1,100×800, כותרת "WhatsApp – נדרים", תפריט מוסר, DevTools כבוי בייצור. `closable` – בזמן קמפיין `close` מסתיר במקום לסגור. |
| W-51 | `SessionMonitor` דוגם כל 2 שנ' (`executeJavaScript`) ומחזיר `qr | loading | ready | disconnected | stale`. `stale` = דף "WhatsApp פתוח בחלון אחר" או "עדכן את Chrome". |
| W-52 | `ConnectionBadge` בסרגל העליון של האפליקציה (ירוק/צהוב/אדום) – לחיצה פותחת/מביאה לחזית את החלון. |
| W-53 | הגדרות → וואטסאפ: הפעל/כבה מודול, קצב, מכסה, קידומת מדינה, כפתור "התנתק מ-WhatsApp" (מנקה partition, דורש אישור), "פתח את החלון". |
| W-54 | הפעלה ראשונה של המודול → דיאלוג הסכמה (1.1) עם checkbox "הבנתי, המספר הוא SIM ייעודי" – נרשם ב-setting וב-audit. |
| W-55 | `SessionMonitor` מעדכן את ה-renderer ב-push (`whatsapp:status`). |
| W-56 | חילוץ המספר המחובר (מ-Profile pane או localStorage `last-wid`) – best effort, לא חוסם. |

### 4.6 מנוע שליחה – `MessageSender` (W-60..W-66)

אלגוריתם להודעה אחת:

1. ולידציה: `phone_e164` תקין, סטאטוס `ready`, לא חרגנו מהמכסה היומית (`whatsapp_daily_counter`).
2. פריט → `sending`, `attempts++`.
3. `loadURL('https://web.whatsapp.com/send?phone=<E164>&text=<encodeURIComponent>')`.
4. המתנה (עד 25 שנ') לאחד מ: תיבת הכתיבה עם הטקסט שלנו · דיאלוג "מספר הטלפון ששותף דרך כתובת URL אינו ב-WhatsApp" → `failed / not_on_whatsapp` · מסך QR → `paused / not_connected`.
5. שליחת Enter דרך `webContents.sendInputEvent` (לא `click` על כפתור – פחות תלוי ב-selectors).
6. אימות (עד 15 שנ'): הבועה האחרונה בשיחה מכילה את הטקסט שלנו **ו**אייקון סטאטוס שאינו "שעון" (ממתין). ✓ אחד מספיק (נשלח לשרת). → `sent`, `sent_at`, `daily_counter++`.
7. כשל אימות → `failed / timeout`. 3 כשלים רצופים → הקמפיין `paused` עם הודעה.
8. השהיה אקראית `[min,max]` לפני הפריט הבא (מדווחת בספירה לאחור).

W-65: `selectors.ts` מכיל לכל אלמנט מערך של selectors (data-testid, aria-label, מבנה) שנבדקים לפי הסדר, + קבוע `SELECTORS_VERIFIED_ON = '2026-09-..'`.
W-66: כשל `selector` (אף selector לא נמצא) נרשם עם צילום מסך (`webContents.capturePage`) ל-`userData/logs/whatsapp/` לצורך תיקון.

### 4.7 היסטוריה (W-70..W-72)

| # | דרישה |
|---|-------|
| W-70 | מסך "קמפיינים": טבלה (תאריך, שם, תבנית, סטאטוס, נשלחו/נכשלו/דולגו, משתמש). |
| W-71 | פירוט קמפיין: כל הפריטים עם הטקסט שנשלח, מצב, שגיאה, שעה. סינון לפי מצב. "נסה שוב כשלים" (W-46). |
| W-72 | בכרטיסיית חבר: לשונית "הודעות" עם כל ההודעות שנשלחו אליו. |

---

### 4.8 הודעה בכל אירוע כספי (W-80..W-89) – מיגרציה `007_notify_events.sql`

**המטרה:** ההתכתבות של החבר בוואטסאפ תהווה יומן של כל ההתחשבנות מול בית
הכנסת. עד כאן ההודעות היו יזומות בלבד (קמפיין או שליחה בודדת); כאן הן
נקשרות לפעולה הכספית שיצרה אותן.

| # | דרישה |
|---|---|
| W-80 | חמישה אירועים מפיקים הודעה: נדר, זיכוי, תשלום, תרומה, קבלה. |
| W-81 | תבנית אחת פעילה לכל אירוע (`message_template.event_kind`, אינדקס חד-ערכי חלקי). תבניות אירוע אינן מוצעות באשף הקמפיין. |
| W-82 | מצב לכל אירוע ב-`setting`: `off` / `ask` / `auto`. **ברירת המחדל `off` לכל האירועים** – התקנה חדשה אינה שולחת דבר (CLAUDE.md כלל 12). שינוי מצב נרשם ב-`audit_log`. |
| W-83 | בניית ההודעה רצה **אחרי ה-commit ולעולם לא בתוכו**. כישלון בבניית ההודעה אינו מחזיר שגיאה על הפעולה הכספית ואינו נראה למשתמש. |
| W-84 | חבר ללא נייד תקין, תורם שאינו חבר, תבנית שנמחקה, רשומה שנמחקה לוגית, קבלה מבוטלת – מדולגים בשקט עם סיבה מוכתבת. |
| W-85 | שדות אירוע ברנדרר: `{{amount}}`, `{{event_date}}`, `{{occasion}}`, `{{payment_method}}`, `{{receipt_number}}`, `{{balance_after}}`. בתבנית חופשית הם מרונדרים `—` ומפיקים אזהרה בעורך. |
| W-86 | `message_campaign.trigger_kind` / `trigger_ref` (`entity:id`) – מקור האירוע. רשומה שכבר נשלחה עליה הודעה לא תפיק הודעה שנייה. |
| W-87 | שורה מותנית בתבנית: `? ` בתחילת שורה. השורה נכללת רק אם כל השדות שבה קיבלו ערך אמיתי. |
| W-88 | "שלח לכל החייבים" – בוחר את כל בעלי יתרת החוב מ-`v_member_balance` ופותח את אשף השליחה הקיים (לא מסלול שליחה שני). |
| W-89 | הזנה מרובה (נדרים/תשלומים לכמה חברים) **אינה** מפיקה הודעות בשלב זה – ראו הערה למטה. |

| W-90 | **שליחה יזומה משורה בטבלה.** בכל שורת תרומה וכל שורת יומן יש כפתור "שלח הודעה בוואטסאפ". הכוונה המפורשת של הגבאי גוברת על ההגדרה (`off`) ועל "כבר נשלח", אך לא על חוסר נייד או חוסר תבנית. |
| W-91 | **דיווח סיבה.** כשלא נבנתה הודעה, המסך אומר למה. אחרי שמירה אוטומטית שותקים רק על מצבים שהגבאי בחר בהם (`off`) או תקינים לחלוטין (`no_member`, `already_sent`); בשליחה יזומה מדווחים תמיד. הכלל מרוכז ב-`useEventNotification`. |

**WB-12 – פעולה אחת = הודעה אחת.** "רישום תשלום + הפקת קבלה" הוא כפתור אחד
במסך אך שתי רשומות ב-DB. במקרה המשולב מדווח אירוע `payment` בלבד, ומספר
הקבלה נכנס לתוכו דרך `{{receipt_number}}`. האכיפה אינה מסתמכת על זרימת
המסכים: `EventFacts.coveredByRef` קושר את הקבלה לרשומת המקור שלה, כך
שהודעה שנשלחה על התשלום מסמנת גם את הקבלה כמטופלת.

**מגבלת שלב – הזנה מרובה (W-89).** הודעה לכל חבר בהזנה מרובה דורשת קמפיין
שבו לכל פריט טקסט משלו עם נתוני האירוע שלו. הסכימה כבר תומכת בכך
(`message_campaign_item.rendered_text`), אבל **שליחה בפועל של 60 פריטים
דורשת את מנוע הקמפיינים (W3)**; בלעדיו אין מי שינהג בחלון. לכן הזנה
מרובה נשארת ללא הודעות עד W3.

**למה W-90 ו-W-91 נוספו.** בבדיקה של הגבאי נרשמה תרומה ולא הוצעה עליה
הודעה. שתי סיבות בלתי תלויות פעלו יחד: האירוע היה `off` (ברירת המחדל),
ולחבר לא היה נייד. בשני המקרים המערכת שתקה לחלוטין. השתיקה נכונה כדי לא
לחסום את הפעולה הכספית, אבל **אפס משוב** השאיר את הגבאי בלי דרך לדעת
שהפיצ'ר בכלל קיים, ובלי דרך לשלוח את ההודעה ידנית.

**מגבלת שלב – `auto`.** שליחה ללא אישור דורשת את אותו מנוע. הערך מוכר
בסכימה ומוצג בהגדרות כחסום, כדי שהגבאי יראה שהאפשרות קיימת ומתי תגיע.
**זו גם ההגנה מפני WB-07:** מוצאי שבת עם 40 נדרים היה אוכל את המכסה
היומית כולה בלי שאיש החליט על כך.

---

## 5. חוזה IPC (`src/shared/api.ts` – תוספת)

```ts
whatsapp: {
  getStatus(): Promise<WaStatus>;                     // {state, phone?, since}
  openWindow(): Promise<void>;
  logout(): Promise<void>;
  onStatus(cb: (s: WaStatus) => void): Unsubscribe;   // push
};
templates: {
  list(): Promise<MessageTemplate[]>;
  save(t: MessageTemplateInput): Promise<MessageTemplate>;
  remove(id: number): Promise<void>;
  fields(): Promise<TemplateField[]>;                 // {key, label, example}
  render(body: string, memberId: number): Promise<string>;
  validate(body: string): Promise<{ok: boolean; unknownFields: string[]}>;
};
campaigns: {
  prepare(input: {memberIds: number[]; body: string; name: string})
    : Promise<PreparedCampaign>;                      // פריטים מרונדרים + תקינות, לא נשמר
  create(p: PreparedCampaign): Promise<number>;       // שומר draft → מחזיר id
  start(id: number): Promise<void>;
  pause(id: number): Promise<void>;
  resume(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
  retryFailed(id: number): Promise<number>;           // קמפיין חדש
  list(): Promise<CampaignSummary[]>;
  get(id: number): Promise<CampaignDetail>;
  getUnfinished(): Promise<CampaignSummary | null>;
  onProgress(cb: (e: CampaignProgressEvent) => void): Unsubscribe;
};
```

`CampaignProgressEvent = { campaignId, status, counters, currentItem?, countdownSec?, item?: {id, status, error_code} }`.

---

## 6. דרישות לא-פונקציונליות

| תחום | דרישה |
|------|-------|
| ביצועים | UI לא נתקע בזמן קמפיין; עדכון ספירה לאחור ≤ 1 שנ'; 200 פריטים ברשימה וירטואלית. |
| אמינות | יצירת קמפיין ופריטים בטרנזקציה; כל מעבר מצב פריט = כתיבה מיידית ל-DB; עמידות בקריסה (W-47). |
| אבטחה | סשן WhatsApp ב-`userData/Partitions/whatsapp` – מחוץ לגיבוי; "התנתק" מוחק; אין שמירת תוכן שיחות. |
| שפה | כל הודעות השגיאה בעברית ידידותית (מיפוי `error_code` → טקסט). |
| בדיקות | יחידה: `TemplateRenderer` (כל שדה, שדה לא מוכר, יתרה שלילית, חבר ללא כינוי), `CampaignRunner` (מכונת מצבים עם `MessageSender` מדומה: הצלחה, כשל, 3 כשלים רצופים, ניתוק, מכסה, pause/resume/cancel). |
| בדיקת שטח | צ'קליסט ידני מול WhatsApp אמיתי: 3 מספרים (תקין, לא ב-WhatsApp, לא תקין), ניתוק באמצע, סגירת אפליקציה באמצע ושחזור. |

---

## 7. סיכונים ומענה

| סיכון | מענה |
|-------|------|
| WhatsApp משנה DOM | WB-06 + W-66 (צילום מסך) + בדיקת עשן ידנית לפני כל release. |
| חסימת מספר | WB-07, SIM ייעודי, הודעות מותאמות אישית (לא זהות), דיאלוג הסכמה. |
| שליחה כפולה אחרי קריסה | WB-08 – `unknown` דורש החלטה ידנית. |
| WhatsApp Web דורש "Chrome מעודכן" | WB-04 UA עדכני כקבוע בקובץ הגדרות, מתעדכן עם Electron. |
| שני חלונות WhatsApp Web (דפדפן + אפליקציה) | `stale` מזוהה ומוצגת הנחיה "סגור את WhatsApp Web בדפדפן". |

---

## 8. שאלות פתוחות לגבאי

1. האם יש SIM ייעודי לבית הכנסת, או שצריך לרכוש? (חוסם את הפעלת המודול בייצור.)
2. מכסה יומית – 50 מספיק לתזכורת חודשית? (90 חברים → יומיים.)
3. ניסוח 3 התבניות ההתחלתיות – דרוש טקסט מהגבאי.
4. האם לשלוח גם לחברים "לא פעילים"? (ברירת מחדל: לא.)
