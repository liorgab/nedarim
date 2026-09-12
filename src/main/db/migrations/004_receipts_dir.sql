-- 004 – תיקיית ארכיון הקבלות ניתנת להגדרה (CLAUDE.md כלל 12).
--
-- ריק = ברירת המחדל `<userData>/receipts`, כלומר ההתנהגות הקיימת. הערך
-- משלים את ההגדרה להתקנות שנוצרו לפני השינוי; קבלות שכבר הופקו שומרות את
-- הנתיב המלא שלהן ב-`receipt.pdf_path` ואינן מושפעות.
INSERT OR IGNORE INTO setting (key, value) VALUES ('receipts_dir', '');
