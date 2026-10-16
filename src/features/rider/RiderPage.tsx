import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Phone, Store } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { ORDER_SELECT, useUpdateOrderStatus } from '@/features/consumer/api';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Money, StatusText, Tabs, formatDateTime, timeAgo } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { orderStatusLabel, riderNextStep, statusTone } from '@/domain/orderStatus';
import { formatMoney } from '@/domain/money';
import { supabase } from '@/lib/supabase';
import { realtimeChannel } from '@/lib/realtime';
import { unwrap, userMessage } from '@/lib/errors';
import type { OrderWithItems } from '@/types/models';

interface RiderProfile {
  user_id: string;
  full_name: string;
  service_area_id: string;
  gcash_name: string;
  gcash_number: string;
  status: 'active' | 'suspended';
}

interface Assignment {
  id: string;
  status: 'active' | 'completed' | 'released';
  completed_at: string | null;
  order: OrderWithItems | null;
}

function useRiderProfile(userId: string | null) {
  return useQuery({
    queryKey: ['rider', 'profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => unwrap(await supabase.from('rider_profiles').select('*').eq('user_id', userId!).maybeSingle()) as RiderProfile | null,
  });
}

function useAvailableOrders(areaId: string | null) {
  return useQuery({
    queryKey: ['rider', 'available', areaId],
    enabled: Boolean(areaId),
    queryFn: async () =>
      unwrap(
        await supabase.from('orders').select(ORDER_SELECT).eq('status', 'pending').eq('service_area_id', areaId!).order('created_at').limit(30),
      ) as unknown as OrderWithItems[],
    refetchInterval: 30_000,
  });
}

function useAssignments(userId: string | null) {
  return useQuery({
    queryKey: ['rider', 'assignments', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('assignments')
          .select(`id, status, completed_at, order:orders(${ORDER_SELECT})`)
          .eq('rider_id', userId!)
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(30),
      ) as unknown as Assignment[],
    refetchInterval: 30_000,
  });
}

function useRiderMutation<TArgs>(fn: (args: TArgs) => PromiseLike<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => fn(args),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rider'] }),
  });
}

/** What to buy: the order's items, options and notes as a tickable list. */
function ShoppingList({ order, checkable }: { order: OrderWithItems; checkable?: boolean }) {
  const storageKey = `getgo.rider.list.${order.id}`;
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return (
    <ul className="divide-y divide-line border-y border-line">
      {order.order_items.map((item) => {
        const checked = done.includes(item.id);
        const body = (
          <span className={cx('min-w-0 flex-1', checked && 'text-ink-3 line-through')}>
            <span className="font-semibold">
              {item.quantity}× {item.product_name}
              {item.variant_name && ` · ${item.variant_name}`}
            </span>
            {item.order_item_options.length > 0 && (
              <span className="block text-small text-ink-2">
                {item.order_item_options.map((o) => `${o.option_name}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`).join(', ')}
              </span>
            )}
            {item.instructions && <span className="block text-small font-medium text-warning">“{item.instructions}”</span>}
          </span>
        );
        return (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            {checkable ? (
              <label className="flex flex-1 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0 accent-ink" checked={checked} onChange={() => toggle(item.id)} />
                {body}
              </label>
            ) : (
              body
            )}
            <span className="tabular shrink-0 text-small text-ink-3">{formatMoney(item.line_total_minor)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Places({ order, showCustomer }: { order: OrderWithItems; showCustomer: boolean }) {
  const addr = order.delivery_address;
  return (
    <div className="grid gap-4 text-small sm:grid-cols-2">
      <div className="flex gap-3">
        <Store className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
        <div>
          <p className="font-semibold">Buy at {order.merchant_name}</p>
          <p className="text-ink-2">
            {order.pickup_address.line1}, {order.pickup_address.barangay}, {order.pickup_address.city}
          </p>
          {order.pickup_address.phone && (
            <a href={`tel:${order.pickup_address.phone}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
              <Phone className="size-3.5" aria-hidden /> Call store
            </a>
          )}
        </div>
      </div>
      <div className="flex gap-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
        <div>
          <p className="font-semibold">Deliver to {showCustomer ? addr.recipient_name : addr.barangay}</p>
          <p className="text-ink-2">
            {showCustomer ? `${addr.line1}, ` : ''}
            {addr.barangay}, {addr.city}
          </p>
          {showCustomer && addr.landmark && <p className="text-ink-3">{addr.landmark}</p>}
          {showCustomer && (
            <a href={`tel:${addr.phone}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
              <Phone className="size-3.5" aria-hidden /> {addr.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function AvailableOrder({ order }: { order: OrderWithItems }) {
  const toast = useToast();
  const accept = useRiderMutation((id: string) => supabase.rpc('rider_accept_order', { p_order_id: id }).then(unwrap));
  return (
    <article className="space-y-4 py-5" aria-label={`Order ${order.code}`}>
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-mono font-semibold">{order.code}</span>
        <span className="text-small text-ink-3">{timeAgo(order.created_at)}</span>
      </header>
      <Places order={order} showCustomer={false} />
      <ShoppingList order={order} />
      <dl className="grid grid-cols-2 gap-2 text-small">
        <div>
          <dt className="text-ink-3">You’ll pay the store</dt>
          <dd className="tabular font-semibold">{formatMoney(order.subtotal_minor)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Customer sends you</dt>
          <dd className="tabular font-semibold">{formatMoney(order.total_minor)}</dd>
        </div>
      </dl>
      {order.notes && <p className="text-small font-medium text-warning">Customer note: {order.notes}</p>}
      {accept.error && <Notice tone="danger">{userMessage(accept.error)}</Notice>}
      <Button block size="lg" loading={accept.isPending} onClick={() => accept.mutateAsync(order.id).then(() => toast(`You accepted ${order.code}`), () => undefined)}>
        Accept order
      </Button>
    </article>
  );
}

function MyOrder({ order }: { order: OrderWithItems }) {
  const toast = useToast();
  const payment = order.payments[0];
  const update = useUpdateOrderStatus();
  const confirm = useRiderMutation((args: { received: boolean; note?: string }) =>
    supabase.rpc('confirm_gcash_payment', { p_order_id: order.id, p_received: args.received, p_note: args.note ?? null }).then(unwrap),
  );
  const release = useRiderMutation((note: string) => supabase.rpc('rider_release_order', { p_order_id: order.id, p_note: note || null }).then(unwrap));
  const [dialog, setDialog] = useState<'not_received' | 'release' | 'cancel' | null>(null);
  const next = riderNextStep(order.status);
  const error = update.error ?? confirm.error ?? release.error;

  return (
    <article className="space-y-4 py-5" aria-label={`Order ${order.code}`}>
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-mono font-semibold">{order.code}</span>
        <StatusText tone={statusTone(order.status)}>{orderStatusLabel(order.status)}</StatusText>
      </header>

      {order.status === 'accepted' && (
        <Notice title={`Waiting for ${formatMoney(order.total_minor)} by GCash`}>
          The customer has your GCash details. Don’t buy anything until you confirm the payment.
          {payment?.rejection_note && <span className="mt-1 block">You said: “{payment.rejection_note}”</span>}
        </Notice>
      )}

      {order.status === 'payment_submitted' && payment && (
        <section aria-label="Confirm payment" className="rounded-media border-2 border-accent p-4">
          <p className="font-semibold">Check your GCash for {formatMoney(order.total_minor)}</p>
          <dl className="mt-2 text-small">
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-ink-3">Reference</dt>
              <dd className="font-mono font-semibold">{payment.gcash_reference}</dd>
            </div>
            {payment.sender_name && (
              <div className="flex justify-between gap-3 py-1">
                <dt className="text-ink-3">From</dt>
                <dd>{payment.sender_name}</dd>
              </div>
            )}
          </dl>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" loading={confirm.isPending && confirm.variables?.received} onClick={() => confirm.mutateAsync({ received: true }).then(() => toast('Payment confirmed — go buy the items'), () => undefined)}>
              Received
            </Button>
            <Button variant="secondary" onClick={() => setDialog('not_received')}>
              Not received
            </Button>
          </div>
        </section>
      )}

      <Places order={order} showCustomer={order.status !== 'accepted' && order.status !== 'payment_submitted'} />
      {order.notes && <p className="text-small font-medium text-warning">Customer note: {order.notes}</p>}

      <div>
        <p className="mb-1 text-small font-semibold">{order.status === 'buying' ? 'Shopping list' : 'Items'}</p>
        <ShoppingList order={order} checkable={order.status === 'buying'} />
        <p className="mt-2 text-small text-ink-3">
          Store total <Money minor={order.subtotal_minor} className="font-semibold text-ink" /> · your delivery and fees{' '}
          <Money minor={order.total_minor - order.subtotal_minor} className="font-semibold text-ink" />
        </p>
      </div>

      {error && <Notice tone="danger">{userMessage(error)}</Notice>}

      <div className="flex flex-wrap gap-2">
        {next && (
          <Button
            size="lg"
            className="flex-1"
            loading={update.isPending}
            onClick={() =>
              update
                .mutateAsync({ orderId: order.id, status: next.to })
                .then(() => toast(next.to === 'completed' ? 'Delivery completed' : 'On your way'), () => undefined)
            }
          >
            {next.label}
          </Button>
        )}
        {order.status === 'accepted' && (
          <Button variant="ghost" onClick={() => setDialog('release')}>
            Release order
          </Button>
        )}
        {(order.status === 'buying' || order.status === 'out_for_delivery') && (
          <Button variant="danger-quiet" onClick={() => setDialog('cancel')}>
            Can’t complete
          </Button>
        )}
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
          await update.mutateAsync({ orderId: order.id, status: 'cancelled', note });
          setDialog(null);
        }}
      />
    </article>
  );
}

type View = 'available' | 'mine';

export default function RiderPage() {
  const { userId, signOut } = useAuth();
  const qc = useQueryClient();
  const profile = useRiderProfile(userId);
  const areaId = profile.data?.status === 'active' ? profile.data.service_area_id : null;
  const available = useAvailableOrders(areaId);
  const assignments = useAssignments(userId);
  const active = assignments.data?.filter((a) => a.status === 'active' && a.order) ?? [];
  const done = assignments.data?.filter((a) => a.status === 'completed' && a.order) ?? [];
  const [view, setView] = useState<View>('available');

  useEffect(() => {
    if (active.length > 0) setView('mine');
  }, [assignments.isSuccess]); // open "My orders" once, when assignments first load

  // Live updates: new orders in the area and changes to this rider's jobs.
  useEffect(() => {
    if (!userId) return;
    const channel = realtimeChannel(`rider:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `rider_id=eq.${userId}` }, () =>
        qc.invalidateQueries({ queryKey: ['rider'] }),
      );
    if (areaId) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `service_area_id=eq.${areaId}` }, () =>
        qc.invalidateQueries({ queryKey: ['rider'] }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, areaId, qc]);

  return (
    <div className="page-x mx-auto max-w-3xl pb-12">
      <header className="safe-top flex items-center justify-between py-4">
        <Link to="/">
          <Logo suffix="Rider" />
        </Link>
        <button type="button" onClick={() => signOut()} className="text-small font-semibold underline underline-offset-4">
          Sign out
        </button>
      </header>

      {profile.isPending ? (
        <PageLoading rows={2} />
      ) : !profile.data ? (
        <EmptyState title="Your rider profile isn’t set up">Ask GETGO support to finish adding you as a rider.</EmptyState>
      ) : profile.data.status !== 'active' ? (
        <Notice tone="danger" title="Your rider account is suspended">
          Contact GETGO support for details.
        </Notice>
      ) : (
        <>
          <h1 className="text-title font-bold">Deliveries</h1>
          <p className="text-small text-ink-3">
            Customers pay you by GCash at {profile.data.gcash_number} ({profile.data.gcash_name})
          </p>
          <Tabs
            label="Order views"
            value={view}
            onChange={setView}
            className="mt-4"
            items={[
              { value: 'available' as View, label: 'Available', count: available.data?.length },
              { value: 'mine' as View, label: 'My orders', count: active.length },
            ]}
          />

          {view === 'available' ? (
            available.isPending ? (
              <PageLoading rows={2} />
            ) : available.isError ? (
              <ErrorState error={available.error} onRetry={() => available.refetch()} />
            ) : available.data.length === 0 ? (
              <EmptyState title="No orders waiting">New orders in your area appear here and in your notifications.</EmptyState>
            ) : (
              <div className="divide-y divide-line">
                {available.data.map((o) => (
                  <AvailableOrder key={o.id} order={o} />
                ))}
              </div>
            )
          ) : assignments.isPending ? (
            <PageLoading rows={2} />
          ) : assignments.isError ? (
            <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
          ) : (
            <>
              {active.length === 0 ? (
                <EmptyState title="No active orders">Accept an order from the Available tab.</EmptyState>
              ) : (
                <div className="divide-y divide-line">
                  {active.map((a) => (
                    <MyOrder key={a.id} order={a.order!} />
                  ))}
                </div>
              )}
              {done.length > 0 && (
                <section aria-labelledby="done-heading" className="mt-10">
                  <h2 id="done-heading" className="mb-2 text-heading font-semibold">
                    Delivered
                  </h2>
                  <ul className="divide-y divide-line text-small">
                    {done.map((a) => (
                      <li key={a.id} className="flex justify-between gap-4 py-2">
                        <span className="font-mono">{a.order!.code}</span>
                        <span className="flex-1 truncate text-ink-3">{a.order!.merchant_name}</span>
                        <span className="text-ink-3">{formatDateTime(a.completed_at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
