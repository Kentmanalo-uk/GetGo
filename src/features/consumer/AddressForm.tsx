import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
import { FormError, Notice } from '@/components/ui/Feedback';
import { BarangayField } from '@/components/BarangayField';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSaveAddress, useServiceAreas } from './api';
import type { Address } from '@/types/models';

const schema = z.object({
  label: z.string().trim().min(1, 'Give this address a name.').max(40),
  recipient_name: z.string().trim().min(2, 'Enter the recipient’s name.').max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^(\+63|0)9\d{9}$/.test(v), 'Enter a mobile number like 0917 123 4567.'),
  line1: z.string().trim().min(3, 'Enter the house number, street or purok.').max(200),
  barangay: z.string().trim().min(2, 'Choose your barangay.').max(80),
  barangay_code: z.string().nullable(),
  city: z.string().trim().min(2, 'Enter the city or municipality.').max(80),
  landmark: z.string().trim().max(200).optional(),
  service_area_id: z.string().uuid('Choose your town.'),
  is_default: z.boolean().optional(),
});

type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

/**
 * Delivery address: the town comes from GETGO's open areas, the barangay from
 * the official PSGC list for that town, and the street is typed.
 */
export function AddressForm({ address, onSaved, onCancel }: { address?: Address; onSaved: (address: Address) => void; onCancel?: () => void }) {
  const { profile } = useAuth();
  const areas = useServiceAreas();
  const save = useSaveAddress();
  const onlyArea = areas.data?.length === 1 ? areas.data[0] : null;
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: address
      ? { ...address, landmark: address.landmark ?? '', barangay_code: address.barangay_code ?? null }
      : {
          label: 'Home',
          recipient_name: profile?.full_name ?? '',
          phone: profile?.phone ?? '',
          line1: '',
          barangay: '',
          barangay_code: null,
          city: onlyArea?.city ?? '',
          landmark: '',
          service_area_id: onlyArea?.id ?? '',
          is_default: true,
        },
  });
  const errors = form.formState.errors;
  const areaId = form.watch('service_area_id');
  const area = areas.data?.find((a) => a.id === areaId) ?? null;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({ ...values, landmark: values.landmark || null, id: address?.id });
      onSaved(saved);
    } catch {
      /* shown inline */
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={save.error} />
      {areas.data?.length === 0 && <Notice tone="warning">GETGO isn’t delivering anywhere yet. Check back soon.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Town" error={errors.service_area_id?.message} hint="Towns where GETGO delivers.">
          {(p) => (
            <Select
              {...p}
              {...form.register('service_area_id', {
                onChange: (e) => {
                  const picked = areas.data?.find((a) => a.id === e.target.value);
                  form.setValue('city', picked?.city ?? '');
                  form.setValue('barangay', '');
                  form.setValue('barangay_code', null);
                },
              })}
              disabled={areas.isPending}
            >
              <option value="">{areas.isPending ? 'Loading…' : 'Choose your town'}</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.province ? `, ${a.province}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <BarangayField
          municipalityCode={area?.psgc_code}
          value={form.watch('barangay')}
          error={errors.barangay?.message}
          disabled={!area}
          onChange={({ name, code }) => {
            form.setValue('barangay', name, { shouldValidate: form.formState.isSubmitted });
            form.setValue('barangay_code', code);
          }}
        />
      </div>
      {area && !area.psgc_code && (
        <Field label="City / municipality" error={errors.city?.message}>
          {(p) => <Input {...p} autoComplete="address-level2" {...form.register('city')} />}
        </Field>
      )}
      <Field label="House no., street, purok or sitio" error={errors.line1?.message}>
        {(p) => <Input {...p} autoComplete="address-line1" placeholder="Purok 3, near the chapel" {...form.register('line1')} />}
      </Field>
      <Field label="Landmark or directions" optional error={errors.landmark?.message}>
        {(p) => <Input {...p} placeholder="Green gate beside the sari-sari store" {...form.register('landmark')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Label" hint="Home, Work…" error={errors.label?.message}>
          {(p) => <Input {...p} {...form.register('label')} />}
        </Field>
        <Field label="Recipient" error={errors.recipient_name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('recipient_name')} />}
        </Field>
        <Field label="Mobile number" error={errors.phone?.message}>
          {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" {...form.register('phone')} />}
        </Field>
      </div>
      <Checkbox label="Use as my default address" {...form.register('is_default')} />
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save address
        </Button>
      </div>
    </form>
  );
}
