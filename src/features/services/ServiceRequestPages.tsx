import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NoRidersNotice, useNoRidersOnline } from '@/features/riders/RidersOnline';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { Check, ListChecks, MapPin, Package } from '@/components/icons';
import { BarangayField } from '@/components/BarangayField';
import { PinField, TripMap } from '@/components/map';
import { areaCenter, formatKm, pinOf } from '@/lib/geo';
import { Button } from '@/components/ui/Button';
import { EmptyState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { DataRow, PageHeader } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { AddressButton } from '@/app/layouts/ConsumerLayout';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocationContext } from '@/features/location/LocationProvider';
import { formatMoney, parsePesos } from '@/domain/money';
import { errorHint, userMessage } from '@/lib/errors';
import { ERRAND_TYPES, PARCEL_SIZES, type Address, type ErrandType, type PadalaTask, type ServiceArea } from '@/types/models';
import { usePlaceServiceRequest, useServiceQuote, type ServiceKind, type ServicePlace, type ServiceRequest } from './api';

const mobile = /^(\+63|0)9\d{9}$/;
const cleanPhone = (v: string) => v.replace(/[\s-]/g, '');

const placeSchema = (phoneRequired: boolean) =>
  z.object({
    name: z.string().trim().min(2, 'Enter a name.').max(120),
    phone: z
      .string()
      .transform(cleanPhone)
      .refine((v) => (phoneRequired ? mobile.test(v) : v === '' || mobile.test(v)), 'Enter a mobile number like 0917 123 4567.'),
    line1: z.string().trim().min(3, 'Enter the street, purok or building.').max(200),
    barangay: z.string().trim().min(2, 'Choose the barangay.').max(80),
    barangay_code: z.string().nullable(),
    landmark: z.string().trim().max(200),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
  });

type Errors = Record<string, string>;

function collectErrors(result: { success: true } | { success: false; error: z.ZodError }, prefix: string, into: Errors) {
  if (result.success) return;
  for (const issue of result.error.issues) {
    const key = `${prefix}.${issue.path.join('.')}`;
    if (!into[key]) into[key] = issue.message;
  }
}

const emptyPlace: ServicePlace = { name: '', phone: '', line1: '', barangay: '', barangay_code: null, landmark: '', lat: null, lng: null };

function fromAddress(a: Address): ServicePlace {
  return {
    name: a.recipient_name,
    phone: a.phone,
    line1: a.line1,
    barangay: a.barangay,
    barangay_code: a.barangay_code,
    landmark: a.landmark ?? '',
    lat: a.lat,
    lng: a.lng,
  };
}

/** Waits until the value stops changing, so the price isn't fetched on every keystroke. */
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- compared by content
  return debounced;
}

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${step}`} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-small font-bold text-accent-ink">{step}</span>
        <div>
          <h2 id={`step-${step}`} className="text-heading font-semibold">
            {title}
          </h2>
          {hint && <p className="text-small text-ink-3">{hint}</p>}
        </div>
      </div>
      <div className="space-y-4 sm:pl-10">{children}</div>
    </section>
  );
}

/** Name, phone and address of one stop, with the customer's saved addresses as shortcuts. */
function PlaceFields({
  id,
  value,
  onChange,
  errors,
  area,
  addresses,
  nameLabel,
  phoneLabel,
  phoneOptional,
  namePlaceholder,
}: {
  id: string;
  value: ServicePlace;
  onChange: (next: ServicePlace) => void;
  errors: Errors;
  area: ServiceArea;
  addresses: Address[];
  nameLabel: string;
  phoneLabel: string;
  phoneOptional?: boolean;
  namePlaceholder?: string;
}) {
  const set = (patch: Partial<ServicePlace>) => onChange({ ...value, ...patch });
  const saved = addresses.filter((a) => a.service_area_id === area.id);
  const err = (k: string) => errors[`${id}.${k}`];
  return (
    <>
      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Use a saved address">
          {saved.map((a) => {
            const active = value.line1 === a.line1 && value.barangay === a.barangay && value.name === a.recipient_name;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(fromAddress(a))}
                aria-pressed={active}
                className={cx(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-small font-semibold transition-colors',
                  active ? 'border-accent-strong bg-accent-soft text-accent-ink' : 'border-line hover:bg-canvas',
                )}
              >
                {active ? <Check className="size-4" weight="bold" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
                {a.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={nameLabel} error={err('name')}>
          {(p) => <Input {...p} value={value.name} placeholder={namePlaceholder} onChange={(e) => set({ name: e.target.value })} maxLength={120} />}
        </Field>
        <Field label={phoneLabel} optional={phoneOptional} error={err('phone')}>
          {(p) => (
            <Input {...p} type="tel" inputMode="tel" placeholder="0917 123 4567" value={value.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <BarangayField
          municipalityCode={area.psgc_code}
          value={value.barangay}
          error={err('barangay')}
          onChange={(b) => set({ barangay: b.name, barangay_code: b.code })}
        />
        <Field label="Street, purok or building" error={err('line1')}>
          {(p) => <Input {...p} value={value.line1} onChange={(e) => set({ line1: e.target.value })} maxLength={200} />}
        </Field>
      </div>
      <Field label="Landmark" optional error={err('landmark')}>
        {(p) => <Input {...p} value={value.landmark} placeholder="Near the chapel, blue gate…" onChange={(e) => set({ landmark: e.target.value })} maxLength={200} />}
      </Field>
      <PinField
        value={pinOf(value)}
        center={pinOf(value) ?? areaCenter(area)}
        hint="Pin it so the rider finds the spot. With both stops pinned, the fee is by distance."
        onChange={(pin) => set({ lat: pin?.lat ?? null, lng: pin?.lng ?? null })}
      />
    </>
  );
}

function ChoiceCard({ selected, onSelect, title, hint, name }: { selected: boolean; onSelect: () => void; title: string; hint: string; name: string }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-media border p-3 transition-colors',
        selected ? 'border-accent-strong bg-accent-soft/50 ring-1 ring-accent-strong' : 'border-line hover:border-line-strong',
      )}
    >
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="mt-0.5 size-5 shrink-0 accent-ink" />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-small text-ink-3">{hint}</span>
      </span>
    </label>
  );
}

/** Price, payment explanation and the send button: an aside on desktop, a bottom bar on phones. */
function Summary({
  service,
  req,
  notes,
  onInvalid,
}: {
  service: ServiceKind;
  req: ServiceRequest | null;
  notes: string;
  onInvalid: () => void;
}) {
  const navigate = useNavigate();
  const debounced = useDebounced(req);
  const quote = useServiceQuote(debounced);
  const place = usePlaceServiceRequest();
  const qc = useQueryClient();
  const noRiders = useNoRidersOnline(useLocationContext().area?.id);
  const [key] = useState(() => crypto.randomUUID());
  const q = req && debounced && JSON.stringify(req) === JSON.stringify(debounced) ? quote.data : undefined;
  const feeLabel = service === 'padala' ? 'Padala fee' : 'Errand fee';

  const send = async () => {
    if (!req) return onInvalid();
    if (!q) return;
    try {
      const id = await place.mutateAsync({ req, notes, expectedTotalMinor: q.total_minor, idempotencyKey: key });
      navigate(`/orders/${id}?placed=1`, { replace: true });
    } catch (error) {
      if (errorHint(error) === 'total_changed') quote.refetch();
      if (errorHint(error) === 'no_riders_online') qc.invalidateQueries({ queryKey: ['riders-online'] });
    }
  };

  const total = q ? formatMoney(q.total_minor) : null;
  const from = pinOf(req?.pickup);
  const to = pinOf(req?.dropoff);
  const loading = Boolean(req) && (quote.isFetching || !q) && !quote.isError;

  return (
    <aside className="space-y-4 lg:sticky lg:top-24">
      <div className="rounded-sheet border border-line p-5">
        <h2 className="text-heading font-semibold">Summary</h2>
        {from && to && <TripMap from={from} to={to} km={q?.distance_km} className="mt-3 h-44" />}
        {req && quote.isError ? (
          <Notice tone="danger" className="mt-3">
            {userMessage(quote.error)}
          </Notice>
        ) : q ? (
          <dl className="mt-2 text-small">
            {service === 'errand' && <DataRow label="Budget for the errand">{formatMoney(q.subtotal_minor)}</DataRow>}
            <DataRow label={q.delivery_basis === 'distance' && q.distance_km != null ? `Delivery fee · ${formatKm(q.distance_km)}` : 'Delivery fee'}>
              {formatMoney(q.delivery_fee_minor)}
            </DataRow>
            <DataRow label={feeLabel}>{formatMoney(q.service_fee_minor)}</DataRow>
            <DataRow label="Total" strong className="mt-1 border-t border-line pt-2">
              {total}
            </DataRow>
          </dl>
        ) : (
          <p className="mt-2 text-small text-ink-3">{loading ? 'Getting the price…' : 'Fill in the details to see the price.'}</p>
        )}
        <p className="mt-4 text-small text-ink-3">
          Nothing to pay yet. When a rider accepts, send the total to their GCash
          {service === 'errand' ? ' — they return any unspent budget in cash with the receipt.' : '.'}
        </p>
      </div>
      {place.error && <Notice tone="danger">{userMessage(place.error)}</Notice>}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <Button block size="lg" loading={place.isPending} disabled={noRiders || (Boolean(req) && !q)} onClick={send}>
          <span className="tabular">{noRiders ? 'No riders online yet' : total ? `Find a rider · ${total}` : 'Find a rider'}</span>
        </Button>
      </div>
    </aside>
  );
}

function useServiceArea(kind: ServiceKind) {
  const loc = useLocationContext();
  const area = loc.area;
  const enabled = area ? (kind === 'padala' ? area.padala_enabled : area.errands_enabled) : false;
  return { loc, area, enabled };
}

function Unavailable({ kind, area }: { kind: ServiceKind; area: ServiceArea | null }) {
  const name = kind === 'padala' ? 'Padala' : 'Errands';
  return (
    <div className="page-x mx-auto max-w-3xl">
      <PageHeader title={name} back="/" />
      {area ? (
        <EmptyState title={`${name} isn’t available in ${area.name} yet`}>We’ll announce it when it launches here. Food and shops are open.</EmptyState>
      ) : (
        <EmptyState title="Choose your area first" action={<AddressButton />}>
          {name} is available in towns where GETGO operates.
        </EmptyState>
      )}
    </div>
  );
}

function Intro({ kind }: { kind: ServiceKind }) {
  const Icon = kind === 'padala' ? Package : ListChecks;
  return (
    <div className="mb-8 flex items-center gap-4 rounded-sheet bg-accent-soft/60 p-4">
      <Icon className={cx('size-10 shrink-0', ICON_GRADIENT)} weight="fill" aria-hidden />
      <p className="text-small text-ink-2">
        {kind === 'padala'
          ? 'A rider picks up your parcel or documents and brings them across town the same day.'
          : 'A rider buys what you need, pays a bill or picks something up for you, then brings it to your door.'}
      </p>
    </div>
  );
}

export function PadalaPage() {
  const { profile } = useAuth();
  const { loc, area, enabled } = useServiceArea('padala');
  const [pickup, setPickup] = useState<ServicePlace>(emptyPlace);
  const [dropoff, setDropoff] = useState<ServicePlace>(emptyPlace);
  const [item, setItem] = useState('');
  const [size, setSize] = useState<PadalaTask['size']>('small');
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // The sender is usually the customer: start from their delivery address.
  useEffect(() => {
    if (loc.address && pickup === emptyPlace) setPickup(fromAddress(loc.address));
    else if (profile && pickup === emptyPlace) setPickup({ ...emptyPlace, name: profile.full_name ?? '', phone: profile.phone ?? '' });
  }, [loc.address, profile]); // eslint-disable-line react-hooks/exhaustive-deps -- prefill once

  const { req, errors } = useMemo(() => {
    const errors: Errors = {};
    const p = placeSchema(true).safeParse(pickup);
    const d = placeSchema(true).safeParse(dropoff);
    collectErrors(p, 'pickup', errors);
    collectErrors(d, 'dropoff', errors);
    if (item.trim().length < 2) errors.item = 'Say what you’re sending.';
    const ok = p.success && d.success && !errors.item && area;
    return {
      errors,
      req: ok ? ({ service: 'padala', areaId: area.id, pickup: p.data, dropoff: d.data, task: { item: item.trim(), size } } as ServiceRequest) : null,
    };
  }, [pickup, dropoff, item, size, area]);

  if (!loc.ready) return <PageLoading rows={3} />;
  if (!area || !enabled) return <Unavailable kind="padala" area={area} />;
  const shown = showErrors ? errors : {};

  return (
    <div className="page-x mx-auto max-w-5xl pb-36 lg:pb-12">
      <PageHeader title="Send a padala" back="/">
        Within {area.name}
      </PageHeader>
      <NoRidersNotice areaId={area.id} className="mb-6" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12">
        <div className="space-y-10">
          <Intro kind="padala" />
          <Section step={1} title="Pick up from" hint="Who hands the parcel to the rider.">
            <PlaceFields id="pickup" value={pickup} onChange={setPickup} errors={shown} area={area} addresses={loc.addresses} nameLabel="Sender’s name" phoneLabel="Sender’s mobile" />
          </Section>
          <Section step={2} title="Deliver to" hint="Who receives it. The rider calls this number on arrival.">
            <PlaceFields id="dropoff" value={dropoff} onChange={setDropoff} errors={shown} area={area} addresses={loc.addresses} nameLabel="Recipient’s name" phoneLabel="Recipient’s mobile" />
          </Section>
          <Section step={3} title="What are you sending?">
            <Field
              label="Item"
              error={shown.item}
              hint={
                <>
                  No cash, valuables, illegal or dangerous items. See the{' '}
                  <Link to="/legal/terms#padala" target="_blank" className="font-semibold underline underline-offset-4">
                    padala rules
                  </Link>
                  .
                </>
              }
            >
              {(p) => <Input {...p} value={item} placeholder="Documents, a box of clothes, keys…" onChange={(e) => setItem(e.target.value)} maxLength={120} />}
            </Field>
            <fieldset>
              <legend className="mb-2 text-small font-semibold">Size</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(PARCEL_SIZES) as Array<PadalaTask['size']>).map((s) => (
                  <ChoiceCard key={s} name="size" selected={size === s} onSelect={() => setSize(s)} title={PARCEL_SIZES[s].label} hint={PARCEL_SIZES[s].hint} />
                ))}
              </div>
            </fieldset>
            <Field label="Note for the rider" optional>
              {(p) => <Textarea {...p} rows={2} maxLength={300} value={notes} placeholder="Fragile, call before pickup…" onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </Section>
        </div>
        <div className="mt-10 lg:mt-0">
          <Summary service="padala" req={req} notes={notes} onInvalid={() => setShowErrors(true)} />
        </div>
      </div>
    </div>
  );
}

export function ErrandPage() {
  const { loc, area, enabled } = useServiceArea('errand');
  const [type, setType] = useState<ErrandType>('buy');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [place, setPlace] = useState<ServicePlace>(emptyPlace);
  const [dropoff, setDropoff] = useState<ServicePlace>(emptyPlace);
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (loc.address && dropoff === emptyPlace) setDropoff(fromAddress(loc.address));
  }, [loc.address]); // eslint-disable-line react-hooks/exhaustive-deps -- prefill once

  const needsBudget = ERRAND_TYPES[type].needsBudget;
  const { req, errors } = useMemo(() => {
    const errors: Errors = {};
    const p = placeSchema(false).safeParse(place);
    const d = placeSchema(true).safeParse(dropoff);
    collectErrors(p, 'place', errors);
    collectErrors(d, 'dropoff', errors);
    if (description.trim().length < 5) errors.description = 'Describe exactly what the rider should do.';
    const budgetMinor = budget.trim() === '' ? 0 : parsePesos(budget);
    if (budgetMinor == null) errors.budget = 'Enter an amount like 500.';
    else if (needsBudget && budgetMinor <= 0) errors.budget = 'Enter how much the rider may spend.';
    else if (area && budgetMinor > area.errand_max_budget_minor) errors.budget = `Budgets are up to ${formatMoney(area.errand_max_budget_minor)}.`;
    const ok = p.success && d.success && Object.keys(errors).length === 0 && area;
    return {
      errors,
      req: ok
        ? ({
            service: 'errand',
            areaId: area.id,
            pickup: p.data,
            dropoff: d.data,
            task: { type, description: description.trim(), budget_minor: budgetMinor ?? 0 },
          } as ServiceRequest)
        : null,
    };
  }, [type, description, budget, place, dropoff, area, needsBudget]);

  if (!loc.ready) return <PageLoading rows={3} />;
  if (!area || !enabled) return <Unavailable kind="errand" area={area} />;
  const shown = showErrors ? errors : {};

  return (
    <div className="page-x mx-auto max-w-5xl pb-36 lg:pb-12">
      <PageHeader title="Book an errand" back="/">
        Within {area.name}
      </PageHeader>
      <NoRidersNotice areaId={area.id} className="mb-6" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12">
        <div className="space-y-10">
          <Intro kind="errand" />
          <p className="-mt-6 text-small text-ink-3">
            Errands must be lawful and can’t include prescription medicines without a prescription, or alcohol or tobacco for minors. See the{' '}
            <Link to="/legal/terms#padala" target="_blank" className="font-semibold text-ink underline underline-offset-4">
              errand rules
            </Link>
            .
          </p>
          <Section step={1} title="What do you need?">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Kind of errand">
              {(Object.keys(ERRAND_TYPES) as ErrandType[]).map((t) => (
                <ChoiceCard key={t} name="errand-type" selected={type === t} onSelect={() => setType(t)} title={ERRAND_TYPES[t].label} hint={ERRAND_TYPES[t].hint} />
              ))}
            </div>
            <Field
              label="Details"
              error={shown.description}
              hint={type === 'bill' ? 'Biller, account name and number, and the amount due.' : 'Be specific: brand, size, quantity, what to do if it’s out of stock.'}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  maxLength={1000}
                  value={description}
                  placeholder={
                    type === 'buy'
                      ? 'Biogesic 500mg, 1 banig. If none, Neozep.'
                      : type === 'bill'
                        ? 'ORMECO bill, account no. 1234-5678, Juan Dela Cruz, ₱1,250'
                        : type === 'pickup'
                          ? 'Pick up my NBI clearance at the municipal hall, window 3'
                          : 'What should the rider do?'
                  }
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={needsBudget ? 'Budget' : 'Budget (if the rider needs to pay for something)'}
              optional={!needsBudget}
              error={shown.budget}
              hint={`The most the rider may spend, up to ${formatMoney(area.errand_max_budget_minor)}. Unspent money is returned with the receipt.`}
            >
              {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />}
            </Field>
          </Section>
          <Section step={2} title="Where should the rider go?">
            <PlaceFields
              id="place"
              value={place}
              onChange={setPlace}
              errors={shown}
              area={area}
              addresses={[]}
              nameLabel="Store, office or person"
              namePlaceholder="Mercury Drug, Municipal Hall…"
              phoneLabel="Their phone"
              phoneOptional
            />
          </Section>
          <Section step={3} title="Bring it to">
            <PlaceFields id="dropoff" value={dropoff} onChange={setDropoff} errors={shown} area={area} addresses={loc.addresses} nameLabel="Your name" phoneLabel="Your mobile" />
            <Field label="Note for the rider" optional>
              {(p) => <Textarea {...p} rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </Section>
        </div>
        <div className="mt-10 lg:mt-0">
          <Summary service="errand" req={req} notes={notes} onInvalid={() => setShowErrors(true)} />
        </div>
      </div>
    </div>
  );
}
