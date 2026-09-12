import { describe, expect, it } from 'vitest';
import { formatAgorot } from '@shared/money';
import {
  TEMPLATE_FIELDS,
  renderTemplate,
  validateTemplate,
  type CampaignContext,
  type EventContext,
  type MemberContext,
} from './TemplateRenderer';

const member: MemberContext = {
  firstName: 'ישראל',
  lastName: 'ישראלי',
  nickname: 'שרוליק',
  memberNumber: 35,
  balanceAgorot: 35000,
  lastPaymentDate: '2025-10-14',
  openCharges: [
    {
      date: '2025-10-18',
      occasion: 'בראשית',
      note: null,
      amountAgorot: 50000,
      remainingAgorot: 50000,
    },
    {
      date: '2025-10-25',
      occasion: 'נח',
      note: 'הבן',
      amountAgorot: 36000,
      remainingAgorot: 20000,
    },
  ],
};

const campaign: CampaignContext = {
  todayIso: '2026-09-06',
  todayHebrew: 'כ״ד באלול תשפ״ו',
  parasha: 'נצבים־וילך',
  hebrewYear: 'תשפ״ו',
  synagogueName: 'בית הכנסת "דוגמה"',
  gabbaiPhone: '050-1234567',
  openChargesMaxLines: 10,
};

const render = (body: string, m: Partial<MemberContext> = {}, c: Partial<CampaignContext> = {}) =>
  renderTemplate(body, { ...member, ...m }, { ...campaign, ...c });

describe('TemplateRenderer – כל שדה (W-12)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['first_name', 'ישראל'],
    ['last_name', 'ישראלי'],
    ['full_name', 'ישראל ישראלי'],
    ['nickname_or_first', 'שרוליק'],
    ['member_number', '35'],
    ['last_payment_date', '14/10/2025'],
    ['today', '06/09/2026'],
    ['today_hebrew', 'כ״ד באלול תשפ״ו'],
    ['parasha', 'נצבים־וילך'],
    ['hebrew_year', 'תשפ״ו'],
    ['synagogue_name', 'בית הכנסת "דוגמה"'],
    ['gabbai_phone', '050-1234567'],
  ];

  for (const [key, expected] of cases) {
    it(`{{${key}}} → ${expected}`, () => {
      expect(render(`{{${key}}}`)).toBe(expected);
    });
  }

  it('לכל שדה ברשימה יש מימוש – אף אחד לא מרונדר לריק', () => {
    for (const field of TEMPLATE_FIELDS) {
      const out = render(`{{${field.key}}}`);
      expect(out, `השדה ${field.key} רונדר לריק`).not.toBe('');
      expect(out).not.toContain('{{');
    }
  });
});

describe('TemplateRenderer – יתרה', () => {
  it('יתרת חוב מוצגת כסכום', () => {
    // הציפייה נבנית מ-formatAgorot ולא מועתקת כמחרוזת: הפורמט מכיל סימני
    // כיווניות בלתי נראים, והעתקה ידנית שלהם היא מקור לבדיקה שבירה.
    expect(render('{{balance}}', { balanceAgorot: 35000 })).toBe(formatAgorot(35000));
  });

  it('יתרה שלילית מוצגת כזכות, לא כמספר שלילי באמצע בקשת תשלום', () => {
    const out = render('חוב: {{balance}}', { balanceAgorot: -12500 });
    expect(out).toContain('לזכותך');
    expect(out).not.toContain('-');
  });

  it('balance_abs תמיד חיובי', () => {
    expect(render('{{balance_abs}}', { balanceAgorot: -12500 })).toBe(
      render('{{balance_abs}}', { balanceAgorot: 12500 }),
    );
  });

  it('יתרה אפס מוצגת ולא נעלמת', () => {
    expect(render('{{balance}}', { balanceAgorot: 0 })).not.toBe('');
  });

  it('אגורות נשמרות בתצוגה', () => {
    expect(render('{{balance}}', { balanceAgorot: 128160 })).toContain('1,281.60');
  });
});

describe('TemplateRenderer – מקרי קצה בנתוני חבר', () => {
  it('חבר בלי כינוי מקבל את השם הפרטי', () => {
    expect(render('{{nickname_or_first}}', { nickname: null })).toBe('ישראל');
  });

  it('כינוי של רווחים בלבד נחשב כלא קיים', () => {
    expect(render('{{nickname_or_first}}', { nickname: '   ' })).toBe('ישראל');
  });

  it('חבר בלי תשלום אחרון מקבל מקף ולא "null"', () => {
    const out = render('{{last_payment_date}}', { lastPaymentDate: null });
    expect(out).toBe('—');
    expect(out).not.toContain('null');
  });

  it('פרשה ריקה מוחלפת במקף', () => {
    expect(render('{{parasha}}', {}, { parasha: '' })).toBe('—');
  });
});

describe('TemplateRenderer – טקסט מסביב', () => {
  it('מרנדר הודעה שלמה', () => {
    const body =
      'שלום {{nickname_or_first}},\nיתרתך ב{{synagogue_name}} היא {{balance}}.\nשבת שלום, פרשת {{parasha}}.';
    const out = render(body);
    expect(out).toBe(
      `שלום שרוליק,\nיתרתך בבית הכנסת "דוגמה" היא ${formatAgorot(35000)}.\nשבת שלום, פרשת נצבים־וילך.`,
    );
  });

  it('אותו שדה פעמיים מוחלף בשתי הפעמים', () => {
    expect(render('{{first_name}} {{first_name}}')).toBe('ישראל ישראל');
  });

  it('רווחים בתוך הסוגריים מותרים', () => {
    expect(render('{{ first_name }}')).toBe('ישראל');
  });

  it('שורות חדשות ואימוג׳י נשמרים (W-16)', () => {
    const body = 'שלום 🙏\n\n{{first_name}}\n*מודגש* _נטוי_';
    expect(render(body)).toBe('שלום 🙏\n\nישראל\n*מודגש* _נטוי_');
  });

  it('שדה לא מוכר נשאר גלוי בתצוגה המקדימה במקום להיעלם', () => {
    expect(render('{{first_name}} {{xyz}}')).toBe('ישראל {{xyz}}');
  });

  it('טקסט בלי שדות חוזר כמו שהוא', () => {
    expect(render('הודעה ללא שדות')).toBe('הודעה ללא שדות');
  });
});

describe('TemplateRenderer – פירוט החוב', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2025-10-${String(i + 1).padStart(2, '0')}`,
      occasion: `פרשה ${i + 1}`,
      note: null,
      amountAgorot: 10000,
      remainingAgorot: 10000,
    }));

  it('שורה לכל חיוב, בפורמט תאריך · פרשה · סכום', () => {
    const lines = render('{{open_charges}}').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('18/10/2025');
    expect(lines[0]).toContain('בראשית');
  });

  it('פירוט מוסיף את ההערה בסוגריים', () => {
    expect(render('{{open_charges}}')).toContain('נח (הבן)');
  });

  it('חיוב ששולם חלקית מוצג ביתרה שנותרה, לא בסכום המקורי', () => {
    // 36,000 במקור, 20,000 פתוחים – ההודעה חייבת להציג את מה שנשאר,
    // אחרת השורות לא מסתכמות ליתרה שהחבר רואה.
    const out = render('{{open_charges}}');
    expect(out).toContain(formatAgorot(20000));
    expect(out).not.toContain(formatAgorot(36000));
  });

  it('חבר בלי חוב פתוח מקבל מקף', () => {
    expect(render('{{open_charges}}', { openCharges: [] })).toBe('—');
    expect(render('{{open_charges_count}}', { openCharges: [] })).toBe('0');
  });

  it('הספירה תואמת למספר החיובים', () => {
    expect(render('{{open_charges_count}}')).toBe('2');
    expect(render('{{open_charges_count}}', { openCharges: many(7) })).toBe('7');
  });

  it('מעל התקרה – השאר מסוכם בשורה אחת ולא נעלם', () => {
    const out = render('{{open_charges}}', { openCharges: many(33) }, { openChargesMaxLines: 10 });
    const lines = out.split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[10]).toContain('ועוד 23');
    // 23 חיובים × 100 ₪
    expect(lines[10]).toContain(formatAgorot(230000));
  });

  it('תקרה 0 = ללא הגבלה', () => {
    const out = render('{{open_charges}}', { openCharges: many(33) }, { openChargesMaxLines: 0 });
    expect(out.split('\n')).toHaveLength(33);
  });

  it('מתחת לתקרה – אין שורת סיכום', () => {
    const out = render('{{open_charges}}', { openCharges: many(3) }, { openChargesMaxLines: 10 });
    expect(out).not.toContain('ועוד');
  });

  it('בדיוק בתקרה – אין שורת סיכום', () => {
    const out = render('{{open_charges}}', { openCharges: many(10) }, { openChargesMaxLines: 10 });
    expect(out.split('\n')).toHaveLength(10);
    expect(out).not.toContain('ועוד');
  });

  it('יתרת פתיחה מוצגת בלי תאריך', () => {
    const out = render('{{open_charges}}', {
      openCharges: [
        {
          date: null,
          occasion: 'יתרת פתיחה',
          note: null,
          amountAgorot: 40000,
          remainingAgorot: 40000,
        },
      ],
    });
    expect(out.startsWith('יתרת פתיחה')).toBe(true);
  });
});

describe('validateTemplate (W-14)', () => {
  it('תבנית תקינה עוברת', () => {
    const v = validateTemplate('שלום {{first_name}}, יתרתך {{balance}}');
    expect(v.ok).toBe(true);
    expect(v.unknownFields).toEqual([]);
    expect(v.errors).toEqual([]);
  });

  it('שדה לא מוכר נכשל ומדווח בשמו', () => {
    const v = validateTemplate('שלום {{xyz}}');
    expect(v.ok).toBe(false);
    expect(v.unknownFields).toEqual(['xyz']);
    expect(v.errors[0]).toContain('xyz');
  });

  it('כמה שדות לא מוכרים מדווחים פעם אחת כל אחד', () => {
    const v = validateTemplate('{{a}} {{b}} {{a}}');
    expect(v.unknownFields.sort()).toEqual(['a', 'b']);
  });

  it('גוף ריק נכשל', () => {
    expect(validateTemplate('').ok).toBe(false);
    expect(validateTemplate('   ').ok).toBe(false);
  });

  it('סוגריים שלא נסגרו נתפסים', () => {
    const v = validateTemplate('שלום {{first_name');
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('סוגריים'))).toBe(true);
  });

  it('הודעה ארוכה מאוד היא אזהרה, לא שגיאה', () => {
    const v = validateTemplate('א'.repeat(1200));
    expect(v.ok).toBe(true);
    expect(v.warnings).toHaveLength(1);
  });

  it('כל שדה ברשימה עובר ולידציה', () => {
    const body = TEMPLATE_FIELDS.map((f) => `{{${f.key}}}`).join(' ');
    expect(validateTemplate(body).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- W-85..W-87

const event: EventContext = {
  amountAgorot: 36000,
  eventDate: '2026-09-06',
  occasion: 'בראשית',
  paymentMethod: 'מזומן',
  receiptNumber: '1042',
  balanceAfterAgorot: 35000,
};

const renderEvent = (body: string, e: Partial<EventContext> = {}) =>
  renderTemplate(body, member, campaign, { ...event, ...e });

describe('שדות אירוע (W-85)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['{{amount}}', formatAgorot(36000)],
    ['{{event_date}}', '06/09/2026'],
    ['{{occasion}}', 'בראשית'],
    ['{{payment_method}}', 'מזומן'],
    ['{{receipt_number}}', '1042'],
    ['{{balance_after}}', formatAgorot(35000)],
  ];

  for (const [body, expected] of cases) {
    it(`${body} מרונדר`, () => {
      expect(renderEvent(body)).toBe(expected);
    });
  }

  it('סכום מוצג בערך מוחלט – זיכוי אינו מוצג כמספר שלילי', () => {
    expect(renderEvent('{{amount}}', { amountAgorot: -20000 })).toBe(formatAgorot(20000));
  });

  it('יתרה שלילית אחרי הפעולה מוצגת כזכות', () => {
    expect(renderEvent('{{balance_after}}', { balanceAfterAgorot: -5000 })).toContain('לזכותך');
  });

  it('ללא הקשר אירוע השדות מוצגים כמקף ולא כטקסט ריק', () => {
    // בקמפיין רגיל אין אירוע. חשוב שלא ייווצר משפט קטוע בלי הסבר.
    expect(renderTemplate('סכום: {{amount}}', member, campaign)).toBe('סכום: —');
    expect(renderTemplate('{{receipt_number}}', member, campaign)).toBe('—');
  });

  it('שדה אירוע ריק בתוך הקשר קיים', () => {
    expect(renderEvent('{{receipt_number}}', { receiptNumber: null })).toBe('—');
  });
});

describe('שורה מותנית (W-87)', () => {
  it('נכללת כשכל השדות שבה מלאים', () => {
    expect(renderEvent('שלום\n? קבלה מספר {{receipt_number}}.\nתודה')).toBe(
      'שלום\nקבלה מספר 1042.\nתודה',
    );
  });

  it('נשמטת כששדה בה ריק', () => {
    // זה בדיוק המקרה של תשלום בלי קבלה (WB-12).
    expect(renderEvent('שלום\n? קבלה מספר {{receipt_number}}.\nתודה', { receiptNumber: null })).toBe(
      'שלום\nתודה',
    );
  });

  it('נשמטת גם כשרק אחד משני שדות בה ריק', () => {
    expect(
      renderEvent('? {{occasion}} / {{receipt_number}}', { occasion: null }),
    ).toBe('');
  });

  it('שורה רגילה עם שדה ריק אינה נשמטת', () => {
    // רק שורה שסומנה במפורש מותנית. אחרת מחיקה שקטה של תוכן.
    expect(renderEvent('קבלה: {{receipt_number}}', { receiptNumber: null })).toBe('קבלה: —');
  });

  it('שורה מותנית ללא שדות כלל נכללת', () => {
    expect(renderEvent('? תודה רבה')).toBe('תודה רבה');
  });

  it('סימן שאלה שאינו בתחילת שורה אינו מפעיל את הכלל', () => {
    expect(renderEvent('מה קורה? {{receipt_number}}')).toBe('מה קורה? 1042');
  });

  it('הזחה לפני הסימן מותרת', () => {
    expect(renderEvent('  ? {{receipt_number}}')).toBe('1042');
  });

  it('תבנית בלי שורות מותנות אינה מושפעת', () => {
    const body = 'שלום {{first_name}}\nיתרה: {{balance}}';
    expect(renderTemplate(body, member, campaign)).toBe(
      `שלום ישראל\nיתרה: ${formatAgorot(35000)}`,
    );
  });
});

describe('validateTemplate – שדות אירוע', () => {
  it('שדה אירוע בתבנית חופשית מפיק אזהרה ולא שגיאה', () => {
    const result = validateTemplate('סכום {{amount}}');
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('amount'))).toBe(true);
  });

  it('אותו שדה בתבנית אירוע אינו מפיק אזהרה', () => {
    expect(validateTemplate('סכום {{amount}}', true).warnings).toEqual([]);
  });

  it('שדה אירוע אינו נחשב שדה לא מוכר', () => {
    expect(validateTemplate('{{balance_after}}').unknownFields).toEqual([]);
  });
});
