import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ChevronRight } from '@/components/icons';
import { ButtonLink, IconButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { MediaImage, StoreMark } from '@/components/ui/Display';
import { useProduct, useStorefront } from './api';
import { useProductCustomizer } from './ProductSheet';

/**
 * Item page (/stores/:slug/items/:productId).
 * Phones: a slim top bar, the photo, details and choices, with quantity and
 * Add fixed to the bottom. Desktop: photo and details side by side, the photo
 * staying in view while the choices scroll.
 */
export default function ProductPage() {
  const { slug, productId } = useParams();
  const navigate = useNavigate();
  const store = useStorefront(slug);
  const product = useProduct(productId);
  const storePath = `/stores/${slug}`;
  const p = product.data && store.data && product.data.merchant_id === store.data.id ? product.data : null;
  const customizer = useProductCustomizer({
    product: p,
    active: Boolean(p),
    storeOpen: store.data?.state === 'open',
    onDone: () => navigate(storePath),
  });

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(storePath));

  const topBar = (
    <header className="safe-top sticky top-0 z-20 bg-surface/95 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center px-2">
        <IconButton label="Back" onClick={back}>
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
      </div>
    </header>
  );

  if (store.isPending || product.isPending) {
    return (
      <>
        {topBar}
        <div className="page-x mx-auto max-w-7xl pt-2 lg:pt-10">
          <PageLoading rows={3} />
        </div>
      </>
    );
  }
  if (store.isError || product.isError) {
    return (
      <>
        {topBar}
        <ErrorState className="page-x mx-auto max-w-7xl" error={store.error ?? product.error} onRetry={() => void Promise.all([store.refetch(), product.refetch()])} />
      </>
    );
  }
  if (!p || !store.data || !customizer) {
    return (
      <>
        {topBar}
        <div className="page-x mx-auto max-w-3xl pt-6">
          <EmptyState
            title="This item isn’t available"
            action={
              <ButtonLink to={store.data ? storePath : '/'} variant="secondary">
                {store.data ? `Back to ${store.data.name}` : 'Browse stores'}
              </ButtonLink>
            }
          >
            It may have been removed from the menu.
          </EmptyState>
        </div>
      </>
    );
  }

  const s = store.data;

  return (
    <div className="pb-48 lg:pb-16">
      {topBar}

      <div className="page-x mx-auto max-w-7xl pt-2 sm:pt-4 lg:pt-10">
        <nav aria-label="Breadcrumb" className="mb-6 hidden min-w-0 items-center gap-2 text-small text-ink-3 lg:flex">
          <button type="button" onClick={back} className="inline-flex items-center gap-1.5 font-semibold text-ink-2 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </button>
          <span aria-hidden>/</span>
          <Link to={storePath} className="hover:text-ink hover:underline">
            {s.name}
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate text-ink">{p.name}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-14 xl:grid-cols-[minmax(0,1fr)_30rem] xl:gap-20">
          {/* A thin frame so photos shot on white still read as a picture. */}
          <div className="overflow-hidden rounded-sheet border border-line lg:sticky lg:top-24">
            {p.image_path ? (
              <MediaImage path={p.image_path} alt={p.name} eager className="aspect-[4/3] w-full lg:aspect-[5/4]" />
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center bg-canvas lg:aspect-[5/4]">
                <StoreMark name={s.name} logoPath={s.logo_path} size="lg" />
              </div>
            )}
          </div>

          <div className="mt-6 min-w-0 lg:mt-2">
            <Link to={storePath} className="group inline-flex max-w-full items-center gap-2.5">
              <StoreMark name={s.name} logoPath={s.logo_path} size="sm" />
              <span className="truncate text-small font-semibold text-ink-2 group-hover:text-ink group-hover:underline">{s.name}</span>
              <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
            </Link>

            <h1 className="mt-5 text-title leading-tight font-bold text-balance lg:text-display">{p.name}</h1>
            <p className="tabular mt-2 text-heading font-bold text-accent-ink">{customizer.priceLabel}</p>
            {p.description && <p className="mt-4 max-w-prose leading-relaxed text-ink-2">{p.description}</p>}

            <div className="mt-8 border-t border-line">{customizer.options}</div>

            <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-3 backdrop-blur lg:sticky lg:bottom-6 lg:mt-6 lg:rounded-sheet lg:border lg:bg-surface lg:p-5 lg:shadow-pop">
              {customizer.actions}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
