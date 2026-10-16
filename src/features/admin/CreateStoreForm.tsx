import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { FormError, Notice } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { HoursEditor } from '@/components/HoursEditor';
import { BarangayField } from '@/components/BarangayField';
import { validateHours, type HoursEntry } from '@/domain/hours';
import { CATEGORY_LABELS, type MerchantCategory } from '@/types/models';
import { useAllServiceAreas, useCreateStore } from './api';

const schema = z.object({
  ownerEmail: z.string().trim().email('Enter the owner’s email.'),
  name: z.string().trim().min(2, 'Enter the store name.').max(120),
  category: z.enum(['restaurant', 'cafe', 'bakery', 'grocery', 'convenience', 'specialty'], { message: 'Choose a category.' }),
  description: z.string().trim().max(600),
  phone: z.string().trim().max(20),
  address_line: z.string().trim().min(3, 'Enter the street address.').max(200),
  barangay: z.string().trim().min(2, 'Enter the barangay.').max(80),
  city: z.string().trim().min(2, 'Enter the city.').max(80),
  service_area_id: z.string().uuid('Choose the service area.'),
});

const DEFAULT_HOURS: HoursEntry[] = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '08:00', closes: '20:00' }));

/**
 * Admin creates a store for an owner email. If that email already has an
 * account it becomes the owner now; otherwise the owner signs up with that
 * email (choosing their own password) and the store is linked automatically.
 */
export function CreateStoreForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const areas = useAllServiceAreas();
  const create = useCreateStore();
  const [hours, setHours] = useState<HoursEntry[]>(DEFAULT_HOURS);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { ownerEmail: '', name: '', category: undefined, description: '', phone: '', address_line: '', barangay: '', city: '', service_area_id: '' },
  });
  const e = form.formState.errors;
  const selectedArea = areas.data?.find((a) => a.id === form.watch('service_area_id')) ?? null;

  const onSubmit = form.handleSubmit(async ({ ownerEmail, ...store }) => {
    const problem = hours.length ? validateHours(hours) : null;
    setHoursError(problem);
    if (problem) return;
    try {
      const result = await create.mutateAsync({ ownerEmail, store: { ...store, category: store.category as MerchantCategory, hours } });
      toast(result.owner_linked ? 'Store created and linked to the owner' : 'Store created — the owner gets it when they sign up');
      navigate(`/admin/merchants/${result.merchant_id}/manage`);
    } catch {
      /* shown inline */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError error={create.error} />
      <Field
        label="Owner email"
        error={e.ownerEmail?.message}
        hint="If they don’t have a GETGO account yet, the store becomes theirs when they sign up with this email."
      >
        {(p) => <Input {...p} type="email" autoComplete="off" {...form.register('ownerEmail')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store name" error={e.name?.message}>
          {(p) => <Input {...p} {...form.register('name')} />}
        </Field>
        <Field label="Category" error={e.category?.message}>
          {(p) => (
            <Select {...p} {...form.register('category')}>
              <option value="">Choose a category</option>
              {(Object.keys(CATEGORY_LABELS) as MerchantCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" optional error={e.description?.message}>
        {(p) => <Textarea {...p} rows={2} maxLength={600} {...form.register('description')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Town" error={e.service_area_id?.message}>
          {(p) => (
            <Select
              {...p}
              {...form.register('service_area_id', {
                onChange: (ev) => {
                  form.setValue('city', areas.data?.find((a) => a.id === ev.target.value)?.city ?? '');
                  form.setValue('barangay', '');
                },
              })}
              disabled={areas.isPending}
            >
              <option value="">{areas.isPending ? 'Loading…' : 'Choose a town'}</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? '' : ' (off)'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <BarangayField
          municipalityCode={selectedArea?.psgc_code}
          value={form.watch('barangay')}
          error={e.barangay?.message}
          disabled={!selectedArea}
          onChange={({ name }) => form.setValue('barangay', name, { shouldValidate: form.formState.isSubmitted })}
        />
        {selectedArea && !selectedArea.psgc_code && (
          <Field label="City / municipality" error={e.city?.message}>
            {(p) => <Input {...p} {...form.register('city')} />}
          </Field>
        )}
      </div>
      <Field label="Street address" hint="Building, house number, street or purok." error={e.address_line?.message}>
        {(p) => <Input {...p} {...form.register('address_line')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store phone" optional error={e.phone?.message}>
          {(p) => <Input {...p} type="tel" {...form.register('phone')} />}
        </Field>
      </div>
      {areas.data?.length === 0 && <Notice tone="warning">Create a service area first (Areas & fees).</Notice>}
      <div>
        <p className="mb-2 text-small font-semibold">Opening hours</p>
        <HoursEditor value={hours} onChange={setHours} error={hoursError} />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create store
        </Button>
      </div>
    </form>
  );
}
