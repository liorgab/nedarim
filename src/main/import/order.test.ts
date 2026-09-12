import { describe, expect, it } from 'vitest';
import { IMPORT_ENTITIES, type ImportEntity, type ImportEntityId } from './catalog';
import { allDependencies, importOrder, planImport } from './order';

/**
 * הסדר הוא ההבדל בין ייבוא שעובד לבין 1,268 נדרים שנדחים כי החברים עוד
 * לא קיימים.
 */

const at = (order: ImportEntity[], id: ImportEntityId): number =>
  order.findIndex((e) => e.id === id);

describe('importOrder – הקטלוג האמיתי', () => {
  const order = importOrder();

  it('כל היישויות מופיעות פעם אחת', () => {
    expect(order).toHaveLength(IMPORT_ENTITIES.length);
    expect(new Set(order.map((e) => e.id)).size).toBe(IMPORT_ENTITIES.length);
  });

  it('חברים לפני כל מה שמפנה אליהם', () => {
    for (const id of ['vow_charge', 'vow_payment', 'donation'] as const) {
      expect(at(order, 'member'), id).toBeLessThan(at(order, id));
    }
  });

  it('רשימות ערכים לפני מי שמשתמש בהן', () => {
    expect(at(order, 'occasion')).toBeLessThan(at(order, 'vow_charge'));
    expect(at(order, 'payment_method')).toBeLessThan(at(order, 'vow_payment'));
    expect(at(order, 'donation_type')).toBeLessThan(at(order, 'donation'));
    expect(at(order, 'expense_category')).toBeLessThan(at(order, 'expense'));
  });

  it('כל תלות מופיעה לפני התלוי בה', () => {
    // הבדיקה הכללית: נכונה גם אחרי הוספת יישות חדשה לקטלוג.
    order.forEach((entity, i) => {
      for (const dep of entity.dependsOn) {
        expect(at(order, dep), `${dep} חייבת לבוא לפני ${entity.id}`).toBeLessThan(i);
      }
    });
  });

  it('הסדר יציב בין הרצות', () => {
    expect(importOrder().map((e) => e.id)).toEqual(order.map((e) => e.id));
  });
});

describe('importOrder – מקרי קצה', () => {
  const fake = (id: string, dependsOn: string[] = []): ImportEntity =>
    ({
      id: id as ImportEntityId,
      sheet: id,
      label: id,
      table: id,
      naturalKey: [],
      dependsOn: dependsOn as ImportEntityId[],
      fields: [],
      intro: '',
    }) as ImportEntity;

  it('מעגל תלויות זורק ולא נתקע', () => {
    const cyclic = [fake('a', ['b']), fake('b', ['a'])];
    expect(() => importOrder(cyclic)).toThrow(/מעגל/);
  });

  it('מעגל עקיף נתפס גם הוא', () => {
    const cyclic = [fake('a', ['b']), fake('b', ['c']), fake('c', ['a'])];
    expect(() => importOrder(cyclic)).toThrow(/מעגל/);
  });

  it('תלות שאינה בקטלוג זורקת ולא מדלגת בשקט', () => {
    expect(() => importOrder([fake('a', ['nope'])])).toThrow(/אינה בקטלוג/);
  });

  it('שרשרת עמוקה ממוינת נכון', () => {
    const chain = [fake('d', ['c']), fake('c', ['b']), fake('b', ['a']), fake('a')];
    expect(importOrder(chain).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('רשימה ריקה', () => {
    expect(importOrder([])).toEqual([]);
  });
});

describe('allDependencies', () => {
  it('כולל תלויות עקיפות', () => {
    const deps = allDependencies('vow_charge');
    expect(deps).toContain('member');
    expect(deps).toContain('occasion');
  });

  it('יישות בלי תלויות', () => {
    expect(allDependencies('member')).toEqual([]);
  });
});

describe('planImport', () => {
  it('מסנן לגיליונות שסופקו ושומר על הסדר', () => {
    const plan = planImport(['donation', 'member']);
    expect(plan.order.map((e) => e.id)).toEqual(['member', 'donation']);
  });

  it('מדווח על תלות שאינה בקובץ', () => {
    // ייבוא תרומות בלבד – החברים אמורים כבר להיות במערכת.
    const plan = planImport(['donation']);
    expect(plan.missingDependencies).toContain('member');
    expect(plan.missingDependencies).toContain('donation_type');
  });

  it('קובץ מלא – אין תלויות חסרות', () => {
    const plan = planImport(IMPORT_ENTITIES.map((e) => e.id));
    expect(plan.missingDependencies).toEqual([]);
    expect(plan.order).toHaveLength(IMPORT_ENTITIES.length);
  });

  it('גיליון שאינו בקטלוג פשוט לא נכלל', () => {
    const plan = planImport(['member', 'לא-קיים' as ImportEntityId]);
    expect(plan.order.map((e) => e.id)).toEqual(['member']);
  });
});
