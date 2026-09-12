import { useCallback, useState } from 'react';
import type { NotificationDraftDto, NotifyEventKindDto, NotifySkipReasonDto } from '@shared/api';
import type { MemberWithBalance } from '@shared/types';

/**
 * W-86, W-90 – הודעת האירוע שנלווית לפעולה כספית.
 *
 * מרוכז ב-hook אחד ולא משוכפל בכל דף: שלושה מסכים מציעים הודעה (כרטיסייה,
 * תרומות, ממתינים לקבלה), והכלל "מתי מספרים לגבאי שלא נשלחה הודעה" חייב
 * להיות זהה בכולם.
 *
 * **הכלל.** אחרי שמירה אוטומטית שותקים על מצבים שהגבאי בחר בהם בעצמו
 * (האירוע כבוי) או שהם נורמליים לחלוטין (תרומה של תורם שאינו חבר). על כל
 * השאר – בעיקר "אין נייד" – מדווחים, כי זו בדיוק המידע שחסר: הגבאי עשה
 * פעולה, ציפה להודעה, ובלי הסבר אין לו דרך לדעת למה לא קרה כלום.
 *
 * בשליחה יזומה (`force`) מדווחים תמיד: הוא לחץ על כפתור ומגיעה לו תשובה.
 */

/** סיבות שאין טעם להטריד בהן אחרי שמירה – הגבאי בחר בהן או שהן תקינות. */
const SILENT_ON_AUTO: ReadonlySet<NotifySkipReasonDto> = new Set<NotifySkipReasonDto>([
  'off',
  'no_member',
  'already_sent',
]);

export interface EventNotification {
  draft: NotificationDraftDto | null;
  member: MemberWithBalance | null;
  /**
   * מציע הודעה על הרשומה. `force` – הגבאי לחץ במפורש "שלח הודעה".
   * מחזיר הודעת מצב להצגה, או `null` כשאין מה לומר.
   */
  offer: (
    kind: NotifyEventKindDto,
    refId: number,
    options?: { force?: boolean },
  ) => Promise<string | null>;
  close: () => void;
}

export function useEventNotification(): EventNotification {
  const [draft, setDraft] = useState<NotificationDraftDto | null>(null);
  const [member, setMember] = useState<MemberWithBalance | null>(null);

  const close = useCallback(() => {
    setDraft(null);
    setMember(null);
  }, []);

  const offer = useCallback(
    async (
      kind: NotifyEventKindDto,
      refId: number,
      options: { force?: boolean } = {},
    ): Promise<string | null> => {
      const forced = options.force === true;
      try {
        const result = await window.api.notifications.draft(kind, refId, forced);
        if (result.ok) {
          // החבר נטען בנפרד: `SendOneDialog` מציג את מצב הנייד שלו, ואילו
          // הטיוטה מחזיקה רק את המזהה והשם.
          setMember(await window.api.members.get(result.draft.memberId));
          setDraft(result.draft);
          return null;
        }
        return forced || !SILENT_ON_AUTO.has(result.reason) ? result.message : null;
      } catch (e) {
        // הרשומה הכספית כבר נשמרה. תקלה כאן אינה תקלה שלה, ולכן היא
        // מדווחת רק כשהגבאי ביקש שליחה במפורש.
        return forced ? (e instanceof Error ? e.message : String(e)) : null;
      }
    },
    [],
  );

  return { draft, member, offer, close };
}
