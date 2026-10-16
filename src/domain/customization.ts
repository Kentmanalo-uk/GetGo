/**
 * Client-side mirror of public.price_configuration for instant feedback while
 * a customer configures a product. The server recomputes everything at
 * add-to-cart and checkout; this module never decides what is charged.
 * Error codes and messages intentionally match the SQL function.
 */

export interface OptionValue {
  id: string;
  name: string;
  price_delta_minor: number;
  is_available: boolean;
  max_quantity: number;
  sort_order: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  values: OptionValue[];
}

export interface Variant {
  id: string;
  name: string;
  price_minor: number;
  is_available: boolean;
  sort_order: number;
}

export interface ConfigurableProduct {
  id: string;
  name: string;
  base_price_minor: number;
  is_available: boolean;
  max_per_order: number;
  variants: Variant[];
  groups: OptionGroup[];
}

/** option_value_id → quantity */
export type Selection = Record<string, number>;

export interface Configuration {
  variantId: string | null;
  selection: Selection;
  quantity: number;
}

export interface ConfigError {
  code: string;
  message: string;
  groupId?: string;
}

export interface Evaluation {
  unitPriceMinor: number;
  totalMinor: number;
  valid: boolean;
  error: ConfigError | null;
  groupErrors: Record<string, string>;
  groupCounts: Record<string, number>;
}

const lower = (s: string) => s.toLowerCase();

export function groupMinMessage(group: OptionGroup): string {
  return group.min_select === 1
    ? `Choose ${lower(group.name)}.`
    : `Choose at least ${group.min_select} for ${lower(group.name)}.`;
}

export function groupMaxMessage(group: OptionGroup): string {
  return `Choose up to ${group.max_select} for ${lower(group.name)}.`;
}

/** Short rule shown beside a group heading, e.g. "Required · pick 1". */
export function describeGroupRule(group: OptionGroup): string {
  const { min_select: min, max_select: max } = group;
  if (min === 0) return max === 1 ? 'Optional' : `Optional · up to ${max}`;
  if (min === max) return `Required · pick ${min}`;
  return `Required · pick ${min}–${max}`;
}

export function isSingleChoice(group: OptionGroup): boolean {
  return group.max_select === 1 && group.values.every((v) => v.max_quantity === 1);
}

export function basePrice(product: ConfigurableProduct, variantId: string | null): number {
  if (product.variants.length === 0) return product.base_price_minor;
  return product.variants.find((v) => v.id === variantId)?.price_minor ?? lowestPrice(product);
}

/** "From" price for listings. */
export function lowestPrice(product: Pick<ConfigurableProduct, 'base_price_minor' | 'variants'>): number {
  if (product.variants.length === 0) return product.base_price_minor;
  return Math.min(...product.variants.map((v) => v.price_minor));
}

export function evaluate(product: ConfigurableProduct, config: Configuration): Evaluation {
  const groupCounts: Record<string, number> = {};
  const groupErrors: Record<string, string> = {};
  const valueIndex = new Map<string, { value: OptionValue; group: OptionGroup }>();
  for (const group of product.groups) {
    groupCounts[group.id] = 0;
    for (const value of group.values) valueIndex.set(value.id, { value, group });
  }

  let delta = 0;
  let firstError: ConfigError | null = null;
  const fail = (error: ConfigError) => {
    if (!firstError) firstError = error;
  };

  if (!product.is_available) fail({ code: 'product_sold_out', message: `${product.name} is sold out.` });
  if (config.quantity < 1 || config.quantity > product.max_per_order) {
    fail({ code: 'invalid_quantity', message: `You can order up to ${product.max_per_order} of ${product.name}.` });
  }

  if (product.variants.length > 0) {
    const variant = product.variants.find((v) => v.id === config.variantId);
    if (!variant) fail({ code: 'variant_required', message: `Choose a size for ${product.name}.` });
    else if (!variant.is_available) {
      fail({ code: 'variant_sold_out', message: `${product.name} (${variant.name}) is sold out.` });
    }
  } else if (config.variantId) {
    fail({ code: 'invalid_variant', message: 'This item has no size options.' });
  }

  for (const [valueId, qty] of Object.entries(config.selection)) {
    if (qty <= 0) continue;
    const entry = valueIndex.get(valueId);
    if (!entry) {
      fail({ code: 'invalid_option', message: 'One of the selected options is no longer offered.' });
      continue;
    }
    const { value, group } = entry;
    if (!value.is_available) {
      fail({ code: 'option_sold_out', message: `${value.name} is sold out.`, groupId: group.id });
      groupErrors[group.id] ??= `${value.name} is sold out.`;
    } else if (qty > value.max_quantity) {
      const message = `You can add up to ${value.max_quantity} of ${value.name}.`;
      fail({ code: 'invalid_option_quantity', message, groupId: group.id });
      groupErrors[group.id] ??= message;
    }
    groupCounts[group.id] += qty;
    delta += value.price_delta_minor * qty;
  }

  for (const group of product.groups) {
    const count = groupCounts[group.id];
    if (count < group.min_select) {
      const message = groupMinMessage(group);
      groupErrors[group.id] ??= message;
      fail({ code: 'group_min', message, groupId: group.id });
    } else if (count > group.max_select) {
      const message = groupMaxMessage(group);
      groupErrors[group.id] ??= message;
      fail({ code: 'group_max', message, groupId: group.id });
    }
  }

  const unitPriceMinor = basePrice(product, config.variantId) + delta;
  return {
    unitPriceMinor,
    totalMinor: unitPriceMinor * Math.max(config.quantity, 0),
    valid: firstError === null,
    error: firstError,
    groupErrors,
    groupCounts,
  };
}

/** Sensible starting configuration: first available variant, nothing else. */
export function initialConfiguration(product: ConfigurableProduct): Configuration {
  const variant = product.variants.find((v) => v.is_available) ?? null;
  return { variantId: variant?.id ?? null, selection: {}, quantity: 1 };
}

/** Selecting a value in a single-choice group replaces the previous choice. */
export function chooseSingle(selection: Selection, group: OptionGroup, valueId: string): Selection {
  const next = { ...selection };
  for (const v of group.values) delete next[v.id];
  next[valueId] = 1;
  return next;
}

/** Toggles a value in a multi-choice group, refusing to exceed the group max. */
export function toggleMulti(selection: Selection, group: OptionGroup, valueId: string): Selection {
  const next = { ...selection };
  if (next[valueId]) {
    delete next[valueId];
    return next;
  }
  const count = group.values.reduce((sum, v) => sum + (next[v.id] ?? 0), 0);
  if (count >= group.max_select) return selection;
  next[valueId] = 1;
  return next;
}

/** Sets a value's quantity within its own and the group's limits. */
export function setValueQuantity(selection: Selection, group: OptionGroup, valueId: string, quantity: number): Selection {
  const value = group.values.find((v) => v.id === valueId);
  if (!value) return selection;
  const others = group.values.reduce((sum, v) => sum + (v.id === valueId ? 0 : (selection[v.id] ?? 0)), 0);
  const capped = Math.max(0, Math.min(quantity, value.max_quantity, group.max_select - others));
  const next = { ...selection };
  if (capped === 0) delete next[valueId];
  else next[valueId] = capped;
  return next;
}

export function selectionPayload(selection: Selection): Array<{ option_value_id: string; quantity: number }> {
  return Object.entries(selection)
    .filter(([, qty]) => qty > 0)
    .map(([option_value_id, quantity]) => ({ option_value_id, quantity }));
}
