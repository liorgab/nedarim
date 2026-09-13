-- 012 – רשימת הנדרים למכירה (F-140..F-143).
--
-- מיגרציות 001–011 קפואות.
--
-- הרקע: עד היום הזנת נדר ביקשה "פירוט" כטקסט חופשי. הגבאי הקליד "עליית
-- שלישי" בשבת אחת ו"שלישי" בשבת הבאה, ואי אפשר היה לשאול כמה הכניסה
-- עליית שלישי השנה – השאלה הבסיסית ביותר על פנקס הגבאי.
--
-- הטבלה היא **קטלוג**, לא תנועה כספית: היא אומרת מה נמכר ומתי, ולא מי
-- קנה ובכמה. מי קנה ובכמה נשאר ב-`vow_charge`, שמצביע לכאן.

CREATE TABLE vow_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  -- קטגוריית הגיליון בפנקס הגבאי. טקסט חופשי ולא רשימה סגורה: בית כנסת
  -- אחר יחלק אחרת, ואין סיבה לכפות עליו את החלוקה של הפנקס הזה.
  category TEXT,
  -- משך המצווה: "חד-פעמי (אותה תפילה)", "שנתי", "חודשי".
  duration TEXT,
  -- **המועד הקובע** לשיוך לחג – מתי הכיבוד נמכר, לא מתי הוא מבוצע.
  sale_timing TEXT,
  performance_timing TEXT,
  -- תחולה: shabbat = כל שבת, occasion = המועדים ב-vow_item_occasion,
  -- always = תמיד. שלוש האפשרויות מכסות את הפנקס בלי טבלת כללים.
  scope TEXT NOT NULL DEFAULT 'always' CHECK (scope IN ('shabbat', 'occasion', 'always')),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_vow_item_scope ON vow_item(scope, is_active);

-- שיוך רבים-לרבים: "חול המועד פסח" שייך גם לשבת חוה"מ פסח וגם לפסח.
CREATE TABLE vow_item_occasion (
  vow_item_id INTEGER NOT NULL REFERENCES vow_item(id) ON DELETE CASCADE,
  occasion_id INTEGER NOT NULL REFERENCES occasion(id) ON DELETE CASCADE,
  PRIMARY KEY (vow_item_id, occasion_id)
);
CREATE INDEX idx_vow_item_occasion_occasion ON vow_item_occasion(occasion_id);

-- הקישור מהחיוב לכיבוד שנמכר. NULL מותר: חיובים קיימים אינם מקושרים,
-- וגם בעתיד אפשר להזין נדר בלי לבחור מהרשימה.
ALTER TABLE vow_charge ADD COLUMN vow_item_id INTEGER REFERENCES vow_item(id);
CREATE INDEX idx_vow_charge_item ON vow_charge(vow_item_id);
