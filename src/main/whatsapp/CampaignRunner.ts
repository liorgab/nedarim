import type { Database } from 'better-sqlite3';
import { nowIso } from '@shared/datetime';
import { writeAudit } from '../services/audit';
import { capStatus } from '../services/dailyCounter';
import { getNumberSetting } from '../services/settings';
import {
  firstPendingItem,
  sendCampaignItem,
  type MessageSenderPort,
} from '../services/sendMessage';
import {
  DEFAULT_FAILURE_THRESHOLD,
  countsAsFailure,
  decideStep,
  phaseForStop,
  pickDelaySeconds,
  stopText,
  type RunnerPhase,
  type StopReason,
} from './runnerDecision';

/**
 * W3 – מנוע הקמפיין.
 *
 * הוא מבצע בלבד: כל החלטה מגיעה מ-`decideStep`, שנבדק בנפרד. מה שנשאר
 * כאן הוא ה-I/O שקשה לבדוק ממילא – שינה, DB ודחיפת אירועים – ולכן הוא
 * מוחזק דק ככל האפשר.
 *
 * **מופע אחד בכל רגע.** שני קמפיינים במקביל היו נלחמים על אותו חלון
 * WhatsApp ועל אותה מכסה יומית, ומכסה שנשמרת ב-DB (`dailyCounter`) לא
 * הייתה מצילה מזה: שניהם היו קוראים "נשארו 12" באותה שנייה.
 */

export interface RunnerProgress {
  campaignId: number;
  phase: RunnerPhase;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  /** הפריט שנשלח כרגע, או `null` בהמתנה. */
  currentItemId: number | null;
  /** שם החבר שאליו נשלח כרגע – לשורת הסטאטוס החיה (W-41). */
  currentName: string | null;
  /** שניות שנותרו בהמתנה, `0` כשלא ממתינים. */
  waitSeconds: number;
  /** למה נעצר, כשנעצר. */
  stopReason: StopReason | null;
  /** הודעה בעברית להצגה. */
  message: string | null;
}

export interface RunnerDeps {
  db: Database;
  sender: MessageSenderPort;
  /** האם החיבור לוואטסאפ פעיל. נקרא מחדש לפני כל הודעה (W-45). */
  isConnected: () => boolean;
  userId: number;
  /** נדחף ל-renderer בכל שינוי ובכל שנייה של ספירה לאחור (W-44). */
  onProgress: (progress: RunnerProgress) => void;
  /** מוזרק לבדיקות, כדי שלא נמתין 14 שניות באמת. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface Counts {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class CampaignRunner {
  private request: 'run' | 'pause' | 'cancel' = 'run';
  private phase: RunnerPhase = 'idle';
  private consecutiveFailures = 0;
  private attemptsSinceStart = 0;
  private waitCompleted = false;
  private stopReason: StopReason | null = null;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly campaignId: number,
    private readonly deps: RunnerDeps,
  ) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
  }

  get currentPhase(): RunnerPhase {
    return this.phase;
  }

  pause(): void {
    this.request = 'pause';
  }

  cancel(): void {
    this.request = 'cancel';
  }

  /**
   * מריץ עד שנגמרים הפריטים או עד שמשהו עוצר.
   *
   * מחזיר את התמונה האחרונה, כדי שהקורא יידע למה נעצר בלי להאזין
   * לאירועים.
   */
  async run(): Promise<RunnerProgress> {
    const { db } = this.deps;
    this.request = 'run';
    this.stopReason = null;
    this.setPhase('running');

    db.prepare(
      `UPDATE message_campaign
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
    ).run(nowIso(), nowIso(), this.campaignId);
    this.audit('start');

    const minDelay = getNumberSetting(db, 'whatsapp_min_delay_sec', 8);
    const maxDelay = getNumberSetting(db, 'whatsapp_max_delay_sec', 20);
    const failureThreshold = getNumberSetting(
      db,
      'whatsapp_stop_after_consecutive_failures',
      DEFAULT_FAILURE_THRESHOLD,
    );

    for (;;) {
      const step = decideStep({
        request: this.request,
        nextItemId: firstPendingItem(db, this.campaignId),
        consecutiveFailures: this.consecutiveFailures,
        quotaRemaining: capStatus(db).remaining,
        connected: this.deps.isConnected(),
        attemptsSinceStart: this.attemptsSinceStart,
        waitCompleted: this.waitCompleted,
        delaySeconds: pickDelaySeconds(minDelay, maxDelay, this.random),
        failureThreshold,
      });

      if (step.kind === 'done') return this.finish(failureThreshold);
      if (step.kind === 'stop') return this.stop(step.reason, failureThreshold);

      if (step.kind === 'wait') {
        // ההמתנה נשברת לשניות כדי שספירה לאחור תוצג, ושלחיצה על "השהה"
        // תיתפס תוך שנייה ולא אחרי 20.
        for (let left = step.seconds; left > 0; left--) {
          if (this.request !== 'run') break;
          this.emit({ waitSeconds: left });
          await this.sleep(1000);
        }
        // הדגל נדלק רק כשההמתנה הושלמה במלואה. הפסקה באמצע חוזרת
        // להחלטה, ששם היא הופכת לעצירה.
        this.waitCompleted = this.request === 'run';
        this.emit({ waitSeconds: 0 });
        continue;
      }

      this.waitCompleted = false;
      await this.sendOne(step.itemId);
    }
  }

  private async sendOne(itemId: number): Promise<void> {
    const { db } = this.deps;
    this.emit({ currentItemId: itemId, waitSeconds: 0 });

    const result = await sendCampaignItem(db, itemId, this.deps.sender, this.deps.userId);

    this.attemptsSinceStart += 1;

    if (result.outcome.ok) {
      this.consecutiveFailures = 0;
    } else if (countsAsFailure(result.outcome.errorCode)) {
      this.consecutiveFailures += 1;
    } else {
      // מספר שאינו בוואטסאפ אינו תקלה שמאיימת על הקמפיין; הרצף מתאפס
      // כדי ששלושה כאלה לא יעצרו אותו.
      this.consecutiveFailures = 0;
    }

    this.emit({ currentItemId: null });
  }

  private finish(failureThreshold: number): RunnerProgress {
    this.deps.db
      .prepare(
        `UPDATE message_campaign SET status = 'completed', finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nowIso(), nowIso(), this.campaignId);
    this.audit('complete');
    this.setPhase('completed');
    return this.emit({ currentItemId: null, waitSeconds: 0 }, failureThreshold);
  }

  private stop(reason: StopReason, failureThreshold: number): RunnerProgress {
    const { db } = this.deps;
    this.stopReason = reason;
    const phase = phaseForStop(reason);

    if (phase === 'cancelled') {
      // W-43: מה שטרם נשלח מסומן כמבוטל ולא נשאר `pending` – אחרת
      // באנר "קמפיין שלא הסתיים" היה מציע להמשיך קמפיין שבוטל.
      db.prepare(
        `UPDATE message_campaign_item
         SET status = 'failed', error_code = 'cancelled', error_message = 'הקמפיין בוטל'
         WHERE campaign_id = ? AND status = 'pending'`,
      ).run(this.campaignId);
    }

    db.prepare(
      `UPDATE message_campaign SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(phase, phase === 'cancelled' ? nowIso() : null, nowIso(), this.campaignId);

    this.audit(phase === 'cancelled' ? 'cancel' : 'pause', { reason });
    this.setPhase(phase);
    return this.emit({ currentItemId: null, waitSeconds: 0 }, failureThreshold);
  }

  private setPhase(phase: RunnerPhase): void {
    this.phase = phase;
  }

  private counts(): Counts {
    const row = this.deps.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(status = 'sent') AS sent,
           SUM(status = 'failed') AS failed,
           SUM(status = 'skipped') AS skipped,
           SUM(status = 'pending') AS pending
         FROM message_campaign_item WHERE campaign_id = ?`,
      )
      .get(this.campaignId) as Record<string, number | null>;
    return {
      total: row['total'] ?? 0,
      sent: row['sent'] ?? 0,
      failed: row['failed'] ?? 0,
      skipped: row['skipped'] ?? 0,
      pending: row['pending'] ?? 0,
    };
  }

  private memberName(itemId: number | null): string | null {
    if (itemId === null) return null;
    const row = this.deps.db
      .prepare(
        `SELECT m.first_name || ' ' || m.last_name AS name
         FROM message_campaign_item i JOIN member m ON m.id = i.member_id
         WHERE i.id = ?`,
      )
      .get(itemId) as { name: string } | undefined;
    return row?.name ?? null;
  }

  private lastProgress: Partial<RunnerProgress> = {};

  private emit(
    patch: Partial<RunnerProgress>,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  ): RunnerProgress {
    this.lastProgress = { ...this.lastProgress, ...patch };
    const currentItemId = this.lastProgress.currentItemId ?? null;

    const progress: RunnerProgress = {
      campaignId: this.campaignId,
      phase: this.phase,
      ...this.counts(),
      currentItemId,
      currentName: this.memberName(currentItemId),
      waitSeconds: this.lastProgress.waitSeconds ?? 0,
      stopReason: this.stopReason,
      message: this.stopReason === null ? null : stopText(this.stopReason, failureThreshold),
    };
    this.deps.onProgress(progress);
    return progress;
  }

  private audit(action: string, extra: Record<string, unknown> = {}): void {
    writeAudit(this.deps.db, {
      userId: this.deps.userId,
      entity: 'message_campaign',
      entityId: this.campaignId,
      action: action === 'start' ? 'update' : action === 'cancel' ? 'cancel' : 'update',
      after: { event: action, ...extra },
    });
  }
}
