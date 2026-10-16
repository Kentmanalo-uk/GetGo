import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Receipt } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/ui/Feedback';
import { Money, PageHeader, StatusText, Tabs, formatDateTime, timeAgo } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import { activeRiderName, useAdminOrders, useAdminOverview, type OrderListRow, type OrderTab } from './api';
import { DataTable, ListSkeleton, LoadMore, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, SearchBox, orderTone } from './ui';

const TABS: Array<{ value: OrderTab; label: string }> = [
  { value: 'active', label: 'Open' },
  { value: 'needs_rider', label: 'Needs rider' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'confirm_payment', label: 'Payment to confirm' },
  { value: 'delivering', label: 'Buying & delivering' },
  { value: 'completed', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<OrderTab, string> = {
  active: 'No open orders right now.',
  needs_rider: 'No orders are waiting for a rider.',
  awaiting_payment: 'No orders are waiting for the customer’s GCash payment.',
  confirm_payment: 'No submitted GCash payments are waiting on a rider.',
  delivering: 'No riders are buying or delivering right now.',
  completed: 'No delivered orders yet.',
  cancelled: 'No cancelled orders.',
  all: 'No orders yet.',
};

/** Queues where the oldest order is the most urgent. */
const OLDEST_FIRST = new Set<OrderTab>(['needs_rider', 'awaiting_payment', 'confirm_payment']);

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'active') as OrderTab;
  const search = params.get('q') ?? '';
  const list = useAdminOrders(tab, search, { oldestFirst: OLDEST_FIRST.has(tab) });
  const overview = useAdminOverview();

  const update = useCallback(
    (key: string, value: string, fallback: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value && value !== fallback) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const onSearch = useCallback((value: string) => update('q', value, ''), [update]);

  const counts: Partial<Record<OrderTab, number | undefined>> = {
    needs_rider: overview.data?.orders_waiting_for_rider,
    confirm_payment: overview.data?.payments_to_confirm,
  };

  const riderCell = (o: OrderListRow) => {
    const name = activeRiderName(o);
    if (name) return <span className="text-small text-ink-2">{name}</span>;
    return o.status === 'pending' ? <span className="text-small font-semibold">No rider yet</span> : <span className="text-small text-ink-3">—</span>;
  };

  return (
    <div>
      <PageHeader title="Orders" />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs
          label="Order status"
          value={tab}
          onChange={(v) => update('tab', v, 'active')}
          items={TABS.map((t) => ({ ...t, count: counts[t.value] }))}
          className="lg:min-w-0 lg:flex-1"
        />
        <SearchBox value={search} onChange={onSearch} placeholder="Order code" label="Search by order code" className="lg:mb-1.5 lg:w-56" />
      </div>
      <div className="mt-4">
        {list.query.isPending ? (
          <ListSkeleton />
        ) : list.query.isError ? (
          <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState title={search ? `No orders match “${search}”` : EMPTY[tab]} icon={<Receipt className="size-8" />}>
            {search ? 'Search uses the order code, e.g. GG-7KQ2MX. Try the All tab.' : undefined}
          </EmptyState>
        ) : (
          <>
            <DataTable
              label="Orders"
              rows={list.items}
              rowKey={(o) => o.id}
              rowLink={(o) => `/admin/orders/${o.id}`}
              columns={[
                { header: 'Order', cell: (o) => <span className="font-mono">{o.code}</span> },
                { header: 'Store', cell: (o) => o.merchant_name },
                { header: 'Customer', cell: (o) => o.customer_name },
                { header: 'Status', cell: (o) => <StatusText tone={orderTone(o.status)}>{ORDER_STATUS_LABELS[o.status] ?? o.status}</StatusText> },
                { header: 'Rider', cell: riderCell },
                { header: 'Payment', cell: (o) => <span className="text-small text-ink-2">{PAYMENT_STATUS_LABELS[o.payment_status] ?? o.payment_status}</span> },
                { header: 'Total', align: 'right', cell: (o) => formatMoney(o.total_minor) },
                {
                  header: 'Placed',
                  align: 'right',
                  cell: (o) => (
                    <span className="text-ink-2" title={formatDateTime(o.created_at, { year: 'numeric' })}>
                      {timeAgo(o.created_at)}
                    </span>
                  ),
                },
              ]}
              mobile={(o) => (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      <span className="font-mono">{o.code}</span> · {o.merchant_name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-ink-3">
                      <StatusText tone={orderTone(o.status)}>{ORDER_STATUS_LABELS[o.status] ?? o.status}</StatusText>
                      <span aria-hidden>·</span>
                      <span>{activeRiderName(o) ?? 'No rider'}</span>
                    </p>
                    <p className="text-small text-ink-3">
                      {o.customer_name} · {timeAgo(o.created_at)}
                    </p>
                  </div>
                  <Money minor={o.total_minor} className="shrink-0" />
                </div>
              )}
            />
            <LoadMore paged={list} />
          </>
        )}
      </div>
    </div>
  );
}
