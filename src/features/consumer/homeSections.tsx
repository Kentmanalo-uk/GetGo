import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { MediaImage, SectionHeading, StoreMark } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS, type Storefront } from '@/types/models';
import type { FeedItem } from './api';

/** An item on the home page; opens its options on the store page. */
function ItemCard({ item }: { item: FeedItem }) {
  // Store hours aren't shown here; the store page and item sheet explain when
  // a store can't take orders yet.
  const unavailable = !item.is_available;
  return (
    <Link to={`/stores/${item.merchant_slug}?item=${item.id}`} className="group block w-36 shrink-0 snap-start sm:w-auto">
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

/** Horizontal row on phones; a grid that can expand on larger screens. */
export function ItemSection({ id, title, items, note }: { id: string; title: string; items: FeedItem[]; note?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const desktopLimit = 12;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title={title} action={note} />
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 sm:hidden">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
      <div className="hidden gap-x-4 gap-y-6 sm:grid sm:grid-cols-4 lg:grid-cols-6">
        {(expanded ? items : items.slice(0, desktopLimit)).map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
      {items.length > desktopLimit && (
        <Button variant="link" size="sm" className="mt-3 hidden sm:inline-flex" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </section>
  );
}

/** Compact row of stores (e.g. new on GETGO). */
export function StoreRow({ id, title, stores }: { id: string; title: string; stores: Storefront[] }) {
  if (stores.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title={title} />
      <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
        {stores.map((s) => {
          return (
            <li key={s.id} className="w-40 shrink-0 snap-start sm:w-auto">
              <Link to={`/stores/${s.slug}`} className="group flex items-center gap-3">
                <StoreMark name={s.name} logoPath={s.logo_path} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-small font-semibold group-hover:underline group-hover:underline-offset-4">{s.name}</span>
                  <span className="block truncate text-micro text-ink-3">{CATEGORY_LABELS[s.category]}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
