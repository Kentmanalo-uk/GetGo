import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Package, Search, ShoppingBasket, UtensilsCrossed, ListChecks } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocationContext } from '@/features/location/LocationProvider';
import { AddressButton } from '@/app/layouts/ConsumerLayout';
import { AddressSheet } from '@/features/location/AddressSheet';
import { Sheet } from '@/components/ui/Sheet';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { SectionHeading, Tabs } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { customerStatusLabel } from '@/domain/orderStatus';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS, FOOD_CATEGORIES, SHOP_CATEGORIES, type MerchantCategory, type Promotion, type Storefront } from '@/types/models';
import { useMyOrders, usePublicPromotions, useStorefronts } from './api';
import { StoreEntry } from './storeDisplay';

type Filter = 'all' | 'food' | 'shops' | MerchantCategory;

const UNAVAILABLE_SERVICES = {
  padala: {
    title: 'Padala',
    body: 'Padala is for sending parcels and documents across town. It isn’t available yet — parcel rules, pricing and rider handling are still being set up for your area.',
  },
  errands: {
    title: 'Errands',
    body: 'Errands such as bill payments and queueing aren’t available yet. We’ll announce supported errands when they launch in your area.',
  },
} as const;

function ActiveOrders() {
  const { status } = useAuth();
  const { data } = useMyOrders('active');
  if (status !== 'signed_in' || !data?.length) return null;
  return (
    <section aria-label="Active orders" className="space-y-2">
      {data.map((order) => (
        <Link
          key={order.id}
          to={`/orders/${order.id}`}
          className="flex items-center gap-4 rounded-media bg-ink px-4 py-3.5 text-white transition-colors hover:bg-ink-2"
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
            <span className="relative size-2.5 rounded-full bg-accent" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{customerStatusLabel(order.status)}</span>
            <span className="block truncate text-small text-white/70">
              {order.merchant_name} · {order.code}
            </span>
          </span>
          <span className="flex items-center gap-1 text-small font-semibold text-accent">
            Track <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      ))}
    </section>
  );
}

function ServiceShortcuts({ filter, onFilter }: { filter: Filter; onFilter: (f: Filter) => void }) {
  const [info, setInfo] = useState<keyof typeof UNAVAILABLE_SERVICES | null>(null);
  const items = [
    { key: 'food', label: 'Food', icon: UtensilsCrossed, available: true },
    { key: 'shops', label: 'Shops', icon: ShoppingBasket, available: true },
    { key: 'padala', label: 'Padala', icon: Package, available: false },
    { key: 'errands', label: 'Errands', icon: ListChecks, available: false },
  ] as const;
  return (
    <>
      <nav aria-label="Services" className="grid grid-cols-4 gap-1 sm:flex sm:gap-8">
        {items.map(({ key, label, icon: Icon, available }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => (available ? onFilter(active ? 'all' : (key as Filter)) : setInfo(key as keyof typeof UNAVAILABLE_SERVICES))}
              aria-pressed={available ? active : undefined}
              className="group flex flex-col items-center gap-1.5 py-1 sm:flex-row sm:gap-2.5"
            >
              <span
                className={cx(
                  'flex size-12 items-center justify-center rounded-media transition-colors sm:size-10',
                  active ? 'bg-accent text-ink' : available ? 'bg-canvas text-ink group-hover:bg-line' : 'bg-canvas text-ink-4',
                )}
              >
                <Icon className="size-[22px] sm:size-5" strokeWidth={1.9} aria-hidden />
              </span>
              <span className={cx('text-small font-semibold', available ? 'text-ink' : 'text-ink-4')}>
                {label}
                {!available && <span className="sr-only"> (not yet available)</span>}
              </span>
            </button>
          );
        })}
      </nav>
      <Sheet
        open={info !== null}
        onClose={() => setInfo(null)}
        title={info ? `${UNAVAILABLE_SERVICES[info].title} is coming later` : ''}
        size="sm"
        footer={
          <Button block variant="secondary" onClick={() => setInfo(null)}>
            Got it
          </Button>
        }
      >
        <p className="text-ink-2">{info && UNAVAILABLE_SERVICES[info].body}</p>
      </Sheet>
    </>
  );
}

function promoLine(p: Promotion) {
  const value =
    p.discount_type === 'percent' ? `${p.value / 100}% off` : p.discount_type === 'fixed' ? `${formatMoney(p.value)} off` : 'Free delivery';
  const min = p.min_subtotal_minor > 0 ? ` on ${formatMoney(p.min_subtotal_minor)}+` : '';
  return `${value}${min}`;
}

function Promotions() {
  const { data } = usePublicPromotions();
  if (!data?.length) return null;
  return (
    <section aria-labelledby="promos-heading">
      <SectionHeading id="promos-heading" title="Promo codes" />
      <ul className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
        {data.map((p) => (
          <li key={p.id} className="w-64 shrink-0 snap-start border-l-2 border-accent-strong py-1 pl-3 sm:w-auto">
            <p className="font-semibold">{promoLine(p)}</p>
            <p className="text-small text-ink-3">{p.title}</p>
            <p className="mt-1 font-mono text-small font-semibold tracking-wide">{p.code}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrderAgain({ stores }: { stores: Storefront[] }) {
  const { status } = useAuth();
  const { data } = useMyOrders('all');
  const again = useMemo(() => {
    const ids = [...new Set((data ?? []).filter((o) => o.status === 'completed').map((o) => o.merchant_id))];
    return ids.map((id) => stores.find((s) => s.id === id)).filter(Boolean).slice(0, 4) as Storefront[];
  }, [data, stores]);
  if (status !== 'signed_in' || again.length === 0) return null;
  return (
    <section aria-labelledby="again-heading">
      <SectionHeading id="again-heading" title="Order again" />
      <div className="divide-y divide-line sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 sm:divide-y-0 lg:grid-cols-4">
        {again.map((s) => (
          <StoreEntry key={s.id} store={s} />
        ))}
      </div>
    </section>
  );
}

function StoreGrid({ stores }: { stores: Storefront[] }) {
  return (
    <div className="divide-y divide-line sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-4">
      {stores.map((s) => (
        <StoreEntry key={s.id} store={s} />
      ))}
    </div>
  );
}

function StoreListSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading stores" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-4 sm:block">
          <Skeleton className="size-20 sm:aspect-[16/10] sm:h-auto sm:w-full" />
          <div className="flex-1 space-y-2 sm:pt-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const loc = useLocationContext();
  const [filter, setFilter] = useState<Filter>('all');
  const [pickArea, setPickArea] = useState(false);
  const stores = useStorefronts(loc.area?.id ?? null);

  const filtered = useMemo(() => {
    const list = stores.data ?? [];
    if (filter === 'all') return list;
    if (filter === 'food') return list.filter((s) => FOOD_CATEGORIES.includes(s.category));
    if (filter === 'shops') return list.filter((s) => SHOP_CATEGORIES.includes(s.category));
    return list.filter((s) => s.category === filter);
  }, [stores.data, filter]);
  const open = filtered.filter((s) => s.state === 'open');
  const later = filtered.filter((s) => s.state !== 'open');
  const categories = [...new Set((stores.data ?? []).map((s) => s.category))];

  return (
    <div className="page-x mx-auto max-w-7xl space-y-8 pt-4 pb-8 lg:space-y-12 lg:pt-8">
      <div className="space-y-4 lg:hidden">
        <AddressButton />
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="flex h-11 w-full items-center gap-2.5 rounded-control bg-canvas px-3 text-left text-ink-3"
        >
          <Search className="size-4" aria-hidden /> Search stores and dishes
        </button>
      </div>

      <ActiveOrders />

      <ServiceShortcuts filter={filter} onFilter={setFilter} />

      {loc.ready && !loc.area ? (
        <EmptyState
          title="Choose where you are"
          action={<Button onClick={() => setPickArea(true)}>Choose area</Button>}
        >
          GETGO works with local stores area by area. Pick yours to see who delivers to you.
        </EmptyState>
      ) : (
        <>
          <Promotions />
          {stores.data && <OrderAgain stores={stores.data} />}

          <section aria-labelledby="stores-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h1 id="stores-heading" className="text-title font-bold lg:text-display">
                {loc.area ? `Stores in ${loc.area.name}` : 'Stores'}
              </h1>
            </div>
            {categories.length > 1 && (
              <Tabs
                label="Store category"
                value={filter}
                onChange={setFilter}
                items={[
                  { value: 'all' as Filter, label: 'All' },
                  ...categories.map((c) => ({ value: c as Filter, label: CATEGORY_LABELS[c] })),
                ]}
              />
            )}

            {stores.isPending ? (
              <StoreListSkeleton />
            ) : stores.isError ? (
              <ErrorState error={stores.error} onRetry={() => stores.refetch()} />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={stores.data?.length ? 'Nothing here yet' : `No stores are live in ${loc.area?.name} yet`}
                action={
                  <ButtonLink to="/partner" variant="secondary">
                    Know a store? Invite them to GETGO
                  </ButtonLink>
                }
              >
                {stores.data?.length ? 'Try another category.' : 'We’re onboarding local partners. Check back soon.'}
              </EmptyState>
            ) : (
              <div className="space-y-10">
                {open.length > 0 && <StoreGrid stores={open} />}
                {later.length > 0 && (
                  <div>
                    <h2 className="mb-2 text-heading font-semibold text-ink-2">
                      {open.length ? 'Closed for now' : 'All stores are closed right now'}
                    </h2>
                    <StoreGrid stores={later} />
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {loc.ready && loc.area && (
        <p className="text-small text-ink-3">
          Orders in {loc.area.name}: {formatMoney(loc.area.delivery_fee_minor)} delivery
          {loc.area.service_fee_minor > 0 && ` + ${formatMoney(loc.area.service_fee_minor)} service fee`}. Every fee is shown before you
          place your order.
        </p>
      )}
      <AddressSheet open={pickArea} onClose={() => setPickArea(false)} />
    </div>
  );
}
