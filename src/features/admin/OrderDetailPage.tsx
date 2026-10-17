import { useState, type ComponentProps } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader, SectionHeading, StatusText, formatDateTime } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { useOrderRealtime } from '@/features/consumer/api';
import { OrderItemsList, OrderTotals } from '@/features/consumer/OrderViews';
import { TaskSummary } from '@/features/services/TaskSummary';
import {
  VEHICLE_LABELS,
  isFinalStatus,
  personLabel,
  useActiveRiders,
  useAdminOrder,
  useAssignRider,
  useCancelOrder,
  usePermissions,
  useProfiles,
  useRequestRefund,
  type AdminOrder,
  type AssignmentRow,
  type OrderStatus,
  type PaymentRow,
  type RefundRow,
} from './api';
import { RefundActions } from './MoneyActions';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, REFUND_LABELS, RoleNote, orderTone, paymentTone, refundTone } from './ui';

/** Riders can be (re)assigned until the customer has paid them. */
const ASSIGNABLE: OrderStatus[] = ['pending', 'accepted'];

const ACTOR_LABELS: Record<string, string> = { customer: 'Customer', merchant: 'Store', rider: 'Rider', admin: 'GETGO staff', system: 'System' };

function RiderPanel({ order, assignments, canOperate }: { order: AdminOrder; assignments: AssignmentRow[]; canOperate: boolean }) {
  const assignable = ASSIGNABLE.includes(order.status);
  const riders = useActiveRiders(canOperate && assignable ? order.service_area_id : undefined);
  const assign = useAssignRider();
  const toast = useToast();
  const [riderId, setRiderId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const current = assignments.find((a) => a.status === 'active');
  const selected = riders.data?.find((r) => r.user_id === riderId);
  const options = riders.data?.filter((r) => r.user_id !== current?.rider_id) ?? [];
  const rp = current?.rider_profiles;

  return (
    <section>
      <h2 className="mb-2 font-semibold">Rider</h2>
      {current ? (
        <div className="text-ink-2">
          <p className="font-semibold text-ink">{rp?.full_name ?? 'Assigned rider'}</p>
          {rp && (
            <p>
              <a href={`tel:${rp.phone}`} className="underline underline-offset-4">
                {rp.phone}
              </a>{' '}
              · {VEHICLE_LABELS[rp.vehicle_type] ?? rp.vehicle_type}
            </p>
          )}
          {rp?.gcash_number && (
            <p>
              GCash: <span className="tabular">{rp.gcash_number}</span>
              {rp.gcash_name && ` (${rp.gcash_name})`}
            </p>
          )}
          <p className="text-ink-3">Assigned {formatDateTime(current.created_at)}</p>
        </div>
      ) : (
        <p className={order.status === 'pending' ? 'font-semibold' : 'text-ink-3'}>
          {order.status === 'pending' ? 'Waiting for a rider to accept.' : 'No active rider.'}
        </p>
      )}

      {assignable &&
        (canOperate ? (
          riders.isError ? (
            <FormError error={riders.error} />
          ) : (
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (riderId) setConfirmOpen(true);
              }}
            >
              <Field label={current ? 'Reassign to' : 'Assign rider'} className="min-w-0 flex-1">
                {(p) => (
                  <Select {...p} value={riderId} onChange={(e) => setRiderId(e.target.value)} disabled={riders.isPending || options.length === 0}>
                    <option value="">{riders.isPending ? 'Loading riders…' : options.length ? 'Choose a rider' : 'No other active riders'}</option>
                    {options.map((r) => (
                      <option key={r.user_id} value={r.user_id}>
                        {r.full_name} · {VEHICLE_LABELS[r.vehicle_type] ?? r.vehicle_type}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" variant="secondary" disabled={!riderId}>
                {current ? 'Reassign' : 'Assign'}
              </Button>
            </form>
          )
        ) : (
          <RoleNote className="mt-2">Admin or support staff assign riders.</RoleNote>
        ))}
      {assignable && canOperate && riders.data && riders.data.length === 0 && (
        <RoleNote className="mt-2">
          No active riders in this order’s area. Add one on the{' '}
          <Link to="/admin/riders" className="underline underline-offset-4">
            Riders
          </Link>{' '}
          page.
        </RoleNote>
      )}
      {!assignable && !isFinalStatus(order.status) && (
        <RoleNote className="mt-2">The rider can’t be changed after the customer has paid them.</RoleNote>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          assign.reset();
        }}
        tone="primary"
        title={current ? 'Reassign this order?' : 'Assign this order?'}
        body={`${selected?.full_name ?? 'The rider'} is notified to take ${order.code} (${order.merchant_name}). The customer pays this rider by GCash.${
          current ? ` ${rp?.full_name ?? 'The current rider'} is released from it.` : ''
        }`}
        confirmLabel={current ? 'Reassign' : 'Assign'}
        loading={assign.isPending}
        error={assign.error ? <FormError error={assign.error} /> : null}
        onConfirm={async () => {
          await assign.mutateAsync({ orderId: order.id, riderId });
          setConfirmOpen(false);
          setRiderId('');
          toast('Rider assigned');
        }}
      />
    </section>
  );
}

function PaymentPanel({ order, payments }: { order: AdminOrder; payments: PaymentRow[] }) {
  return (
    <section>
      <h2 className="mb-1 font-semibold">GCash payment</h2>
      <p>
        <StatusText tone={paymentTone(order.payment_status)}>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</StatusText>
        <span className="tabular text-ink-2"> · {formatMoney(order.total_minor)}</span>
      </p>
      {payments.length > 0 ? (
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {payments.map((p) => (
            <li key={p.id} className="space-y-0.5 py-2">
              {(p.payee_number || p.payee_name) && (
                <p className="flex justify-between gap-3">
                  <span className="text-ink-3">Pay to</span>
                  <span className="text-right">
                    {p.payee_name}
                    {p.payee_number && <span className="tabular block">{p.payee_number}</span>}
                  </span>
                </p>
              )}
              <p className="flex justify-between gap-3">
                <span className="text-ink-3">Reference</span>
                <span className="font-mono break-all">{p.gcash_reference ?? '—'}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-3">Sender</span>
                <span>{p.sender_name ?? '—'}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-3">Amount</span>
                <span className="tabular">{formatMoney(p.amount_minor)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-3">Status</span>
                <span>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</span>
              </p>
              {p.submitted_at && (
                <p className="flex justify-between gap-3">
                  <span className="text-ink-3">Submitted</span>
                  <span>{formatDateTime(p.submitted_at)}</span>
                </p>
              )}
              <p className="flex justify-between gap-3">
                <span className="text-ink-3">Confirmed by rider</span>
                <span>{p.confirmed_at ? formatDateTime(p.confirmed_at) : 'Not yet'}</span>
              </p>
              {p.refunded_minor > 0 && (
                <p className="flex justify-between gap-3">
                  <span className="text-ink-3">Refunded</span>
                  <span className="tabular">{formatMoney(p.refunded_minor)}</span>
                </p>
              )}
              {p.rejection_note && <p className="text-danger">Rider note: {p.rejection_note}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-ink-3">No GCash payment submitted yet.</p>
      )}
      {order.status === 'payment_submitted' && (
        <RoleNote className="mt-2">The rider must confirm the GCash payment arrived before buying the order.</RoleNote>
      )}
    </section>
  );
}

function CancelPanel({ order, canOperate }: { order: AdminOrder; canOperate: boolean }) {
  const cancel = useCancelOrder();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (isFinalStatus(order.status)) return null;
  return (
    <section>
      <h2 className="mb-2 font-semibold">Cancel order</h2>
      {canOperate ? (
        <Button variant="danger-quiet" size="sm" className="-ml-3" onClick={() => setOpen(true)}>
          Cancel this order
        </Button>
      ) : (
        <RoleNote>Admin or support staff can cancel orders.</RoleNote>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          cancel.reset();
        }}
        title={`Cancel ${order.code}?`}
        body={`The customer and any assigned rider are notified with your reason.${
          order.payment_status === 'paid' ? ' The customer already paid by GCash, so a refund request is created for finance.' : ''
        }${order.status === 'buying' || order.status === 'out_for_delivery' ? ' The rider may have already bought the items — agree on next steps with them first.' : ''}`}
        confirmLabel="Cancel order"
        reason={{
          label: 'Reason (shown to the customer)',
          required: true,
          suggestions: ['No rider available', 'Store closed or out of stock', 'Customer unreachable', 'Payment not received'],
        }}
        loading={cancel.isPending}
        error={cancel.error ? <FormError error={cancel.error} /> : null}
        onConfirm={async (reason) => {
          await cancel.mutateAsync({ orderId: order.id, reason });
          setOpen(false);
          toast('Order cancelled');
        }}
      />
    </section>
  );
}

function RefundRequest({ order, refunds }: { order: AdminOrder; refunds: RefundRow[] }) {
  const request = useRequestRefund();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const committed = refunds.filter((r) => r.status !== 'rejected').reduce((sum, r) => sum + r.amount_minor, 0);
  const balance = Math.max(order.total_minor - committed, 0);
  const minor = parsePesos(amount);
  const amountError =
    amount && (minor == null || minor <= 0)
      ? 'Enter an amount like 120 or 120.50.'
      : minor != null && minor > balance
        ? `At most ${formatMoney(balance)} can still be refunded.`
        : undefined;

  if (order.payment_status !== 'paid') return null;

  const close = () => {
    setOpen(false);
    request.reset();
  };

  return (
    <section>
      <h2 className="mb-2 font-semibold">Refund</h2>
      {balance > 0 ? (
        <>
          <p className="mb-3 text-ink-3">Up to {formatMoney(balance)} can still be refunded. Finance approves and sends refunds by GCash.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAmount(toPesoInput(balance));
              setReason('');
              setOpen(true);
            }}
          >
            Request refund
          </Button>
        </>
      ) : (
        <p className="text-ink-3">The full amount is already refunded or requested.</p>
      )}
      <Sheet
        open={open}
        onClose={close}
        title="Request a refund"
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close} disabled={request.isPending}>
              Go back
            </Button>
            <Button
              loading={request.isPending}
              disabled={minor == null || minor <= 0 || Boolean(amountError) || reason.trim().length < 3}
              onClick={async () => {
                try {
                  await request.mutateAsync({ orderId: order.id, amountMinor: minor!, reason: reason.trim() });
                  toast('Refund requested');
                  close();
                } catch {
                  /* shown inline */
                }
              }}
            >
              Request refund
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-ink-2">
            For {order.code} · paid {formatMoney(order.total_minor)} by GCash. Finance approves the request and sends the money back.
          </p>
          <Field label="Amount" error={amountError}>
            {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-48" />}
          </Field>
          <Field label="Reason" hint="At least 3 characters. Finance and the audit log see this.">
            {(p) => (
              <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Item out of stock: 1× Iced latte" />
            )}
          </Field>
          <FormError error={request.error} />
        </div>
      </Sheet>
    </section>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const perms = usePermissions();
  const query = useAdminOrder(orderId);
  useOrderRealtime({ column: 'id', value: orderId }, [['admin', 'order', orderId]]);
  const customer = useProfiles([query.data?.order?.customer_id]);

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { order, history, refunds, assignments, payments } = query.data;
  if (!order) return <EmptyState title="Order not found" action={<ButtonLink to="/admin/orders" variant="secondary">All orders</ButtonLink>} />;

  const profile = customer.data?.[order.customer_id];
  const refundsWithOrder = refunds.map((r) => ({ ...r, orders: { code: order.code, merchant_name: order.merchant_name, customer_name: order.customer_name } }));
  const totals = order as unknown as ComponentProps<typeof OrderTotals>['order'];

  return (
    <div>
      <PageHeader title={<span className="font-mono">{order.code}</span>} back="/admin/orders">
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <StatusText tone={orderTone(order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</StatusText>
          <span aria-hidden>·</span>
          {order.merchant_id ? (
            <Link to={`/admin/merchants/${order.merchant_id}`} className="underline underline-offset-4">
              {order.merchant_name}
            </Link>
          ) : (
            <span>{order.merchant_name}</span>
          )}
          <span aria-hidden>·</span>
          <span>{formatDateTime(order.created_at, { year: 'numeric' })}</span>
        </span>
      </PageHeader>

      <div className="space-y-10 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:space-y-0">
        <div className="min-w-0 space-y-10">
          {order.status === 'cancelled' && (
            <Notice tone="danger" title="Cancelled">
              {order.cancel_reason ?? 'No reason was given.'}
            </Notice>
          )}

          <section aria-labelledby="items-heading">
            <SectionHeading id="items-heading" title={order.service === 'pabili' ? 'Items' : 'Request'} />
            {order.service === 'pabili' ? <OrderItemsList items={order.order_items} /> : <TaskSummary order={order} />}
            <div className="border-t border-line pt-2">
              <OrderTotals order={totals} />
            </div>
          </section>

          <section>
            <SectionHeading title="History" />
            {history.length === 0 ? (
              <p className="text-small text-ink-3">No status changes recorded yet.</p>
            ) : (
              <ol className="divide-y divide-line border-y border-line text-small">
                {history.map((h) => (
                  <li key={h.id} className="flex gap-4 py-2.5">
                    <span className="tabular w-28 shrink-0 text-ink-3 sm:w-36">{formatDateTime(h.created_at)}</span>
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-semibold">{ORDER_STATUS_LABELS[h.to_status] ?? h.to_status}</span>
                        <span className="text-ink-3"> · {ACTOR_LABELS[h.actor_kind] ?? h.actor_kind}</span>
                      </p>
                      {h.note && <p className="text-ink-2">{h.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {refunds.length > 0 && (
            <section>
              <SectionHeading title="Refunds" />
              <ul className="divide-y divide-line border-y border-line">
                {refundsWithOrder.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2">
                        <span className="tabular font-semibold">{formatMoney(r.amount_minor)}</span>
                        <StatusText tone={refundTone(r.status)}>{REFUND_LABELS[r.status]}</StatusText>
                      </p>
                      <p className="text-small text-ink-2">{r.reason}</p>
                      <p className="text-small text-ink-3">
                        Requested {formatDateTime(r.created_at)}
                        {r.reference && ` · GCash ref ${r.reference}`}
                      </p>
                    </div>
                    {perms.canHandleMoney && <RefundActions refund={r} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8 text-small">
          <section>
            <h2 className="mb-1 font-semibold">Customer</h2>
            <p className="text-ink-2">
              {order.customer_name} ·{' '}
              <a href={`tel:${order.customer_phone}`} className="underline underline-offset-4">
                {order.customer_phone}
              </a>
              {profile?.email && <span className="block text-ink-3">{profile.email}</span>}
              {profile?.full_name && profile.full_name !== order.customer_name && <span className="block text-ink-3">Account: {personLabel(profile)}</span>}
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Deliver to</h2>
            {order.delivery_address ? (
              <p className="text-ink-2">
                {order.delivery_address.recipient_name} · {order.delivery_address.phone}
                <br />
                {order.delivery_address.line1}, {order.delivery_address.barangay}, {order.delivery_address.city}
                {order.delivery_address.landmark && <span className="block text-ink-3">Landmark: {order.delivery_address.landmark}</span>}
              </p>
            ) : (
              <p className="text-ink-3">No address recorded.</p>
            )}
            {order.pickup_address && (
              <p className="mt-2 text-ink-3">
                {order.service === 'padala' ? 'Pick up from' : order.service === 'errand' ? 'Rider goes to' : 'Buy at'}:{' '}
                {order.service === 'pabili' ? order.merchant_name : order.pickup_address.name}, {order.pickup_address.line1}, {order.pickup_address.barangay}
                {order.pickup_address.phone && ` · ${order.pickup_address.phone}`}
              </p>
            )}
            {order.notes && <p className="mt-2 text-warning">Note: {order.notes}</p>}
          </section>

          <PaymentPanel order={order} payments={payments} />
          <RiderPanel order={order} assignments={assignments} canOperate={perms.canOperateOrders} />
          <RefundRequest order={order} refunds={refunds} />
          <CancelPanel order={order} canOperate={perms.canOperateOrders} />
        </aside>
      </div>
    </div>
  );
}
