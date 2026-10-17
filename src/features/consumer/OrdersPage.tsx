import { Link } from 'react-router';
import { ChevronRight, ListChecks, Package, Receipt } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { MediaImage, Money, PageHeader, StatusText, StoreMark, formatDateTime } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { customerStatusLabel, isOpenStatus, progressIndex, statusTone } from '@/domain/orderStatus';
import { ERRAND_TYPES, PARCEL_SIZES, type ErrandTask, type OrderWithItems, type PadalaTask } from '@/types/models';
import { useMyOrders, useOrderRealtime } from './api';

/** The order's picture: an item photo, or the padala/errand icon, or the store's initials. */
function OrderThumb({ order, size = 'md' }: { order: OrderWithItems; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16' : 'size-14';
  if (order.service !== 'pabili') {
    const Icon = order.service === 'padala' ? Package : ListChecks;
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center rounded-media bg-accent-soft', box)}>
        <Icon className={cx('size-8', ICON_GRADIENT)} weight="fill" aria-hidden />
      </span>
    );
  }
  const image = order.order_items.find((i) => i.product?.image_path)?.product?.image_path;
  if (image) return <MediaImage path={image} alt="" className={cx('shrink-0 rounded-media', box)} />;
  return <StoreMark name={order.merchant_name} size={size === 'lg' ? 'lg' : 'md'} className={box} />;
}

function summary(order: OrderWithItems) {
  if (order.service === 'padala') {
    const t = order.task as PadalaTask;
    return `${PARCEL_SIZES[t.size]?.label ?? ''} parcel to Brgy. ${order.delivery_address.barangay}`;
  }
  if (order.service === 'errand') {
    const t = order.task as ErrandTask;
    return t.description.split('\n')[0] || (ERRAND_TYPES[t.type]?.label ?? 'Errand');
  }
  const count = order.order_items.reduce((n, i) => n + i.quantity, 0);
  const first = order.order_items[0]?.product_name ?? '';
  return count > 1 ? `${first} + ${count - 1} more` : first;
}

/** An order in progress: a card with its live status and progress. */
function ActiveOrderCard({ order }: { order: OrderWithItems }) {
  const step = Math.max(progressIndex(order.status), 0);
  return (
    <Link to={`/orders/${order.id}`} className="group block rounded-sheet bg-surface p-4 shadow-card transition-transform hover:-translate-y-0.5">
      <div className="flex gap-4">
        <OrderThumb order={order} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate font-semibold">{order.merchant_name}</p>
            <Money minor={order.total_minor} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-small text-ink-3">{summary(order)}</p>
          <p className="mt-1.5 flex items-center gap-2 text-small font-semibold">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
              <span className="relative size-2 rounded-full bg-accent-strong" />
            </span>
            {customerStatusLabel(order.status, order.service)}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="grid flex-1 grid-cols-5 gap-1" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cx('h-1.5 rounded-full', i <= step ? 'bg-accent-strong' : 'bg-line')} />
          ))}
        </div>
        <span className="inline-flex items-center gap-0.5 text-small font-semibold text-accent-ink">
          Track <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

function PastOrderRow({ order }: { order: OrderWithItems }) {
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="group flex items-center gap-4 py-4 sm:-mx-3 sm:rounded-control sm:px-3 sm:hover:bg-canvas">
        <OrderThumb order={order} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate font-semibold">{order.merchant_name}</p>
            <Money minor={order.total_minor} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-small text-ink-3">{summary(order)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-ink-3">
            <StatusText tone={statusTone(order.status)}>{customerStatusLabel(order.status, order.service)}</StatusText>
            <span aria-hidden>·</span>
            <span>{formatDateTime(order.created_at)}</span>
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-ink-4" aria-hidden />
      </Link>
    </li>
  );
}

export default function OrdersPage() {
  const { status, userId } = useAuth();
  const orders = useMyOrders('all');
  useOrderRealtime({ column: 'customer_id', value: userId }, [['orders', userId]]);

  if (status === 'signed_out') {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageHeader title="Orders" />
        <EmptyState title="Sign in to see your orders" icon={<Receipt className="size-8" />} action={<ButtonLink to="/sign-in?next=/orders">Sign in</ButtonLink>} />
      </div>
    );
  }

  const active = orders.data?.filter((o) => isOpenStatus(o.status)) ?? [];
  const past = orders.data?.filter((o) => !isOpenStatus(o.status)) ?? [];

  return (
    <div className="page-x mx-auto max-w-3xl pb-10">
      <PageHeader title="Orders" />
      {orders.isPending ? (
        <PageLoading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
      ) : orders.data.length === 0 ? (
        <EmptyState title="No orders yet" icon={<Receipt className="size-8" />} action={<ButtonLink to="/">Start an order</ButtonLink>}>
          When you order, you can follow your rider here from store to door.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {active.length > 0 && (
            <section aria-labelledby="active-heading">
              <h2 id="active-heading" className="mb-3 text-heading font-semibold">
                In progress
              </h2>
              <div className="space-y-4">
                {active.map((o) => (
                  <ActiveOrderCard key={o.id} order={o} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-heading">
              <h2 id="past-heading" className="text-heading font-semibold">
                Past orders
              </h2>
              <ul className="divide-y divide-line">
                {past.map((o) => (
                  <PastOrderRow key={o.id} order={o} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
