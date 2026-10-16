import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
import { FormError } from '@/components/ui/Feedback';
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
  line1: z.string().trim().min(3, 'Enter the house number and street.').max(200),
  barangay: z.string().trim().min(2, 'Enter the barangay.').max(80),
  city: z.string().trim().min(2, 'Enter the city or municipality.').max(80),
  landmark: z.string().trim().max(200).optional(),
  service_area_id: z.string().uuid('Choose the GETGO area this address is in.'),
  is_default: z.boolean().optional(),
});

type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

export function AddressForm({ address, onSaved, onCancel }: { address?: Address; onSaved: (address: Address) => void; onCancel?: () => void }) {
  const { profile } = useAuth();
  const areas = useServiceAreas();
  const save = useSaveAddress();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: address
      ? { ...address, landmark: address.landmark ?? '' }
      : {
          label: 'Home',
          recipient_name: profile?.full_name ?? '',
          phone: profile?.phone ?? '',
          line1: '',
          barangay: '',
          city: '',
          landmark: '',
          service_area_id: areas.data?.length === 1 ? areas.data[0].id : '',
          is_default: true,
        },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await save.mutateAsync({ ...values, landmark: values.landmark || null, id: address?.id });
    onSaved(saved);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" hint="Home, Work, Lola’s house" error={errors.label?.message}>
          {(p) => <Input {...p} {...form.register('label')} />}
        </Field>
        <Field label="GETGO area" error={errors.service_area_id?.message}>
          {(p) => (
            <Select {...p} {...form.register('service_area_id')}>
              <option value="">Choose area</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="House no., street, building" error={errors.line1?.message}>
        {(p) => <Input {...p} autoComplete="address-line1" {...form.register('line1')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Barangay" error={errors.barangay?.message}>
          {(p) => <Input {...p} {...form.register('barangay')} />}
        </Field>
        <Field label="City / municipality" error={errors.city?.message}>
          {(p) => <Input {...p} autoComplete="address-level2" {...form.register('city')} />}
        </Field>
      </div>
      <Field label="Landmark or directions" optional error={errors.landmark?.message}>
        {(p) => <Input {...p} placeholder="Beside the sari-sari store, green gate" {...form.register('landmark')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
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
