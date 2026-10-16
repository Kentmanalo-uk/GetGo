import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from '@/components/icons';
import { useLocationContext } from '@/features/location/LocationProvider';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { MediaImage } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import { useCatalogSearch } from './api';
import { StoreEntry } from './storeDisplay';

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = useDebounced(text, 300);
  const { area } = useLocationContext();
  const results = useCatalogSearch(query, area?.id ?? null);

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, setParams]);

  const empty = results.data && results.data.stores.length === 0 && results.data.products.length === 0;

  return (
    <div className="page-x mx-auto max-w-5xl pt-4 lg:pt-8">
      <h1 className="sr-only">Search</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={area ? `Search in ${area.name}` : 'Search stores and dishes'}
          aria-label="Search stores and dishes"
          className="h-12 w-full rounded-control border border-line-strong bg-surface pr-3 pl-11 text-heading focus:border-ink focus:ring-2 focus:ring-accent focus:outline-none"
        />
      </div>

      <div className="py-6">
        {query.trim().length < 2 ? (
          <p className="text-ink-3">Search for a store, a dish like “sisig”, or a category like “bakery”.</p>
        ) : results.isPending ? (
          <PageLoading rows={3} />
        ) : results.isError ? (
          <ErrorState error={results.error} onRetry={() => results.refetch()} />
        ) : empty ? (
          <EmptyState title={`Nothing found for “${query}”`} icon={<Search className="size-8" />}>
            Check the spelling or try a broader word.
          </EmptyState>
        ) : (
          <div className="space-y-10" aria-live="polite">
            {results.data!.stores.length > 0 && (
              <section aria-labelledby="stores-results">
                <h2 id="stores-results" className="mb-2 text-heading font-semibold">
                  Stores
                </h2>
                <div className="divide-y divide-line sm:grid sm:grid-cols-2 sm:gap-6 sm:divide-y-0 lg:grid-cols-3">
                  {results.data!.stores.map((s) => (
                    <StoreEntry key={s.id} store={s} />
                  ))}
                </div>
              </section>
            )}
            {results.data!.products.length > 0 && (
              <section aria-labelledby="dishes-results">
                <h2 id="dishes-results" className="mb-2 text-heading font-semibold">
                  Dishes and items
                </h2>
                <ul className="divide-y divide-line">
                  {results.data!.products.map((p) => (
                    <li key={p.id}>
                      <Link to={`/stores/${p.merchant_slug}/items/${p.id}`} className="group flex items-center gap-4 py-3">
                        {p.image_path && <MediaImage path={p.image_path} alt="" className="size-16 shrink-0 rounded-media" />}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold group-hover:underline group-hover:underline-offset-4">{p.name}</p>
                          <p className="text-small text-ink-3">
                            {p.merchant_name}
                            {p.merchant_state !== 'open' && ' · Closed now'}
                          </p>
                        </div>
                        <span className="tabular shrink-0 text-small font-semibold">{p.is_available ? formatMoney(p.base_price_minor) : 'Sold out'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
