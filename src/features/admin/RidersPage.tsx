import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bike, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader, StatusText, Tabs } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import {
  VEHICLE_LABELS,
  useAdminOverview,
  useAllServiceAreas,
  useCreateRider,
  useRejectRider,
  usePermissions,
  useRiderLoad,
  useRiders,
  useSetRiderStatus,
  type RiderRow,
  type RiderStatus,
  type VehicleType,
} from './api';
import { DataTable, ListSkeleton, LoadMore, RoleNote } from './ui';

const TABS: Array<{ value: RiderStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Applications' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'all', label: 'All' },
];

const schema = z.object({
  email: z.string().trim().email('Enter the email of the rider’s GETGO account.'),
  fullName: z.string().trim().min(2, 'Enter the rider’s full name.').max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a mobile number like 0917 123 4567.'),
  vehicle: z.enum(['motorcycle', 'bicycle', 'car']),
  plate: z.string().trim().max(20),
  serviceAreaId: z.string().uuid('Choose the area this rider covers.'),
  gcashName: z.string().trim().min(2, 'Enter the name on the GCash account.').max(120),
  gcashNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^(\+63|0)9\d{9}$/.test(v), 'Enter the GCash mobile number, e.g. 0917 123 4567.'),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

function RiderForm({ rider, onDone }: { rider: RiderRow | null; onDone: () => void }) {
  const areas = useAllServiceAreas();
  const create = useCreateRider();
  const toast = useToast();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: rider
      ? {
          email: rider.profiles?.email ?? '',
          fullName: rider.full_name,
          phone: rider.phone,
          vehicle: rider.vehicle_type,
          plate: rider.plate_number ?? '',
          serviceAreaId: rider.service_area_id,
          gcashName: rider.gcash_name ?? '',
          gcashNumber: rider.gcash_number ?? '',
        }
      : { email: '', fullName: '', phone: '', vehicle: 'motorcycle', plate: '', serviceAreaId: '', gcashName: '', gcashNumber: '' },
  });
  const errors = form.formState.errors;
  const vehicle = form.watch('vehicle');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({ ...values });
      toast(rider ? 'Rider updated' : 'Rider added');
      onDone();
    } catch {
      /* shown inline */
    }
  });

  return (
    <form id="rider-form" onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError error={create.error} />
      <Field label="Account email" error={errors.email?.message} hint={rider ? undefined : 'The rider must sign up for a GETGO account first.'}>
        {(p) => <Input {...p} type="email" autoComplete="off" readOnly={Boolean(rider)} {...form.register('email')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName?.message}>
          {(p) => <Input {...p} {...form.register('fullName')} />}
        </Field>
        <Field label="Mobile number" error={errors.phone?.message}>
          {(p) => <Input {...p} type="tel" inputMode="tel" {...form.register('phone')} />}
        </Field>
        <Field label="Vehicle" error={errors.vehicle?.message}>
          {(p) => (
            <Select {...p} {...form.register('vehicle')}>
              {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((v) => (
                <option key={v} value={v}>
                  {VEHICLE_LABELS[v]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Plate number" error={errors.plate?.message} optional hint={vehicle === 'bicycle' ? 'Not needed for bicycles.' : undefined}>
          {(p) => <Input {...p} autoCapitalize="characters" {...form.register('plate')} />}
        </Field>
      </div>
      <Field label="Service area" error={errors.serviceAreaId?.message}>
        {(p) => (
          <Select {...p} {...form.register('serviceAreaId')} disabled={areas.isPending}>
            <option value="">{areas.isPending ? 'Loading areas…' : 'Choose an area'}</option>
            {areas.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.is_active ? '' : ' (off)'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="space-y-4 border-t border-line pt-4">
        <div>
          <h3 className="font-semibold">GCash account</h3>
          <p className="text-small text-ink-3">Customers send payment for their order to this account before the rider buys it.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name" error={errors.gcashName?.message}>
            {(p) => <Input {...p} autoComplete="off" {...form.register('gcashName')} />}
          </Field>
          <Field label="GCash number" error={errors.gcashNumber?.message}>
            {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="off" placeholder="0917 123 4567" {...form.register('gcashNumber')} />}
          </Field>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          {rider ? 'Save rider' : 'Add rider'}
        </Button>
      </div>
    </form>
  );
}

export default function RidersPage() {
  const perms = usePermissions();
  const [tab, setTab] = useState<RiderStatus | 'all'>('active');
  const list = useRiders(tab);
  const load = useRiderLoad();
  const setStatus = useSetRiderStatus();
  const reject = useRejectRider();
  const overview = useAdminOverview();
  const toast = useToast();
  const [editing, setEditing] = useState<RiderRow | 'new' | null>(null);
  const [toggling, setToggling] = useState<RiderRow | null>(null);
  const [rejecting, setRejecting] = useState<RiderRow | null>(null);

  const actions = (r: RiderRow) =>
    !perms.canConfigure ? null : r.status === 'pending' ? (
      <span className="flex justify-end gap-1">
        <Button
          size="sm"
          loading={setStatus.isPending && setStatus.variables?.userId === r.user_id}
          onClick={() => setStatus.mutateAsync({ userId: r.user_id, status: 'active' }).then(() => toast(`${r.full_name} approved`), () => undefined)}
        >
          Approve
        </Button>
        <Button size="sm" variant="danger-quiet" onClick={() => setRejecting(r)}>
          Reject
        </Button>
      </span>
    ) : (
      <span className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
          Edit
        </Button>
        <Button size="sm" variant={r.status === 'active' ? 'danger-quiet' : 'ghost'} onClick={() => setToggling(r)}>
          {r.status === 'active' ? 'Suspend' : 'Reactivate'}
        </Button>
      </span>
    );

  const statusLabel = (r: RiderRow) => (
    <StatusText tone={r.status === 'active' ? 'done' : r.status === 'pending' ? 'attention' : 'danger'}>
      {r.status === 'active' ? 'Active' : r.status === 'pending' ? 'Waiting for approval' : 'Suspended'}
    </StatusText>
  );

  return (
    <div>
      <PageHeader
        title="Riders"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} disabled={!perms.canConfigure} onClick={() => setEditing('new')}>
            Add rider
          </Button>
        }
      />
      {!perms.canConfigure && <RoleNote className="-mt-2 mb-4">Only administrators can add, edit or suspend riders.</RoleNote>}
      <Tabs
        label="Rider status"
        value={tab}
        onChange={setTab}
        items={TABS.map((t) => (t.value === 'pending' ? { ...t, count: overview.data?.riders_pending } : t))}
        className="mb-4"
      />
      {setStatus.error && <FormError error={setStatus.error} />}
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? 'No rider applications waiting' : tab === 'suspended' ? 'No suspended riders' : 'No riders yet'}
          icon={<Bike className="size-8" />}
        >
          {tab === 'pending'
            ? 'People who sign up at /rider/sign-up appear here for approval.'
            : tab !== 'suspended' && 'Riders sign up at /rider/sign-up and you approve them here, or you can add a rider directly.'}
        </EmptyState>
      ) : (
        <>
          <DataTable
            label="Riders"
            rows={list.items}
            rowKey={(r) => r.user_id}
            columns={[
              {
                header: 'Rider',
                cell: (r) => (
                  <span>
                    <span className="block font-semibold">{r.full_name}</span>
                    <span className="block text-small text-ink-3">{[r.phone, r.profiles?.email].filter(Boolean).join(' · ')}</span>
                  </span>
                ),
              },
              { header: 'Vehicle', cell: (r) => `${VEHICLE_LABELS[r.vehicle_type]}${r.plate_number ? ` · ${r.plate_number}` : ''}` },
              { header: 'Area', cell: (r) => r.service_areas?.name ?? '—' },
              {
                header: 'GCash',
                cell: (r) => (
                  <span className="text-small">
                    <span className="tabular block">{r.gcash_number}</span>
                    <span className="block text-ink-3">{r.gcash_name}</span>
                  </span>
                ),
              },
              { header: 'Status', cell: statusLabel },
              { header: 'On delivery', align: 'right', cell: (r) => load.data?.[r.user_id] ?? 0 },
              { header: <span className="sr-only">Actions</span>, align: 'right', cell: actions },
            ]}
            mobile={(r) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.full_name}</p>
                    <p className="text-small text-ink-3">
                      {VEHICLE_LABELS[r.vehicle_type]}
                      {r.plate_number && ` · ${r.plate_number}`} · {r.service_areas?.name}
                    </p>
                    <p className="text-small text-ink-3">
                      {r.phone}
                      {r.profiles?.email && ` · ${r.profiles.email}`}
                    </p>
                    <p className="text-small text-ink-3">
                      GCash {r.gcash_number} · {r.gcash_name}
                    </p>
                  </div>
                  <span className="shrink-0">{statusLabel(r)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-small text-ink-3">
                    {load.data?.[r.user_id] ? `${load.data[r.user_id]} active ${load.data[r.user_id] === 1 ? 'delivery' : 'deliveries'}` : 'No active delivery'}
                  </span>
                  {actions(r)}
                </div>
              </div>
            )}
          />
          <LoadMore paged={list} />
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? 'Edit rider' : 'Add rider'}>
        {editing !== null && <RiderForm key={editing === 'new' ? 'new' : editing.user_id} rider={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>

      {toggling && (
        <ConfirmDialog
          open
          onClose={() => {
            setToggling(null);
            setStatus.reset();
          }}
          tone={toggling.status === 'active' ? 'danger' : 'primary'}
          title={toggling.status === 'active' ? `Suspend ${toggling.full_name}?` : `Reactivate ${toggling.full_name}?`}
          body={
            toggling.status === 'active'
              ? `They stop receiving deliveries.${load.data?.[toggling.user_id] ? ' Their current deliveries are released and need a new rider.' : ''}`
              : 'They can be assigned deliveries again.'
          }
          confirmLabel={toggling.status === 'active' ? 'Suspend rider' : 'Reactivate'}
          loading={setStatus.isPending}
          error={setStatus.error ? <FormError error={setStatus.error} /> : null}
          onConfirm={async () => {
            await setStatus.mutateAsync({ userId: toggling.user_id, status: toggling.status === 'active' ? 'suspended' : 'active' });
            toast(toggling.status === 'active' ? 'Rider suspended' : 'Rider reactivated');
            setToggling(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => {
          setRejecting(null);
          reject.reset();
        }}
        title={`Reject ${rejecting?.full_name ?? 'this application'}?`}
        body="They’re notified with your reason and can apply again."
        confirmLabel="Reject application"
        reason={{ label: 'Reason', required: true, suggestions: ['GCash name doesn’t match', 'Area not open for riders yet', 'Incomplete details'] }}
        loading={reject.isPending}
        error={reject.error ? <FormError error={reject.error} /> : null}
        onConfirm={async (reason) => {
          await reject.mutateAsync({ userId: rejecting!.user_id, reason });
          toast('Application rejected');
          setRejecting(null);
        }}
      />
    </div>
  );
}
