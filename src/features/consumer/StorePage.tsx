import { useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { Clock, Info, MapPin, Search, Star } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocationContext } from '@/features/location/LocationProvider';
import { Sheet } from '@/components/ui/Sheet';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { DataRow, MediaImage, Money, SectionHeading, StoreMark, formatDate } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { lowestPrice } from '@/domain/customization';
import { formatMoney } from '@/domain/money';
import { summarizeHours, trimSeconds } from '@/domain/hours';
import type { ProductRow, Storefront } from '@/types/models';
import { useCarts, useQuote, useStoreHours, useStoreMenu, useStorefront, useStoreReviews } from './api';
import { StoreMeta, storeStateText } from './storeDisplay';

function ProductEntry({ product, storeSlug }: { product: ProductRow; storeSlug: string }) {
  const variants = product.product_variants;
  const price = lowestPrice({ base_price_minor: product.base_price_minor, variants });
  const soldOut = !product.is_available;
  return (
    <li>
      <Link to={`/stores/${storeSlug}/items/${product.id}`} className="group flex w-full gap-4 py-4 text-left">
        <div className={cx('min-w-0 flex-1', soldOut && 'opacity-55')}>
          <h3 className="font-semibold group-hover:underline group-hover:underline-offset-4">{product.name}</h3>
          {product.description && <p className="mt-0.5 line-clamp-2 text-small text-ink-3">{product.description}</p>}
          <p className="tabular mt-1.5 text-small font-semibold">
            {soldOut ? 'Sold out' : variants.length > 1 ? `From ${formatMoney(price)}` : formatMoney(price)}
          </p>
        </div>
        {product.image_path && (
          <MediaImage path={product.image_path} alt="" className={cx('size-22 shrink-0 rounded-media sm:size-24', soldOut && 'opacity-55')} />
        )}
      </Link>
    </li>
  );
}

function StoreInfoSheet({ store, open, onClose }: { store: Storefront; open: boolean; onClose: () => void }) {
  const hours = useStoreHours(store.id);
  const rows = summarizeHours((hours.data ?? []).map((h) => ({ weekday: h.weekday, opens: trimSeconds(h.opens_at), closes: trimSeconds(h.closes_at) })));
  return (
    <Sheet open={open} onClose={onClose} title={store.name} size="sm">
      <div className="space-y-6">
        {store.description && <p className="text-ink-2">{store.description}</p>}
        <section>
          <h3 className="mb-1 flex items-center gap-2 font-semibold">
            <Clock className="size-4" aria-hidden /> Opening hours
          </h3>
          <dl className="text-small">
            {rows.map((r) => (
              <DataRow key={r.days} label={r.days}>
                {r.hours}
              </DataRow>
            ))}
          </dl>
        </section>
        <section>
          <h3 className="mb-1 flex items-center gap-2 font-semibold">
            <MapPin className="size-4" aria-hidden /> Address
          </h3>
          <p className="text-small text-ink-2">
            {store.address_line}, {store.barangay}, {store.city}
          </p>
        </section>
        <dl className="text-small">
          <DataRow label="Delivery fee">
            {store.delivery_fee_varies ? `from ${formatMoney(store.delivery_fee_from_minor)} — depends on your barangay` : formatMoney(store.delivery_fee_minor)}
          </DataRow>
          {store.service_fee_minor > 0 && <DataRow label="Service fee">{formatMoney(store.service_fee_minor)}</DataRow>}
          <DataRow label="Minimum order">{store.min_order_minor > 0 ? formatMoney(store.min_order_minor) : 'None'}</DataRow>
        </dl>
      </div>
    </Sheet>
  );
}

function Reviews({ storeId }: { storeId: string }) {
  const { data } = useStoreReviews(storeId);
  const withText = (data ?? []).filter((r) => r.comment);
  if (!withText.length) return null;
  return (
    <section aria-labelledby="reviews-heading" className="border-t border-line pt-8">
      <SectionHeading id="reviews-heading" title="What customers say" />
      <ul className="grid gap-6 sm:grid-cols-2">
        {withText.slice(0, 6).map((r) => (
          <li key={r.id} className="space-y-1">
            <p className="flex items-center gap-1 text-small font-semibold">
              <Star className="size-3.5" weight="fill" aria-hidden /> {r.rating}
              <span className="font-normal text-ink-3">
                · {r.reviewer_first_name} · {formatDate(r.created_at)}
              </span>
            </p>
            <p className="text-ink-2">{r.comment}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CartPanel({ store }: { store: Storefront }) {
  const { status } = useAuth();
  const { address } = useLocationContext();
  const carts = useCarts();
  const cart = carts.data?.find((c) => c.merchant_id === store.id);
  const quote = useQuote({
    merchantId: cart ? store.id : undefined,
    addressId: address?.id ?? null,
    promo: null,
  });
  if (status !== 'signed_in' || !cart) {
    return (
      <div className="space-y-2">
        <h2 className="text-heading font-semibold">Your order</h2>
        <p className="text-small text-ink-3">Items you add from {store.name} appear here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h2 className="text-heading font-semibold">Your order</h2>
      {quote.data ? (
        <>
          <ul className="space-y-3 text-small">
            {quote.data.items.map((item) => (
              <li key={item.cart_item_id} className="flex gap-3">
                <span className="tabular font-semibold">{item.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.product_name}</span>
                  {(item.variant_name || item.options.length > 0) && (
                    <span className="block text-ink-3">{[item.variant_name, ...item.options.map((o) => o.option_name)].filter(Boolean).join(', ')}</span>
                  )}
                  {item.error_message && <span className="block text-danger">{item.error_message}</span>}
                </span>
                <Money minor={item.line_total_minor} />
              </li>
            ))}
          </ul>
          <dl className="border-t border-line pt-3 text-small">
            <DataRow label="Subtotal" strong>
              {formatMoney(quote.data.subtotal_minor)}
            </DataRow>
          </dl>
        </>
      ) : (
        <p className="text-small text-ink-3">{cart.item_count} items</p>
      )}
      <ButtonLink to={`/checkout/${store.id}`} block size="lg">
        Review order
      </ButtonLink>
    </div>
  );
}

function MobileCartBar({ store }: { store: Storefront }) {
  const { status } = useAuth();
  const carts = useCarts();
  const cart = carts.data?.find((c) => c.merchant_id === store.id);
  if (status !== 'signed_in' || !cart) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4 pb-3 lg:hidden">
      <Link
        to={`/checkout/${store.id}`}
        className="flex h-13 items-center justify-between rounded-control bg-accent px-4 font-semibold text-ink shadow-pop"
      >
        <span className="tabular">
          {cart.item_count} {cart.item_count === 1 ? 'item' : 'items'}
        </span>
        <span>Review order</span>
      </Link>
    </div>
  );
}

export default function StorePage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const store = useStorefront(slug);
  const menu = useStoreMenu(store.data?.id);
  const [infoOpen, setInfoOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const sectionRefs = useRef(new Map<string, HTMLElement | null>());

  // Older links opened items with ?item=; items now have their own page.
  const legacyItem = params.get('item');

  const sections = useMemo(() => {
    if (!menu.data) return [];
    const q = filter.trim().toLowerCase();
    const products = menu.data.products.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
    );
    const byCategory = menu.data.categories
      .map((c) => ({ id: c.id, name: c.name, products: products.filter((p) => p.category_id === c.id) }))
      .filter((s) => s.products.length > 0);
    const uncategorized = products.filter((p) => !p.category_id || !menu.data!.categories.some((c) => c.id === p.category_id));
    if (uncategorized.length) byCategory.push({ id: 'other', name: byCategory.length ? 'More items' : 'Menu', products: uncategorized });
    return byCategory;
  }, [menu.data, filter]);

  if (legacyItem) return <Navigate to={`/stores/${slug}/items/${legacyItem}`} replace />;

  if (store.isPending) {
    return (
      <div className="page-x mx-auto max-w-7xl">
        <PageLoading />
      </div>
    );
  }
  if (store.isError) return <ErrorState className="page-x" error={store.error} onRetry={() => store.refetch()} />;
  if (!store.data) {
    return (
      <div className="page-x mx-auto max-w-7xl">
        <EmptyState title="This store isn’t available" action={<ButtonLink to="/" variant="secondary">Browse other stores</ButtonLink>}>
          It may have closed its GETGO page or moved. Your past orders are still in your order history.
        </EmptyState>
      </div>
    );
  }

  const s = store.data;
  const stateText = storeStateText(s);
  const productCount = menu.data?.products.length ?? 0;

  return (
    <div className="pb-24 lg:pb-0">
      {s.cover_path && (
        <div className="mx-auto max-w-7xl lg:px-8 lg:pt-6">
          <MediaImage path={s.cover_path} alt="" eager className="aspect-[16/7] max-h-72 w-full lg:aspect-[16/5] lg:rounded-media" />
        </div>
      )}

      <div className="page-x mx-auto max-w-7xl">
        <header className={cx('flex items-start gap-4 pb-4', s.cover_path ? 'pt-0' : 'pt-5 lg:pt-8')}>
          {/* The logo overlaps the cover photo when there is one. */}
          <StoreMark
            name={s.name}
            logoPath={s.logo_path}
            size="lg"
            className={cx('ring-4 ring-surface', s.cover_path && 'relative -mt-8 lg:-mt-10')}
          />
          <div className={cx('min-w-0 flex-1', s.cover_path && 'pt-3')}>
            <h1 className="text-title font-bold lg:text-display">{s.name}</h1>
            <StoreMeta store={s} className="mt-1" />
            <button type="button" onClick={() => setInfoOpen(true)} className="mt-2 inline-flex items-center gap-1.5 text-small font-semibold underline underline-offset-4">
              <Info className="size-4" aria-hidden /> Hours, address and fees
            </button>
          </div>
        </header>

        {stateText && (
          <Notice tone={s.state === 'paused' ? 'warning' : 'neutral'} className="mb-4" title={s.state === 'paused' ? 'Paused' : 'Closed now'}>
            {s.state === 'paused' ? `${s.name} isn’t taking new orders at the moment.` : `${stateText}. You can browse and add items now.`}
          </Notice>
        )}
        {s.min_order_minor > 0 && <p className="mb-4 text-small text-ink-3">Minimum order {formatMoney(s.min_order_minor)}</p>}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <div>
            {sections.length > 1 && (
              <nav
                aria-label="Menu categories"
                className="no-scrollbar sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 flex gap-6 overflow-x-auto border-b border-line bg-surface px-4 sm:mx-0 sm:px-0 lg:top-16"
              >
                {sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => sectionRefs.current.get(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="shrink-0 border-b-2 border-transparent py-3 text-small font-semibold whitespace-nowrap text-ink-2 hover:border-ink hover:text-ink"
                  >
                    {sec.name}
                  </button>
                ))}
              </nav>
            )}

            {productCount > 8 && (
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Search ${s.name}`}
                  aria-label={`Search the ${s.name} menu`}
                  className="h-10 w-full rounded-control bg-canvas pr-3 pl-9 focus:bg-surface focus:ring-2 focus:ring-accent focus:outline-none"
                />
              </div>
            )}

            {menu.isPending ? (
              <PageLoading rows={5} />
            ) : menu.isError ? (
              <ErrorState error={menu.error} onRetry={() => menu.refetch()} />
            ) : sections.length === 0 ? (
              <EmptyState title={filter ? 'No matching items' : 'The menu is being prepared'}>
                {filter ? 'Try a different word.' : 'This store hasn’t published items yet.'}
              </EmptyState>
            ) : (
              sections.map((sec) => (
                <section
                  key={sec.id}
                  ref={(el) => void sectionRefs.current.set(sec.id, el)}
                  aria-labelledby={`cat-${sec.id}`}
                  className="scroll-mt-28 pt-6 lg:scroll-mt-32"
                >
                  <h2 id={`cat-${sec.id}`} className="text-heading font-bold">
                    {sec.name}
                  </h2>
                  <ul className="divide-y divide-line">
                    {sec.products.map((p) => (
                      <ProductEntry key={p.id} product={p} storeSlug={s.slug} />
                    ))}
                  </ul>
                </section>
              ))
            )}

            <div className="mt-10">
              <Reviews storeId={s.id} />
            </div>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-24 border-l border-line pl-8">
              <CartPanel store={s} />
            </div>
          </aside>
        </div>
      </div>

      <MobileCartBar store={s} />
      <StoreInfoSheet store={s} open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
