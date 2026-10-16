import { Navigate, useNavigate, useParams } from 'react-router';
import { Package } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServiceAreas } from '@/features/consumer/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, SectionHeading, timeAgo } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/errors';
import { useAcceptOrder, useAvailableOrders, useJobs, useRiderOrder } from './api';
import { MoneySplit, OrderCard, Route, ShoppingList } from './components';
import { useRider } from './RiderLayout';

/** Orders waiting for a rider in the rider's area. */
export function RiderOrdersPage() {
  const { profile } = useRider();
  const areas = useServiceAreas();
  const area = areas.data?.find((a) => a.id === profile.service_area_id);
  const available = useAvailableOrders(profile.service_area_id);

  return (
    <div className="pb-6">
      <PageHeader title="Available orders">{area ? `Waiting for a rider in ${area.name}` : 'Waiting for a rider in your area'}</PageHeader>
      {available.isPending ? (
        <PageLoading rows={3} />
      ) : available.isError ? (
        <ErrorState error={available.error} onRetry={() => available.refetch()} />
      ) : available.data.length === 0 ? (
        <EmptyState title="No orders waiting" icon={<Package className="size-10" weight="fill" />}>
          New orders appear here as soon as customers place them. This list updates by itself.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {available.data.map((o) => (
            <OrderCard key={o.id} order={o} to={`/rider/orders/${o.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One waiting order: everything a rider needs to decide, and Accept. */
export function RiderOrderPreviewPage() {
  const { orderId } = useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const order = useRiderOrder(orderId);
  const jobs = useJobs(userId);
  const accept = useAcceptOrder();

  if (order.isPending) return <PageLoading rows={3} />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;

  const o = order.data;
  // Already this rider's job: show the job screen instead.
  if (o && jobs.data?.active.some((j) => j.order.id === o.id)) return <Navigate to={`/rider/jobs/${o.id}`} replace />;
  if (!o || o.status !== 'pending') {
    return (
      <>
        <PageHeader title="Order unavailable" back="/rider/orders" />
        <EmptyState title="Another rider took this order" action={<ButtonLink to="/rider/orders">See other orders</ButtonLink>}>
          Or the customer cancelled it.
        </EmptyState>
      </>
    );
  }

  const onAccept = () =>
    accept.mutateAsync(o.id).then(
      () => {
        toast(`You accepted ${o.code}`);
        navigate(`/rider/jobs/${o.id}`, { replace: true });
      },
      () => undefined,
    );

  return (
    <div className="pb-40 lg:pb-6">
      <PageHeader title={o.merchant_name} back="/rider/orders">
        <span className="font-mono">{o.code}</span> · placed {timeAgo(o.created_at)}
      </PageHeader>

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10 lg:space-y-0">
        <div className="space-y-8">
          <section aria-label="Route">
            <Route order={o} showCustomer={false} />
          </section>
          <section aria-labelledby="buy-heading">
            <SectionHeading id="buy-heading" title="What you’ll buy" />
            <ShoppingList order={o} />
            {o.notes && <Notice className="mt-3" title="Customer note">{o.notes}</Notice>}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8">
          <MoneySplit order={o} />
          <p className="text-small text-ink-3">The customer sends the total to your GCash first. Buy the items only after you confirm the payment.</p>
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
            {accept.error && (
              <Notice tone="danger" className="mb-3">
                {userMessage(accept.error)}
              </Notice>
            )}
            <Button block size="lg" loading={accept.isPending} onClick={onAccept}>
              Accept order
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
