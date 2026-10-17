import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { DataRow, PageHeader, SectionHeading, formatDate } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { HoursEditor } from '@/components/HoursEditor';
import { ImageUpload } from '@/components/ImageUpload';
import { formatTime, validateHours, type HoursEntry } from '@/domain/hours';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import { CATEGORY_LABELS, type Merchant } from '@/types/models';
import { useMerchantContext } from './MerchantLayout';
import { StoreStatusControl } from './StoreStatusControl';
import { StoreLocation } from './StoreLocation';
import { useHourExceptions, useMerchant, useReplaceHours, useSetPublished, useStoreHoursAdmin, useUpdateMerchant } from './api';

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter the store name.').max(120),
  description: z.string().trim().max(600),
  phone: z.string().trim().max(20),
  min_order: z.string().trim().refine((v) => v === '' || parsePesos(v) !== null, 'Enter an amount like 150.'),
});

function ProfileForm({ merchant, readOnly }: { merchant: Merchant; readOnly: boolean }) {
  const update = useUpdateMerchant(merchant.id);
  const toast = useToast();
  const form = useForm<z.input<typeof profileSchema>, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: merchant.name,
      description: merchant.description ?? '',
      phone: merchant.phone ?? '',
      min_order: merchant.min_order_minor ? toPesoInput(merchant.min_order_minor) : '',
    },
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((v) =>
        update
          .mutateAsync({
            name: v.name,
            description: v.description || null,
            phone: v.phone || null,
            min_order_minor: v.min_order ? parsePesos(v.min_order)! : 0,
          })
          .then(() => toast('Store details saved'), () => undefined),
      )}
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <FormError error={update.error} />
        <Field label="Store name" error={e.name?.message}>
          {(p) => <Input {...p} {...form.register('name')} />}
        </Field>
        <Field label="Description" optional error={e.description?.message}>
          {(p) => <Textarea {...p} maxLength={600} {...form.register('description')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store phone" optional hint="Riders may call if an item is out." error={e.phone?.message}>
            {(p) => <Input {...p} type="tel" {...form.register('phone')} />}
          </Field>
          <Field label="Minimum order" optional error={e.min_order?.message}>
            {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('min_order')} />}
          </Field>
        </div>
        {!readOnly && (
          <Button type="submit" loading={update.isPending}>
            Save details
          </Button>
        )}
      </fieldset>
    </form>
  );
}

function Branding({ merchant, readOnly }: { merchant: Merchant; readOnly: boolean }) {
  const update = useUpdateMerchant(merchant.id);
  const toast = useToast();
  if (readOnly) return null;
  const save = (patch: Partial<Merchant>) => update.mutateAsync(patch).then(() => toast('Saved'), () => undefined);
  return (
    <div className="space-y-6">
      <ImageUpload label="Logo" prefix={`merchants/${merchant.id}/branding`} value={merchant.logo_path} onChange={(logo_path) => save({ logo_path })} />
      <ImageUpload label="Cover photo" aspect="wide" prefix={`merchants/${merchant.id}/branding`} value={merchant.cover_path} onChange={(cover_path) => save({ cover_path })} />
      {update.error && <Notice tone="danger">{userMessage(update.error)}</Notice>}
    </div>
  );
}

function Hours({ merchantId, readOnly }: { merchantId: string; readOnly: boolean }) {
  const hours = useStoreHoursAdmin(merchantId);
  const replace = useReplaceHours(merchantId);
  const exceptions = useHourExceptions(merchantId);
  const toast = useToast();
  const [value, setValue] = useState<HoursEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exDate, setExDate] = useState('');
  const [exClosed, setExClosed] = useState(true);
  const [exOpens, setExOpens] = useState('09:00');
  const [exCloses, setExCloses] = useState('17:00');
  const [exNote, setExNote] = useState('');

  useEffect(() => {
    if (hours.data && value === null) setValue(hours.data.hours);
  }, [hours.data, value]);

  if (hours.isPending || value === null) return <PageLoading rows={2} />;
  if (hours.isError) return <ErrorState error={hours.error} onRetry={() => hours.refetch()} />;

  return (
    <div className="space-y-8">
      {readOnly ? (
        <p className="text-ink-3">Only owners and managers can change opening hours.</p>
      ) : (
        <div className="space-y-4">
          <HoursEditor value={value} onChange={setValue} error={error} />
          {replace.error && <Notice tone="danger">{userMessage(replace.error)}</Notice>}
          <Button
            loading={replace.isPending}
            onClick={() => {
              const problem = value.length === 0 ? 'Open at least one day.' : validateHours(value);
              setError(problem);
              if (!problem) replace.mutateAsync(value).then(() => toast('Hours saved'), () => undefined);
            }}
          >
            Save hours
          </Button>
        </div>
      )}

      <div>
        <h3 className="mb-1 font-semibold">Holidays and special hours</h3>
        <p className="mb-3 text-small text-ink-3">These override your weekly hours for a single day.</p>
        {hours.data.exceptions.length > 0 && (
          <ul className="mb-4 divide-y divide-line border-y border-line text-small">
            {hours.data.exceptions.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{formatDate(x.date)}</span>
                  <span className="text-ink-3"> · {x.is_closed ? 'Closed' : `${formatTime(x.opens_at!)} – ${formatTime(x.closes_at!)}`}</span>
                  {x.note && <span className="text-ink-3"> · {x.note}</span>}
                </span>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => exceptions.remove.mutate(x.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!exDate) return;
              exceptions.add
                .mutateAsync({ date: exDate, is_closed: exClosed, opens_at: exClosed ? null : exOpens, closes_at: exClosed ? null : exCloses, note: exNote.trim() || null })
                .then(() => {
                  setExDate('');
                  setExNote('');
                }, () => undefined);
            }}
          >
            <Field label="Date">{(p) => <Input {...p} type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className="w-44" />}</Field>
            <label className="flex h-11 items-center gap-2">
              <input type="checkbox" className="size-5 accent-ink" checked={exClosed} onChange={(e) => setExClosed(e.target.checked)} />
              Closed all day
            </label>
            {!exClosed && (
              <>
                <Field label="Opens">{(p) => <Input {...p} type="time" value={exOpens} onChange={(e) => setExOpens(e.target.value)} className="w-32" />}</Field>
                <Field label="Closes">{(p) => <Input {...p} type="time" value={exCloses} onChange={(e) => setExCloses(e.target.value)} className="w-32" />}</Field>
              </>
            )}
            <Field label="Note" optional>
              {(p) => <Input {...p} value={exNote} onChange={(e) => setExNote(e.target.value)} placeholder="Town fiesta" maxLength={120} />}
            </Field>
            <Button type="submit" variant="secondary" loading={exceptions.add.isPending} disabled={!exDate}>
              Add
            </Button>
          </form>
        )}
        {(exceptions.add.error || exceptions.remove.error) && (
          <Notice tone="danger" className="mt-3">
            {userMessage(exceptions.add.error ?? exceptions.remove.error)}
          </Notice>
        )}
      </div>
    </div>
  );
}

export default function StoreSettingsPage() {
  const { merchantId, canManage } = useMerchantContext();
  const merchant = useMerchant(merchantId);
  const publish = useSetPublished(merchantId);
  const toast = useToast();
  const [unpublishing, setUnpublishing] = useState(false);

  if (merchant.isPending) return <PageLoading />;
  if (merchant.isError) return <ErrorState error={merchant.error} onRetry={() => merchant.refetch()} />;
  const m = merchant.data;

  return (
    <div className="space-y-12">
      <PageHeader title="Store settings">
        {m.is_published ? (
          <>
            Live at{' '}
            <Link to={`/stores/${m.slug}`} className="underline underline-offset-4">
              /stores/{m.slug}
            </Link>
          </>
        ) : (
          'Not published — customers can’t see your store yet.'
        )}
      </PageHeader>

      {m.status !== 'active' && <Notice tone="danger">This store is {m.status} by GETGO. Contact support for details.</Notice>}

      <section aria-labelledby="status-heading" className="space-y-4">
        <SectionHeading id="status-heading" title="Status" />
        <StoreStatusControl merchant={m} />
        {canManage && (
          <div className="space-y-2">
            {m.is_published ? (
              <Button variant="danger-quiet" className="-ml-4" onClick={() => setUnpublishing(true)}>
                Unpublish store
              </Button>
            ) : (
              <Button loading={publish.isPending} disabled={m.status !== 'active'} onClick={() => publish.mutateAsync(true).then(() => toast('Your store is live'), () => undefined)}>
                Publish store
              </Button>
            )}
            {publish.error && <Notice tone="danger">{userMessage(publish.error)}</Notice>}
          </div>
        )}
      </section>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="details-heading">
          <SectionHeading id="details-heading" title="Details" />
          <ProfileForm key={m.id} merchant={m} readOnly={!canManage} />
        </section>
        <section aria-labelledby="branding-heading" className="space-y-6">
          <SectionHeading id="branding-heading" title="Branding" />
          <Branding merchant={m} readOnly={!canManage} />
          <dl className="border-t border-line pt-4 text-small">
            <DataRow label="Category">{CATEGORY_LABELS[m.category]}</DataRow>
            <DataRow label="Address">
              {m.address_line}, {m.barangay}
            </DataRow>
            <DataRow label="Minimum order">{m.min_order_minor ? formatMoney(m.min_order_minor) : 'None'}</DataRow>
          </dl>
          <p className="text-small text-ink-3">To change your category or address, contact GETGO support.</p>
          <StoreLocation merchant={m} readOnly={!canManage} />
        </section>
      </div>

      <section id="hours" aria-labelledby="hours-heading" className="scroll-mt-20">
        <SectionHeading id="hours-heading" title="Opening hours" />
        <Hours merchantId={m.id} readOnly={!canManage} />
      </section>

      <ConfirmDialog
        open={unpublishing}
        onClose={() => setUnpublishing(false)}
        title="Unpublish your store?"
        body="Customers won’t find your store or be able to order. Orders in progress are not affected. To stop orders for a short time, pause instead."
        confirmLabel="Unpublish"
        loading={publish.isPending}
        onConfirm={async () => {
          await publish.mutateAsync(false);
          setUnpublishing(false);
          toast('Store unpublished');
        }}
      />
    </div>
  );
}
