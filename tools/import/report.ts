import { formatAgorot } from '@shared/money';
import { DIFF_CAUSE_LABEL } from './legacySim';
import type { ImportIssue, ImportResult } from './types';

/** מייצר את `data/import-report.md` – דוח חריגים + דוח התאמה (ROADMAP שלב 1). */
export function renderReport(result: ImportResult): string {
  const L: string[] = [];
  const { counts, reconcile: rec } = result;

  const money = (agorot: number) => formatAgorot(agorot);
  const ok = (b: boolean) => (b ? '✅' : '❌');

  L.push('# דוח ייבוא – מערכת NEDARIM');
  L.push('');
  L.push(`**קובץ מקור:** \`${result.sourceFile}\`  `);
  L.push(`**זמן ריצה:** ${result.startedAt} → ${result.finishedAt}  `);
  L.push(
    `**טווח תאריכי הנתונים:** ${result.dataRange.minDate ?? '—'} עד ${result.dataRange.maxDate ?? '—'}`,
  );
  L.push('');

  // ------------------------------------------------------------------ סיכום
  L.push('## 1. מה יובא');
  L.push('');
  L.push('| ישות | כמות |');
  L.push('|---|---:|');
  L.push(`| חברים | ${counts.members} |`);
  L.push(`| יתרות פתיחה (לשדה \`opening_balance_agorot\`) | ${counts.openingBalances} |`);
  L.push(`| חיובי נדר | ${counts.charges} |`);
  L.push(`| זיכויים | ${counts.credits} |`);
  L.push(`| תשלומי נדר | ${counts.payments} |`);
  L.push(`| תרומות | ${counts.donations} |`);
  L.push(`| הוצאות | ${counts.expenses} |`);
  L.push(`| קבלות | ${counts.receipts} |`);
  L.push(`| שורות שדולגו | ${counts.skipped} |`);
  L.push(`| רשומות עם דגל לבדיקה | ${counts.flagged} |`);
  L.push('');

  // ------------------------------------------------------- דוח ההתאמה
  const balancesOk = rec.balances.diffs.length === 0;
  const monthsOk = rec.months.diffs.length === 0;
  const receiptsOk = rec.receipts.duplicates.length === 0 && rec.receipts.ambiguous.length === 0;
  const totalsOk =
    rec.totals.legacyCharges === rec.totals.importedCharges &&
    rec.totals.legacyPayments === rec.totals.importedPayments;

  L.push('## 2. דוח התאמה (SPEC 7.3)');
  L.push('');
  L.push('| # | בדיקה | תוצאה |');
  L.push('|---|---|---|');
  L.push(
    `| 1 | יתרה לכל חבר מול E3 בבלוק (${rec.balances.checked} חברים) | ${ok(balancesOk)} ${
      balancesOk ? 'אין סטיות' : `${rec.balances.diffs.length} סטיות`
    } |`,
  );
  L.push(
    `| 2 | סכומים חודשיים מול \`מאזן שנתי\` (${rec.months.checked} השוואות) | ${ok(monthsOk)} ${
      monthsOk ? 'אין סטיות' : `${rec.months.diffs.length} סטיות`
    } |`,
  );
  L.push(
    `| 3 | קבלות: ${rec.receipts.imported} יובאו, מונה הקובץ מגיע ל-${rec.receipts.counterMax} | ${ok(
      receiptsOk,
    )} ${rec.receipts.duplicates.length === 0 ? 'ללא כפילויות' : 'נמצאו כפילויות'}${
      rec.receipts.missing.length > 0 ? `, ${rec.receipts.missing.length} מספרים לא בשימוש` : ''
    } |`,
  );
  L.push(
    `| 4 | סה"כ חיובים ותשלומים | ${ok(totalsOk)} ${
      totalsOk ? 'זהה לקובץ' : 'קיים פער – ראו למטה'
    } |`,
  );
  L.push('');
  L.push('| מדד | בקובץ הישן | במערכת החדשה | פער |');
  L.push('|---|---:|---:|---:|');
  L.push(
    `| סה"כ חיובים (כולל יתרות פתיחה) | ${money(rec.totals.legacyCharges)} | ${money(
      rec.totals.importedCharges,
    )} | ${money(rec.totals.importedCharges - rec.totals.legacyCharges)} |`,
  );
  L.push(
    `| סה"כ תשלומים | ${money(rec.totals.legacyPayments)} | ${money(
      rec.totals.importedPayments,
    )} | ${money(rec.totals.importedPayments - rec.totals.legacyPayments)} |`,
  );
  L.push(
    `| יתרת חוב כוללת | ${money(rec.totals.legacyCharges - rec.totals.legacyPayments)} | ${money(
      rec.totals.importedCharges - rec.totals.importedPayments,
    )} | — |`,
  );
  L.push('');

  // 2.1 סטיות יתרה
  L.push('### 2.1 סטיות ביתרות חברים');
  L.push('');
  if (balancesOk) {
    L.push(
      `אין סטיות. היתרה של כל אחד מ-${rec.balances.checked} החברים זהה ל-\`D202 − F202\` בקובץ.`,
    );
  } else {
    L.push("| מס' חבר | שם | בקובץ הישן | במערכת | פער |");
    L.push('|---:|---|---:|---:|---:|');
    for (const d of rec.balances.diffs) {
      L.push(
        `| ${d.memberNumber} | ${d.name} | ${money(d.legacyBalance)} | ${money(
          d.importedBalance,
        )} | ${money(d.diff)} |`,
      );
    }
  }
  L.push('');

  // 2.2 סטיות חודשיות
  const fieldLabel: Record<string, string> = {
    donations: 'תרומות',
    vowPayments: 'נדרים (תשלומים)',
    expenses: 'הוצאות',
  };
  L.push('### 2.2 סטיות במאזן החודשי');
  L.push('');
  L.push(
    `סובלנות בעמודת ההוצאות: ${money(rec.months.toleranceAgorot)} לחודש. הסיבה: ב-\`MaazanSheet\` ` +
      'מוגדר `Dim SumTruma(37), SumNeder(37), SumHotzaa(37) As Long` – ב-VBA רק המשתנה האחרון מקבל ' +
      'את הטיפוס, ולכן **רק סכום ההוצאות** נחתך למספר שלם. זו הגבלה של הקובץ הישן, לא שגיאת נתונים.',
  );
  L.push('');
  if (monthsOk) {
    L.push('אין סטיות בכל 37 החודשים.');
  } else {
    L.push(
      'עמודת "המאקרו היה מחשב" היא סימולציה של `MaazanSheet` על אותם נתונים בדיוק ' +
        '(חיתוך תווים לפי מיקום במקום פענוח תאריך). ההשוואה בינה לבין מה שרשום בגיליון ' +
        'מזהה בוודאות אם הסטייה נובעת מבאג בקובץ הישן או מכך שהמאזן לא חושב מחדש.',
    );
    L.push('');
    L.push('| חודש | עמודה | בגיליון | המאקרו היה מחשב | במערכת החדשה | פער | הסבר |');
    L.push('|---|---|---:|---:|---:|---:|---|');
    for (const d of rec.months.diffs) {
      L.push(
        `| ${d.ym} | ${fieldLabel[d.field]} | ${money(d.legacy)} | ${money(d.simulated)} | ${money(
          d.imported,
        )} | ${money(d.diff)} | ${DIFF_CAUSE_LABEL[d.cause]} |`,
      );
    }
    L.push('');
    const unknown = rec.months.diffs.filter((d) => d.cause === 'unknown');
    L.push(
      unknown.length === 0
        ? '**כל הסטיות מוסברות** – אף אחת מהן אינה מעידה על שגיאה בייבוא.'
        : `**${unknown.length} סטיות לא הוסברו** ודורשות בדיקה ידנית.`,
    );
  }
  L.push('');

  // 2.3 קבלות
  L.push('### 2.3 קבלות');
  L.push('');
  L.push(`- מספר הקבלה הגבוה ביותר בגיליון \`מספר קבלה\`: **${rec.receipts.counterMax}**`);
  L.push(`- קבלות שיובאו בפועל: **${rec.receipts.imported}**`);
  L.push(
    `- כפילויות: ${rec.receipts.duplicates.length === 0 ? 'אין' : rec.receipts.duplicates.join(', ')}`,
  );
  L.push(
    `- קבלות שאינן מצביעות על תשלום/תרומה אחד בדיוק: ${
      rec.receipts.ambiguous.length === 0 ? 'אין' : rec.receipts.ambiguous.join(', ')
    }`,
  );
  if (rec.receipts.missing.length > 0) {
    L.push(
      `- **מספרים במונה שאינם בשימוש: ${rec.receipts.missing.join(', ')}** – מספר הוקצה בגיליון ` +
        'המונה אך לא נמצאה לו שורת תשלום או תרומה. דורש הכרעה של הגבאי (ראו סעיף 5).',
    );
  }
  L.push('');

  // 2.4 מחוץ לחלון
  L.push('### 2.4 תנועות מחוץ לחלון של המאזן הישן');
  L.push('');
  if (rec.outOfWindow.length === 0) {
    L.push('אין.');
  } else {
    L.push(
      'המאקרו `MaazanSheet` סופר 37 חודשים קבועים (09/2023–09/2026). התנועות הבאות **אינן נספרות** ' +
        'במאזן הישן כלל – זו ההוכחה המעשית לממצא #1 ב-SPEC:',
    );
    L.push('');
    L.push('| חודש | תשלומי נדרים | תרומות | הוצאות |');
    L.push('|---|---:|---:|---:|');
    for (const o of rec.outOfWindow) {
      L.push(
        `| ${o.ym} | ${money(o.vowPayments)} | ${money(o.donations)} | ${money(o.expenses)} |`,
      );
    }
  }
  L.push('');

  // ------------------------------------------------------- דוח חריגים
  L.push('## 3. דוח חריגים');
  L.push('');
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const infos = result.issues.filter((i) => i.severity === 'info');
  L.push(
    `שגיאות (שורות שלא יובאו): **${errors.length}** · אזהרות (יובאו עם ניחוש): **${warnings.length}** · הודעות: **${infos.length}**`,
  );
  L.push('');

  L.push(renderIssueSection('3.1 שגיאות – שורות שלא יובאו', errors));
  L.push(renderIssueSection('3.2 אזהרות – יובאו עם ניחוש או ברירת מחדל', warnings));
  L.push(renderIssueSection('3.3 הודעות', infos));

  // ------------------------------------------------------- החלטות
  L.push('## 4. מה נדרש ממך');
  L.push('');
  L.push('1. לעבור על סעיף 3.1 – כל שורה שם לא נכנסה למערכת.');
  L.push(
    '2. לעבור על סעיף 3.2 – השורות נכנסו, אבל עם ערך שהמערכת ניחשה. עמודת "הצעה" מציעה תיקון.',
  );
  L.push('3. לאשר את ההכרעות בסעיף 5.');
  L.push('');

  L.push('## 5. החלטות שממתינות לך');
  L.push('');
  if (rec.receipts.missing.length > 0) {
    L.push(
      `- **קבלה ${rec.receipts.missing.join(', ')}** – המספר קיים בגיליון המונה אך אין לו תשלום או ` +
        'תרומה. האם זו קבלה שהודפסה ובוטלה, או תקלה באקסל? כרגע המספר פשוט לא בשימוש והמונה ' +
        `הבא הוא ${rec.receipts.counterMax + 1}.`,
    );
  }
  L.push(
    '- **"סיכום שנת תשפ"ג"** נרשם בקובץ הישן כחבר מס\' 61 עם חיוב ותשלום זהים. הוא יובא כחבר ' +
      'לא-פעיל כדי לשמור על התאמה מלאה למאזן הישן; יתרתו 0. האם למחוק אותו מהמערכת החדשה?',
  );
  L.push('');

  return L.join('\n');
}

function renderIssueSection(title: string, issues: ImportIssue[]): string {
  const L: string[] = [];
  L.push(`### ${title}`);
  L.push('');
  if (issues.length === 0) {
    L.push('אין.');
    L.push('');
    return L.join('\n');
  }

  // קיבוץ לפי הודעה כדי שדוח של מאות שורות יישאר קריא
  const groups = new Map<string, ImportIssue[]>();
  for (const i of issues) {
    const key = `${i.entity}|${i.message}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }

  const entityLabel: Record<ImportIssue['entity'], string> = {
    member: 'חבר',
    charge: 'חיוב',
    payment: 'תשלום',
    donation: 'תרומה',
    expense: 'הוצאה',
    receipt: 'קבלה',
    general: 'כללי',
  };

  L.push('| ישות | תיאור | מיקום בקובץ | ערך מקורי | מה נעשה | הצעה |');
  L.push('|---|---|---|---|---|---|');
  for (const [, list] of groups) {
    for (const i of list) {
      L.push(
        `| ${entityLabel[i.entity]} | ${esc(i.message)} | \`${i.sourceRef}\` | ${
          i.rawValue === undefined ? '' : `\`${esc(i.rawValue)}\``
        } | ${esc(i.action ?? '')} | ${esc(i.suggestion ?? '')} |`,
      );
    }
  }
  L.push('');
  return L.join('\n');
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
