import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, type IpcChannel } from '@shared/api';
import { verifyApiSurface } from './apiSurface';

/**
 * הבדיקה הזו נועדה לתפוס preload ישן – המצב שבו `electron-vite dev` מרענן
 * את ה-renderer אבל לא את ה-preload, והמשתמש מקבל
 * `window.api.x.y is not a function` באמצע דיאלוג.
 */

/** בונה `window.api` מלא מתוך החוזה עצמו. */
function fullApi(): Record<string, Record<string, unknown>> {
  const api: Record<string, Record<string, unknown>> = {};
  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    const [ns, fn] = channel.split(':') as [string, string];
    api[ns] ??= {};
    api[ns]![fn] = () => undefined;
  }
  return api;
}

describe('verifyApiSurface', () => {
  it('API מלא עובר', () => {
    const result = verifyApiSurface(fullApi());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('ערוץ חסר מזוהה בשמו', () => {
    const api = fullApi();
    delete api['campaigns']!['sendOne'];
    const result = verifyApiSurface(api);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('campaigns:sendOne');
  });

  it('namespace שלם שחסר מזוהה', () => {
    const api = fullApi();
    delete api['whatsapp'];
    const result = verifyApiSurface(api);
    expect(result.ok).toBe(false);
    expect(result.missing.every((m) => m.startsWith('whatsapp:'))).toBe(true);
  });

  it('שדה שאינו פונקציה נחשב חסר', () => {
    // preload ישן עשוי לחשוף אובייקט בלי המתודה החדשה.
    const api = fullApi();
    api['campaigns']!['sendOne'] = 'not a function';
    expect(verifyApiSurface(api).missing).toContain('campaigns:sendOne');
  });

  it('אין api בכלל', () => {
    expect(verifyApiSurface(undefined).missing).toEqual(['window.api']);
    expect(verifyApiSurface(null).missing).toEqual(['window.api']);
  });

  it('הבדיקה נגזרת מהחוזה ולכן מכסה כל ערוץ', () => {
    // אם מישהו יוסיף ערוץ ל-IPC_CHANNELS, הבדיקה תכסה אותו אוטומטית
    // בלי לעדכן רשימה ידנית.
    const api = fullApi();
    const namespaces = Object.keys(api);
    expect(namespaces.length).toBeGreaterThan(15);
    expect(verifyApiSurface(api).ok).toBe(true);
  });
});
