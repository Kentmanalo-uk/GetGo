import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Package, Search, ShoppingBasket, UtensilsCrossed, ListChecks } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocationContext } from '@/features/location/LocationProvider';
import { AddressButton } from '@/app/layouts/ConsumerLayout';
import { AddressSheet } from '@/features/location/AddressSheet';
import { Sheet } from '@/components/ui/Sheet';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { SectionHeading, Tabs } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { customerStatusLabel } from '@/domain/orderStatus';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS, FOOD_CATEGORIES, SHOP_CATEGORIES, type MerchantCategory, type Promotion, type Storefront } from '@/types/models';
import { useHomeFeed, useMyOrders, usePublicPromotions, useStorefronts } from './api';
import { AllItems, FeaturedItems, ITEM_GRID, StoreRow } from './homeSections';
import { StoreEntry } from './storeDisplay';

type Filter = 'all' | 'food' | 'shops' | MerchantCategory;

const UNAVAILABLE_SERVICES = {
  padala: {
    title: 'Padala',
    body: 'Padala sends parcels and documents across town. It isn’t available in this area yet — we’ll announce it when it launches here.',
  },
  errands: {
    title: 'Errands',
    body: 'Errands — buying things not on GETGO, paying bills, picking things up — aren’t available in this area yet. We’ll announce them when they launch here.',
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
            <span className="block font-semibold">{customerStatusLabel(order.status, order.service)}</span>
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

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Desktop-only welcome: a short greeting and the four services as icons in a
 * line-separated row. Phones use the compact shortcut row instead; search
 * lives in the desktop header.
 */
function DesktopHero({ onFilter }: { onFilter: (f: Filter) => void }) {
  const { profile } = useAuth();
  const { area } = useLocationContext();
  const navigate = useNavigate();
  const toStores = (f: Filter) => {
    onFilter(f);
    document.getElementById('stores-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const services = [
    { key: 'food', label: 'Food', icon: UtensilsCrossed, available: true, go: () => toStores('food') },
    { key: 'shops', label: 'Shops', icon: ShoppingBasket, available: true, go: () => toStores('shops') },
    { key: 'padala', label: 'Padala', icon: Package, available: area?.padala_enabled ?? true, go: () => navigate('/padala') },
    { key: 'errands', label: 'Errands', icon: ListChecks, available: area?.errands_enabled ?? true, go: () => navigate('/errands') },
  ];
  const firstName = profile?.full_name?.split(' ')[0];
  return (
    <section aria-labelledby="hero-heading" className="hidden items-center justify-between gap-10 border-b border-line pt-2 pb-10 lg:flex">
      <div>
        <p className="text-small font-semibold text-accent-ink">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h2 id="hero-heading" className="mt-1 text-[2.5rem] leading-tight font-extrabold tracking-tight">
          What do you need today?
        </h2>
      </div>
      <div className="flex divide-x divide-line">
        {services.map(({ key, label, icon: Icon, available, go }) => (
          <button
            key={key}
            type="button"
            onClick={go}
            disabled={!available}
            title={available ? undefined : 'Not available in your area yet'}
            className="group flex w-28 flex-col items-center gap-2 py-1 disabled:cursor-not-allowed disabled:opacity-50 xl:w-32"
          >
            <Icon className={cx('size-11 transition-transform group-hover:scale-110 motion-reduce:transition-none', ICON_GRADIENT)} weight="fill" aria-hidden />
            <span className="font-semibold group-hover:text-accent-ink">{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ServiceShortcuts({ filter, onFilter }: { filter: Filter; onFilter: (f: Filter) => void }) {
  const [info, setInfo] = useState<keyof typeof UNAVAILABLE_SERVICES | null>(null);
  const navigate = useNavigate();
  const { area } = useLocationContext();
  // Padala and errands open their request pages; admins can switch them off per area.
  const items = [
    { key: 'food', label: 'Food', icon: UtensilsCrossed, available: true },
    { key: 'shops', label: 'Shops', icon: ShoppingBasket, available: true },
    { key: 'padala', label: 'Padala', icon: Package, available: area?.padala_enabled ?? true },
    { key: 'errands', label: 'Errands', icon: ListChecks, available: area?.errands_enabled ?? true },
  ] as const;
  const open = (key: (typeof items)[number]['key'], available: boolean) => {
    if (key === 'padala' || key === 'errands') {
      if (available) navigate(`/${key}`);
      else setInfo(key);
      return;
    }
    onFilter(filter === key ? 'all' : key);
  };
  return (
    <>
      <nav aria-label="Services" className="grid grid-cols-4 gap-1 sm:flex sm:gap-8">
        {items.map(({ key, label, icon: Icon, available }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => open(key, available)}
              aria-pressed={key === 'food' || key === 'shops' ? active : undefined}
              className="group flex flex-col items-center gap-1 py-1 sm:flex-row sm:gap-2.5"
            >
              {/* Filled pink-gradient icons; the selected filter is marked on its label. */}
              <Icon
                className={cx('size-10 transition-transform group-hover:scale-105 motion-reduce:transition-none sm:size-9', ICON_GRADIENT)}
                weight="fill"
                aria-hidden
              />
              <span
                className={cx(
                  'text-small font-semibold',
                  !available ? 'text-ink-4' : active ? 'text-accent-ink underline decoration-2 underline-offset-4' : 'text-ink',
                )}
              >
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
        title={info ? `${UNAVAILABLE_SERVICES[info].title} isn’t available here yet` : ''}
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
      <ul className="grid gap-3 sm:grid-cols-3">
        {data.map((p) => (
          <li key={p.id} className="border-l-2 border-accent-strong py-1 pl-3">
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
          <StoreEntry key={s.id} store={s} showState={false} />
        ))}
      </div>
    </section>
  );
}

function StoreGrid({ stores }: { stores: Storefront[] }) {
  return (
    <div className="divide-y divide-line sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-4">
      {stores.map((s) => (
        <StoreEntry key={s.id} store={s} showState={false} />
      ))}
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading items">
      <Skeleton className="h-5 w-40" />
      <div className={ITEM_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={i >= 4 ? 'space-y-2 max-sm:hidden' : 'space-y-2'}>
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
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
  const feed = useHomeFeed(loc.area?.id ?? null);
  /** The Food / Shops shortcuts and category tabs filter items and stores alike. */
  const matches = ({ merchant_category: c }: { merchant_category: MerchantCategory }) =>
    filter === 'all' || (filter === 'food' ? FOOD_CATEGORIES.includes(c) : filter === 'shops' ? SHOP_CATEGORIES.includes(c) : c === filter);

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

      <DesktopHero onFilter={setFilter} />

      <div className="lg:hidden">
        <ServiceShortcuts filter={filter} onFilter={setFilter} />
      </div>

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
              <h1 id="stores-heading" className="scroll-mt-24 text-title font-bold lg:text-display">
                {loc.area ? `Stores in ${loc.area.name}` : 'Stores'}
              </h1>
              {(filter === 'food' || filter === 'shops') && (
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="hidden items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-small font-semibold text-accent-ink hover:bg-accent-soft/70 lg:inline-flex"
                  aria-label={`Showing ${filter === 'food' ? 'food' : 'shops'} only. Show all stores`}
                >
                  {filter === 'food' ? 'Food' : 'Shops'} <span aria-hidden>×</span>
                </button>
              )}
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
                {stores.data?.length ? 'Try another category.' : 'We’re adding stores in your area. Check back soon.'}
              </EmptyState>
            ) : (
              // Open stores first; whether a store can order right now is shown on its page.
              <StoreGrid stores={[...open, ...later]} />
            )}
          </section>

          {/* Featured items below the stores; the full lists are on Explore. */}
          {feed.isPending ? (
            <ItemsSkeleton />
          ) : (
            feed.data && (
              <>
                <FeaturedItems id="popular-heading" section="popular" title={`Popular in ${loc.area?.name ?? 'your area'}`} items={feed.data.popular.filter(matches)} />
                <FeaturedItems id="meals-heading" section="meals" title="Meals and snacks" items={feed.data.meals.filter(matches)} />
                <FeaturedItems id="essentials-heading" section="essentials" title="Groceries and essentials" items={feed.data.essentials.filter(matches)} />
                <StoreRow id="new-stores-heading" title="New on GETGO" stores={feed.data.new_stores.filter((s) => matches({ merchant_category: s.category }))} />
              </>
            )
          )}
          {loc.area && <AllItems areaId={loc.area.id} filter={matches} />}
        </>
      )}

      {loc.ready && loc.area && (
        <p className="text-small text-ink-3">
          Delivery in {loc.area.name} is priced by barangay
          {loc.area.service_fee_minor > 0 && `, plus a ${formatMoney(loc.area.service_fee_minor)} service fee`}. Your exact fee is shown at
          checkout before you place your order.
        </p>
      )}
      <AddressSheet open={pickArea} onClose={() => setPickArea(false)} />
    </div>
  );
}
