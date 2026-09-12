import { BrowserWindow, app } from 'electron';
import type { Database } from 'better-sqlite3';
import { CampaignRunner, type RunnerProgress } from './CampaignRunner';
import { sendOne as sendOneMessage } from './MessageSender';
import {
  currentStatus,
  openWhatsAppWindow,
  publishSimulatedReady,
  setCampaignRunning,
  whatsAppWindow,
} from './WhatsAppWindow';
import type { SendOutcome } from './sendOutcome';

/**
 * W3 – הבעלות על הקמפיין הרץ.
 *
 * **מופע אחד בלבד בכל רגע.** שני קמפיינים במקביל היו נלחמים על אותו חלון
 * WhatsApp – אותו `webContents` שמנווט לכתובת שליחה – והתוצאה היא הודעות
 * שנשלחות לאדם הלא נכון. המכסה היומית לא הייתה מצילה מזה: שניהם היו
 * קוראים "נשארו 12" באותה שנייה.
 *
 * המצב יושב במודול ולא ב-DB במכוון. קמפיין רץ הוא מצב של **התהליך**, לא
 * של הנתונים; מה שנשמר ב-DB הוא מה שכבר קרה (`sent`/`failed`), וזה מה
 * שמאפשר להמשיך אחרי סגירת היישום.
 */

let active: { runner: CampaignRunner; campaignId: number } | null = null;
let lastProgress: RunnerProgress | null = null;

/** דוחף לכל החלונות, כמו `whatsapp:status`. ה-main אינו יודע מי מאזין. */
function push(progress: RunnerProgress): void {
  lastProgress = progress;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('campaign:progress', progress);
  }
}

export function runningCampaignId(): number | null {
  return active?.campaignId ?? null;
}

/** התמונה האחרונה – ל-renderer שנפתח באמצע קמפיין. */
export function latestProgress(): RunnerProgress | null {
  return lastProgress;
}

/**
 * מתחיל או ממשיך קמפיין.
 *
 * אותה פונקציה לשניהם: "המשך" הוא בדיוק "התחל" על קמפיין שכבר יש בו
 * פריטים שנשלחו, כי המנוע ממילא לוקח את הפריט הממתין הראשון. פונקציה
 * נפרדת ל-resume הייתה מסלול שני שחייב להישאר זהה לראשון.
 */
export async function startCampaign(
  db: Database,
  campaignId: number,
  userId: number,
): Promise<RunnerProgress> {
  if (active !== null) {
    throw new Error(
      active.campaignId === campaignId
        ? 'הקמפיין כבר רץ.'
        : `קמפיין אחר (${active.campaignId}) רץ כרגע. יש לסיים או להשהות אותו תחילה.`,
    );
  }

  const simulated = simulatedSender();

  // החלון נפתח כאן ולא בתוך המנוע: המנוע לא אמור להכיר את Electron.
  if (simulated === null && whatsAppWindow() === null) openWhatsAppWindow();

  const runner = new CampaignRunner(campaignId, {
    db,
    sender: simulated ?? {
      send: async (request) => {
        const win = whatsAppWindow();
        if (win === null) {
          return {
            ok: false,
            errorCode: 'not_connected',
            errorMessage: 'חלון הוואטסאפ נסגר',
          };
        }
        return sendOneMessage(request, { window: win, userDataDir: userDataDirRef });
      },
    },
    isConnected: () => simulated !== null || currentStatus().state === 'ready',
    userId,
    onProgress: push,
  });

  active = { runner, campaignId };
  // בזמן קמפיין סגירת חלון הוואטסאפ **מסתירה** אותו במקום לסגור: סגירה
  // באמצע שליחה מנתקת את הסשן ומשאירה פריט תקוע ב-`sending`.
  setCampaignRunning(true);
  try {
    return await runner.run();
  } finally {
    setCampaignRunning(false);
    // גם כשהריצה נפלה: מופע תקוע היה חוסם כל קמפיין עתידי עד להפעלה
    // מחדש של היישום.
    active = null;
  }
}

export function pauseCampaign(): void {
  active?.runner.pause();
}

export function cancelCampaign(): void {
  active?.runner.cancel();
}

/**
 * עזר בדיקות: `NEDARIM_FAKE_WA_SEND=1` מחליף את השליחה בסימולציה.
 *
 * קיים כדי שאפשר יהיה לראות את מודאל ההתקדמות בעיניים (כלל-על 17) בלי
 * סשן WhatsApp אמיתי ובלי לשלוח הודעות לאנשים. הערך `fail:3` גורם
 * לכישלון של ההודעה השלישית, כדי לבדוק גם את המסלול הזה.
 *
 * **פועל רק בפיתוח.** בהתקנה ארוזה הדגל מתעלם, כדי שלא תיווצר דרך
 * לדווח "נשלח" בלי שנשלח דבר.
 */
function simulatedSender(): { send: () => Promise<SendOutcome> } | null {
  const flag = process.env['NEDARIM_FAKE_WA_SEND'];
  if (flag === undefined || flag === '' || app.isPackaged) return null;

  const failEvery = Number(/fail:(\d+)/.exec(flag)?.[1] ?? '0');
  let count = 0;

  return {
    send: async () => {
      count += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (failEvery > 0 && count % failEvery === 0) {
        return {
          ok: false,
          errorCode: 'timeout',
          errorMessage: 'סימולציה: לא נמצאה תיבת כתיבה',
        };
      }
      return { ok: true };
    },
  };
}

/**
 * תיקיית הנתונים – נדרשת ל-`MessageSender`.
 *
 * מוזרקת פעם אחת בהפעלה ולא נקראת מ-`app` כאן, כדי שהמודול יישאר נבדק
 * בלי Electron.
 */
let userDataDirRef = '';

export function configureRunnerHost(userDataDir: string): void {
  userDataDirRef = userDataDir;
  // מצב הסימולציה מדווח "מחובר" כדי שמסכי השליחה יהיו נגישים לבדיקה.
  if (simulatedSender() !== null) publishSimulatedReady();
}
