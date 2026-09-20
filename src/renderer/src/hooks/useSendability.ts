import { useMemo } from 'react';
import type { NotifyEventKindDto } from '@shared/api';
import { useAsync } from './useAsync';

export interface SendabilityState {
  ok: boolean;
  message?: string;
  mobileReason?: string;
}

export type SendabilityRef = { kind: NotifyEventKindDto; refId: number };

const keyOf = (ref: SendabilityRef): string => `${ref.kind}:${ref.refId}`;

/**
 * W-91 – האם אפשר לשלוח הודעה על כל אחת מהשורות שעל המסך.
 *
 * נקראת פעם אחת לכל הטבלה ולא פעם לכל שורה: המסך מציג עד מאות שורות,
 * וקריאת IPC לכל אחת מהן הייתה הופכת גלילה לאיטית.
 */
export function useSendability(
  refs: readonly SendabilityRef[],
): (ref: SendabilityRef) => SendabilityState | undefined {
  // המפתח הוא תוכן הרשימה ולא הזהות שלה: מערך חדש בכל רינדור היה גורם
  // לקריאה אינסופית.
  const signature = refs.map(keyOf).join(',');

  const query = useAsync(() => window.api.notifications.sendability(refs), [signature]);

  // הפונקציה המוחזרת ממומואיזת: העמודות של הטבלה בנויות ב-useMemo ותלויות
  // בה, ואילו הייתה נוצרת מחדש בכל רינדור הן היו נבנות מחדש בכל רינדור.
  // בלי המימואיזציה הן נתקעות על התוצאה הראשונה – ריקה – והאייקון נשאר
  // "בודק…" לנצח.
  return useMemo(() => {
    const byKey = new Map((query.data ?? []).map((s) => [keyOf(s), s as SendabilityState]));
    return (ref: SendabilityRef) => byKey.get(keyOf(ref));
  }, [query.data]);
}
