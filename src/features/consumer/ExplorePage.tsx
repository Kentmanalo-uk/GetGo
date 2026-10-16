import { useNavigate, useSearchParams } from 'react-router';
import { Search, ShoppingBasket } from '@/components/icons';
import { useLocationContext } from '@/features/location/LocationProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { PageHeader, Tabs } from '@/components/ui/Display';
import { useExploreItems, type ExploreSection } from './api';
import { ITEM_GRID, ItemCard } from './homeSections';

const SECTIONS: Array<{ value: ExploreSection; label: string }> = [
  { value: 'all', label: 'All items' },
  { value: 'popular', label: 'Popular' },
  { value: 'meals', label: 'Meals and snacks' },
  { value: 'essentials', label: 'Groceries and essentials' },
];

const EMPTY: Record<ExploreSection, string> = {
  all: 'Stores in your area haven’t listed items yet.',
  popular: 'Popular items appear once people start ordering in your area.',
  meals: 'No meals or snacks are listed in your area yet.',
  essentials: 'No groceries or essentials are listed in your area yet.',
};

/** Browse every item in the customer's area, top to bottom. */
export default function ExplorePage() {
  const navigate = useNavigate();
  const { area } = useLocationContext();
  const [params, setParams] = useSearchParams();
  const section = (SECTIONS.some((s) => s.value === params.get('section')) ? params.get('section') : 'all') as ExploreSection;
  const items = useExploreItems(area?.id ?? null, section);
  const list = items.data?.pages.flat() ?? [];

  return (
    <div className="page-x mx-auto max-w-7xl pb-10">
      <PageHeader title="Explore">{area ? `Everything you can order in ${area.name}` : 'Choose your area on the home page first.'}</PageHeader>

      <button
        type="button"
        onClick={() => navigate('/search')}
        className="mb-4 flex h-11 w-full items-center gap-2.5 rounded-control bg-canvas px-3 text-left text-ink-3 lg:max-w-md"
      >
        <Search className="size-4" aria-hidden /> Search stores and dishes
      </button>

      <Tabs
        label="Item sections"
        value={section}
        onChange={(value) => setParams(value === 'all' ? {} : { section: value }, { replace: true })}
        items={SECTIONS}
        className="mb-5"
      />

      {!area ? null : items.isPending ? (
        <div className={ITEM_GRID} role="status" aria-label="Loading items">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => items.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="Nothing here yet" icon={<ShoppingBasket className="size-8" />}>
          {EMPTY[section]}
        </EmptyState>
      ) : (
        <>
          <div className={ITEM_GRID}>
            {list.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
          {items.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <Button variant="secondary" loading={items.isFetchingNextPage} onClick={() => items.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
