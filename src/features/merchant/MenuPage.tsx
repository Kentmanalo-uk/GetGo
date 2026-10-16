import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { MediaImage, PageHeader, Tabs } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { lowestPrice } from '@/domain/customization';
import { formatMoney } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import type { Category, ProductRow } from '@/types/models';
import { useMerchantContext } from './MerchantLayout';
import { useCategoryMutations, useMerchant, useMerchantCatalog, useSetPublished, useSetProductAvailability } from './api';
import { useToast } from '@/components/ui/Toast';

type Filter = 'all' | 'published' | 'draft' | 'sold_out' | 'archived';

function AvailabilityToggle({ product }: { product: ProductRow }) {
  const { merchantId } = useMerchantContext();
  const set = useSetProductAvailability(merchantId);
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-small">
      <span className={product.is_available ? 'text-ink-2' : 'font-semibold text-danger'}>{product.is_available ? 'Available' : 'Sold out'}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={`${product.name} available`}
        checked={product.is_available}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ productId: product.id, available: e.target.checked })}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'relative inline-flex h-6 w-10 items-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ink',
          product.is_available ? 'bg-ink' : 'bg-line-strong',
        )}
      >
        <span className={cx('inline-block size-4 rounded-full bg-white transition-transform', product.is_available ? 'translate-x-5' : 'translate-x-1')} />
      </span>
    </label>
  );
}

function CategoriesSheet({ open, onClose, categories, products }: { open: boolean; onClose: () => void; categories: Category[]; products: ProductRow[] }) {
  const { merchantId } = useMerchantContext();
  const m = useCategoryMutations(merchantId);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const error = m.create.error ?? m.rename.error ?? m.remove.error ?? m.reorder.error;

  const move = (index: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    m.reorder.mutate(ids);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Menu sections">
      <div className="space-y-4">
        {error && <Notice tone="danger">{userMessage(error)}</Notice>}
        <ul className="divide-y divide-line border-y border-line">
          {categories.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              {editing?.id === c.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    m.rename.mutateAsync({ id: c.id, name: editing.name }).then(() => setEditing(null), () => undefined);
                  }}
                >
                  <Input aria-label="Section name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} autoFocus />
                  <Button type="submit" size="sm" loading={m.rename.isPending}>
                    Save
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1">
                    {c.name} <span className="text-small text-ink-3">· {products.filter((p) => p.category_id === c.id).length} items</span>
                  </span>
                  <IconButton label={`Move ${c.name} up`} disabled={i === 0 || m.reorder.isPending} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton label={`Move ${c.name} down`} disabled={i === categories.length - 1 || m.reorder.isPending} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ id: c.id, name: c.name })}>
                    Rename
                  </Button>
                  <Button variant="danger-quiet" size="sm" onClick={() => setDeleting(c)}>
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) m.create.mutateAsync(name).then(() => setName(''), () => undefined);
          }}
        >
          <Input aria-label="New section name" placeholder="New section, e.g. Rice meals" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button type="submit" variant="secondary" loading={m.create.isPending} disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        body="Items in this section are kept and moved to “More items”."
        confirmLabel="Delete section"
        loading={m.remove.isPending}
        onConfirm={async () => {
          await m.remove.mutateAsync(deleting!.id);
          setDeleting(null);
        }}
      />
    </Sheet>
  );
}

/** Shown until the store is live: what's missing, and the publish action. */
function PublishBanner() {
  const { merchantId, canManage } = useMerchantContext();
  const merchant = useMerchant(merchantId);
  const catalog = useMerchantCatalog(merchantId);
  const publish = useSetPublished(merchantId);
  const toast = useToast();
  const m = merchant.data;
  if (!m || m.is_published || !catalog.data) return null;
  const hasLive = catalog.data.products.some((p) => p.status === 'published');
  return (
    <Notice
      tone={m.status === 'active' ? 'success' : 'danger'}
      className="mt-5"
      title={m.status === 'active' ? 'Your store isn’t live yet' : `This store is ${m.status}`}
      action={
        canManage &&
        m.status === 'active' && (
          <Button size="sm" variant="dark" disabled={!hasLive} loading={publish.isPending} onClick={() => publish.mutateAsync(true).then(() => toast('Your store is live'), () => undefined)}>
            Publish store
          </Button>
        )
      }
    >
      {m.status !== 'active'
        ? 'Contact GETGO support to reactivate it.'
        : hasLive
          ? 'Customers will see your products once you publish. Check your hours in Store first.'
          : 'Review your products, set prices and mark at least one as live, then publish.'}
      {publish.error && <span className="mt-1 block font-semibold">{userMessage(publish.error)}</span>}
    </Notice>
  );
}

export default function MerchantMenuPage() {
  const { merchantId, canManage } = useMerchantContext();
  const catalog = useMerchantCatalog(merchantId);
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as Filter) || 'all';
  const [search, setSearch] = useState('');
  const [sectionsOpen, setSectionsOpen] = useState(false);

  const products = useMemo(() => {
    const all = catalog.data?.products ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (filter === 'published') return p.status === 'published';
      if (filter === 'draft') return p.status === 'draft';
      if (filter === 'archived') return p.status === 'archived';
      if (filter === 'sold_out') return p.status !== 'archived' && !p.is_available;
      return p.status !== 'archived';
    });
  }, [catalog.data, filter, search]);

  if (catalog.isPending) return <PageLoading />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;
  const { categories } = catalog.data;
  const sections = [
    ...categories.map((c) => ({ id: c.id, name: c.name, items: products.filter((p) => p.category_id === c.id) })),
    { id: 'none', name: 'More items', items: products.filter((p) => !p.category_id) },
  ].filter((s) => s.items.length > 0);
  const count = (f: Filter) =>
    (catalog.data.products ?? []).filter((p) =>
      f === 'draft' ? p.status === 'draft' : f === 'sold_out' ? p.status !== 'archived' && !p.is_available : f === 'archived' ? p.status === 'archived' : false,
    ).length;

  return (
    <div>
      <PublishBanner />
      <PageHeader
        title="Products"
        actions={
          canManage && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setSectionsOpen(true)}>
                Sections
              </Button>
              <ButtonLink to="/merchant/menu/new" size="sm" className="hidden sm:inline-flex">
                <Plus className="size-4" aria-hidden /> Add item
              </ButtonLink>
            </>
          )
        }
      />
      <Tabs
        label="Filter items"
        value={filter}
        onChange={(f) => setParams(f === 'all' ? {} : { filter: f }, { replace: true })}
        items={[
          { value: 'all' as Filter, label: 'All' },
          { value: 'published' as Filter, label: 'Live' },
          { value: 'draft' as Filter, label: 'Drafts', count: count('draft') },
          { value: 'sold_out' as Filter, label: 'Sold out', count: count('sold_out') },
          { value: 'archived' as Filter, label: 'Archived' },
        ]}
      />
      <div className="relative mt-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
          className="h-10 w-full rounded-control border border-line-strong pr-3 pl-9 focus:border-ink focus:ring-2 focus:ring-accent focus:outline-none"
        />
      </div>

      {sections.length === 0 ? (
        <EmptyState
          title={catalog.data.products.length === 0 ? 'Your menu is empty' : 'No items match'}
          action={canManage && catalog.data.products.length === 0 ? <ButtonLink to="/merchant/menu/new">Add your first item</ButtonLink> : undefined}
        />
      ) : (
        sections.map((s) => (
          <section key={s.id} aria-labelledby={`sec-${s.id}`} className="pt-6">
            <h2 id={`sec-${s.id}`} className="text-small font-bold tracking-wide text-ink-3 uppercase">
              {s.name}
            </h2>
            <ul className="divide-y divide-line">
              {s.items.map((p) => (
                <li key={p.id} className="flex items-center gap-4 py-3">
                  <MediaImage path={p.image_path} alt="" className="size-14 shrink-0 rounded-media" />
                  <div className="min-w-0 flex-1">
                    {canManage ? (
                      <Link to={`/merchant/menu/${p.id}`} className="font-semibold hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <p className="font-semibold">{p.name}</p>
                    )}
                    <p className="text-small text-ink-3">
                      <span className="tabular">
                        {p.product_variants.length > 1 ? 'From ' : ''}
                        {formatMoney(lowestPrice({ base_price_minor: p.base_price_minor, variants: p.product_variants }))}
                      </span>
                      {p.product_option_groups.length > 0 && ` · ${p.product_option_groups.length} option groups`}
                      {p.status !== 'published' && <span className="font-semibold text-ink-2"> · {p.status === 'draft' ? 'Draft — hidden' : 'Archived'}</span>}
                    </p>
                  </div>
                  {p.status !== 'archived' && <AvailabilityToggle product={p} />}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canManage && (
        <ButtonLink to="/merchant/menu/new" size="lg" className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 shadow-pop sm:hidden">
          <Plus className="size-5" aria-hidden /> Add item
        </ButtonLink>
      )}
      <CategoriesSheet open={sectionsOpen} onClose={() => setSectionsOpen(false)} categories={categories} products={catalog.data.products} />
    </div>
  );
}
