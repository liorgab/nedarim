# מודל נתונים – סכימת SQLite

מסמך זה הוא הגרסה הטכנית של פרק 4 ב-`SPEC.md`. הוא המקור המחייב לסכימה. כל שינוי בסכימה נעשה דרך קובץ מיגרציה ממוספר ב-`src/main/db/migrations/` ומעודכן כאן.

## עקרונות

- סכומים: `INTEGER` באגורות (`amount_agorot`). לעולם לא REAL/float. תצוגה: `amount / 100` עם מפריד אלפים ו-₪.
- תאריכים: `TEXT` בפורמט ISO `YYYY-MM-DD`. חותמות זמן: `YYYY-MM-DDTHH:MM:SS` (זמן מקומי).
- מחיקה לוגית בלבד: `deleted_at TEXT NULL`. שאילתות ברירת מחדל מסננות `deleted_at IS NULL`.
- כל טבלה עסקית: `id INTEGER PRIMARY KEY`, `created_at`, `updated_at`, `created_by INTEGER REFERENCES user(id)`.
- `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`.
- יתרות מחושבות בשאילתות/Views — לא נשמרות כשדה.

## טבלאות

```sql
CREATE TABLE user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','clerk','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- keys: synagogue_name, synagogue_city, synagogue_address, synagogue_phone,
--       association_number, logo_path, signature_path, receipt_footer_text,
--       fiscal_year_start_month (default 9), backup_dir, credit_approval_threshold_agorot,
--       receipt_paper_size (A5|A4), default_printer

CREATE TABLE occasion (               -- פרשה / חג / אירוע / זיכוי
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('parasha','holiday','event','credit','opening','other')),
  hebcal_key TEXT,                    -- מפתח לזיהוי אוטומטי מ-@hebcal/core (למשל 'Bereshit')
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE payment_method (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  requires_reference INTEGER NOT NULL DEFAULT 0,   -- המחאה → 1
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE donation_type (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE expense_category (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE member (
  id INTEGER PRIMARY KEY,
  member_number INTEGER NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nickname TEXT,
  mobile TEXT,
  email TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  opening_balance_agorot INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  import_source_ref TEXT,             -- 'members!A5' וכד'
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_member_name ON member(last_name, first_name);

CREATE TABLE vow_charge (             -- חיוב נדר / זיכוי / יתרת פתיחה
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id),
  charge_date TEXT NOT NULL,
  occasion_id INTEGER NOT NULL REFERENCES occasion(id),
  occasion_note TEXT,
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  kind TEXT NOT NULL CHECK (kind IN ('vow','credit','opening')),
  reversal_of_id INTEGER REFERENCES vow_charge(id),
  credit_reason TEXT,                 -- חובה כאשר kind='credit'
  notes TEXT,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_vow_charge_member_date ON vow_charge(member_id, charge_date);
CREATE INDEX idx_vow_charge_date ON vow_charge(charge_date);

CREATE TABLE receipt (                -- קבלה: רשומה בלתי ניתנת לשינוי
  id INTEGER PRIMARY KEY,
  receipt_number INTEGER NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('vow_payment','donation')),
  source_id INTEGER NOT NULL,
  payer_name TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  payment_method_text TEXT NOT NULL,
  payment_reference TEXT,
  payment_date TEXT NOT NULL,
  purpose_text TEXT NOT NULL,         -- 'תשלום נדרים' / 'תרומה – בדק בית'
  hebrew_year TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  issued_by INTEGER REFERENCES user(id),
  pdf_path TEXT,
  print_count INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES user(id),
  cancel_reason TEXT,
  import_source_ref TEXT
);
CREATE UNIQUE INDEX idx_receipt_source ON receipt(source_type, source_id) WHERE cancelled_at IS NULL;

CREATE TABLE vow_payment (            -- תשלום על חשבון נדרים
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id),
  payment_date TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
  reference TEXT,
  receipt_id INTEGER REFERENCES receipt(id),
  notes TEXT,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_vow_payment_member_date ON vow_payment(member_id, payment_date);
CREATE INDEX idx_vow_payment_date ON vow_payment(payment_date);

CREATE TABLE donation (
  id INTEGER PRIMARY KEY,
  donation_number INTEGER NOT NULL UNIQUE,
  donation_date TEXT NOT NULL,
  member_id INTEGER REFERENCES member(id),
  donor_name TEXT NOT NULL,
  donation_type_id INTEGER NOT NULL REFERENCES donation_type(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
  reference TEXT,
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  purpose TEXT,
  receipt_id INTEGER REFERENCES receipt(id),
  notes TEXT,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_donation_date ON donation(donation_date);

CREATE TABLE expense (
  id INTEGER PRIMARY KEY,
  expense_number INTEGER NOT NULL UNIQUE,
  expense_date TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,     -- שלילי מותר רק עם is_refund=1
  is_refund INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER NOT NULL REFERENCES expense_category(id),
  description TEXT NOT NULL,
  supplier TEXT,
  reference TEXT,
  payment_method_id INTEGER REFERENCES payment_method(id),
  attachment_path TEXT,
  notes TEXT,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_expense_date ON expense(expense_date);

CREATE TABLE sequence (               -- מונים רצים
  name TEXT PRIMARY KEY,              -- 'receipt' | 'member' | 'donation' | 'expense'
  next_value INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER REFERENCES user(id),
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,               -- create|update|delete|cancel|print|login|backup|restore|import
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
```

## Views

```sql
CREATE VIEW v_member_balance AS
SELECT m.id AS member_id,
       m.member_number, m.first_name, m.last_name, m.status,
       m.opening_balance_agorot
       + COALESCE((SELECT SUM(CASE kind WHEN 'credit' THEN -amount_agorot ELSE amount_agorot END)
                   FROM vow_charge c WHERE c.member_id = m.id AND c.deleted_at IS NULL), 0)
       - COALESCE((SELECT SUM(amount_agorot) FROM vow_payment p
                   WHERE p.member_id = m.id AND p.deleted_at IS NULL), 0) AS balance_agorot,
       (SELECT MAX(payment_date) FROM vow_payment p WHERE p.member_id = m.id AND p.deleted_at IS NULL) AS last_payment_date
FROM member m WHERE m.deleted_at IS NULL;

-- כרטיסייה משולבת (חיובים + תשלומים) לפי חבר
CREATE VIEW v_ledger AS
SELECT 'charge' AS row_type, c.id, c.member_id, c.charge_date AS d, o.name AS occasion, c.occasion_note AS note,
       CASE c.kind WHEN 'credit' THEN 0 ELSE c.amount_agorot END AS debit_agorot,
       CASE c.kind WHEN 'credit' THEN c.amount_agorot ELSE 0 END AS credit_agorot,
       NULL AS payment_method, NULL AS receipt_number, c.kind AS status
FROM vow_charge c JOIN occasion o ON o.id = c.occasion_id WHERE c.deleted_at IS NULL
UNION ALL
SELECT 'payment', p.id, p.member_id, p.payment_date, NULL, p.notes,
       0, p.amount_agorot, pm.name, r.receipt_number,
       CASE WHEN r.id IS NULL THEN 'recorded' WHEN r.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'receipted' END
FROM vow_payment p JOIN payment_method pm ON pm.id = p.payment_method_id
LEFT JOIN receipt r ON r.id = p.receipt_id WHERE p.deleted_at IS NULL;

-- מאזן חודשי (בסיס מזומן – כמו בקובץ הישן)
CREATE VIEW v_monthly_balance AS
WITH months AS (
  SELECT substr(payment_date,1,7) AS ym FROM vow_payment WHERE deleted_at IS NULL
  UNION SELECT substr(donation_date,1,7) FROM donation WHERE deleted_at IS NULL
  UNION SELECT substr(expense_date,1,7) FROM expense WHERE deleted_at IS NULL
)
SELECT ym,
  COALESCE((SELECT SUM(amount_agorot) FROM donation d WHERE substr(d.donation_date,1,7)=ym AND d.deleted_at IS NULL),0) AS donations,
  COALESCE((SELECT SUM(amount_agorot) FROM vow_payment p WHERE substr(p.payment_date,1,7)=ym AND p.deleted_at IS NULL),0) AS vow_payments,
  COALESCE((SELECT SUM(amount_agorot) FROM expense e WHERE substr(e.expense_date,1,7)=ym AND e.deleted_at IS NULL),0) AS expenses
FROM months ORDER BY ym;
```

## הקצאת מספר קבלה (חובה בטרנזקציה)

```sql
BEGIN IMMEDIATE;
  SELECT next_value FROM sequence WHERE name='receipt';          -- n
  UPDATE sequence SET next_value = next_value + 1 WHERE name='receipt';
  INSERT INTO receipt (receipt_number, ...) VALUES (n, ...);
  UPDATE vow_payment SET receipt_id = last_insert_rowid() WHERE id = ?;  -- או donation
COMMIT;
```

אם יצירת ה-PDF נכשלת אחרי ה-COMMIT — הקבלה קיימת עם `print_count = 0` ומודפסת שוב; המספר לעולם לא משוחרר.

## כלל ברזל: מיגרציה שהוחלה היא קפואה

אין לערוך קובץ מיגרציה שכבר רץ אצל מישהו. DB שרשם את הגרסה ב-`schema_version`
לא יריץ אותה שוב, יישאר עם סכימה ישנה, וייפול בשגיאות ריצה סתומות
(`table vow_payment has no column named is_reversal`). כל שינוי = קובץ חדש עם
המספר הבא. מיגרציה 002 נוצרה בדיוק בגלל הפרה של הכלל הזה במהלך שלב 1.

## שינויים ביחס לגרסה הראשונה של המסמך

הסכימה שמומשה ב-`src/main/db/migrations/001_init.sql` תואמת למסמך, למעט התוספות הבאות
שהוחלטו במימוש ומתועדות כאן כמקור האמת:

| # | תוספת | נימוק |
|---|---|---|
| 1 | טבלת `schema_version (version, name, applied_at)` | מנגנון המיגרציות (ROADMAP שלב 0) |
| 2 | עמודה `needs_review INTEGER NOT NULL DEFAULT 0` ב-`vow_charge`, `vow_payment`, `donation`, `expense` | דגל "לבדיקה ידנית" לרשומות שיובאו עם ניחוש (SPEC 7.2, ROADMAP שלב 1) |
| 3 | `CHECK (kind <> 'credit' OR credit_reason IS NOT NULL)` ב-`vow_charge` | זיכוי בלי סיבה הוא נתון חסר (F-35: הערה חובה) |
| 4 | `CHECK (amount_agorot >= 0 OR is_refund = 1)` ב-`expense` | SPEC 4.7: סכום שלילי מותר רק בסוג "החזר/תיקון" |
| 5 | `v_member_balance` מחזירה גם `charges_agorot` ו-`payments_agorot` | הכרטיסייה והדוחות צריכים את שני האגפים, לא רק את היתרה |
| 6 | סיומת `_agorot` בשמות עמודות ה-Views | עקביות עם שמות עמודות הטבלאות |
| 7 | אינדקסים `idx_occasion_hebcal`, `idx_audit_ts` | חיפוש פרשה לפי מפתח hebcal; סינון יומן ביקורת לפי תאריך |
| 8 | **(מיגרציה 002)** `is_reversal INTEGER NOT NULL DEFAULT 0` ב-`vow_payment` וב-`donation`, במקום `CHECK (amount_agorot > 0)` | בקובץ הישן נמצאו **שני תשלומים בסכום שלילי** (‎-38 ו-‎-68 ₪, לשניהם הוקצו קבלות 166 ו-167) ו**תרומה אחת בסכום שלילי** (‎-2,000 ₪, "ביטול קבלה על תרומה", קבלה 396). בלי תמיכה בהם היתרות והמאזן לא מתאימים לקובץ. האילוץ החדש: `amount_agorot <> 0` וגם `amount_agorot > 0 OR is_reversal = 1` – אותה תבנית כמו `expense.is_refund` |
| 9 | **(מיגרציה 002)** ב-`v_ledger`, תשלום שלילי מוצג בצד החיוב ולא בצד הזיכוי | אחרת היתרה המצטברת בכרטיסייה הייתה מציגה מספר שלילי בעמודת הזיכוי |

### יתרות פתיחה – החלטה

יתרות `יתרות תשפ"ג` **אינן** מיובאות כשורות `vow_charge` עם `kind='opening'`, אלא לשדה
`member.opening_balance_agorot`. הסיבה: בקובץ הישן נמצאה יתרת פתיחה **שלילית** (חבר 24: −5 ₪),
ו-`vow_charge.amount_agorot` מוגבל ב-`CHECK (> 0)`. `opening_balance_agorot` הוא INTEGER עם סימן
ולכן מייצג נכון גם יתרת זכות. `kind='opening'` נשאר בסכימה לשימוש עתידי.

### מונים רצים – התקנה נקייה מול ייבוא

`seed` מאתחל את כל המונים ל-**1**, לא לערכים שבמסמך המקורי (receipt=453 וכו').
הערכים האלה ספציפיים לבית הכנסת "דוגמה" ולכן שייכים ל**כלי הייבוא**, שמעדכן את
`sequence` ל-`MAX(...)+1` בסוף הייבוא. התקנה נקייה של מישהו אחר מתחילה מקבלה מס' 1
(CLAUDE.md כלל 12–13).


## מיגרציה 009 – מפתח hebcal של שבועות

מיגרציות 001–008 קפואות. אותו סוג באג כמו ב-008: בטבלה נרשם `Shavuot I`,
ו-hebcal מחזיר `Shavuot`.

הוא לא נתפס ב-008 כי הסריקה שם הייתה על `getSedra` בלבד, **ושבועות לעולם
אינו חל בשבת** – ולכן הוא לא הופיע כמפתח שבת חסר. עד שברירת המחדל התחילה
להתחשב בחגים ביום חול (F-31) זה היה ערך מת בלבד.

```sql
UPDATE occasion SET hebcal_key = 'Shavuot'
  WHERE name = 'שבועות' AND (hebcal_key IS NULL OR hebcal_key = 'Shavuot I');
```

**הכלל שנלמד:** `hebcal_key` מחזיק את הצורה הקנונית של המזהה, ו-
`holidayCandidateKeys` מקלף אליה את מה ש-`getHolidaysOnDate` מחזיר
(שנה עברית, `Chanukah: 3 Candles`, `Pesach IV (CH''M)`, ספרה רומית).
**אין התאמת prefix** – `Yom Kippur Katan Adar` מתחיל ב-`Yom Kippur`.

---

## מיגרציה 008 – מפתחות hebcal של פסח וסוכות

מיגרציות 001–007 קפואות.

`occasion.hebcal_key` נקרא אך ורק דרך `findOccasionByHebcalKey`, ושם המפתח
מגיע **תמיד** מ-`getSedra` (הקריאה של אותה שבת). סריקה של 12 שנים
(2025–2037) מצאה 67 מפתחות שבת שונים; `Pesach I` ו-`Sukkot I` אינם ביניהם –
הם מזהי האירוע של `getHolidaysOnDate`, מקור אחר לגמרי. כלומר שני ערכים
שלעולם לא יכלו להתאים.

```sql
UPDATE occasion SET hebcal_key = 'Sukkot Shabbat Chol ha-Moed' WHERE name = 'שבת חול המועד סוכות' AND hebcal_key IS NULL;
UPDATE occasion SET hebcal_key = 'Pesach Shabbat Chol ha-Moed' WHERE name = 'שבת חול המועד פסח'   AND hebcal_key IS NULL;
UPDATE occasion SET hebcal_key = 'Sukkot' WHERE name = 'סוכות' AND (hebcal_key IS NULL OR hebcal_key = 'Sukkot I');
UPDATE occasion SET hebcal_key = 'Pesach' WHERE name = 'פסח'   AND (hebcal_key IS NULL OR hebcal_key = 'Pesach I');
```

ארבע השבתות שהיו ללא ברירת מחדל בהזנת נדר:

| מפתח | מתי |
|---|---|
| `Sukkot Shabbat Chol ha-Moed` | 11/10/2025, 07/10/2028, 29/09/2029 |
| `Pesach Shabbat Chol ha-Moed` | 04/04/2026, 24/04/2027, 15/04/2028 |
| `Sukkot` (סוכות שחל בשבת) | 26/09/2026, 16/10/2027, 12/10/2030 |
| `Pesach` (פסח שחל בשבת) | 31/03/2029, 27/03/2032, 12/04/2036 |

**הכלל:** `hebcal_key` מחזיק את מפתח הסדרה, לא את מזהה האירוע. `WHERE` על
הערך הישן שומר על גבאי שכבר תיקן ידנית. הרגרסיה נשמרת ב-
`occasionCoverage.test.ts`, שסורק 12 שנים – בדיקה עם תאריכים קבועים לא
הייתה תופסת את זה, כי כל מקרה חוזר רק אחת לכמה שנים.

**שם החג** (`HebrewDateInfo.holiday`) אינו עובר דרך הטבלה כלל: הוא מגיע
מ-hebcal עצמו ב-`render('he-x-NoNikud')`, כי `getHolidaysOnDate` מחזיר
מזהים כמו `Chanukah: 8th Day` ו-`Pesach III (CH''M)` שאין להם שורה.

---

## מיגרציה 007 – הודעה בכל אירוע כספי

מיגרציות 001–006 קפואות. הדרישות המלאות ב-`docs/WHATSAPP-SPEC.md` §4.8.

```sql
-- לאיזה אירוע התבנית משמשת. NULL = תבנית חופשית (קמפיינים ושליחה ידנית).
ALTER TABLE message_template ADD COLUMN event_kind TEXT;

-- תבנית אחת פעילה לכל אירוע. אינדקס חלקי ולא CHECK: תבנית מחוקה לוגית
-- חייבת לפנות את המקום לתבנית חדשה לאותו אירוע.
CREATE UNIQUE INDEX idx_template_event_kind ON message_template(event_kind)
  WHERE event_kind IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE message_campaign ADD COLUMN trigger_kind TEXT;   -- 'vow' | 'credit' | 'payment' | 'donation' | 'receipt'
ALTER TABLE message_campaign ADD COLUMN trigger_ref TEXT;    -- 'vow_payment:42'
CREATE INDEX idx_campaign_trigger ON message_campaign(trigger_ref) WHERE trigger_ref IS NOT NULL;
```

**למה `entity:id` ולא מזהה חשוף:** מזהה 42 קיים גם ב-`vow_charge` וגם
ב-`vow_payment`. בלי שם הישות, בדיקת "כבר נשלחה הודעה" הייתה מדלגת על
הודעות תקינות לחלוטין.

**מצבי השליחה** (`setting`, כולם `off` בהתקנה חדשה):
`whatsapp_notify_vow` · `_credit` · `_payment` · `_donation` · `_receipt`,
בערכים `off` / `ask` / `auto`.

---

## מיגרציה 005 – נרמול נייד + מודול WhatsApp

מיגרציות 001–004 קפואות. כל התוספות הבאות נכנסות ל-`005_whatsapp.sql` אחד, בטרנזקציה אחת. הסכימה המלאה של טבלאות המודול (`message_template`, `message_campaign`, `message_campaign_item`, `whatsapp_daily_counter`) מוגדרת ב-`docs/WHATSAPP-SPEC.md` §3 והוא המקור המחייב להן.

### תוספת ל-`member`

```sql
ALTER TABLE member ADD COLUMN mobile_e164 TEXT;                 -- '972501234567' (ספרות בלבד, ללא +) או NULL
ALTER TABLE member ADD COLUMN mobile_status TEXT NOT NULL DEFAULT 'missing'
  CHECK (mobile_status IN ('valid','invalid','missing'));
CREATE INDEX idx_member_mobile_e164 ON member(mobile_e164) WHERE mobile_e164 IS NOT NULL;

CREATE VIEW v_member_duplicate_mobile AS
SELECT mobile_e164, COUNT(*) AS cnt, GROUP_CONCAT(member_number) AS member_numbers
FROM member WHERE deleted_at IS NULL AND mobile_e164 IS NOT NULL
GROUP BY mobile_e164 HAVING COUNT(*) > 1;

-- SQLite: אין ALTER VIEW → DROP + CREATE של v_member_balance עם העמודות mobile_e164, mobile_status
```

עקרון: `mobile` נשאר כפי שהוזן (לתצוגה/עריכה). `mobile_e164` ו-`mobile_status` **מחושבים תמיד** מ-`mobile` על ידי `src/main/services/PhoneNormalizer.ts` – ב-repository של `member` בכל `create/update` (לא trigger), ובצעד backfill חד-פעמי. אין מסלול שכותב `mobile` בלי לחשב אותם. `setting` מקבל מפתח `default_country_code` (`'972'`) דרך `SETTING_SPECS`.

### Backfill (חד-פעמי, אידמפוטנטי)

SQL לא יכול להריץ את הנרמול, לכן אחרי החלת 005 רץ `backfillMobileE164(db)` ב-TypeScript: לכל חבר עם `mobile IS NOT NULL AND mobile_e164 IS NULL` מחשב את שני השדות, ורושם ב-`audit_log` (`entity='member'`, `action='backfill_mobile'`) סיכום `{valid, invalid, missing, duplicates}`. אם מנגנון המיגרציות הוא SQL-only, הצעד רץ בהפעלת האפליקציה אחרי המיגרציות, מוגן בתנאי הזה. על נתוני האמת (55/90 עם נייד בפורמט `05XXXXXXXX`) הצפי: 55 valid, 35 missing, 0 invalid.

### `PhoneNormalizer` – טבלת מקרים (= מפרט בדיקות היחידה)

חתימה: `normalizeMobile(raw: string | null, defaultCountryCode = '972'): { e164: string | null; status: 'valid'|'invalid'|'missing'; reason?: 'landline'|'too_short'|'multiple'|'foreign'|'no_digits' }`. פונקציה טהורה, ללא `db`.

| קלט | e164 | status | reason |
|-----|------|--------|--------|
| `null` / `''` / `'  '` | NULL | missing | – |
| `'אין'` / `'לברר'` (ללא ספרות) | NULL | missing | no_digits |
| `'0501234567'` | `972501234567` | valid | – |
| `'050-123-4567'` / `'050 123 4567'` | `972501234567` | valid | – |
| `'501234567'` (Excel אכל אפס מוביל, 9 ספרות שמתחילות ב-5) | `972501234567` | valid | – |
| `'+972501234567'` / `'972501234567'` / `'00972501234567'` | `972501234567` | valid | – |
| `'9720501234567'` (קידומת + אפס מיותר) | `972501234567` | valid | – |
| `'02-6543210'` / `'036543210'` | NULL | invalid | landline |
| `'05292593'` (קצר) | NULL | invalid | too_short |
| `'050-1234567 / 054-1112222'` | `972501234567` (הראשון) | valid | multiple |
| `'+1 212 555 0100'` | `12125550100` | valid | foreign |
| `'0501234567 של הבן'` | `972501234567` | valid | – |

כללים: מסירים כל תו שאינו ספרה או `+` מוביל; נייד ישראלי תקין = `972` + `5` + 8 ספרות (12 ספרות סה"כ); `reason` שאינו ריק מוצג כאזהרה במסך החברים גם כש-`status='valid'`.

### פירוט החוב הפתוח (FIFO)

אין קישור בין `vow_payment` ל-`vow_charge`. הפירוט לשדה `{{open_charges}}` נגזר ב-`src/main/services/openCharges.ts`: פריטי החיוב מסודרים מהישן לחדש (יתרת פתיחה ראשונה, אחריה `vow_charge` לפי `charge_date, id`), וסך התשלומים + הזיכויים + יתרת פתיחה שלילית מכסה אותם לפי הסדר. מה שנותר לא מכוסה הוא החוב הפתוח.

**האילוץ שנועל את החישוב:** `Σ remainingAgorot = balance_agorot`. הבדיקה נאכפת ב-`openCharges.test.ts` ואומתה על כל 90 החברים בנתוני האמת.

## נתוני seed

- `sequence`: התקנה נקייה = 1 לכל מונה. לאחר ייבוא הקובץ הישן: receipt = MAX+1 (=453), member = 91, donation = 46, expense = 170.
- `payment_method`: מזומן, המחאה (requires_reference), הוראת קבע, כרטיס אשראי, העברה בנקאית, ביט/פייבוקס.
- `donation_type`: בדק בית, ברכת השנה, משכורת לרב, כללי.
- `expense_category`: משכורת לרב, תחזוקה ותיקונים, ציוד, כיבוד וחגים, חשמל ומים, הדפסות, אחר.
- `occasion`: ראו נספח א' ב-SPEC.md (54 פרשות עם hebcal_key, חגים, אירועים, סוגי זיכוי, 'יתרת פתיחה').
- `user`: admin ראשוני עם סיסמה שנקבעת בהפעלה הראשונה.
