import { Link } from 'react-router';
import { Star } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { MediaImage, StoreMark } from '@/components/ui/Display';
import { describeNextOpen } from '@/domain/hours';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS, type Storefront } from '@/types/models';

/** Rider travel estimate when the area has one configured; shopping time varies. */
export function storeEta(store: Pick<Storefront, 'typical_delivery_minutes'>): string | null {
  return store.typical_delivery_minutes ? `~${store.typical_delivery_minutes} min ride` : null;
}

export function storeStateText(store: Pick<Storefront, 'state' | 'next_open_at'>): string | null {
  if (store.state === 'open') return null;
  if (store.state === 'paused') return 'Temporarily closed';
  return describeNextOpen(store.next_open_at);
}

export function StoreMeta({ store, className }: { store: Storefront; className?: string }) {
  const parts = [
    CATEGORY_LABELS[store.category],
    storeEta(store),
    `${store.delivery_fee_varies ? 'from ' : ''}${formatMoney(store.delivery_fee_from_minor)} delivery`,
  ].filter((p): p is string => Boolean(p));
  return (
    <p className={cx('flex flex-wrap items-center gap-x-1.5 text-small text-ink-3', className)}>
      {store.rating_count > 0 && (
        <>
          <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
            <Star className="size-3.5 fill-ink" aria-hidden />
            {store.rating_avg}
          </span>
          <span className="tabular">({store.rating_count})</span>
          <span aria-hidden>·</span>
        </>
      )}
      {parts.map((p, i) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </p>
  );
}

/**
 * A store in a listing: a compact row with a thumbnail on phones, a
 * cover-led tile in multi-column grids on larger screens.
 */
/**
 * `showState` is off on the home page: whether a store can take orders right
 * now is shown once the customer opens the store or an item.
 */
export function StoreEntry({ store, showState = true }: { store: Storefront; showState?: boolean }) {
  const stateText = showState ? storeStateText(store) : null;
  const closed = showState && store.state !== 'open';
  return (
    <Link to={`/stores/${store.slug}`} className="group flex gap-4 py-3 sm:block sm:py-0">
      <div className={cx('relative shrink-0 overflow-hidden rounded-media', closed && 'opacity-60')}>
        {store.cover_path ? (
          <MediaImage path={store.cover_path} alt="" className="size-20 transition-transform duration-300 group-hover:scale-[1.02] sm:aspect-[16/10] sm:h-auto sm:w-full" />
        ) : (
          <div className="flex size-20 items-center justify-center bg-canvas sm:aspect-[16/10] sm:h-auto sm:w-full">
            <StoreMark name={store.name} logoPath={store.logo_path} size="md" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 sm:pt-3">
        <h3 className="truncate text-heading font-semibold group-hover:underline group-hover:underline-offset-4">{store.name}</h3>
        <StoreMeta store={store} className="mt-0.5" />
        {stateText && <p className="mt-1 text-small font-semibold text-ink-2">{stateText}</p>}
      </div>
    </Link>
  );
}
