import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Pencil, Plus } from '@/components/icons';
import { useLocationContext } from '@/features/location/LocationProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ChoiceRow, Field, Input, QuantityStepper, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { DataRow, Money, PageHeader } from '@/components/ui/Display';
import { Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { formatMoney } from '@/domain/money';
import { supabase } from '@/lib/supabase';
import { errorHint, unwrap, userMessage } from '@/lib/errors';
import { newIdempotencyKey } from '@/lib/queryClient';
import type { ProductRow, QuoteItem } from '@/types/models';
import { PRODUCT_SELECT, usePlaceOrder, useQuote, useSetCartQuantity } from './api';
import { AddressForm } from './AddressForm';
import { ProductSheet, type EditingLine } from './ProductSheet';

function keyFor(merchantId: string) {
  const storageKey = `getgo.checkout.${merchantId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const key = newIdempotencyKey();
    sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return newIdempotencyKey();
  }
}
function clearKey(merchantId: string) {
  try {
    sessionStorage.removeItem(`getgo.checkout.${merchantId}`);
  } catch {
    /* ignore */
  }
}

function useProduct(productId: string | null) {
  return useQuery({
    queryKey: ['product', productId],
    enabled: Boolean(productId),
    queryFn: async () => unwrap(await supabase.from('products').select(PRODUCT_SELECT).eq('id', productId!).maybeSingle()) as unknown as ProductRow | null,
  });
}

function ItemRow({ item, onEdit }: { item: QuoteItem; onEdit: () => void }) {
  const setQty = useSetCartQuantity();
  const details = [item.variant_name, ...item.options.map((o) => `${o.option_name}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`)].filter(Boolean);
  return (
    <li className="py-4">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{item.product_name}</p>
          {details.length > 0 && <p className="text-small text-ink-3">{details.join(', ')}</p>}
          {item.instructions && <p className="text-small text-ink-3 italic">“{item.instructions}”</p>}
          {item.error_message ? (
            <p className="mt-1 text-small font-semibold text-danger">{item.error_message}</p>
          ) : (
            item.price_changed && (
              <p className="mt-1 text-small font-semibold text-warning">
                Price changed from {formatMoney(item.previous_unit_price_minor)} to {formatMoney(item.unit_price_minor)} each
              </p>
            )
          )}
        </div>
        <Money minor={item.line_total_minor ?? 0} className={cx('font-semibold', item.error_code && 'text-ink-4 line-through')} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <QuantityStepper
          size="sm"
          label={item.product_name}
          value={item.quantity}
          min={0}
          max={99}
          disabled={setQty.isPending}
          onChange={(quantity) => setQty.mutate({ cartItemId: item.cart_item_id, quantity })}
        />
        <Button variant="ghost" size="sm" icon={<Pencil className="size-3.5" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setQty.mutate({ cartItemId: item.cart_item_id, quantity: 0 })}>
          Remove
        </Button>
      </div>
      {setQty.error && <p className="mt-1 text-small text-danger">{userMessage(setQty.error)}</p>}
    </li>
  );
}

export default function CheckoutPage() {
  const { merchantId } = useParams();
  const navigate = useNavigate();
  const loc = useLocationContext();
  const [addressId, setAddressId] = useState<string | null>(loc.address?.id ?? null);
  const [notes, setNotes] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [addressSheet, setAddressSheet] = useState<'pick' | 'new' | null>(null);
  const [editing, setEditing] = useState<QuoteItem | null>(null);
  const idempotencyKey = useMemo(() => (merchantId ? keyFor(merchantId) : ''), [merchantId]);

  useEffect(() => {
    if (!addressId && loc.addresses.length) setAddressId(loc.address?.id ?? loc.addresses[0].id);
  }, [addressId, loc.address, loc.addresses]);

  const quote = useQuote({ merchantId, addressId, promo });
  const place = usePlaceOrder();
  const editProduct = useProduct(editing?.product_id ?? null);
  const q = quote.data;

  if (quote.isPending) {
    return (
      <div className="page-x mx-auto max-w-5xl">
        <PageLoading />
      </div>
    );
  }
  if (quote.isError && !q) return <ErrorState className="page-x mx-auto max-w-5xl" error={quote.error} onRetry={() => quote.refetch()} />;
  if (!q || q.items.length === 0) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageHeader title="Checkout" back="/cart" />
        <EmptyState title="Nothing to check out" action={<ButtonLink to="/">Browse stores</ButtonLink>}>
          Your cart for this store is empty.
        </EmptyState>
      </div>
    );
  }

  const address = loc.addresses.find((a) => a.id === addressId) ?? null;

  const placeOrder = async () => {
    if (!addressId) return;
    try {
      const orderId = await place.mutateAsync({
        merchantId: q.merchant.id,
        addressId,
        notes,
        promo,
        expectedTotalMinor: q.total_minor,
        idempotencyKey,
      });
      clearKey(q.merchant.id);
      navigate(`/orders/${orderId}?placed=1`, { replace: true });
    } catch (error) {
      if (errorHint(error) === 'total_changed') quote.refetch();
    }
  };

  const editingLine: EditingLine | null = editing
    ? { cartItemId: editing.cart_item_id, variantId: editing.variant_id, selection: editing.selection, quantity: editing.quantity, instructions: editing.instructions }
    : null;

  return (
    <div className="page-x mx-auto max-w-5xl pb-36 lg:pb-12">
      <PageHeader title="Checkout" back={`/stores/${q.merchant.slug}`}>
        {q.merchant.name}
      </PageHeader>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="space-y-8">
          <section aria-labelledby="where-heading">
            <h2 id="where-heading" className="mb-2 text-heading font-semibold">
              Deliver to
            </h2>
            {address ? (
              <button type="button" onClick={() => setAddressSheet('pick')} className="flex w-full items-start gap-3 rounded-control border border-line-strong p-3 text-left hover:bg-canvas">
                <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {address.label} · {address.recipient_name}
                  </span>
                  <span className="block text-small text-ink-3">
                    {address.line1}, {address.barangay}, {address.city}
                    {address.landmark && ` · ${address.landmark}`}
                  </span>
                  <span className="block text-small text-ink-3">{address.phone}</span>
                </span>
                <span className="text-small font-semibold underline underline-offset-4">Change</span>
              </button>
            ) : (
              <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAddressSheet('new')}>
                Add a delivery address
              </Button>
            )}
          </section>

          <section aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-heading font-semibold">
              What the rider will buy
            </h2>
            <ul className="divide-y divide-line">
              {q.items.map((item) => (
                <ItemRow key={item.cart_item_id} item={item} onEdit={() => setEditing(item)} />
              ))}
            </ul>
            <ButtonLink to={`/stores/${q.merchant.slug}`} variant="link" size="sm">
              Add more items
            </ButtonLink>
          </section>

          <section aria-label="Notes and promo code" className="space-y-4">
            <Field label="Note for the rider" optional>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Substitutes if something is out, gate code, call when outside…"
                />
              )}
            </Field>

            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPromo(promoInput.trim() ? promoInput.trim().toUpperCase() : null);
              }}
            >
              <Field label="Promo code" optional className="flex-1">
                {(p) => <Input {...p} value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} autoCapitalize="characters" maxLength={20} />}
              </Field>
              <Button type="submit" variant="secondary" disabled={!promoInput.trim()}>
                Apply
              </Button>
            </form>
            {q.promo && (
              <p className={cx('text-small font-semibold', q.promo.applied ? 'text-accent-ink' : 'text-danger')}>
                {q.promo.applied ? `${q.promo.code} applied — ${q.promo.title}` : q.promo.message}
              </p>
            )}
          </section>

          <section aria-labelledby="pay-heading" className="rounded-media bg-canvas p-4">
            <h2 id="pay-heading" className="font-semibold">
              How you pay
            </h2>
            <ol className="mt-2 space-y-1.5 text-small text-ink-2">
              <li>1. A GETGO rider near you accepts your order.</li>
              <li>2. You send the total by GCash to the rider’s number shown on your order.</li>
              <li>3. You enter the GCash reference number. The rider confirms it, buys your items and delivers them.</li>
            </ol>
            <p className="mt-2 text-small text-ink-3">Don’t send money before a rider accepts. You can cancel for free until you pay.</p>
          </section>
        </div>

        <aside aria-labelledby="summary-heading" className="mt-8 lg:mt-0">
          <div className="lg:sticky lg:top-24">
            <h2 id="summary-heading" className="mb-2 text-heading font-semibold">
              Summary
            </h2>
            <dl className="text-small">
              <DataRow label="Items (store prices)">{formatMoney(q.subtotal_minor)}</DataRow>
              <DataRow label="Delivery fee">{formatMoney(q.delivery_fee_minor)}</DataRow>
              {q.service_fee_minor > 0 && <DataRow label="Service fee">{formatMoney(q.service_fee_minor)}</DataRow>}
              {q.small_order_fee_minor > 0 && <DataRow label="Small order fee">{formatMoney(q.small_order_fee_minor)}</DataRow>}
              {q.discount_minor > 0 && (
                <DataRow label="Discount" className="text-accent-ink">
                  −{formatMoney(q.discount_minor)}
                </DataRow>
              )}
              <DataRow label="Total to send by GCash" strong className="mt-2 border-t border-line pt-3 text-heading">
                {formatMoney(q.total_minor)}
              </DataRow>
            </dl>

            {q.issues.length > 0 && (
              <div className="mt-4 space-y-2">
                {q.issues.map((issue) => (
                  <Notice key={issue.code} tone="warning">
                    {issue.message}
                  </Notice>
                ))}
              </div>
            )}
            {place.error && (
              <Notice tone="danger" className="mt-4">
                {userMessage(place.error)}
              </Notice>
            )}

            <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pt-3 pb-3 lg:static lg:mt-6 lg:border-0 lg:p-0">
              <Button block size="lg" onClick={placeOrder} loading={place.isPending} disabled={!q.can_checkout || quote.isFetching || place.isPending}>
                <span className="tabular">Place order · {formatMoney(q.total_minor)}</span>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <Sheet open={addressSheet !== null} onClose={() => setAddressSheet(null)} title={addressSheet === 'new' ? 'New address' : 'Deliver to'}>
        {addressSheet === 'new' ? (
          <AddressForm
            onSaved={(a) => {
              setAddressId(a.id);
              setAddressSheet(null);
            }}
            onCancel={loc.addresses.length ? () => setAddressSheet('pick') : () => setAddressSheet(null)}
          />
        ) : (
          <div>
            <div className="divide-y divide-line">
              {loc.addresses.map((a) => (
                <ChoiceRow
                  key={a.id}
                  type="radio"
                  name="address"
                  checked={a.id === addressId}
                  onChange={() => {
                    setAddressId(a.id);
                    setAddressSheet(null);
                  }}
                  label={
                    <span>
                      <span className="block font-semibold">{a.label}</span>
                      <span className="block text-small text-ink-3">
                        {a.line1}, {a.barangay}, {a.city}
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
            <Button variant="ghost" className="mt-2" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAddressSheet('new')}>
              Add an address
            </Button>
          </div>
        )}
      </Sheet>

      <ProductSheet
        product={editProduct.data ?? null}
        open={Boolean(editing && editProduct.data)}
        onClose={() => setEditing(null)}
        editing={editingLine}
        storeOpen={q.merchant.state === 'open'}
      />
    </div>
  );
}
