import { useAsync } from './useAsync';

/**
 * F-13 – האם השם מנוהל כשדה אחד או כשניים.
 *
 * ההגדרה נקראת פעם אחת ומשמשת בכל מקום שמציג או עורך שם. ברירת המחדל היא
 * `split` – ההתנהגות שהייתה עד היום – ולכן התקנה שלא נגעה בהגדרה אינה
 * משתנה כלל.
 */
export function useMemberNameMode(): 'split' | 'full' {
  const { data } = useAsync(() => window.api.settings.get('member_name_mode'), []);
  return data === 'full' ? 'full' : 'split';
}
