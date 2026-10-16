import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError } from '@/components/ui/Feedback';
import { ChoiceRow, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { PageHeader, StatusText, Tabs, formatDateTime } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney, formatPercentFromBps, parsePesos, toPesoInput } from '@/domain/money';
import {
  bpsToPercentInput,
  redemptionCount,
  useDeletePromotion,
  useMerchantOptions,
  usePermissions,
  usePromotions,
  useSavePromotion,
  useSetPromotionActive,
  type PromotionRow,
  type PromotionTab,
} from './api';
import { DataTable, ListSkeleton, LoadMore, RoleNote, fromManilaInput, toManilaInput, type StatusTone } from './ui';

const TABS: Array<{ value: PromotionTab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

function describeDiscount(p: Pick<PromotionRow, 'discount_type' | 'value' | 'max_discount_minor' | 'min_subtotal_minor'>): string {
  const base =
    p.discount_type === 'percent'
      ? `${formatPercentFromBps(p.value)} off${p.max_discount_minor ? ` up to ${formatMoney(p.max_discount_minor)}` : ''}`
      : p.discount_type === 'fixed'
        ? `${formatMoney(p.value)} off`
        : 'Free delivery';
  return p.min_subtotal_minor > 0 ? `${base} · min ${formatMoney(p.min_subtotal_minor)}` : base;
}

function promoState(p: PromotionRow, now = Date.now()): { label: string; tone: StatusTone } {
  if (!p.is_active) return { label: 'Inactive', tone: 'muted' };
  if (new Date(p.starts_at).getTime() > now) return { label: 'Scheduled', tone: 'progress' };
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return { label: 'Ended', tone: 'muted' };
  if (p.usage_limit != null && redemptionCount(p) >= p.usage_limit) return { label: 'Used up', tone: 'muted' };
  return { label: 'Live', tone: 'done' };
}

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z0-9]{3,20}$/.test(v), 'Use 3–20 letters and numbers, no spaces.'),
    title: z.string().trim().min(3, 'Enter a title of at least 3 characters.').max(80),
    description: z.string().trim().max(300),
    scope: z.enum(['platform', 'merchant']),
    merchant_id: z.string(),
    discount_type: z.enum(['percent', 'fixed', 'free_delivery']),
    value: z.string().trim(),
    max_discount: z.string().trim(),
    min_subtotal: z.string().trim().refine((v) => v === '' || parsePesos(v) != null, 'Enter an amount like 300, or leave blank.'),
    starts_at: z.string().min(1, 'Choose when it starts.'),
    ends_at: z.string(),
    usage_limit: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0), 'Enter a whole number, or leave blank for no limit.'),
    per_user_limit: z.string().trim().refine((v) => /^\d+$/.test(v) && Number(v) > 0, 'Enter 1 or more.'),
    is_active: z.boolean(),
    is_public: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'merchant' && !v.merchant_id) ctx.addIssue({ code: 'custom', path: ['merchant_id'], message: 'Choose the store.' });
    if (v.discount_type === 'percent') {
      const n = Number(v.value);
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v.value) || n <= 0 || n > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a percentage from 0.01 to 100.' });
    } else if (v.discount_type === 'fixed') {
      const minor = parsePesos(v.value);
      if (minor == null || minor <= 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount like 50.' });
    }
    if (v.max_discount) {
      const minor = parsePesos(v.max_discount);
      if (minor == null || minor <= 0) ctx.addIssue({ code: 'custom', path: ['max_discount'], message: 'Enter an amount like 100, or leave blank.' });
    }
    const start = fromManilaInput(v.starts_at);
    if (!start) ctx.addIssue({ code: 'custom', path: ['starts_at'], message: 'Choose a valid start.' });
    if (v.ends_at) {
      const end = fromManilaInput(v.ends_at);
      if (!end || (start && end <= start)) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'The end must be after the start.' });
    }
  });
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

function PromotionForm({ promo, onDone }: { promo: PromotionRow | null; onDone: () => void }) {
  const merchants = useMerchantOptions();
  const save = useSavePromotion();
  const toast = useToast();
  const used = promo ? redemptionCount(promo) : 0;
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: promo
      ? {
          code: promo.code,
          title: promo.title,
          description: promo.description ?? '',
          scope: promo.merchant_id ? 'merchant' : 'platform',
          merchant_id: promo.merchant_id ?? '',
          discount_type: promo.discount_type,
          value:
            promo.discount_type === 'percent' ? bpsToPercentInput(promo.value) : promo.discount_type === 'fixed' ? toPesoInput(promo.value) : '',
          max_discount: toPesoInput(promo.max_discount_minor),
          min_subtotal: promo.min_subtotal_minor ? toPesoInput(promo.min_subtotal_minor) : '',
          starts_at: toManilaInput(promo.starts_at),
          ends_at: toManilaInput(promo.ends_at),
          usage_limit: promo.usage_limit?.toString() ?? '',
          per_user_limit: String(promo.per_user_limit),
          is_active: promo.is_active,
          is_public: promo.is_public,
        }
      : {
          code: '',
          title: '',
          description: '',
          scope: 'platform',
          merchant_id: '',
          discount_type: 'percent',
          value: '',
          max_discount: '',
          min_subtotal: '',
          starts_at: toManilaInput(new Date().toISOString()),
          ends_at: '',
          usage_limit: '',
          per_user_limit: '1',
          is_active: true,
          is_public: true,
        },
  });
  const errors = form.formState.errors;
  const scope = form.watch('scope');
  const type = form.watch('discount_type');

  const onSubmit = form.handleSubmit(async (v) => {
    const value = v.discount_type === 'percent' ? Math.round(Number(v.value) * 100) : v.discount_type === 'fixed' ? parsePesos(v.value)! : 0;
    try {
      await save.mutateAsync({
        id: promo?.id,
        code: v.code,
        title: v.title,
        description: v.description || null,
        merchant_id: v.scope === 'merchant' ? v.merchant_id : null,
        discount_type: v.discount_type,
        value,
        max_discount_minor: v.discount_type === 'percent' && v.max_discount ? parsePesos(v.max_discount) : null,
        min_subtotal_minor: v.min_subtotal ? parsePesos(v.min_subtotal)! : 0,
        starts_at: fromManilaInput(v.starts_at)!,
        ends_at: v.ends_at ? fromManilaInput(v.ends_at) : null,
        usage_limit: v.usage_limit ? Number(v.usage_limit) : null,
        per_user_limit: Number(v.per_user_limit),
        is_active: v.is_active,
        is_public: v.is_public,
      });
      toast(promo ? 'Promotion saved' : 'Promotion created');
      onDone();
    } catch {
      /* shown inline */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          error={errors.code?.message}
          hint={used > 0 ? `Locked — used on ${used} ${used === 1 ? 'order' : 'orders'}.` : 'Customers type this at checkout.'}
        >
          {(p) => (
            <Input
              {...p}
              autoCapitalize="characters"
              autoComplete="off"
              readOnly={used > 0}
              className="font-mono uppercase"
              {...form.register('code')}
            />
          )}
        </Field>
        <Field label="Title" error={errors.title?.message}>
          {(p) => <Input {...p} placeholder="₱50 off your first order" {...form.register('title')} />}
        </Field>
      </div>
      <Field label="Description" optional error={errors.description?.message}>
        {(p) => <Textarea {...p} rows={2} maxLength={300} {...form.register('description')} />}
      </Field>

      <fieldset>
        <legend className="mb-1 text-small font-semibold">Applies to</legend>
        <Controller
          control={form.control}
          name="scope"
          render={({ field }) => (
            <div className="divide-y divide-line">
              <ChoiceRow type="radio" name="scope" checked={field.value === 'platform'} onChange={() => field.onChange('platform')} label="All stores" />
              <ChoiceRow type="radio" name="scope" checked={field.value === 'merchant'} onChange={() => field.onChange('merchant')} label="One store" />
            </div>
          )}
        />
      </fieldset>
      {scope === 'merchant' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store" error={errors.merchant_id?.message}>
            {(p) => (
              <Select {...p} {...form.register('merchant_id')} disabled={merchants.isPending}>
                <option value="">{merchants.isPending ? 'Loading stores…' : 'Choose a store'}</option>
                {merchants.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.status !== 'active' ? ` (${m.status})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      <fieldset>
        <legend className="mb-1 text-small font-semibold">Discount</legend>
        <Controller
          control={form.control}
          name="discount_type"
          render={({ field }) => (
            <div className="divide-y divide-line">
              <ChoiceRow type="radio" name="discount_type" checked={field.value === 'percent'} onChange={() => field.onChange('percent')} label="Percent off the subtotal" />
              <ChoiceRow type="radio" name="discount_type" checked={field.value === 'fixed'} onChange={() => field.onChange('fixed')} label="Fixed amount off" />
              <ChoiceRow type="radio" name="discount_type" checked={field.value === 'free_delivery'} onChange={() => field.onChange('free_delivery')} label="Free delivery" />
            </div>
          )}
        />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        {type !== 'free_delivery' && (
          <Field label={type === 'percent' ? 'Percent' : 'Amount'} error={errors.value?.message}>
            {(p) =>
              type === 'percent' ? (
                <div className="relative">
                  <Input {...p} inputMode="decimal" className="pr-8" {...form.register('value')} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-3">%</span>
                </div>
              ) : (
                <Input {...p} prefix="₱" inputMode="decimal" {...form.register('value')} />
              )
            }
          </Field>
        )}
        {type === 'percent' && (
          <Field label="Maximum discount" optional error={errors.max_discount?.message}>
            {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('max_discount')} />}
          </Field>
        )}
        <Field label="Minimum subtotal" optional error={errors.min_subtotal?.message}>
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('min_subtotal')} />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" error={errors.starts_at?.message} hint="Philippine time.">
          {(p) => <Input {...p} type="datetime-local" {...form.register('starts_at')} />}
        </Field>
        <Field label="Ends" optional error={errors.ends_at?.message}>
          {(p) => <Input {...p} type="datetime-local" {...form.register('ends_at')} />}
        </Field>
        <Field label="Total uses" optional error={errors.usage_limit?.message} hint={used > 0 ? `${used} used so far.` : 'Across all customers.'}>
          {(p) => <Input {...p} inputMode="numeric" {...form.register('usage_limit')} />}
        </Field>
        <Field label="Uses per customer" error={errors.per_user_limit?.message}>
          {(p) => <Input {...p} inputMode="numeric" {...form.register('per_user_limit')} />}
        </Field>
      </div>

      <div className="divide-y divide-line border-y border-line">
        <Controller
          control={form.control}
          name="is_active"
          render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Active" description="Inactive codes are rejected at checkout." />}
        />
        <Controller
          control={form.control}
          name="is_public"
          render={({ field }) => (
            <Switch checked={field.value} onChange={field.onChange} label="Show to customers" description="Listed on the home page. Turn off for codes you share privately." />
          )}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {promo ? 'Save promotion' : 'Create promotion'}
        </Button>
      </div>
    </form>
  );
}

export default function PromotionsPage() {
  const perms = usePermissions();
  const [tab, setTab] = useState<PromotionTab>('active');
  const list = usePromotions(tab);
  const setActive = useSetPromotionActive();
  const remove = useDeletePromotion();
  const toast = useToast();
  const [editing, setEditing] = useState<PromotionRow | 'new' | null>(null);
  const [pending, setPending] = useState<{ promo: PromotionRow; action: 'deactivate' | 'activate' | 'delete' } | null>(null);

  const actions = (p: PromotionRow) =>
    perms.canConfigure ? (
      <span className="flex flex-wrap justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
          Edit
        </Button>
        {p.is_active ? (
          <Button size="sm" variant="ghost" onClick={() => setPending({ promo: p, action: 'deactivate' })}>
            Deactivate
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setPending({ promo: p, action: 'activate' })}>
            Activate
          </Button>
        )}
        {redemptionCount(p) === 0 && (
          <Button size="sm" variant="danger-quiet" onClick={() => setPending({ promo: p, action: 'delete' })}>
            Delete
          </Button>
        )}
      </span>
    ) : null;

  const mutation = pending?.action === 'delete' ? remove : setActive;

  return (
    <div>
      <PageHeader
        title="Promotions"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} disabled={!perms.canConfigure} onClick={() => setEditing('new')}>
            New promotion
          </Button>
        }
      />
      {!perms.canConfigure && <RoleNote className="-mt-2 mb-4">Only administrators can create or change promotions.</RoleNote>}
      <Tabs label="Promotion status" value={tab} onChange={setTab} items={TABS} className="mb-4" />
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title={tab === 'inactive' ? 'No inactive promotions' : 'No promotions yet'} icon={<Tag className="size-8" />}>
          {tab !== 'inactive' && 'Create a code for a launch, a partner store, or a free-delivery weekend.'}
        </EmptyState>
      ) : (
        <>
          <DataTable
            label="Promotions"
            rows={list.items}
            rowKey={(p) => p.id}
            columns={[
              {
                header: 'Code',
                cell: (p) => (
                  <span>
                    <span className="block font-mono font-semibold">{p.code}</span>
                    <span className="block text-small text-ink-3">{p.title}</span>
                  </span>
                ),
              },
              { header: 'Discount', cell: (p) => <span className="text-small">{describeDiscount(p)}</span> },
              {
                header: 'Scope',
                cell: (p) => (
                  <span className="text-small">
                    {p.merchants?.name ?? 'All stores'}
                  </span>
                ),
              },
              {
                header: 'Runs',
                cell: (p) => (
                  <span className="text-small text-ink-2">
                    {formatDateTime(p.starts_at)}
                    <span className="block">{p.ends_at ? `to ${formatDateTime(p.ends_at)}` : 'No end date'}</span>
                  </span>
                ),
              },
              { header: 'Used', align: 'right', cell: (p) => `${redemptionCount(p)}${p.usage_limit ? ` / ${p.usage_limit}` : ''}` },
              {
                header: 'Status',
                cell: (p) => {
                  const s = promoState(p);
                  return (
                    <span>
                      <StatusText tone={s.tone}>{s.label}</StatusText>
                      {!p.is_public && <span className="block text-micro text-ink-3">Private code</span>}
                    </span>
                  );
                },
              },
              { header: <span className="sr-only">Actions</span>, align: 'right', cell: actions },
            ]}
            mobile={(p) => {
              const s = promoState(p);
              return (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold">{p.code}</p>
                      <p className="text-small text-ink-2">{p.title}</p>
                    </div>
                    <StatusText tone={s.tone}>{s.label}</StatusText>
                  </div>
                  <p className="text-small text-ink-3">
                    {describeDiscount(p)} · {p.merchants?.name ?? 'All stores'} · used {redemptionCount(p)}
                    {p.usage_limit ? ` of ${p.usage_limit}` : ''}
                  </p>
                  {actions(p)}
                </div>
              );
            }}
          />
          <LoadMore paged={list} />
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? `Edit ${editing.code}` : 'New promotion'} size="lg">
        {editing !== null && <PromotionForm key={editing === 'new' ? 'new' : editing.id} promo={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>

      {pending && (
        <ConfirmDialog
          open
          onClose={() => {
            setPending(null);
            setActive.reset();
            remove.reset();
          }}
          tone={pending.action === 'activate' ? 'primary' : 'danger'}
          title={
            pending.action === 'delete' ? `Delete ${pending.promo.code}?` : pending.action === 'deactivate' ? `Deactivate ${pending.promo.code}?` : `Activate ${pending.promo.code}?`
          }
          body={
            pending.action === 'delete'
              ? 'It has never been used, so it can be removed completely.'
              : pending.action === 'deactivate'
                ? 'Customers can no longer apply this code. Orders that already used it keep their discount.'
                : 'Customers can apply this code again while it is within its dates and limits.'
          }
          confirmLabel={pending.action === 'delete' ? 'Delete' : pending.action === 'deactivate' ? 'Deactivate' : 'Activate'}
          loading={mutation.isPending}
          error={mutation.error ? <FormError error={mutation.error} /> : null}
          onConfirm={async () => {
            if (pending.action === 'delete') await remove.mutateAsync(pending.promo.id);
            else await setActive.mutateAsync({ id: pending.promo.id, active: pending.action === 'activate' });
            toast(pending.action === 'delete' ? 'Promotion deleted' : pending.action === 'deactivate' ? 'Promotion deactivated' : 'Promotion activated');
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
