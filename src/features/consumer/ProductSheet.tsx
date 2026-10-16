import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { X } from '@/components/icons';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { ChoiceRow, Field, QuantityStepper, Textarea } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Feedback';
import { MediaImage } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  chooseSingle,
  describeGroupRule,
  evaluate,
  initialConfiguration,
  isSingleChoice,
  lowestPrice,
  selectionPayload,
  setValueQuantity,
  toggleMulti,
  type ConfigurableProduct,
  type Configuration,
  type OptionGroup,
} from '@/domain/customization';
import { formatDelta, formatMoney } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import type { ProductRow } from '@/types/models';
import { toConfigurable, useAddToCart, useUpdateCartItem } from './api';

export interface EditingLine {
  cartItemId: string;
  variantId: string | null;
  selection: Array<{ option_value_id: string; quantity: number }>;
  quantity: number;
  instructions: string | null;
}

function summarize(product: ConfigurableProduct, config: Configuration): string[] {
  const parts: string[] = [];
  const variant = product.variants.find((v) => v.id === config.variantId);
  if (variant && product.variants.length > 1) parts.push(variant.name);
  for (const group of product.groups) {
    for (const value of group.values) {
      const qty = config.selection[value.id];
      if (!qty) continue;
      const delta = value.price_delta_minor * qty;
      parts.push(`${value.name}${qty > 1 ? ` ×${qty}` : ''}${delta > 0 ? ` (${formatDelta(delta)})` : ''}`);
    }
  }
  return parts;
}

function GroupSection({
  group,
  config,
  setConfig,
  error,
  sectionRef,
}: {
  group: OptionGroup;
  config: Configuration;
  setConfig: (c: Configuration) => void;
  error?: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const single = isSingleChoice(group);
  const count = group.values.reduce((s, v) => s + (config.selection[v.id] ?? 0), 0);
  const full = !single && count >= group.max_select;
  const headingId = `group-${group.id}`;
  return (
    <section ref={sectionRef} aria-labelledby={headingId} tabIndex={-1} className="scroll-mt-4 py-4 outline-none">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="font-semibold">
          {group.name}
        </h3>
        <span className={cx('shrink-0 text-small', error ? 'font-semibold text-danger' : group.min_select > 0 ? 'text-ink-2' : 'text-ink-3')}>
          {error ?? describeGroupRule(group)}
        </span>
      </div>
      <div role={single ? 'radiogroup' : 'group'} aria-labelledby={headingId} className="mt-1 divide-y divide-line">
        {group.values.map((value) => {
          const qty = config.selection[value.id] ?? 0;
          const selected = qty > 0;
          const soldOut = !value.is_available;
          const meta = soldOut ? 'Sold out' : formatDelta(value.price_delta_minor) || (single ? '' : 'Free');
          return (
            <ChoiceRow
              key={value.id}
              type={single ? 'radio' : 'checkbox'}
              name={group.id}
              checked={selected}
              disabled={soldOut || (!selected && full)}
              onChange={() =>
                setConfig({
                  ...config,
                  selection: single ? chooseSingle(config.selection, group, value.id) : toggleMulti(config.selection, group, value.id),
                })
              }
              label={value.name}
              meta={meta}
              trailing={
                selected && value.max_quantity > 1 ? (
                  <QuantityStepper
                    size="sm"
                    label={value.name}
                    value={qty}
                    min={1}
                    max={Math.min(value.max_quantity, group.max_select - (count - qty))}
                    onChange={(n) => setConfig({ ...config, selection: setValueQuantity(config.selection, group, value.id, n) })}
                  />
                ) : undefined
              }
            />
          );
        })}
      </div>
    </section>
  );
}

export function ProductSheet({
  product,
  open,
  onClose,
  editing,
  storeOpen,
  preview,
}: {
  product: ProductRow | null;
  open: boolean;
  onClose: () => void;
  editing?: EditingLine | null;
  storeOpen: boolean;
  /** Merchant preview: fully interactive, but nothing is added to a cart. */
  preview?: boolean;
}) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const configurable = useMemo(() => (product ? toConfigurable(product) : null), [product]);
  const [config, setConfig] = useState<Configuration | null>(null);
  const [instructions, setInstructions] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const sections = useRef(new Map<string, HTMLElement | null>());
  const add = useAddToCart();
  const update = useUpdateCartItem();
  const mutation = editing ? update : add;

  useEffect(() => {
    if (!configurable || !open) return;
    if (editing) {
      setConfig({
        variantId: editing.variantId,
        selection: Object.fromEntries(editing.selection.map((s) => [s.option_value_id, s.quantity])),
        quantity: editing.quantity,
      });
      setInstructions(editing.instructions ?? '');
    } else {
      setConfig(initialConfiguration(configurable));
      setInstructions('');
    }
    setShowErrors(false);
    add.reset();
    update.reset();
  }, [configurable, open, editing]); // mutation objects are intentionally omitted (new identity each render)

  if (!product || !configurable || !config) {
    return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  }

  const result = evaluate(configurable, config);
  const summary = summarize(configurable, config);
  const variantError = showErrors && result.error && (result.error.code === 'variant_required' || result.error.code === 'variant_sold_out') ? result.error.message : undefined;

  const submit = async () => {
    if (preview) {
      setShowErrors(true);
      return;
    }
    if (status !== 'signed_in') {
      navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!result.valid) {
      setShowErrors(true);
      const groupId = result.error?.groupId;
      const el = groupId ? sections.current.get(groupId) : sections.current.get('__variant');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
      return;
    }
    const line = {
      productId: product.id,
      variantId: config.variantId,
      options: selectionPayload(config.selection),
      quantity: config.quantity,
      instructions: instructions.trim(),
    };
    try {
      if (editing) await update.mutateAsync({ ...line, cartItemId: editing.cartItemId });
      else await add.mutateAsync(line);
      toast(editing ? 'Item updated' : `Added ${config.quantity > 1 ? `${config.quantity} × ` : ''}${product.name}`);
      onClose();
    } catch {
      /* shown inline */
    }
  };

  const soldOut = !product.is_available;
  const buttonLabel = preview
    ? `Preview · ${formatMoney(result.totalMinor)}`
    : status !== 'signed_in'
      ? 'Sign in to order'
      : soldOut
        ? 'Sold out'
        : `${editing ? 'Update' : 'Add'}${config.quantity > 1 ? ` ${config.quantity}` : ''} · ${formatMoney(result.totalMinor)}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product.name}
      hideTitle={Boolean(product.image_path)}
      size="md"
      media={
        product.image_path ? (
          <div className="relative">
            <MediaImage path={product.image_path} alt={product.name} eager className="aspect-[16/10] w-full" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full bg-surface/95 shadow-pop"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        ) : undefined
      }
      footer={
        <div className="space-y-3">
          {summary.length > 0 && <p className="text-small text-ink-3 line-clamp-2">{summary.join(' · ')}</p>}
          {mutation.error && <Notice tone="danger">{userMessage(mutation.error)}</Notice>}
          {preview && <p className="text-small text-ink-3">This is how customers see this item. Nothing is added to a cart.</p>}
          {!preview && !storeOpen && !editing && (
            <Notice tone="warning">This store can’t take orders right now. You can add items and check out when it opens.</Notice>
          )}
          <div className="flex items-center gap-3">
            <QuantityStepper
              label="quantity"
              value={config.quantity}
              min={1}
              max={product.max_per_order}
              onChange={(quantity) => setConfig({ ...config, quantity })}
              disabled={soldOut}
            />
            <Button size="lg" className="flex-1" onClick={submit} loading={mutation.isPending} disabled={soldOut && status === 'signed_in'}>
              <span className="tabular">{buttonLabel}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div>
        {product.image_path && <h2 className="pt-1 text-title font-semibold">{product.name}</h2>}
        {product.description && <p className="mt-1 text-ink-2">{product.description}</p>}
        <p className="tabular mt-2 font-semibold">
          {configurable.variants.length > 1 ? `From ${formatMoney(lowestPrice(configurable))}` : formatMoney(lowestPrice(configurable))}
        </p>

        <div className="mt-2 divide-y divide-line border-t border-line">
          {configurable.variants.length > 0 && (
            <section
              ref={(el) => void sections.current.set('__variant', el)}
              tabIndex={-1}
              aria-labelledby="variant-heading"
              className="scroll-mt-4 py-4 outline-none"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="variant-heading" className="font-semibold">
                  Size
                </h3>
                <span className={cx('text-small', variantError ? 'font-semibold text-danger' : 'text-ink-2')}>{variantError ?? 'Required · pick 1'}</span>
              </div>
              <div role="radiogroup" aria-labelledby="variant-heading" className="mt-1 divide-y divide-line">
                {configurable.variants.map((v) => (
                  <ChoiceRow
                    key={v.id}
                    type="radio"
                    name="variant"
                    checked={config.variantId === v.id}
                    disabled={!v.is_available}
                    onChange={() => setConfig({ ...config, variantId: v.id })}
                    label={v.name}
                    meta={v.is_available ? formatMoney(v.price_minor) : 'Sold out'}
                  />
                ))}
              </div>
            </section>
          )}

          {configurable.groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              config={config}
              setConfig={setConfig}
              error={showErrors ? result.groupErrors[group.id] : undefined}
              sectionRef={(el) => void sections.current.set(group.id, el)}
            />
          ))}

          <div className="py-4">
            <Field label="Special instructions" optional hint="The store sees this note. It can’t add paid extras.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={200}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Less spicy, no onions…"
                />
              )}
            </Field>
          </div>
        </div>
        {showErrors && result.error && !result.error.groupId && result.error.code !== 'variant_required' && (
          <Notice tone="danger">{result.error.message}</Notice>
        )}
      </div>
    </Sheet>
  );
}
