import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ChevronRight } from '@/components/icons';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { MediaImage, StoreMark } from '@/components/ui/Display';
import { useProduct, useStorefront } from './api';
import { useProductCustomizer } from './ProductSheet';

/**
 * Item page (/stores/:slug/items/:productId): photo, details, sizes and
 * choices, with the quantity and Add button fixed to the bottom on phones.
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

  if (store.isPending || product.isPending) {
    return (
      <div className="page-x mx-auto max-w-6xl">
        <PageLoading rows={3} />
      </div>
    );
  }
  if (store.isError || product.isError) {
    return <ErrorState className="page-x mx-auto max-w-6xl" error={store.error ?? product.error} onRetry={() => void Promise.all([store.refetch(), product.refetch()])} />;
  }
  if (!p || !store.data || !customizer) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <EmptyState title="This item isn’t available" action={<ButtonLink to={store.data ? storePath : '/'} variant="secondary">{store.data ? `Back to ${store.data.name}` : 'Browse stores'}</ButtonLink>}>
          It may have been removed from the menu.
        </EmptyState>
      </div>
    );
  }

  const s = store.data;

  return (
    <div className="pb-44 lg:pb-12">
      <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:pt-8">
        <div className="relative lg:sticky lg:top-24 lg:self-start">
          {p.image_path ? (
            <MediaImage path={p.image_path} alt={p.name} eager className="aspect-[4/3] w-full lg:rounded-media" />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center bg-canvas lg:rounded-media">
              <StoreMark name={s.name} logoPath={s.logo_path} size="lg" />
            </div>
          )}
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-3 inline-flex size-10 items-center justify-center rounded-full bg-surface/95 shadow-pop lg:hidden"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        </div>

        <div className="page-x pt-5 lg:px-0 lg:pt-0">
          <button type="button" onClick={back} className="mb-4 hidden items-center gap-1.5 text-small font-semibold text-ink-2 hover:text-ink lg:inline-flex">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </button>
          <Link to={storePath} className="inline-flex items-center gap-1 text-small font-semibold text-ink-2 hover:text-ink hover:underline">
            {s.name} <ChevronRight className="size-3.5" aria-hidden />
          </Link>
          <h1 className="mt-1 text-title font-bold lg:text-display">{p.name}</h1>
          {p.description && <p className="mt-2 text-ink-2">{p.description}</p>}
          <p className="tabular mt-3 text-heading font-semibold">{customizer.priceLabel}</p>

          <div className="mt-4 border-t border-line">{customizer.options}</div>

          <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pt-3 pb-3 lg:static lg:mt-6 lg:border-0 lg:p-0">
            {customizer.actions}
          </div>
        </div>
      </div>
    </div>
  );
}
