import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Eye, X } from '@/components/icons';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { ImageUpload } from '@/components/ImageUpload';
import { describeGroupRule } from '@/domain/customization';
import { formatDelta, parsePesos, toPesoInput } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import { ProductSheet } from '@/features/consumer/ProductSheet';
import type { ProductRow, ProductStatus } from '@/types/models';
import { useMerchantContext } from './MerchantLayout';
import { useCategoryMutations, useMerchantCatalog, useSaveProduct, useSetProductStatus, type ProductInput } from './api';

interface VariantDraft {
  id?: string;
  name: string;
  price: string;
  is_available: boolean;
}

interface Draft {
  name: string;
  description: string;
  category_id: string;
  image_path: string | null;
  price: string;
  hasSizes: boolean;
  variants: VariantDraft[];
  is_available: boolean;
  max_per_order: string;
  group_ids: string[];
}

function toDraft(p: ProductRow | undefined): Draft {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    category_id: p?.category_id ?? '',
    image_path: p?.image_path ?? null,
    price: toPesoInput(p?.base_price_minor),
    hasSizes: (p?.product_variants.length ?? 0) > 0,
    variants: p?.product_variants.length
      ? [...p.product_variants].sort((a, b) => a.sort_order - b.sort_order).map((v) => ({ id: v.id, name: v.name, price: toPesoInput(v.price_minor), is_available: v.is_available }))
      : [
          { name: 'Regular', price: '', is_available: true },
          { name: 'Large', price: '', is_available: true },
        ],
    is_available: p?.is_available ?? true,
    max_per_order: String(p?.max_per_order ?? 20),
    group_ids: p ? [...p.product_option_groups].sort((a, b) => a.sort_order - b.sort_order).map((g) => g.group_id) : [],
  };
}

type Errors = Partial<Record<'name' | 'price' | 'variants' | 'max', string>>;

function validate(d: Draft): { errors: Errors; input?: Omit<ProductInput, 'status' | 'id'> } {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Enter a name.';
  const max = Number(d.max_per_order);
  if (!Number.isInteger(max) || max < 1 || max > 99) errors.max = 'Use a number from 1 to 99.';
  let base = parsePesos(d.price);
  const variants: ProductInput['variants'] = [];
  if (d.hasSizes) {
    const names = new Set<string>();
    for (const v of d.variants) {
      const price = parsePesos(v.price);
      if (!v.name.trim() || price === null) {
        errors.variants = 'Each size needs a name and a price.';
        break;
      }
      if (names.has(v.name.trim().toLowerCase())) {
        errors.variants = 'Size names must be different.';
        break;
      }
      names.add(v.name.trim().toLowerCase());
      variants.push({ id: v.id, name: v.name.trim(), price_minor: price, is_available: v.is_available });
    }
    if (variants.length === 0 && !errors.variants) errors.variants = 'Add at least one size, or turn off sizes.';
    base = variants.length ? Math.min(...variants.map((v) => v.price_minor)) : 0;
  } else if (base === null) {
    errors.price = 'Enter a price like 120 or 99.50.';
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      name: d.name.trim(),
      description: d.description.trim(),
      category_id: d.category_id || null,
      image_path: d.image_path,
      base_price_minor: base ?? 0,
      is_available: d.is_available,
      max_per_order: max,
      variants,
      option_group_ids: d.group_ids,
    },
  };
}

export default function ProductEditorPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { merchantId, canManage, basePath } = useMerchantContext();
  const catalog = useMerchantCatalog(merchantId);
  const save = useSaveProduct(merchantId);
  const setStatus = useSetProductStatus(merchantId);
  const categories = useCategoryMutations(merchantId);
  const existing = catalog.data?.products.find((p) => p.id === productId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [newCategory, setNewCategory] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (catalog.data && !draft) setDraft(toDraft(existing));
  }, [catalog.data, existing, draft]);

  const groups = catalog.data?.groups ?? [];
  const previewProduct = useMemo<ProductRow | null>(() => {
    if (!draft) return null;
    const v = validate(draft);
    return {
      id: existing?.id ?? 'preview',
      merchant_id: merchantId,
      category_id: draft.category_id || null,
      name: draft.name || 'Untitled item',
      description: draft.description || null,
      image_path: draft.image_path,
      base_price_minor: v.input?.base_price_minor ?? parsePesos(draft.price) ?? 0,
      status: 'draft',
      is_available: draft.is_available,
      max_per_order: Number(draft.max_per_order) || 20,
      sort_order: 0,
      updated_at: '',
      product_variants: draft.hasSizes
        ? draft.variants.map((x, i) => ({ id: x.id ?? `v${i}`, product_id: 'preview', name: x.name || `Size ${i + 1}`, price_minor: parsePesos(x.price) ?? 0, is_available: x.is_available, sort_order: i }))
        : [],
      product_option_groups: draft.group_ids.map((id, i) => ({ sort_order: i, group_id: id, option_groups: groups.find((g) => g.id === id) ?? null })),
    };
  }, [draft, groups, existing, merchantId]);

  if (!canManage) return <EmptyState title="Only owners and managers can edit the menu" action={<Link to={basePath} className="font-semibold underline">Back to products</Link>} />;
  if (catalog.isPending || !draft) return <PageLoading />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;
  if (productId && !existing) return <EmptyState title="Item not found" action={<Link to={basePath} className="font-semibold underline">Back to products</Link>} />;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setVariant = (i: number, patch: Partial<VariantDraft>) => set({ variants: draft.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const moveGroup = (i: number, dir: -1 | 1) => {
    const ids = [...draft.group_ids];
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    set({ group_ids: ids });
  };

  const submit = async (status: ProductStatus) => {
    const v = validate(draft);
    setErrors(v.errors);
    if (!v.input) return;
    try {
      const id = await save.mutateAsync({ ...v.input, id: existing?.id, status });
      toast(status === 'published' ? 'Saved — visible to customers' : 'Saved as draft');
      if (!existing) navigate(`${basePath}/menu/${id}`, { replace: true });
      setDraft(null); // reload from server
    } catch {
      /* shown below */
    }
  };

  const currentStatus = existing?.status ?? 'draft';

  return (
    <div className="pb-28 sm:pb-10">
      <PageHeader
        title={existing ? existing.name : 'New item'}
        back={basePath}
        actions={
          <Button variant="secondary" size="sm" icon={<Eye className="size-4" aria-hidden />} onClick={() => setPreviewing(true)}>
            Preview
          </Button>
        }
      >
        {existing && (currentStatus === 'published' ? 'Live on your store' : currentStatus === 'draft' ? 'Draft — not visible to customers' : 'Archived')}
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />}
          </Field>
          <Field label="Description" optional hint="What’s in it, portion size, spice level.">
            {(p) => <Textarea {...p} value={draft.description} onChange={(e) => set({ description: e.target.value })} maxLength={600} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Menu section" optional>
              {(p) => (
                <Select {...p} value={draft.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                  <option value="">No section</option>
                  {catalog.data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCategory.trim()) return;
                categories.create.mutateAsync(newCategory).then((c) => {
                  set({ category_id: c.id });
                  setNewCategory('');
                }, () => undefined);
              }}
            >
              <Field label="Or create a section" optional className="flex-1">
                {(p) => <Input {...p} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={60} />}
              </Field>
              <Button type="submit" variant="secondary" loading={categories.create.isPending} disabled={!newCategory.trim()}>
                Add
              </Button>
            </form>
          </div>
          {categories.create.error && <Notice tone="danger">{userMessage(categories.create.error)}</Notice>}

          <section aria-labelledby="price-heading" className="space-y-3 border-t border-line pt-6">
            <h2 id="price-heading" className="font-semibold">
              Price
            </h2>
            <Switch label="This item comes in sizes" description="Customers must choose one size; each size has its own price." checked={draft.hasSizes} onChange={(hasSizes) => set({ hasSizes })} />
            {draft.hasSizes ? (
              <div className="space-y-2">
                {draft.variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input aria-label={`Size ${i + 1} name`} value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="Size name" maxLength={60} />
                    <Input aria-label={`Size ${i + 1} price`} prefix="₱" inputMode="decimal" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} className="w-28" />
                    <label className="flex shrink-0 items-center gap-1.5 text-small">
                      <input type="checkbox" className="size-4 accent-ink" checked={v.is_available} onChange={(e) => setVariant(i, { is_available: e.target.checked })} />
                      In stock
                    </label>
                    <IconButton label={`Remove size ${v.name || i + 1}`} disabled={draft.variants.length === 1} onClick={() => set({ variants: draft.variants.filter((_, j) => j !== i) })}>
                      <X className="size-4" />
                    </IconButton>
                  </div>
                ))}
                {errors.variants && <p className="text-small text-danger">{errors.variants}</p>}
                {draft.variants.length < 8 && (
                  <Button variant="ghost" size="sm" onClick={() => set({ variants: [...draft.variants, { name: '', price: '', is_available: true }] })}>
                    Add size
                  </Button>
                )}
              </div>
            ) : (
              <Field label="Price" error={errors.price}>
                {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} className="max-w-40" />}
              </Field>
            )}
          </section>

          <section aria-labelledby="options-heading" className="space-y-3 border-t border-line pt-6">
            <div className="flex items-baseline justify-between">
              <h2 id="options-heading" className="font-semibold">
                Choices (sizes of rice, drinks, add-ons)
              </h2>
              <Link to={`${basePath}/options`} className="text-small font-semibold underline underline-offset-4">
                Manage choices
              </Link>
            </div>
            {groups.length === 0 ? (
              <p className="text-small text-ink-3">
                Create option groups such as “Choice of drink” or “Add-ons” once, then attach them to any item.
              </p>
            ) : (
              <>
                {draft.group_ids.length > 0 && (
                  <ol className="divide-y divide-line border-y border-line">
                    {draft.group_ids.map((id, i) => {
                      const g = groups.find((x) => x.id === id);
                      if (!g) return null;
                      return (
                        <li key={id} className="flex items-center gap-2 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{g.name}</span>
                            <span className="block truncate text-small text-ink-3">
                              {describeGroupRule({ ...g, values: [] })} ·{' '}
                              {g.option_values.map((v) => `${v.name}${v.price_delta_minor ? ` ${formatDelta(v.price_delta_minor)}` : ''}`).join(', ')}
                            </span>
                          </span>
                          <IconButton label={`Move ${g.name} up`} disabled={i === 0} onClick={() => moveGroup(i, -1)}>
                            <ArrowUp className="size-4" />
                          </IconButton>
                          <IconButton label={`Move ${g.name} down`} disabled={i === draft.group_ids.length - 1} onClick={() => moveGroup(i, 1)}>
                            <ArrowDown className="size-4" />
                          </IconButton>
                          <IconButton label={`Remove ${g.name}`} onClick={() => set({ group_ids: draft.group_ids.filter((x) => x !== id) })}>
                            <X className="size-4" />
                          </IconButton>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {groups.some((g) => !draft.group_ids.includes(g.id)) && (
                  <div className="space-y-1">
                    <p className="text-small font-semibold text-ink-3">Attach a group</p>
                    {groups
                      .filter((g) => !draft.group_ids.includes(g.id))
                      .map((g) => (
                        <Checkbox
                          key={g.id}
                          checked={false}
                          onChange={() => set({ group_ids: [...draft.group_ids, g.id] })}
                          label={g.name}
                          description={describeGroupRule({ ...g, values: [] })}
                        />
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <ImageUpload label="Photo" prefix={`merchants/${merchantId}/products`} value={draft.image_path} onChange={(image_path) => set({ image_path })} hint="A clear, well-lit photo of the actual dish." />
          <Switch label="Available now" description="Turn off when sold out for the day." checked={draft.is_available} onChange={(is_available) => set({ is_available })} />
          <Field label="Most a customer can order" error={errors.max}>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={99} value={draft.max_per_order} onChange={(e) => set({ max_per_order: e.target.value })} className="max-w-28" />}
          </Field>
          {existing && currentStatus !== 'archived' && (
            <Button variant="danger-quiet" className="-ml-4" onClick={() => setArchiving(true)}>
              Archive item
            </Button>
          )}
          {existing && currentStatus === 'archived' && (
            <Button variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutateAsync({ productId: existing.id, status: 'draft' }).then(() => setDraft(null), () => undefined)}>
              Restore as draft
            </Button>
          )}
        </aside>
      </div>

      {(save.error || setStatus.error) && (
        <Notice tone="danger" className="mt-6">
          {userMessage(save.error ?? setStatus.error)}
        </Notice>
      )}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mt-8 sm:border-0 sm:p-0 lg:bottom-0">
        <Button variant="secondary" loading={save.isPending && save.variables?.status === 'draft'} onClick={() => submit('draft')}>
          {currentStatus === 'published' ? 'Unpublish' : 'Save draft'}
        </Button>
        <Button className="flex-1 sm:flex-none" loading={save.isPending && save.variables?.status === 'published'} onClick={() => submit('published')}>
          {currentStatus === 'published' ? 'Save changes' : 'Save and publish'}
        </Button>
      </div>

      <ProductSheet product={previewProduct} open={previewing} onClose={() => setPreviewing(false)} storeOpen preview />
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title="Archive this item?"
        body="It disappears from your menu and from customers’ carts at checkout. Past orders keep their records."
        confirmLabel="Archive"
        loading={setStatus.isPending}
        onConfirm={async () => {
          await setStatus.mutateAsync({ productId: existing!.id, status: 'archived' });
          setArchiving(false);
          navigate(basePath);
        }}
      />
    </div>
  );
}
