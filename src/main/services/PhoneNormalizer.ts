/**
 * WB-11 – נרמול נייד. המימוש עצמו יושב ב-`src/shared/phone.ts`.
 *
 * האיפיון (WHATSAPP-SPEC §2) מציב את הקובץ כאן, ולכן הנתיב הזה נשמר. המימוש
 * הועבר ל-`shared` מסיבה אחת: **גם ה-renderer צריך אותו.** טופס החבר מציג
 * תצוגה חיה "יישלח אל +972-…" בכל הקלדה (W0), וקריאת IPC לכל תו היא בזבוז
 * עבור פונקציה טהורה שאינה נוגעת ב-DB. בלי זה היו שני מימושים שונים לאותה
 * שאלה – בדיוק המצב שיצר טופס שדוחה מספר שהמערכת בעצם מקבלת.
 */
export {
  formatE164ForDisplay,
  normalizeMobile,
  type MobileReason,
  type MobileStatus,
  type NormalizedMobile,
} from '@shared/phone';
