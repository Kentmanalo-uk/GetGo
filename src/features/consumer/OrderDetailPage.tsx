import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Check, Copy, Phone, Star } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { PageHeader, formatDateTime } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { PROGRESS_STEPS, customerCanCancel, customerStatusLabel, paymentStatusLabel, progressIndex } from '@/domain/orderStatus';
import { formatMoney } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import type { OrderWithItems } from '@/types/models';
import { useOrder, useOrderRealtime, useOrderReview, useSubmitGcashPayment, useSubmitReview, useUpdateOrderStatus } from './api';
import { OrderItemsList, OrderTotals } from './OrderViews';

function Progress({ order }: { order: OrderWithItems }) {
  const reached = progressIndex(order.status);
  return (
    <ol className="grid gap-0 sm:grid-cols-5 sm:gap-2" aria-label="Order progress">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i <= reached;
        const current = i === reached;
        return (
          <li key={step.label} className="flex gap-3 sm:flex-col sm:gap-2" aria-current={current ? 'step' : undefined}>
            <div className="flex flex-col items-center sm:flex-row">
              <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full border-2', done ? 'border-ink bg-ink text-accent' : 'border-line-strong bg-surface')}>
                {done && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              </span>
              {i < PROGRESS_STEPS.length - 1 && <span className={cx('h-6 w-0.5 sm:h-0.5 sm:w-full', i < reached ? 'bg-ink' : 'bg-line')} aria-hidden />}
            </div>
            <p className={cx('pb-3 text-small sm:pb-0', current ? 'font-bold' : done ? 'font-semibold' : 'text-ink-3')}>{step.label}</p>
          </li>
        );
      })}
    </ol>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-small text-ink-3">{label}</p>
        <p className="tabular text-heading font-bold">{value}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value.replace(/[₱,\s]/g, ''));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Tells the customer exactly where and how much to send, and takes the reference. */
function GcashPayment({ order }: { order: OrderWithItems }) {
  const payment = order.payments[0];
  const submit = useSubmitGcashPayment();
  const toast = useToast();
  const [reference, setReference] = useState('');
  const [sender, setSender] = useState('');
  if (!payment) return null;

  if (order.status === 'payment_submitted') {
    return (
      <Notice title="Payment sent — waiting for your rider to confirm">
        Reference <span className="font-mono font-semibold">{payment.gcash_reference}</span>. Your rider will buy your items as soon as they see the
        transfer.
      </Notice>
    );
  }
  if (order.status !== 'accepted' || !payment.payee_number) return null;

  return (
    <section aria-labelledby="pay-heading" className="rounded-media border-2 border-accent p-4 sm:p-5">
      <h2 id="pay-heading" className="text-heading font-bold">
        Send your payment by GCash
      </h2>
      <p className="mt-1 text-small text-ink-2">Your rider uses this money to buy your items at {order.merchant_name}.</p>
      {payment.rejection_note && (
        <Notice tone="warning" className="mt-3" title="Your rider didn’t receive the last payment">
          {payment.rejection_note}
        </Notice>
      )}
      <div className="mt-3 divide-y divide-line">
        <CopyValue label="Amount" value={formatMoney(order.total_minor, { fixed: true })} />
        <CopyValue label={`GCash number · ${payment.payee_name}`} value={payment.payee_number} />
      </div>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit
            .mutateAsync({ orderId: order.id, reference, senderName: sender })
            .then(() => toast('Payment reported to your rider'), () => undefined);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GCash reference number" hint="On your GCash receipt, e.g. 1012 345 678 901.">
            {(p) => <Input {...p} inputMode="numeric" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} required />}
          </Field>
          <Field label="Name on your GCash" optional>
            {(p) => <Input {...p} value={sender} onChange={(e) => setSender(e.target.value)} maxLength={120} />}
          </Field>
        </div>
        {submit.error && <Notice tone="danger">{userMessage(submit.error)}</Notice>}
        <Button type="submit" size="lg" block loading={submit.isPending} disabled={reference.replace(/\s/g, '').length < 6}>
          I’ve sent {formatMoney(order.total_minor)}
        </Button>
      </form>
    </section>
  );
}

function ReviewForm({ order }: { order: OrderWithItems }) {
  const review = useOrderReview(order.id);
  const submit = useSubmitReview();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  if (review.isPending) return null;
  if (review.data) {
    return (
      <p className="flex items-center gap-1 text-small text-ink-2">
        You rated {order.merchant_name} <Star className="size-3.5 fill-ink" aria-hidden /> {review.data.rating}
      </p>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await submit.mutateAsync({ orderId: order.id, merchantId: order.merchant_id, rating, comment });
          toast('Thanks for your review');
        } catch {
          /* shown inline */
        }
      }}
    >
      <fieldset>
        <legend className="mb-2 font-semibold">How was {order.merchant_name}?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={rating === n}
              className="inline-flex size-11 items-center justify-center rounded-control hover:bg-canvas"
            >
              <Star className={cx('size-7', n <= rating ? 'fill-ink text-ink' : 'text-line-strong')} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
      {rating > 0 && (
        <>
          <Field label="Tell others about it" optional>
            {(p) => <Textarea {...p} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          {submit.error && <Notice tone="danger">{userMessage(submit.error)}</Notice>}
          <Button type="submit" variant="dark" loading={submit.isPending}>
            Submit review
          </Button>
        </>
      )}
    </form>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const query = useOrder(orderId);
  const update = useUpdateOrderStatus();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  useOrderRealtime({ column: 'id', value: orderId }, [['order', orderId]]);

  if (query.isPending) {
    return (
      <div className="page-x mx-auto max-w-5xl">
        <PageLoading />
      </div>
    );
  }
  if (query.isError) return <ErrorState className="page-x mx-auto max-w-5xl" error={query.error} onRetry={() => query.refetch()} />;
  const order = query.data.order;
  if (!order) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <EmptyState title="Order not found" action={<ButtonLink to="/orders" variant="secondary">All orders</ButtonLink>} />
      </div>
    );
  }

  const rider = order.assignments.find((a) => a.status !== 'released')?.rider ?? null;
  const payment = order.payments[0];
  const justPlaced = params.get('placed') === '1' && order.status === 'pending';

  return (
    <div className="page-x mx-auto max-w-5xl pb-12">
      <PageHeader title={customerStatusLabel(order.status)} back="/orders">
        {order.merchant_name} · <span className="font-mono">{order.code}</span>
      </PageHeader>

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 lg:space-y-0">
        <div className="space-y-8">
          {justPlaced && (
            <Notice tone="success" title="Order placed">
              Riders near you have been notified. When one accepts, you’ll see their GCash number here. Don’t send payment before that.
            </Notice>
          )}
          {order.status === 'pending' && !justPlaced && <Notice>Waiting for a rider to accept your order. You’ll get a notification.</Notice>}
          {order.status === 'cancelled' && (
            <Notice tone="danger" title="This order was cancelled">
              {order.cancel_reason ?? 'No reason was given.'}
              {payment?.status === 'paid' && ' Your GCash payment will be refunded.'}
              {payment?.status === 'refunded' && ' Your GCash payment was refunded.'}
            </Notice>
          )}

          <GcashPayment order={order} />

          {order.status !== 'cancelled' && (
            <section aria-label="Progress">
              <Progress order={order} />
            </section>
          )}

          <section aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-heading font-semibold">
              Items
            </h2>
            <OrderItemsList items={order.order_items} />
            <div className="border-t border-line pt-2">
              <OrderTotals order={order} />
            </div>
          </section>

          {order.status === 'completed' && (
            <section aria-label="Review" className="border-t border-line pt-6">
              <ReviewForm order={order} />
            </section>
          )}
        </div>

        <aside className="space-y-6 text-small">
          {rider && (
            <section>
              <h2 className="mb-1 font-semibold">Your rider</h2>
              <p className="text-ink-2">
                {rider.full_name} · {rider.vehicle_type}
                {rider.plate_number && ` · ${rider.plate_number}`}
              </p>
              <a href={`tel:${rider.phone}`} className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-4">
                <Phone className="size-3.5" aria-hidden /> Call {rider.phone}
              </a>
            </section>
          )}
          <section>
            <h2 className="mb-1 font-semibold">Delivering to</h2>
            <p className="text-ink-2">
              {order.delivery_address.recipient_name} · {order.delivery_address.phone}
              <br />
              {order.delivery_address.line1}, {order.delivery_address.barangay}, {order.delivery_address.city}
              {order.delivery_address.landmark && (
                <>
                  <br />
                  {order.delivery_address.landmark}
                </>
              )}
            </p>
            {order.notes && <p className="mt-2 text-ink-3">Note: {order.notes}</p>}
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Payment</h2>
            <p className="text-ink-2">{paymentStatusLabel(order.payment_status)}</p>
            {payment?.gcash_reference && <p className="font-mono text-ink-3">Ref {payment.gcash_reference}</p>}
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Placed</h2>
            <p className="text-ink-2">{formatDateTime(order.created_at, { year: 'numeric' })}</p>
          </section>
          <div className="flex flex-col items-start gap-2 border-t border-line pt-4">
            {customerCanCancel(order.status) && (
              <Button variant="danger-quiet" className="-ml-4" onClick={() => setCancelOpen(true)}>
                Cancel order
              </Button>
            )}
            <Link to={`/account/support/new?order=${order.id}`} className="font-semibold underline underline-offset-4">
              Get help with this order
            </Link>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        body="You haven’t paid yet, so there’s nothing to refund."
        confirmLabel="Cancel order"
        reason={{ label: 'Reason', placeholder: 'Ordered by mistake, changed my mind…' }}
        loading={update.isPending}
        error={update.error ? <Notice tone="danger">{userMessage(update.error)}</Notice> : null}
        onConfirm={async (note) => {
          await update.mutateAsync({ orderId: order.id, status: 'cancelled', note });
          setCancelOpen(false);
          toast('Order cancelled');
        }}
      />
    </div>
  );
}
