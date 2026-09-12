-- מיגרציה 002 – תמיכה בתשלומים ובתרומות בסכום שלילי (ביטול/החזר).
--
-- למה: בייבוא מהקובץ הישן נמצאו שני תשלומים בסכום שלילי (‎-38 ו-‎-68 ₪, לשניהם
-- הוקצו קבלות 166 ו-167) ותרומה אחת בסכום שלילי (‎-2,000 ₪, "ביטול קבלה על תרומה",
-- קבלה 396). האילוץ `CHECK (amount_agorot > 0)` שבמיגרציה 001 חסם אותם, והיתרות
-- של שלושה חברים יצאו שונות מהקובץ הישן.
--
-- SQLite אינו יודע להוסיף או להסיר CHECK ב-ALTER TABLE, ולכן שתי הטבלאות נבנות
-- מחדש ומועתקות. אף טבלה אינה מפנה אליהן במפתח זר, ולכן הבנייה מחדש בטוחה.
-- `receipt.source_id` הוא מזהה חופשי ולא FK, וה-id-ים נשמרים בהעתקה.

-- SQLite מאמת מחדש את כל ה-Views בכל `ALTER TABLE ... RENAME`. לכן חייבים להסיר
-- מראש כל View שמפנה לטבלאות שנבנות מחדש, ולהקים אותם בסוף.
DROP VIEW v_ledger;
DROP VIEW v_member_balance;
DROP VIEW v_monthly_balance;

-- ------------------------------------------------------------------ vow_payment
CREATE TABLE vow_payment_new (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id),
  payment_date TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  -- סכום שלילי = ביטול/החזר תשלום.
  is_reversal INTEGER NOT NULL DEFAULT 0,
  payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
  reference TEXT,
  receipt_id INTEGER REFERENCES receipt(id),
  notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id),
  CHECK (amount_agorot <> 0),
  CHECK (amount_agorot > 0 OR is_reversal = 1)
);

INSERT INTO vow_payment_new (
  id, member_id, payment_date, amount_agorot, is_reversal, payment_method_id,
  reference, receipt_id, notes, needs_review, import_source_ref, deleted_at,
  created_at, updated_at, created_by
)
SELECT id, member_id, payment_date, amount_agorot, 0, payment_method_id,
       reference, receipt_id, notes, needs_review, import_source_ref, deleted_at,
       created_at, updated_at, created_by
FROM vow_payment;

DROP TABLE vow_payment;
ALTER TABLE vow_payment_new RENAME TO vow_payment;
CREATE INDEX idx_vow_payment_member_date ON vow_payment(member_id, payment_date);
CREATE INDEX idx_vow_payment_date ON vow_payment(payment_date);

-- ------------------------------------------------------------------ donation
CREATE TABLE donation_new (
  id INTEGER PRIMARY KEY,
  donation_number INTEGER NOT NULL UNIQUE,
  donation_date TEXT NOT NULL,
  member_id INTEGER REFERENCES member(id),
  donor_name TEXT NOT NULL,
  donation_type_id INTEGER NOT NULL REFERENCES donation_type(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
  reference TEXT,
  amount_agorot INTEGER NOT NULL,
  -- סכום שלילי = ביטול תרומה.
  is_reversal INTEGER NOT NULL DEFAULT 0,
  purpose TEXT,
  receipt_id INTEGER REFERENCES receipt(id),
  notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id),
  CHECK (amount_agorot <> 0),
  CHECK (amount_agorot > 0 OR is_reversal = 1)
);

INSERT INTO donation_new (
  id, donation_number, donation_date, member_id, donor_name, donation_type_id,
  payment_method_id, reference, amount_agorot, is_reversal, purpose, receipt_id,
  notes, needs_review, import_source_ref, deleted_at, created_at, updated_at, created_by
)
SELECT id, donation_number, donation_date, member_id, donor_name, donation_type_id,
       payment_method_id, reference, amount_agorot, 0, purpose, receipt_id,
       notes, needs_review, import_source_ref, deleted_at, created_at, updated_at, created_by
FROM donation;

DROP TABLE donation;
ALTER TABLE donation_new RENAME TO donation;
CREATE INDEX idx_donation_date ON donation(donation_date);

-- ------------------------------------------------------------------ Views
CREATE VIEW v_member_balance AS
SELECT m.id AS member_id,
       m.member_number, m.first_name, m.last_name, m.status,
       m.opening_balance_agorot,
       COALESCE((SELECT SUM(CASE kind WHEN 'credit' THEN -amount_agorot ELSE amount_agorot END)
                 FROM vow_charge c WHERE c.member_id = m.id AND c.deleted_at IS NULL), 0)
         AS charges_agorot,
       COALESCE((SELECT SUM(amount_agorot) FROM vow_payment p
                 WHERE p.member_id = m.id AND p.deleted_at IS NULL), 0) AS payments_agorot,
       m.opening_balance_agorot
       + COALESCE((SELECT SUM(CASE kind WHEN 'credit' THEN -amount_agorot ELSE amount_agorot END)
                   FROM vow_charge c WHERE c.member_id = m.id AND c.deleted_at IS NULL), 0)
       - COALESCE((SELECT SUM(amount_agorot) FROM vow_payment p
                   WHERE p.member_id = m.id AND p.deleted_at IS NULL), 0) AS balance_agorot,
       (SELECT MAX(payment_date) FROM vow_payment p
        WHERE p.member_id = m.id AND p.deleted_at IS NULL) AS last_payment_date
FROM member m WHERE m.deleted_at IS NULL;

CREATE VIEW v_monthly_balance AS
WITH months AS (
  SELECT substr(payment_date,1,7) AS ym FROM vow_payment WHERE deleted_at IS NULL
  UNION SELECT substr(donation_date,1,7) FROM donation WHERE deleted_at IS NULL
  UNION SELECT substr(expense_date,1,7) FROM expense WHERE deleted_at IS NULL
)
SELECT ym,
  COALESCE((SELECT SUM(amount_agorot) FROM donation d
            WHERE substr(d.donation_date,1,7)=ym AND d.deleted_at IS NULL),0) AS donations_agorot,
  COALESCE((SELECT SUM(amount_agorot) FROM vow_payment p
            WHERE substr(p.payment_date,1,7)=ym AND p.deleted_at IS NULL),0) AS vow_payments_agorot,
  COALESCE((SELECT SUM(amount_agorot) FROM expense e
            WHERE substr(e.expense_date,1,7)=ym AND e.deleted_at IS NULL),0) AS expenses_agorot
FROM months ORDER BY ym;

-- תשלום בסכום שלילי מוצג בצד החיוב, אחרת הכרטיסייה הייתה מציגה מספר שלילי
-- בעמודת הזיכוי.
CREATE VIEW v_ledger AS
SELECT 'charge' AS row_type, c.id AS id, c.member_id AS member_id, c.charge_date AS d,
       o.name AS occasion, c.occasion_note AS note,
       CASE c.kind WHEN 'credit' THEN 0 ELSE c.amount_agorot END AS debit_agorot,
       CASE c.kind WHEN 'credit' THEN c.amount_agorot ELSE 0 END AS credit_agorot,
       NULL AS payment_method, NULL AS receipt_number, c.kind AS status
FROM vow_charge c JOIN occasion o ON o.id = c.occasion_id
WHERE c.deleted_at IS NULL
UNION ALL
SELECT 'payment', p.id, p.member_id, p.payment_date, NULL, p.notes,
       CASE WHEN p.amount_agorot < 0 THEN -p.amount_agorot ELSE 0 END,
       CASE WHEN p.amount_agorot > 0 THEN p.amount_agorot ELSE 0 END,
       pm.name, r.receipt_number,
       CASE WHEN r.id IS NULL THEN 'recorded'
            WHEN r.cancelled_at IS NOT NULL THEN 'cancelled'
            ELSE 'receipted' END
FROM vow_payment p JOIN payment_method pm ON pm.id = p.payment_method_id
LEFT JOIN receipt r ON r.id = p.receipt_id
WHERE p.deleted_at IS NULL;
