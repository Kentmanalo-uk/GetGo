import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { CheckCircle, ClipboardList, Copy } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useUpdateOrderStatus } from '@/features/consumer/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, SectionHeading, StatusText, Tabs, formatDateTime } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { orderStatusLabel, riderNextStep, statusTone } from '@/domain/orderStatus';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import type { OrderWithItems } from '@/types/models';
import { Field, Input } from '@/components/ui/Field';
import { TaskSummary } from '@/features/services/TaskSummary';
import { useRecordSpent } from '@/features/services/api';
import { riderEarning, useConfirmPayment, useJobs, useReleaseOrder, useRiderOrder, type Job } from './api';
import { JobProgress, MoneySplit, OrderCard, Route, ShoppingList } from './components';
import { useRider } from './RiderLayout';

type View = 'active' | 'done';

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Completed deliveries grouped by day, each with what the rider earned. */
export function DeliveryHistory({ jobs }: { jobs: Job[] }) {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    const key = dayLabel(j.completed_at ?? j.created_at);
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return (
    <div className="space-y-6">
      {[...groups].map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h3 className="mb-1 text-small font-semibold text-ink-3">{day}</h3>
          <ul className="divide-y divide-line border-y border-line">
            {list.map(({ id, order, completed_at }) => {
              const delivered = order.status === 'completed';
              return (
                <li key={id}>
                  <Link to={`/rider/jobs/${order.id}`} className="flex items-center gap-3 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{order.merchant_name}</span>
                      <span className="block truncate text-small text-ink-3">
                        <span className="font-mono">{order.code}</span> · Brgy. {order.delivery_address.barangay} ·{' '}
                        {formatDateTime(completed_at ?? order.updated_at, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    {delivered ? (
                      <span className="tabular shrink-0 font-semibold text-accent-ink">+{formatMoney(riderEarning(order))}</span>
                    ) : (
                      <StatusText tone="danger" className="shrink-0">
                        Cancelled
                      </StatusText>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function RiderJobsPage() {
  const { userId } = useAuth();
  const jobs = useJobs(userId);
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'done' ? 'done' : 'active';

  return (
    <div className="pb-6">
      <PageHeader title="My jobs" />
      <Tabs
        label="Job views"
        value={view}
        onChange={(v) => setParams(v === 'done' ? { view: 'done' } : {}, { replace: true })}
        items={[
          { value: 'active' as View, label: 'In progress', count: jobs.data?.active.length },
          { value: 'done' as View, label: 'History' },
        ]}
      />
      <div className="pt-5">
        {jobs.isPending ? (
          <PageLoading rows={3} />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : view === 'active' ? (
          jobs.data.active.length === 0 ? (
            <EmptyState
              title="No jobs in progress"
              icon={<ClipboardList className="size-10" weight="fill" />}
              action={<ButtonLink to="/rider/orders">Find orders</ButtonLink>}
            >
              Orders you accept show up here until they’re delivered.
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {jobs.data.active.map(({ order }) => (
                <div key={order.id}>
                  <OrderCard order={order} to={`/rider/jobs/${order.id}`} showStatus />
                </div>
              ))}
            </div>
          )
        ) : jobs.data.done.length === 0 ? (
          <EmptyState title="No deliveries yet">Your completed deliveries and what you earned from each appear here.</EmptyState>
        ) : (
          <DeliveryHistory jobs={jobs.data.done} />
        )}
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast(`${label} copied`), () => undefined)}
      className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-canvas hover:text-ink"
      aria-label={`Copy ${label.toLowerCase()}`}
    >
      <Copy className="size-4" aria-hidden />
    </button>
  );
}

/** The panel at the top of a job: what to do at this step. */
function StepPanel({ order, onNotReceived }: { order: OrderWithItems; onNotReceived: () => void }) {
  const { profile } = useRider();
  const toast = useToast();
  const confirm = useConfirmPayment(order.id);
  const payment = order.payments;

  switch (order.status) {
    case 'accepted':
      return (
        <section aria-label="Waiting for payment" className="rounded-sheet bg-canvas p-5">
          <p className="text-small text-ink-3">Step 1 · Wait for payment</p>
          <p className="mt-1 text-heading font-bold">The customer is sending {formatMoney(order.total_minor)} to your GCash</p>
          <p className="mt-2 text-small text-ink-2">
            To {profile.gcash_number} ({profile.gcash_name}). Don’t buy anything until you confirm the payment here.
          </p>
          {payment?.rejection_note && <p className="mt-2 text-small text-ink-3">You told them: “{payment.rejection_note}”</p>}
        </section>
      );
    case 'payment_submitted':
      return (
        <section aria-label="Confirm payment" className="rounded-sheet border-2 border-accent p-5">
          <p className="text-small text-ink-3">Step 2 · Confirm payment</p>
          <p className="mt-1 text-heading font-bold">Check your GCash for {formatMoney(order.total_minor)}</p>
          {payment && (
            <dl className="mt-3 divide-y divide-line rounded-media bg-canvas px-4 text-small">
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-ink-3">Reference no.</dt>
                <dd className="flex items-center gap-1 font-mono font-semibold">
                  {payment.gcash_reference}
                  {payment.gcash_reference && <CopyButton value={payment.gcash_reference} label="Reference" />}
                </dd>
              </div>
              {payment.sender_name && (
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-ink-3">Sender</dt>
                  <dd className="font-semibold">{payment.sender_name}</dd>
                </div>
              )}
            </dl>
          )}
          {confirm.error && (
            <Notice tone="danger" className="mt-3">
              {userMessage(confirm.error)}
            </Notice>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              loading={confirm.isPending}
              onClick={() =>
                confirm.mutateAsync({ received: true }).then(
                  () =>
                    toast(
                      order.service === 'padala'
                        ? 'Payment confirmed — go pick up the parcel'
                        : order.service === 'errand'
                          ? 'Payment confirmed — start the errand'
                          : 'Payment confirmed — go buy the items',
                    ),
                  () => undefined,
                )
              }
            >
              I received it
            </Button>
            <Button size="lg" variant="secondary" onClick={onNotReceived}>
              Not received
            </Button>
          </div>
        </section>
      );
    case 'buying':
      if (order.service === 'padala') {
        return (
          <section aria-label="Pick up" className="rounded-sheet bg-accent-soft p-5">
            <p className="text-small text-accent-ink">Step 3 · Pick up</p>
            <p className="mt-1 text-heading font-bold">Get the parcel from {order.pickup_address.name}</p>
            <p className="mt-2 text-small text-ink-2">Check that it matches the description and is sealed. Don’t carry cash, valuables or anything illegal.</p>
          </section>
        );
      }
      if (order.service === 'errand') {
        return (
          <section aria-label="Do the errand" className="rounded-sheet bg-accent-soft p-5">
            <p className="text-small text-accent-ink">Step 3 · Do the errand</p>
            <p className="mt-1 text-heading font-bold">
              {order.subtotal_minor > 0 ? `Spend up to ${formatMoney(order.subtotal_minor)} at ${order.pickup_address.name}` : `Go to ${order.pickup_address.name}`}
            </p>
            <p className="mt-2 text-small text-ink-2">Keep the receipt. Give the customer any unspent budget in cash when you deliver.</p>
          </section>
        );
      }
      return (
        <section aria-label="Buy the items" className="rounded-sheet bg-accent-soft p-5">
          <p className="text-small text-accent-ink">Step 3 · Buy the items</p>
          <p className="mt-1 text-heading font-bold">Pay {formatMoney(order.subtotal_minor)} at {order.merchant_name}</p>
          <p className="mt-2 text-small text-ink-2">Tick each item as you get it. Follow the customer’s notes.</p>
        </section>
      );
    case 'out_for_delivery':
      return (
        <section aria-label="Deliver" className="rounded-sheet bg-accent-soft p-5">
          <p className="text-small text-accent-ink">Step 4 · Deliver</p>
          <p className="mt-1 text-heading font-bold">
            Bring the {order.service === 'padala' ? 'parcel' : order.service === 'errand' ? 'items and receipt' : 'order'} to {order.delivery_address.recipient_name}
          </p>
          <p className="mt-2 text-small text-ink-2">
            {order.service === 'errand' && order.subtotal_minor > 0
              ? 'Hand over the receipt and the change. Call the customer if you can’t find the address.'
              : order.service === 'padala'
                ? 'Call the recipient if you can’t find the address.'
                : 'Call the customer if you can’t find the address.'}
          </p>
        </section>
      );
    case 'completed':
      return (
        <section aria-label="Delivered" className="flex items-center gap-4 rounded-sheet bg-accent-soft p-5">
          <CheckCircle className="size-10 shrink-0 text-accent-ink" weight="fill" aria-hidden />
          <div>
            <p className="text-heading font-bold">
              {order.service === 'errand' ? 'Done' : 'Delivered'} · you earned {formatMoney(riderEarning(order))}
            </p>
            <p className="text-small text-ink-2">{formatDateTime(order.completed_at)}</p>
          </div>
        </section>
      );
    case 'cancelled':
      return (
        <Notice tone="danger" title="This order was cancelled">
          {order.cancel_reason ?? 'No reason was given.'}
        </Notice>
      );
    default:
      return null;
  }
}

/** Errands with a budget: the rider records what they spent; the change goes back to the customer. */
function SpentForm({ order }: { order: OrderWithItems }) {
  const record = useRecordSpent(order.id);
  const toast = useToast();
  const [value, setValue] = useState(order.spent_minor != null ? toPesoInput(order.spent_minor) : '');
  const minor = parsePesos(value);
  const valid = minor != null && minor <= order.subtotal_minor;
  return (
    <form
      className="space-y-3 rounded-sheet border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) record.mutateAsync(minor).then(() => toast('Amount saved'), () => undefined);
      }}
    >
      <Field
        label="Amount spent (from the receipt)"
        error={value && !valid ? `Enter up to ${formatMoney(order.subtotal_minor)}.` : undefined}
        hint={valid ? `Change to return: ${formatMoney(order.subtotal_minor - minor)}` : `Budget ${formatMoney(order.subtotal_minor)}`}
      >
        {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      {record.error && <Notice tone="danger">{userMessage(record.error)}</Notice>}
      <Button type="submit" variant="secondary" block loading={record.isPending} disabled={!valid}>
        {order.spent_minor != null ? 'Update amount' : 'Save amount'}
      </Button>
    </form>
  );
}

export function RiderJobPage() {
  const { orderId } = useParams();
  const toast = useToast();
  const order = useRiderOrder(orderId);
  const update = useUpdateOrderStatus();
  const confirm = useConfirmPayment(orderId ?? '');
  const release = useReleaseOrder(orderId ?? '');
  const [dialog, setDialog] = useState<'not_received' | 'release' | 'cancel' | null>(null);
  const navigate = useNavigate();

  if (order.isPending) return <PageLoading rows={3} />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;
  if (!o) {
    return (
      <>
        <PageHeader title="Job not found" back="/rider/jobs" />
        <EmptyState title="This job isn’t yours anymore" action={<ButtonLink to="/rider/jobs">My jobs</ButtonLink>}>
          It may have been released or reassigned.
        </EmptyState>
      </>
    );
  }

  // Waiting for a rider (e.g. just released): the order preview handles it.
  if (o.status === 'pending') return <Navigate to={`/rider/orders/${o.id}`} replace />;

  const next = riderNextStep(o.status, o.service);
  const finished = o.status === 'completed' || o.status === 'cancelled';
  const showCustomer = !['pending', 'accepted', 'payment_submitted'].includes(o.status);
  const error = update.error ?? release.error;
  const hasBar = Boolean(next) || o.status === 'accepted';

  return (
    <div className={cx(hasBar ? 'pb-44 lg:pb-6' : 'pb-6')}>
      <PageHeader title={o.merchant_name} back="/rider/jobs">
        <span className="font-mono">{o.code}</span> · <StatusText tone={statusTone(o.status)}>{orderStatusLabel(o.status, o.service)}</StatusText>
      </PageHeader>

      {!finished && <JobProgress status={o.status} service={o.service} className="mb-6" />}

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10 lg:space-y-0">
        <div className="space-y-8">
          <StepPanel order={o} onNotReceived={() => setDialog('not_received')} />

          <section aria-label="Route">
            <Route order={o} showCustomer={showCustomer} />
          </section>

          <section aria-labelledby="list-heading">
            {o.service === 'pabili' ? (
              <>
                <SectionHeading id="list-heading" title={o.status === 'buying' ? 'Shopping list' : 'Items'} />
                <ShoppingList order={o} checkable={o.status === 'buying'} />
              </>
            ) : (
              <>
                <SectionHeading id="list-heading" title={o.service === 'padala' ? 'Parcel' : 'Errand'} />
                <TaskSummary order={o} />
              </>
            )}
            {o.notes && (
              <Notice className="mt-3" title="Customer note">
                {o.notes}
              </Notice>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8">
          <MoneySplit order={o} />
          {o.service === 'errand' && o.subtotal_minor > 0 && (o.status === 'buying' || o.status === 'out_for_delivery') && <SpentForm order={o} />}
          {error && <Notice tone="danger">{userMessage(error)}</Notice>}

          {hasBar && (
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 space-y-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
              {next && (
                <Button
                  block
                  size="lg"
                  loading={update.isPending}
                  onClick={() =>
                    update
                      .mutateAsync({ orderId: o.id, status: next.to })
                      .then(() => toast(next.to === 'completed' ? 'Delivery completed' : 'On your way'), () => undefined)
                  }
                >
                  {next.label}
                </Button>
              )}
              {o.status === 'accepted' && (
                <Button block variant="secondary" onClick={() => setDialog('release')}>
                  Release this order
                </Button>
              )}
            </div>
          )}

          {(o.status === 'buying' || o.status === 'out_for_delivery') && (
            <button type="button" onClick={() => setDialog('cancel')} className="text-small font-semibold text-danger underline-offset-4 hover:underline">
              I can’t complete this order
            </button>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === 'not_received'}
        onClose={() => setDialog(null)}
        title="Payment not received?"
        body="The customer will be asked to check and send it again."
        confirmLabel="Tell the customer"
        tone="primary"
        reason={{ label: 'What’s wrong?', required: true, suggestions: ['No transfer with that reference', 'Amount is short', 'Sent to the wrong number'] }}
        loading={confirm.isPending}
        onConfirm={async (note) => {
          await confirm.mutateAsync({ received: false, note });
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'release'}
        onClose={() => setDialog(null)}
        title="Release this order?"
        body="Another rider can accept it. The customer hasn’t paid you yet."
        confirmLabel="Release"
        reason={{ label: 'Reason', placeholder: 'Motorcycle trouble, too far…' }}
        loading={release.isPending}
        onConfirm={async (note) => {
          await release.mutateAsync(note);
          setDialog(null);
          toast('Order released');
          navigate('/rider/orders', { replace: true });
        }}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title="Cancel this order?"
        body="The customer has already paid you. GETGO will arrange their refund, and you’ll need to return the money."
        confirmLabel="Cancel order"
        reason={{ label: 'Reason', required: true, suggestions: ['Store is closed', 'Items are out of stock', 'Customer unreachable'] }}
        loading={update.isPending}
        onConfirm={async (note) => {
          await update.mutateAsync({ orderId: o.id, status: 'cancelled', note });
          setDialog(null);
        }}
      />
    </div>
  );
}
