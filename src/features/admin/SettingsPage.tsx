import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { PageHeader, SectionHeading, formatDateTime } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { usePermissions, usePlatformSettings, useSavePlatformSettings, type AdminPlatformSettings } from './api';

const schema = z.object({
  partner_fee_note: z.string().trim().max(2000, 'Keep this under 2,000 characters.'),
  support_email: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter an email address, or leave blank.'),
  support_phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a phone number like 0917 123 4567, or leave blank.'),
});
type FormValues = z.infer<typeof schema>;

function SettingsForm({ settings, canEdit }: { settings: AdminPlatformSettings; canEdit: boolean }) {
  const save = useSavePlatformSettings();
  const toast = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      partner_fee_note: settings.partner_fee_note ?? '',
      support_email: settings.support_email ?? '',
      support_phone: settings.support_phone ?? '',
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        partner_fee_note: v.partner_fee_note || null,
        support_email: v.support_email || null,
        support_phone: v.support_phone || null,
      });
      form.reset(v);
      toast('Settings saved');
    } catch {
      /* shown inline */
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-10">
      <FormError error={save.error} />
      <fieldset disabled={!canEdit} className="space-y-4">
        <SectionHeading title="Customer support contact" />
        <p className="-mt-2 text-small text-ink-3">Shown to customers and partners who need help.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email" optional error={errors.support_email?.message}>
            {(p) => <Input {...p} type="email" {...form.register('support_email')} />}
          </Field>
          <Field label="Support phone" optional error={errors.support_phone?.message}>
            {(p) => <Input {...p} type="tel" inputMode="tel" {...form.register('support_phone')} />}
          </Field>
        </div>
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-4">
        <SectionHeading title="Partner terms" />
        <Field
          label="Note for prospective partners"
          optional
          error={errors.partner_fee_note?.message}
          hint="Shown on the partner page and application. Describe any fees or terms plainly; leave blank if there are none to state."
        >
          {(p) => <Textarea {...p} rows={5} maxLength={2000} {...form.register('partner_fee_note')} />}
        </Field>
      </fieldset>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
            Save settings
          </Button>
          {!form.formState.isDirty && <span className="text-small text-ink-3">No unsaved changes</span>}
        </div>
      )}
    </form>
  );
}

export default function SettingsPage() {
  const perms = usePermissions();
  const settings = usePlatformSettings();

  return (
    <div>
      <PageHeader title="Platform settings">
        {settings.data?.updated_at && <span className="text-small">Last changed {formatDateTime(settings.data.updated_at, { year: 'numeric' })}</span>}
      </PageHeader>
      {!perms.canConfigure && <Notice className="mb-6">Only administrators can change platform settings.</Notice>}
      {settings.isPending ? (
        <PageLoading rows={2} />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : !settings.data ? (
        <Notice tone="danger" title="Settings row missing">
          The platform settings record wasn’t found. Re-run the database migrations to create it.
        </Notice>
      ) : (
        <SettingsForm key={settings.data.updated_at} settings={settings.data} canEdit={perms.canConfigure} />
      )}
    </div>
  );
}
