import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, FileText, Trash2, Upload } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServiceAreas } from '@/features/consumer/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, formatDateTime } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { HoursEditor } from '@/components/HoursEditor';
import { ImageUpload } from '@/components/ImageUpload';
import { BarangayField } from '@/components/BarangayField';
import { Logo } from '@/components/Logo';
import { summarizeHours, validateHours, type HoursEntry } from '@/domain/hours';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import { CATEGORY_LABELS, type MerchantCategory, type PartnerApplication } from '@/types/models';
import { LegalConsent } from '@/features/legal/LegalConsent';
import { useAcceptLegal } from '@/features/legal/legal';
import {
  DOCUMENT_TYPES,
  openDocument,
  useApplicationDocuments,
  useDeleteDocument,
  useMissingItems,
  useMyApplication,
  useSaveApplication,
  useStartApplication,
  useSubmitApplication,
  useUploadDocument,
} from './api';

const STEPS = [
  { key: 'business', label: 'Business' },
  { key: 'location', label: 'Location' },
  { key: 'hours', label: 'Opening hours' },
  { key: 'branding', label: 'Branding' },
  { key: 'menu', label: 'Products' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review and submit' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+63|0)\d{9,10}$/.test(v), 'Enter a valid Philippine phone number.');

function StepActions({ onBack, saving, submitLabel = 'Save and continue' }: { onBack?: () => void; saving: boolean; submitLabel?: string }) {
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mt-8 sm:border-0 sm:p-0">
      {onBack && (
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      )}
      <Button type="submit" loading={saving} className="flex-1 sm:flex-none">
        {submitLabel}
      </Button>
    </div>
  );
}

interface StepProps {
  app: PartnerApplication;
  next: () => void;
  back?: () => void;
}

// ---------------------------------------------------------------------------
const businessSchema = z.object({
  business_name: z.string().trim().min(2, 'Enter your business name.').max(120),
  category: z.enum(['restaurant', 'cafe', 'bakery', 'grocery', 'convenience', 'specialty'], { message: 'Choose a category.' }),
  description: z.string().trim().max(600).optional(),
  owner_name: z.string().trim().min(2, 'Enter the owner’s full name.').max(120),
  owner_phone: phone,
  owner_email: z.string().trim().email('Enter a valid email.'),
  business_phone: z.union([z.literal(''), phone]).optional(),
});

function BusinessStep({ app, next }: StepProps) {
  const save = useSaveApplication(app.id);
  const form = useForm<z.input<typeof businessSchema>, unknown, z.output<typeof businessSchema>>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      business_name: app.business_name ?? '',
      category: app.category ?? undefined,
      description: app.description ?? '',
      owner_name: app.owner_name ?? '',
      owner_phone: app.owner_phone ?? '',
      owner_email: app.owner_email ?? '',
      business_phone: app.business_phone ?? '',
    },
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        await save.mutateAsync({ ...v, description: v.description || null, business_phone: v.business_phone || null }).then(next, () => undefined);
      })}
    >
      <FormError error={save.error} />
      <Field label="Business name" hint="As customers will see it." error={e.business_name?.message}>
        {(p) => <Input {...p} {...form.register('business_name')} />}
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
      <Field label="Short description" optional hint="What you’re known for, in a sentence or two." error={e.description?.message}>
        {(p) => <Textarea {...p} maxLength={600} {...form.register('description')} />}
      </Field>
      <h3 className="pt-4 font-semibold">Owner</h3>
      <Field label="Full name" error={e.owner_name?.message}>
        {(p) => <Input {...p} autoComplete="name" {...form.register('owner_name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile number" error={e.owner_phone?.message}>
          {(p) => <Input {...p} type="tel" {...form.register('owner_phone')} />}
        </Field>
        <Field label="Email" error={e.owner_email?.message}>
          {(p) => <Input {...p} type="email" {...form.register('owner_email')} />}
        </Field>
      </div>
      <Field label="Store phone" optional hint="If customers and riders should call a different number." error={e.business_phone?.message}>
        {(p) => <Input {...p} type="tel" {...form.register('business_phone')} />}
      </Field>
      <StepActions saving={save.isPending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
const locationSchema = z.object({
  address_line: z.string().trim().min(3, 'Enter the street address.').max(200),
  barangay: z.string().trim().min(2, 'Enter the barangay.').max(80),
  city: z.string().trim().min(2, 'Enter the city or municipality.').max(80),
  service_area_id: z.string().uuid('Choose the GETGO area your store is in.'),
});

function LocationStep({ app, next, back }: StepProps) {
  const save = useSaveApplication(app.id);
  const areas = useServiceAreas();
  const form = useForm<z.infer<typeof locationSchema>>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      address_line: app.address_line ?? '',
      barangay: app.barangay ?? '',
      city: app.city ?? '',
      service_area_id: app.service_area_id ?? '',
    },
  });
  const e = form.formState.errors;
  const area = areas.data?.find((a) => a.id === form.watch('service_area_id')) ?? null;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        await save.mutateAsync(v).then(next, () => undefined);
      })}
    >
      <FormError error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Town" error={e.service_area_id?.message} hint="Customers in this town will see your store.">
          {(p) => (
            <Select
              {...p}
              {...form.register('service_area_id', {
                onChange: (ev) => {
                  form.setValue('city', areas.data?.find((a) => a.id === ev.target.value)?.city ?? '');
                  form.setValue('barangay', '');
                },
              })}
            >
              <option value="">Choose town</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}, {a.province}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <BarangayField
          municipalityCode={area?.psgc_code}
          value={form.watch('barangay')}
          error={e.barangay?.message}
          disabled={!area}
          onChange={({ name }) => form.setValue('barangay', name, { shouldValidate: form.formState.isSubmitted })}
        />
      </div>
      {area && !area.psgc_code && (
        <Field label="City / municipality" error={e.city?.message}>
          {(p) => <Input {...p} {...form.register('city')} />}
        </Field>
      )}
      <Field label="Street address" hint="Building, house number, street or purok." error={e.address_line?.message}>
        {(p) => <Input {...p} autoComplete="address-line1" {...form.register('address_line')} />}
      </Field>
      {areas.data?.length === 0 && (
        <Notice tone="warning">GETGO isn’t operating in any area yet. You can save your application and submit it once your area opens.</Notice>
      )}
      <StepActions onBack={back} saving={save.isPending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
function HoursStep({ app, next, back }: StepProps) {
  const save = useSaveApplication(app.id);
  const [hours, setHours] = useState<HoursEntry[]>(app.hours);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hoursError = hours.length === 0 ? 'Open at least one day.' : validateHours(hours);
    if (hoursError) return setError(hoursError);
    setError(null);
    await save.mutateAsync({ hours });
    next();
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e).catch(() => undefined)} className="space-y-6">
      <FormError error={save.error} />
      <p className="text-ink-2">GETGO riders come to buy during these hours, so customers can only order while you’re open.</p>
      <HoursEditor value={hours} onChange={setHours} />
      {error && <Notice tone="danger">{error}</Notice>}
      <StepActions onBack={back} saving={save.isPending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
function BrandingStep({ app, next, back }: StepProps) {
  const save = useSaveApplication(app.id);
  const [logo, setLogo] = useState(app.logo_path);
  const [cover, setCover] = useState(app.cover_path);
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutateAsync({ logo_path: logo, cover_path: cover }).then(next, () => undefined);
      }}
    >
      <FormError error={save.error} />
      <p className="text-ink-2">Optional now — you can add or change these after approval. Real photos of your food or storefront work best.</p>
      <ImageUpload label="Logo" prefix={`applications/${app.id}`} value={logo} onChange={setLogo} hint="Square image, at least 400 × 400." />
      <ImageUpload label="Cover photo" aspect="wide" prefix={`applications/${app.id}`} value={cover} onChange={setCover} hint="Wide photo of your best dish or your storefront." />
      <StepActions onBack={back} saving={save.isPending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
type MenuDraft = { name: string; description: string; price: string; category: string };

function MenuStep({ app, next, back }: StepProps) {
  const save = useSaveApplication(app.id);
  const [items, setItems] = useState<MenuDraft[]>(
    app.menu_items.length
      ? app.menu_items.map((m) => ({ name: m.name, description: m.description ?? '', price: toPesoInput(m.price_minor), category: m.category ?? '' }))
      : [{ name: '', description: '', price: '', category: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const update = (i: number, patch: Partial<MenuDraft>) => setItems((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const filled = items.filter((m) => m.name.trim() || m.price.trim());
    if (filled.length === 0) return setError('Add at least one item.');
    const parsed = [];
    for (const m of filled) {
      const price = parsePesos(m.price);
      if (!m.name.trim() || price === null) return setError('Each item needs a name and a price like 120 or 99.50.');
      parsed.push({ name: m.name.trim().slice(0, 120), description: m.description.trim() || undefined, price_minor: price, category: m.category.trim() || undefined });
    }
    setError(null);
    save.mutateAsync({ menu_items: parsed }).then(next, () => undefined);
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-6">
      <FormError error={save.error} />
      <p className="text-ink-2">Add a few of your products with their store prices. After approval you can add photos, sizes and choices, and keep the list up to date.</p>
      <ol className="space-y-6">
        {items.map((m, i) => (
          <li key={i} className="space-y-3 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <span className="text-small font-semibold text-ink-3">Item {i + 1}</span>
              {items.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Name">{(p) => <Input {...p} value={m.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={120} />}</Field>
              <Field label="Price">{(p) => <Input {...p} prefix="₱" inputMode="decimal" value={m.price} onChange={(e) => update(i, { price: e.target.value })} />}</Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="Description" optional>
                {(p) => <Input {...p} value={m.description} onChange={(e) => update(i, { description: e.target.value })} maxLength={600} />}
              </Field>
              <Field label="Menu section" optional>
                {(p) => <Input {...p} value={m.category} onChange={(e) => update(i, { category: e.target.value })} placeholder="Rice meals" maxLength={60} />}
              </Field>
            </div>
          </li>
        ))}
      </ol>
      {items.length < 30 && (
        <Button variant="secondary" onClick={() => setItems((l) => [...l, { name: '', description: '', price: '', category: l[l.length - 1]?.category ?? '' }])}>
          Add another item
        </Button>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <StepActions onBack={back} saving={save.isPending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
function DocumentsStep({ app, next, back }: StepProps) {
  const docs = useApplicationDocuments(app.id);
  const upload = useUploadDocument(app.id);
  const remove = useDeleteDocument(app.id);
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const [uploading, setUploading] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
      className="space-y-6"
    >
      <p className="text-ink-2">Clear photos or PDFs, up to 10 MB each. Documents are private: only you and GETGO reviewers can open them.</p>
      {(upload.error || remove.error || openError) && <Notice tone="danger">{openError ?? userMessage(upload.error ?? remove.error)}</Notice>}
      {docs.isPending ? (
        <PageLoading rows={2} />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {DOCUMENT_TYPES.map((d) => {
            const files = docs.data?.filter((f) => f.doc_type === d.type) ?? [];
            return (
              <li key={d.type} className="py-4">
                <div className="flex items-start gap-3">
                  <span
                    className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', files.length ? 'bg-ink text-accent' : 'border-2 border-line-strong')}
                    aria-hidden
                  >
                    {files.length > 0 && <Check className="size-3" weight="bold" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {d.label}
                      {!d.required && <span className="ml-2 text-small font-normal text-ink-3">Optional</span>}
                    </p>
                    <p className="text-small text-ink-3">{d.hint}</p>
                    {files.map((f) => (
                      <div key={f.id} className="mt-2 flex items-center gap-2 text-small">
                        <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
                        <button type="button" className="truncate underline underline-offset-4" onClick={() => openDocument(f.storage_path).catch((e) => setOpenError(e.message))}>
                          {f.file_name}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${f.file_name}`}
                          onClick={() => remove.mutate(f)}
                          className="ml-auto inline-flex size-9 items-center justify-center rounded-control text-ink-3 hover:bg-canvas hover:text-danger"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={uploading === d.type}
                    icon={<Upload className="size-4" aria-hidden />}
                    onClick={() => inputs.current.get(d.type)?.click()}
                  >
                    {files.length ? 'Add' : 'Upload'}
                  </Button>
                  <input
                    ref={(el) => void inputs.current.set(d.type, el)}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={`Upload ${d.label}`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setOpenError(null);
                      setUploading(d.type);
                      try {
                        await upload.mutateAsync({ docType: d.type, file });
                      } catch {
                        /* shown above */
                      } finally {
                        setUploading(null);
                      }
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <StepActions onBack={back} saving={false} submitLabel="Continue" />
    </form>
  );
}

// ---------------------------------------------------------------------------
function ReviewRow({ label, children, onEdit }: { label: string; children: ReactNode; onEdit: () => void }) {
  return (
    <div className="flex gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-ink-3">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 self-start text-small font-semibold underline underline-offset-4">
        Edit
      </button>
    </div>
  );
}

function ReviewStep({ app, back, goTo }: StepProps & { goTo: (k: StepKey) => void }) {
  const missing = useMissingItems(app.id, true);
  const submit = useSubmitApplication(app.id);
  const docs = useApplicationDocuments(app.id);
  const areas = useServiceAreas();
  const area = areas.data?.find((a) => a.id === app.service_area_id);
  const hours = summarizeHours(app.hours);
  const [confirmed, setConfirmed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const acceptLegal = useAcceptLegal();

  return (
    <div>
      <div className="divide-y divide-line border-y border-line">
        <ReviewRow label="Business" onEdit={() => goTo('business')}>
          <p className="font-semibold">{app.business_name || '—'}</p>
          <p className="text-small text-ink-3">
            {app.category ? CATEGORY_LABELS[app.category] : 'No category'} · {app.owner_name} · {app.owner_phone}
          </p>
        </ReviewRow>
        <ReviewRow label="Location" onEdit={() => goTo('location')}>
          <p>{[app.address_line, app.barangay, app.city].filter(Boolean).join(', ') || '—'}</p>
          <p className="text-small text-ink-3">{area ? `GETGO area: ${area.name}` : 'No service area chosen'}</p>
        </ReviewRow>
        <ReviewRow label="Opening hours" onEdit={() => goTo('hours')}>
          {hours.map((h) => (
            <p key={h.days} className="text-small">
              <span className="inline-block w-20 text-ink-3">{h.days}</span> {h.hours}
            </p>
          ))}
        </ReviewRow>
        <ReviewRow label="Products" onEdit={() => goTo('menu')}>
          {app.menu_items.length === 0 ? (
            <p>—</p>
          ) : (
            <ul className="text-small">
              {app.menu_items.map((m, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>{m.name}</span> <span className="tabular">{formatMoney(m.price_minor)}</span>
                </li>
              ))}
            </ul>
          )}
        </ReviewRow>
        <ReviewRow label="Documents" onEdit={() => goTo('documents')}>
          <p className="text-small">{docs.data?.length ?? 0} uploaded</p>
        </ReviewRow>
      </div>

      {missing.data && missing.data.length > 0 ? (
        <Notice tone="warning" className="mt-6" title="Still needed before you can submit">
          <ul className="list-disc pl-4">
            {missing.data.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <div className="mt-6 space-y-4">
          <Checkbox
            label="The information and documents I provided are accurate and belong to my business."
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <LegalConsent documents={['terms', 'privacy', 'store_terms']} checked={agreed} onChange={setAgreed} />
          <p className="pl-8 text-small text-ink-3">Listing your store on GETGO is optional and free, and doesn’t make your store a GETGO partner or agent.</p>
        </div>
      )}
      {submit.error && (
        <Notice tone="danger" className="mt-4">
          {userMessage(submit.error)}
        </Notice>
      )}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mt-8 sm:border-0 sm:p-0">
        <Button variant="secondary" onClick={back}>
          Back
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          loading={submit.isPending}
          disabled={!confirmed || !agreed || missing.isPending || Boolean(missing.data?.length)}
          onClick={() => acceptLegal.mutateAsync(['terms', 'privacy', 'store_terms']).then(() => submit.mutate(), () => undefined)}
        >
          Submit application
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function StatusView({ app }: { app: PartnerApplication }) {
  const start = useStartApplication();
  const content: Record<string, { title: string; body: ReactNode; action?: ReactNode }> = {
    submitted: {
      title: 'Application submitted',
      body: `We received your application on ${formatDateTime(app.submitted_at)}. Our team will review your documents and let you know here and by notification.`,
    },
    under_review: {
      title: 'Under review',
      body: 'A GETGO reviewer is checking your application. If anything needs fixing, we’ll tell you exactly what to change.',
    },
    approved: {
      title: 'You’re approved',
      body: 'Your store has been created with your products as drafts. Review prices and choices, then publish your store.',
      action: <ButtonLink to="/merchant">Set up your store</ButtonLink>,
    },
    rejected: {
      title: 'Application not approved',
      body: (
        <>
          {app.review_notes && <span className="mb-2 block font-medium text-ink">“{app.review_notes}”</span>}
          You can apply again once the issue above is resolved.
        </>
      ),
      action: (
        <Button loading={start.isPending} onClick={() => start.mutate()}>
          Start a new application
        </Button>
      ),
    },
  };
  const c = content[app.status];
  return (
    <div className="max-w-xl space-y-4 py-4">
      <h2 className="text-title font-bold">{c.title}</h2>
      <p className="text-ink-2">{c.body}</p>
      {start.error && <Notice tone="danger">{userMessage(start.error)}</Notice>}
      {c.action}
    </div>
  );
}

export default function ApplicationPage() {
  const { status: authStatus } = useAuth();
  const app = useMyApplication();
  const start = useStartApplication();
  const [params, setParams] = useSearchParams();
  const step = (STEPS.find((s) => s.key === params.get('step'))?.key ?? 'business') as StepKey;
  const index = STEPS.findIndex((s) => s.key === step);
  const goTo = (key: StepKey) => {
    setParams({ step: key });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (authStatus === 'loading' || app.isPending) {
    return (
      <div className="page-x mx-auto max-w-4xl">
        <PageLoading />
      </div>
    );
  }
  if (app.isError) return <ErrorState className="page-x mx-auto max-w-4xl" error={app.error} onRetry={() => app.refetch()} />;

  const a = app.data;
  const header = (
    <PageHeader title="Store listing application" back="/partner">
      {a?.business_name ?? 'Tell us about your business'}
    </PageHeader>
  );

  if (!a) {
    return (
      <div className="page-x mx-auto max-w-2xl">
        {header}
        <div className="space-y-4">
          <p className="text-ink-2">It takes about 15 minutes. Your progress is saved after each step, so you can finish later on any device.</p>
          <ul className="space-y-1 text-small text-ink-3">
            <li>• Business and owner details</li>
            <li>• Store address, hours and a few menu items</li>
            <li>• Photos of your ID, business permit and DTI/SEC registration</li>
          </ul>
          {start.error && <Notice tone="danger">{userMessage(start.error)}</Notice>}
          <Button size="lg" loading={start.isPending} onClick={() => start.mutate()}>
            Start application
          </Button>
        </div>
      </div>
    );
  }

  if (!['draft', 'needs_changes'].includes(a.status)) {
    return (
      <div className="page-x mx-auto max-w-4xl">
        {header}
        <StatusView app={a} />
      </div>
    );
  }

  const props: StepProps = { app: a, next: () => goTo(STEPS[Math.min(index + 1, STEPS.length - 1)].key), back: index > 0 ? () => goTo(STEPS[index - 1].key) : undefined };

  return (
    <div className="page-x mx-auto max-w-5xl pb-28 sm:pb-12">
      <div className="hidden py-4 lg:block">
        <Logo suffix="Stores" />
      </div>
      {header}
      {a.status === 'needs_changes' && a.review_notes && (
        <Notice tone="warning" title="Changes requested by GETGO" className="mb-6">
          {a.review_notes}
        </Notice>
      )}
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Application steps" className="mb-6 lg:mb-0">
          <p className="text-small text-ink-3 lg:hidden">
            Step {index + 1} of {STEPS.length}
          </p>
          <ol className="hidden space-y-1 lg:block">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => goTo(s.key)}
                  aria-current={s.key === step ? 'step' : undefined}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-small',
                    s.key === step ? 'bg-canvas font-semibold text-ink' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <span className="tabular w-4">{i + 1}</span> {s.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section aria-labelledby="step-heading">
          <h2 id="step-heading" className="mb-4 text-heading font-bold">
            {STEPS[index].label}
          </h2>
          {step === 'business' && <BusinessStep {...props} />}
          {step === 'location' && <LocationStep {...props} />}
          {step === 'hours' && <HoursStep {...props} />}
          {step === 'branding' && <BrandingStep {...props} />}
          {step === 'menu' && <MenuStep {...props} />}
          {step === 'documents' && <DocumentsStep {...props} />}
          {step === 'review' && <ReviewStep {...props} goTo={goTo} />}
        </section>
      </div>
    </div>
  );
}
