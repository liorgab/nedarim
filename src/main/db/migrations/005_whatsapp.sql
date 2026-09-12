-- 005 – נרמול נייד + מודול WhatsApp (WHATSAPP-SPEC §3, DATA-MODEL "מיגרציה 005").
--
-- מיגרציות 001–004 קפואות. הכול כאן, בטרנזקציה אחת של מנגנון המיגרציות.
--
-- הנרמול עצמו (mobile → mobile_e164) אינו כאן: SQL לא יכול להריץ את
-- PhoneNormalizer. העמודות נוצרות ריקות, ומיד אחרי החלת המיגרציה רץ
-- `backfillMobileE164(db)` ב-TypeScript (WB-11).

-- ---------------------------------------------------------------- נייד מנורמל

ALTER TABLE member ADD COLUMN mobile_e164 TEXT;
ALTER TABLE member ADD COLUMN mobile_status TEXT NOT NULL DEFAULT 'missing'
  CHECK (mobile_status IN ('valid','invalid','missing'));
-- הסיבה נשמרת גם כשהמספר תקין (multiple/foreign), כדי שמסך החברים יוכל
-- להציג אזהרה בלי לחשב מחדש בכל רינדור.
ALTER TABLE member ADD COLUMN mobile_reason TEXT;

CREATE INDEX idx_member_mobile_e164 ON member(mobile_e164) WHERE mobile_e164 IS NOT NULL;

CREATE VIEW v_member_duplicate_mobile AS
SELECT mobile_e164, COUNT(*) AS cnt, GROUP_CONCAT(member_number) AS member_numbers
FROM member WHERE deleted_at IS NULL AND mobile_e164 IS NOT NULL
GROUP BY mobile_e164 HAVING COUNT(*) > 1;

-- ל-SQLite אין ALTER VIEW. הגדרת התצוגה זהה ל-002, בתוספת שלוש העמודות.
DROP VIEW v_member_balance;
CREATE VIEW v_member_balance AS
SELECT m.id AS member_id,
       m.member_number, m.first_name, m.last_name, m.status,
       m.mobile, m.mobile_e164, m.mobile_status, m.mobile_reason,
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

-- ---------------------------------------------------------------- תבניות

CREATE TABLE message_template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id)
);

-- ---------------------------------------------------------------- קמפיינים

CREATE TABLE message_campaign (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  template_id INTEGER REFERENCES message_template(id),
  -- התבנית עשויה להשתנות אחרי הקמפיין; הגוף שנשלח בפועל נשמר כאן.
  template_body_snapshot TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('draft','running','paused','completed','cancelled','failed')),
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES user(id)
);
CREATE INDEX idx_campaign_status ON message_campaign(status);

CREATE TABLE message_campaign_item (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES message_campaign(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES member(id),
  -- snapshot של mobile_e164 בזמן היצירה. NULL → הפריט דולג.
  phone_e164 TEXT,
  rendered_text TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending','sending','sent','failed','skipped','unknown')),
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_campaign_item ON message_campaign_item(campaign_id, status);
CREATE INDEX idx_campaign_item_member ON message_campaign_item(member_id);

-- מכסה יומית שנאכפת גם אחרי הפעלה מחדש של היישום (WB-07).
CREATE TABLE whatsapp_daily_counter (
  day TEXT PRIMARY KEY,
  sent_count INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- הגדרות

INSERT OR IGNORE INTO setting (key, value) VALUES
  ('whatsapp_enabled', '0'),
  ('whatsapp_consent_accepted_at', ''),
  ('whatsapp_min_delay_sec', '8'),
  ('whatsapp_max_delay_sec', '20'),
  ('whatsapp_daily_cap', '50'),
  ('whatsapp_stop_after_consecutive_failures', '3'),
  ('default_country_code', '972'),
  ('gabbai_phone_display', '');
