import { Link } from 'react-router';
import { Receipt } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { Money, PageHeader, StatusText, formatDateTime } from '@/components/ui/Display';
import { customerStatusLabel, isOpenStatus, statusTone } from '@/domain/orderStatus';
import type { OrderWithItems } from '@/types/models';
import { useMyOrders, useOrderRealtime } from './api';

function OrderRow({ order }: { order: OrderWithItems }) {
  const summary = order.order_items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ');
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="group flex gap-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-3">
            <span className="truncate font-semibold group-hover:underline group-hover:underline-offset-4">{order.merchant_name}</span>
            <Money minor={order.total_minor} className="shrink-0 font-semibold" />
          </p>
          <p className="truncate text-small text-ink-3">{summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-small text-ink-3">
            <StatusText tone={statusTone(order.status)}>{customerStatusLabel(order.status, order.service)}</StatusText>
            <span aria-hidden>·</span>
            <span>{formatDateTime(order.created_at)}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">{order.code}</span>
          </p>
        </div>
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
    <div className="page-x mx-auto max-w-3xl">
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
        <div className="space-y-8">
          {active.length > 0 && (
            <section aria-labelledby="active-heading">
              <h2 id="active-heading" className="text-heading font-semibold">
                In progress
              </h2>
              <ul className="divide-y divide-line">
                {active.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-heading">
              <h2 id="past-heading" className="text-heading font-semibold">
                Past orders
              </h2>
              <ul className="divide-y divide-line">
                {past.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
