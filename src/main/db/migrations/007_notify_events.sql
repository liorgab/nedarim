-- 007 – יומן ההתחשבנות: הודעה בכל אירוע כספי (W-80..W-89, WB-12).
--
-- הרעיון: ההתכתבות של החבר בוואטסאפ תהווה יומן מלא של ההתחשבנות מול בית
-- הכנסת – נדר, זיכוי, תשלום, תרומה וקבלה. עד כאן ההודעות היו יזומות בלבד
-- (קמפיין או שליחה בודדת); כאן הן נקשרות לאירוע שיצר אותן.
--
-- מיגרציות 001–006 קפואות.

-- ------------------------------------------------------- תבנית לכל אירוע
--
-- NULL = תבנית חופשית (קמפיינים ושליחה ידנית), כמו כל התבניות עד היום.
ALTER TABLE message_template ADD COLUMN event_kind TEXT;

-- תבנית אחת פעילה לכל אירוע. אינדקס חלקי ולא CHECK: תבנית מחוקה לוגית
-- חייבת לפנות את המקום לתבנית חדשה לאותו אירוע.
CREATE UNIQUE INDEX idx_template_event_kind ON message_template(event_kind)
  WHERE event_kind IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------ מקור הקמפיין
--
-- `trigger_ref` בפורמט `entity:id` (למשל `vow_payment:42`) ולא מזהה חשוף:
-- מזהה 42 קיים גם בנדר וגם בתשלום, וללא שם הישות בדיקת "כבר נשלח" הייתה
-- מדלגת על הודעות תקינות.
ALTER TABLE message_campaign ADD COLUMN trigger_kind TEXT;
ALTER TABLE message_campaign ADD COLUMN trigger_ref TEXT;

CREATE INDEX idx_campaign_trigger ON message_campaign(trigger_ref)
  WHERE trigger_ref IS NOT NULL;

-- ------------------------------------------------------------- הגדרות
--
-- ברירת המחדל `off` לכל אירוע: התקנה חדשה אינה שולחת דבר עד שהגבאי מפעיל
-- (CLAUDE.md כלל 12 – אין ערך עסקי קשיח).
--
-- `off`  – אין הודעה.
-- `ask`  – אחרי שמירת הרשומה נפתחת הודעה מוכנה לאישור הגבאי.
-- `auto` – שליחה ללא אישור. דורש את מנוע הקמפיינים (W3) ולכן עדיין אינו
--          מוצע בהגדרות; הערך מוכר כאן כדי שהמיגרציה לא תידרש שוב.
INSERT OR IGNORE INTO setting (key, value) VALUES
  ('whatsapp_notify_vow', 'off'),
  ('whatsapp_notify_credit', 'off'),
  ('whatsapp_notify_payment', 'off'),
  ('whatsapp_notify_donation', 'off'),
  ('whatsapp_notify_receipt', 'off');
