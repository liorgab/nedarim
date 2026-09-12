import { useEffect, useState } from 'react';
import type { WaStatusDto } from '@shared/api';

/**
 * W-55 – מצב החיבור ל-WhatsApp, מתעדכן ב-push מה-main.
 *
 * אין כאן polling: המצב הראשוני נשלף פעם אחת, ומשם ה-main דוחף כל שינוי.
 * ההרשמה מבוטלת ב-cleanup, אחרת כל מעבר בין מסכים היה מוסיף מאזין נוסף.
 */
export function useWhatsAppStatus(): WaStatusDto | null {
  const [status, setStatus] = useState<WaStatusDto | null>(null);

  useEffect(() => {
    let alive = true;
    void window.api.whatsapp.getStatus().then((s) => {
      if (alive) setStatus(s);
    });
    const unsubscribe = window.api.whatsapp.onStatus(setStatus);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return status;
}
