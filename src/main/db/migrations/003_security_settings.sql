-- 003 – הגדרות אבטחה (שלב 4).
--
-- מוסיפה את `require_login` להתקנות שנוצרו לפני שלב 4. ב-DB חדש הערך מגיע
-- מ-seed-data; כאן רק משלימים אותו למי שכבר קיים. INSERT OR IGNORE כדי לא
-- לדרוס בחירה של גבאי ששינה את הערך.
INSERT OR IGNORE INTO setting (key, value) VALUES ('require_login', '0');

-- אינדקסים ליומן הביקורת – מסך F-93 מסנן לפי טווח תאריכים, ישות ומשתמש.
CREATE INDEX IF NOT EXISTS ix_audit_log_ts ON audit_log (ts);
CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_user ON audit_log (user_id);
