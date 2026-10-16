import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { MediaImage, SectionHeading, StoreMark } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS, type Storefront } from '@/types/models';
import { useExploreItems, type FeedItem } from './api';

/**
 * An item tile; opens its options on the store page. Store hours aren't shown
 * here — the store page and item sheet explain when a store can't take orders.
 */
export function ItemCard({ item }: { item: FeedItem }) {
  const unavailable = !item.is_available;
  return (
    <Link to={`/stores/${item.merchant_slug}/items/${item.id}`} className="group block min-w-0">
      <div className={cx('relative overflow-hidden rounded-media', unavailable && 'opacity-60')}>
        {item.image_path ? (
          <MediaImage path={item.image_path} alt="" className="aspect-square w-full transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-canvas">
            <StoreMark name={item.merchant_name} size="sm" />
          </div>
        )}
        {unavailable && (
          <span className="absolute inset-x-2 bottom-2 rounded bg-surface/95 px-2 py-0.5 text-center text-micro font-semibold">Sold out</span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-small font-semibold group-hover:underline group-hover:underline-offset-4">{item.name}</p>
      <p className="tabular text-small font-semibold text-ink-2">
        {item.has_sizes && <span className="font-normal text-ink-3">from </span>}
        {formatMoney(item.price_minor)}
      </p>
      <p className="truncate text-micro text-ink-3">{item.merchant_name}</p>
    </Link>
  );
}

/** Two items per row on phones, more on wider screens. Scrolls vertically only. */
export const ITEM_GRID = 'grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-6';

/**
 * A featured row on the home page: scrolls sideways, with a link to the full
 * list on the Explore page.
 */
export function FeaturedItems({ id, title, items, section }: { id: string; title: string; items: FeedItem[]; section: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading
        id={id}
        title={title}
        action={
          <Link to={`/explore?section=${section}`} className="inline-flex items-center gap-0.5 text-small font-semibold underline-offset-4 hover:underline">
            See all <ChevronRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-4 sm:px-0">
        {items.map((item) => (
          <div key={item.id} className="w-36 shrink-0 snap-start sm:w-44">
            <ItemCard item={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Stores as a compact grid (e.g. new on GETGO). */
export function StoreRow({ id, title, stores }: { id: string; title: string; stores: Storefront[] }) {
  if (stores.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title={title} />
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {stores.map((s) => (
          <li key={s.id} className="min-w-0">
            <Link to={`/stores/${s.slug}`} className="group flex items-center gap-3">
              <StoreMark name={s.name} logoPath={s.logo_path} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-small font-semibold group-hover:underline group-hover:underline-offset-4">{s.name}</span>
                <span className="block truncate text-micro text-ink-3">{CATEGORY_LABELS[s.category]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every item in the area, two per row on phones, loading more as the
 * customer scrolls down (with a button as a fallback).
 */
export function AllItems({ areaId, filter }: { areaId: string; filter: (item: FeedItem) => boolean }) {
  const items = useExploreItems(areaId, 'all');
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = items;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const list = (items.data?.pages.flat() ?? []).filter(filter);
  if (items.isPending || list.length === 0) return null;

  return (
    <section aria-labelledby="all-items-heading">
      <SectionHeading id="all-items-heading" title="All items" />
      <div className={ITEM_GRID}>
        {list.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
