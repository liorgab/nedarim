-- מיגרציה 001 – סכימת הבסיס. תואמת ל-docs/DATA-MODEL.md.
-- סכומים: INTEGER באגורות. תאריכים: TEXT ISO. מחיקה לוגית בלבד.

CREATE TABLE user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','clerk','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE occasion (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('parasha','holiday','event','credit','opening','other')),
  hebcal_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_occasion_hebcal ON occasion(hebcal_key);

CREATE TABLE payment_method (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  requires_reference INTEGER NOT NULL DEFAULT 0,
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
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_member_name ON member(last_name, first_name);

CREATE TABLE vow_charge (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id),
  charge_date TEXT NOT NULL,
  occasion_id INTEGER NOT NULL REFERENCES occasion(id),
  occasion_note TEXT,
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  kind TEXT NOT NULL CHECK (kind IN ('vow','credit','opening')),
  reversal_of_id INTEGER REFERENCES vow_charge(id),
  credit_reason TEXT,
  notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id),
  CHECK (kind <> 'credit' OR credit_reason IS NOT NULL)
);
CREATE INDEX idx_vow_charge_member_date ON vow_charge(member_id, charge_date);
CREATE INDEX idx_vow_charge_date ON vow_charge(charge_date);

CREATE TABLE receipt (
  id INTEGER PRIMARY KEY,
  receipt_number INTEGER NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('vow_payment','donation')),
  source_id INTEGER NOT NULL,
  payer_name TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  payment_method_text TEXT NOT NULL,
  payment_reference TEXT,
  payment_date TEXT NOT NULL,
  purpose_text TEXT NOT NULL,
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

CREATE TABLE vow_payment (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id),
  payment_date TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
  reference TEXT,
  receipt_id INTEGER REFERENCES receipt(id),
  notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id)
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
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_donation_date ON donation(donation_date);

CREATE TABLE expense (
  id INTEGER PRIMARY KEY,
  expense_number INTEGER NOT NULL UNIQUE,
  expense_date TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  is_refund INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER NOT NULL REFERENCES expense_category(id),
  description TEXT NOT NULL,
  supplier TEXT,
  reference TEXT,
  payment_method_id INTEGER REFERENCES payment_method(id),
  attachment_path TEXT,
  notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  import_source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id),
  CHECK (amount_agorot >= 0 OR is_refund = 1)
);
CREATE INDEX idx_expense_date ON expense(expense_date);

CREATE TABLE sequence (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER REFERENCES user(id),
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_ts ON audit_log(ts);

-- ============================ Views ============================

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
       0, p.amount_agorot, pm.name, r.receipt_number,
       CASE WHEN r.id IS NULL THEN 'recorded'
            WHEN r.cancelled_at IS NOT NULL THEN 'cancelled'
            ELSE 'receipted' END
FROM vow_payment p JOIN payment_method pm ON pm.id = p.payment_method_id
LEFT JOIN receipt r ON r.id = p.receipt_id
WHERE p.deleted_at IS NULL;

-- מאזן חודשי על בסיס מזומן (כמו בקובץ הישן, SPEC F-80)
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
