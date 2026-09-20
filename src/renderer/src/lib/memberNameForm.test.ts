import { describe, expect, it } from 'vitest';
import { joinName, nameForForm, nameForSave, nameIsComplete } from './memberNameForm';

/**
 * F-13 – המעבר מניהול שם מפוצל לניהול שם מלא.
 *
 * שתי התקלות שבגללן נכתב הקובץ הזה, ושהיו בגרסה 0.6.0:
 * 1. במצב "שם מלא" כפתור השמירה נשאר מושבת לעולם – הוא דרש שם משפחה,
 *    שבמצב הזה תמיד ריק. כלומר לא ניתן היה להוסיף חבר חדש כלל.
 * 2. חבר ששמור מפוצל הוצג בשדה היחיד בלי שם המשפחה.
 */

const split = { firstName: 'ישראל', lastName: 'ישראלי' };

describe('תצוגה בטופס', () => {
  it('במצב מפוצל – שני השדות כפי שהם', () => {
    expect(nameForForm('split', split)).toEqual(split);
  });

  it('במצב שם מלא – השדה היחיד מציג את כל השם', () => {
    // זו התקלה: קודם הוצג רק "ישראל", ושם המשפחה נעלם מהעין.
    expect(nameForForm('full', split)).toEqual({ firstName: 'ישראל ישראלי', lastName: '' });
  });

  it('שם שכבר מאוחד אינו מקבל רווח עוקב', () => {
    expect(joinName({ firstName: 'משה כהן', lastName: '' })).toBe('משה כהן');
  });
});

describe('מה נשמר', () => {
  it('במצב מפוצל – כפי שהוקלד, מנוקה רווחים', () => {
    expect(nameForSave('split', { firstName: ' ישראל ', lastName: ' ישראלי ' }, null)).toEqual(
      split,
    );
  });

  it('חבר חדש במצב שם מלא – הכל נכנס לשם הפרטי', () => {
    expect(nameForSave('full', { firstName: 'משה כהן', lastName: '' }, null)).toEqual({
      firstName: 'משה כהן',
      lastName: '',
    });
  });

  it('עריכה שלא נגעה בשם – הפיצול הקיים נשמר', () => {
    // הגבאי פתח את החבר כדי לעדכן טלפון. אין שום סיבה שהשם ימוזג בעקבות
    // זה, והמיזוג אינו ניתן לביטול אוטומטי.
    expect(nameForSave('full', { firstName: 'ישראל ישראלי', lastName: '' }, split)).toEqual(split);
  });

  it('עריכה ששינתה את השם – מיזוג לשדה אחד', () => {
    expect(nameForSave('full', { firstName: 'ישראל ישראלי הלוי', lastName: '' }, split)).toEqual({
      firstName: 'ישראל ישראלי הלוי',
      lastName: '',
    });
  });
});

describe('מתי אפשר לשמור', () => {
  it('במצב שם מלא – שם משפחה ריק אינו חוסם', () => {
    // זו התקלה השנייה: כפתור השמירה נשאר מושבת לעולם.
    expect(nameIsComplete('full', { firstName: 'משה כהן', lastName: '' })).toBe(true);
  });

  it('במצב מפוצל – שם משפחה ריק חוסם', () => {
    expect(nameIsComplete('split', { firstName: 'ישראל', lastName: '' })).toBe(false);
  });

  it('שם ריק לגמרי חוסם בשני המצבים', () => {
    expect(nameIsComplete('full', { firstName: '   ', lastName: '' })).toBe(false);
    expect(nameIsComplete('split', { firstName: '   ', lastName: 'ישראלי' })).toBe(false);
  });
});
