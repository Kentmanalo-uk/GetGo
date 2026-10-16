import { describe, expect, test } from 'vitest';
import {
  chooseSingle,
  describeGroupRule,
  evaluate,
  initialConfiguration,
  setValueQuantity,
  toggleMulti,
  type ConfigurableProduct,
} from './customization';
import { formatMoney, parsePesos, toPesoInput } from './money';
import { progressIndex, riderNextStep } from './orderStatus';
import { summarizeHours, validateHours } from './hours';

const meal: ConfigurableProduct = {
  id: 'p',
  name: 'Rice Meal',
  base_price_minor: 12000,
  is_available: true,
  max_per_order: 10,
  variants: [
    { id: 'reg', name: 'Regular', price_minor: 12000, is_available: true, sort_order: 1 },
    { id: 'lg', name: 'Large', price_minor: 15000, is_available: true, sort_order: 2 },
  ],
  groups: [
    {
      id: 'drink',
      name: 'Drink',
      min_select: 1,
      max_select: 1,
      values: [
        { id: 'tea', name: 'Iced tea', price_delta_minor: 0, is_available: true, max_quantity: 1, sort_order: 1 },
        { id: 'coke', name: 'Coke', price_delta_minor: 1500, is_available: true, max_quantity: 1, sort_order: 2 },
        { id: 'buko', name: 'Buko juice', price_delta_minor: 2500, is_available: false, max_quantity: 1, sort_order: 3 },
      ],
    },
    {
      id: 'addons',
      name: 'Add-ons',
      min_select: 0,
      max_select: 3,
      values: [
        { id: 'rice', name: 'Extra rice', price_delta_minor: 2000, is_available: true, max_quantity: 2, sort_order: 1 },
        { id: 'egg', name: 'Egg', price_delta_minor: 1500, is_available: true, max_quantity: 1, sort_order: 2 },
      ],
    },
  ],
};

describe('customization', () => {
  test('starts with the first available size and requires the drink', () => {
    const config = initialConfiguration(meal);
    expect(config.variantId).toBe('reg');
    const result = evaluate(meal, config);
    expect(result.valid).toBe(false);
    expect(result.error).toMatchObject({ code: 'group_min', message: 'Choose drink.', groupId: 'drink' });
    expect(result.unitPriceMinor).toBe(12000);
  });

  test('updates the price as options change', () => {
    let selection = chooseSingle({}, meal.groups[0], 'tea');
    selection = chooseSingle(selection, meal.groups[0], 'coke');
    expect(selection).toEqual({ coke: 1 });
    selection = setValueQuantity(selection, meal.groups[1], 'rice', 2);
    selection = toggleMulti(selection, meal.groups[1], 'egg');
    const result = evaluate(meal, { variantId: 'lg', selection, quantity: 2 });
    expect(result).toMatchObject({ valid: true, unitPriceMinor: 15000 + 1500 + 4000 + 1500, totalMinor: 2 * 22000 });
  });

  test('respects option and group maximums when adjusting', () => {
    let selection = setValueQuantity({}, meal.groups[1], 'rice', 5);
    expect(selection.rice).toBe(2);
    selection = toggleMulti(selection, meal.groups[1], 'egg');
    expect(selection).toEqual({ rice: 2, egg: 1 });
    // Group max (3) reached; adding more is ignored.
    expect(setValueQuantity(selection, meal.groups[1], 'rice', 3).rice).toBe(2);
  });

  test('reports sold-out choices and invalid quantities', () => {
    expect(evaluate(meal, { variantId: 'reg', selection: { buko: 1 }, quantity: 1 }).error?.code).toBe('option_sold_out');
    expect(evaluate(meal, { variantId: 'reg', selection: { tea: 1 }, quantity: 11 }).error?.code).toBe('invalid_quantity');
    expect(evaluate({ ...meal, is_available: false }, { variantId: 'reg', selection: { tea: 1 }, quantity: 1 }).error?.code).toBe('product_sold_out');
  });

  test('describes group rules briefly', () => {
    expect(describeGroupRule(meal.groups[0])).toBe('Required · pick 1');
    expect(describeGroupRule(meal.groups[1])).toBe('Optional · up to 3');
    expect(describeGroupRule({ ...meal.groups[1], min_select: 2 })).toBe('Required · pick 2–3');
  });
});

describe('money', () => {
  test('formats and parses peso amounts', () => {
    expect(formatMoney(12000)).toBe('₱120');
    expect(formatMoney(12050)).toBe('₱120.50');
    expect(formatMoney(123456789)).toBe('₱1,234,567.89');
    expect(formatMoney(12000, { fixed: true })).toBe('₱120.00');
    expect(parsePesos('1,250.5')).toBe(125050);
    expect(parsePesos('₱ 99')).toBe(9900);
    expect(parsePesos('12.345')).toBeNull();
    expect(parsePesos('abc')).toBeNull();
    expect(toPesoInput(125050)).toBe('1250.50');
  });
});

describe('order lifecycle', () => {
  test('riders get one next step at a time after payment', () => {
    expect(riderNextStep('accepted')).toBeNull();
    expect(riderNextStep('buying')?.to).toBe('out_for_delivery');
    expect(riderNextStep('out_for_delivery')?.to).toBe('completed');
  });

  test('progress groups payment with rider acceptance', () => {
    expect(progressIndex('payment_submitted')).toBe(1);
    expect(progressIndex('buying')).toBe(2);
    expect(progressIndex('cancelled')).toBe(-1);
  });
});

describe('hours', () => {
  test('validates and summarizes weekly hours', () => {
    expect(validateHours([{ weekday: 1, opens: '09:00', closes: '08:00' }])).toBe('Monday must close after it opens.');
    expect(
      validateHours([
        { weekday: 1, opens: '09:00', closes: '14:00' },
        { weekday: 1, opens: '13:00', closes: '20:00' },
      ]),
    ).toBe('Monday has overlapping hours.');
    const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '07:00', closes: '21:00' }));
    expect(summarizeHours(week)).toEqual([
      { days: 'Mon–Fri', hours: '7 AM – 9 PM' },
      { days: 'Sat–Sun', hours: 'Closed' },
    ]);
  });
});
