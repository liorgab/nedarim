-- 008 – תיקון מפתחות hebcal של אירועי פסח וסוכות.
--
-- מיגרציות 001–007 קפואות.
--
-- הרקע: `occasion.hebcal_key` נקרא אך ורק דרך `findOccasionByHebcalKey`,
-- ושם המפתח מגיע תמיד מ-`getSedra` (הקריאה של אותה שבת). נסרקו 12 שנים
-- (2025–2037): `getSedra` מחזיר 67 מפתחות שבת שונים, ו-`Pesach I`/`Sukkot I`
-- אינם ביניהם. הם מזהי האירוע של `getHolidaysOnDate` – מקור אחר לגמרי –
-- ולכן היו ערכים מתים שלעולם לא יכלו להתאים.
--
-- התוצאה בשטח: בארבע שבתות שונות לא הייתה ברירת מחדל לאירוע בהזנת נדר,
-- דווקא בשבתות עם הקהל הגדול:
--   Pesach Shabbat Chol ha-Moed   04/04/2026, 24/04/2027, 15/04/2028
--   Sukkot Shabbat Chol ha-Moed   11/10/2025, 07/10/2028, 29/09/2029
--   Pesach   (פסח שחל בשבת)        31/03/2029, 27/03/2032, 12/04/2036
--   Sukkot   (סוכות שחל בשבת)      26/09/2026, 16/10/2027, 12/10/2030
--
-- העדכון לפי `name` ולא לפי `id`: המזהים נקבעים בסדר ה-seed ואינם יציבים
-- בין התקנות, בעוד ש-`name` הוא UNIQUE.
--
-- `WHERE hebcal_key IS NULL OR hebcal_key = '<הישן>'` שומר על גבאי שכבר
-- תיקן ידנית – לא דורסים בחירה שלו.

UPDATE occasion SET hebcal_key = 'Sukkot Shabbat Chol ha-Moed'
  WHERE name = 'שבת חול המועד סוכות' AND hebcal_key IS NULL;

UPDATE occasion SET hebcal_key = 'Pesach Shabbat Chol ha-Moed'
  WHERE name = 'שבת חול המועד פסח' AND hebcal_key IS NULL;

UPDATE occasion SET hebcal_key = 'Sukkot'
  WHERE name = 'סוכות' AND (hebcal_key IS NULL OR hebcal_key = 'Sukkot I');

UPDATE occasion SET hebcal_key = 'Pesach'
  WHERE name = 'פסח' AND (hebcal_key IS NULL OR hebcal_key = 'Pesach I');
