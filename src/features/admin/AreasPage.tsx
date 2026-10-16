import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError } from '@/components/ui/Feedback';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { PageHeader, StatusText } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { usePsgcMunicipalities, usePsgcProvinces } from '@/lib/psgc';
import type { ServiceArea } from '@/types/models';
import { useAllServiceAreas, useDeleteServiceArea, usePermissions, useSaveServiceArea } from './api';
import { DataTable, ListSkeleton, RoleNote } from './ui';

const peso = z
  .string()
  .trim()
  .refine((v) => parsePesos(v) != null, 'Enter an amount like 49 or 49.50.');
const optionalPeso = z
  .string()
  .trim()
  .refine((v) => v === '' || parsePesos(v) != null, 'Enter an amount like 150, or leave blank.');

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter the area name.').max(80),
    city: z.string().trim().min(2, 'Enter the city or municipality.').max(80),
    province: z.string().trim().min(2, 'Enter the province.').max(80),
    is_active: z.boolean(),
    delivery_fee: peso,
    service_fee: peso,
    small_order_threshold: optionalPeso,
    small_order_fee: peso,
    typical_delivery_minutes: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 5 && Number(v) <= 120), 'Enter 5 to 120 minutes, or leave blank.'),
  })
  .superRefine((v, ctx) => {
    const threshold = v.small_order_threshold ? parsePesos(v.small_order_threshold) : null;
    const fee = parsePesos(v.small_order_fee) ?? 0;
    if (threshold === 0) ctx.addIssue({ code: 'custom', path: ['small_order_threshold'], message: 'Leave blank for no small-order fee.' });
    if (fee > 0 && threshold == null) {
      ctx.addIssue({ code: 'custom', path: ['small_order_threshold'], message: 'Set the subtotal the fee applies under.' });
    }
  });
type FormValues = z.infer<typeof schema>;

function AreaForm({ area, onDone }: { area: ServiceArea | null; onDone: () => void }) {
  const save = useSaveServiceArea();
  const remove = useDeleteServiceArea();
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Official PSGC location (optional): lets customers pick barangays from the official list.
  const [provinceCode, setProvinceCode] = useState<string | null>(area?.province_code ?? null);
  const [psgcCode, setPsgcCode] = useState<string | null>(area?.psgc_code ?? null);
  const provinces = usePsgcProvinces();
  const municipalities = usePsgcMunicipalities(provinceCode);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: area?.name ?? '',
      city: area?.city ?? '',
      province: area?.province ?? '',
      is_active: area?.is_active ?? false,
      delivery_fee: toPesoInput(area?.delivery_fee_minor ?? null),
      service_fee: toPesoInput(area?.service_fee_minor ?? 0),
      small_order_threshold: toPesoInput(area?.small_order_threshold_minor ?? null),
      small_order_fee: toPesoInput(area?.small_order_fee_minor ?? 0),
      typical_delivery_minutes: area?.typical_delivery_minutes?.toString() ?? '',
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: area?.id,
        name: v.name,
        city: v.city,
        province: v.province,
        is_active: v.is_active,
        delivery_fee_minor: parsePesos(v.delivery_fee)!,
        service_fee_minor: parsePesos(v.service_fee)!,
        small_order_threshold_minor: v.small_order_threshold ? parsePesos(v.small_order_threshold) : null,
        small_order_fee_minor: parsePesos(v.small_order_fee)!,
        typical_delivery_minutes: v.typical_delivery_minutes ? Number(v.typical_delivery_minutes) : null,
        psgc_code: psgcCode,
        province_code: psgcCode ? provinceCode : null,
      });
      toast(area ? 'Area saved' : 'Area added');
      onDone();
    } catch {
      /* shown inline */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Province" hint="From the official PSGC list.">
          {(p) => (
            <Select
              {...p}
              value={provinceCode ?? ''}
              disabled={provinces.isPending || provinces.isError}
              onChange={(e) => {
                const code = e.target.value || null;
                setProvinceCode(code);
                setPsgcCode(null);
                form.setValue('province', provinces.data?.find((x) => x.code === code)?.name ?? '');
              }}
            >
              <option value="">{provinces.isError ? 'List unavailable — type below' : provinces.isPending ? 'Loading…' : 'Choose province'}</option>
              {provinces.data?.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="City or municipality" hint="Customers then pick their barangay from this town’s list.">
          {(p) => (
            <Select
              {...p}
              value={psgcCode ?? ''}
              disabled={!provinceCode || municipalities.isPending}
              onChange={(e) => {
                const town = municipalities.data?.find((x) => x.code === e.target.value);
                setPsgcCode(town?.code ?? null);
                if (town) {
                  form.setValue('city', town.name);
                  if (!form.getValues('name')) form.setValue('name', town.name);
                }
              }}
            >
              <option value="">{provinceCode ? 'Choose city or municipality' : 'Choose a province first'}</option>
              {municipalities.data?.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Area name" error={errors.name?.message} hint="Shown to customers, e.g. “Tagum City”.">
        {(p) => <Input {...p} {...form.register('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City name" error={errors.city?.message} hint="Filled from the list; edit if needed.">
          {(p) => <Input {...p} {...form.register('city')} />}
        </Field>
        <Field label="Province name" error={errors.province?.message}>
          {(p) => <Input {...p} {...form.register('province')} />}
        </Field>
        <Field label="Delivery fee" error={errors.delivery_fee?.message}>
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('delivery_fee')} />}
        </Field>
        <Field label="Service fee" error={errors.service_fee?.message} hint="Per order. Use 0 for none.">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('service_fee')} />}
        </Field>
        <Field label="Small-order threshold" optional error={errors.small_order_threshold?.message} hint="Orders under this subtotal pay the small-order fee.">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('small_order_threshold')} />}
        </Field>
        <Field label="Small-order fee" error={errors.small_order_fee?.message}>
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" {...form.register('small_order_fee')} />}
        </Field>
        <Field label="Typical delivery time" optional error={errors.typical_delivery_minutes?.message} hint="Minutes, shown on store pages.">
          {(p) => <Input {...p} inputMode="numeric" {...form.register('typical_delivery_minutes')} />}
        </Field>
      </div>
      <Controller
        control={form.control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onChange={field.onChange}
            label="Open to customers"
            description="Customers can browse and order in this area. Stores here are only listed while it’s on."
          />
        )}
      />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center">
        {area && (
          <Button variant="danger-quiet" className="sm:mr-auto" onClick={() => setDeleteOpen(true)}>
            Delete area
          </Button>
        )}
        <Button variant="secondary" onClick={onDone} disabled={save.isPending} className={area ? undefined : 'sm:ml-auto'}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {area ? 'Save area' : 'Add area'}
        </Button>
      </div>
      {area && (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => {
            setDeleteOpen(false);
            remove.reset();
          }}
          title={`Delete ${area.name}?`}
          body="Only areas that no store, rider, address or order uses can be deleted. To stop service, turn the area off instead."
          confirmLabel="Delete area"
          loading={remove.isPending}
          error={remove.error ? <FormError error={remove.error} /> : null}
          onConfirm={async () => {
            await remove.mutateAsync(area.id);
            toast('Area deleted');
            setDeleteOpen(false);
            onDone();
          }}
        />
      )}
    </form>
  );
}

export default function AreasPage() {
  const perms = usePermissions();
  const areas = useAllServiceAreas();
  const [editing, setEditing] = useState<ServiceArea | 'new' | null>(null);

  const smallOrder = (a: ServiceArea) =>
    a.small_order_threshold_minor && a.small_order_fee_minor > 0
      ? `${formatMoney(a.small_order_fee_minor)} under ${formatMoney(a.small_order_threshold_minor)}`
      : 'None';

  return (
    <div>
      <PageHeader
        title="Areas & fees"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} disabled={!perms.canConfigure} onClick={() => setEditing('new')}>
            Add area
          </Button>
        }
      />
      {!perms.canConfigure && <RoleNote className="-mt-2 mb-4">Only administrators can change areas and fees.</RoleNote>}
      {areas.isPending ? (
        <ListSkeleton rows={3} />
      ) : areas.isError ? (
        <ErrorState error={areas.error} onRetry={() => areas.refetch()} />
      ) : areas.data.length === 0 ? (
        <EmptyState title="No service areas yet" icon={<MapPin className="size-8" />}>
          Add the first area GETGO serves. Stores, riders and customer addresses all belong to an area.
        </EmptyState>
      ) : (
        <DataTable
          label="Service areas"
          rows={areas.data}
          rowKey={(a) => a.id}
          columns={[
            {
              header: 'Area',
              cell: (a) => (
                <span>
                  <span className="block font-semibold">{a.name}</span>
                  <span className="block text-small text-ink-3">
                    {a.city}, {a.province}
                  </span>
                </span>
              ),
            },
            { header: 'Status', cell: (a) => <StatusText tone={a.is_active ? 'done' : 'muted'}>{a.is_active ? 'Open' : 'Off'}</StatusText> },
            { header: 'Delivery fee', align: 'right', cell: (a) => formatMoney(a.delivery_fee_minor) },
            { header: 'Service fee', align: 'right', cell: (a) => formatMoney(a.service_fee_minor) },
            { header: 'Small-order fee', align: 'right', cell: smallOrder },
            { header: 'Typical time', align: 'right', cell: (a) => (a.typical_delivery_minutes ? `${a.typical_delivery_minutes} min` : '—') },
            {
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (a) =>
                perms.canConfigure ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                    Edit
                  </Button>
                ) : null,
            },
          ]}
          mobile={(a) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-small text-ink-3">
                    {a.city}, {a.province}
                  </p>
                </div>
                <StatusText tone={a.is_active ? 'done' : 'muted'}>{a.is_active ? 'Open' : 'Off'}</StatusText>
              </div>
              <p className="tabular text-small text-ink-2">
                Delivery {formatMoney(a.delivery_fee_minor)} · Service {formatMoney(a.service_fee_minor)} · Small order {smallOrder(a)}
                {a.typical_delivery_minutes ? ` · ~${a.typical_delivery_minutes} min` : ''}
              </p>
              {perms.canConfigure && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                  Edit
                </Button>
              )}
            </div>
          )}
        />
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? `Edit ${editing.name}` : 'Add area'} size="lg">
        {editing !== null && <AreaForm key={editing === 'new' ? 'new' : editing.id} area={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
