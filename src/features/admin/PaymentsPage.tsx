import { Link, useSearchParams } from 'react-router';
import { CreditCard } from '@/components/icons';
import { EmptyState, ErrorState, Notice } from '@/components/ui/Feedback';
import { Money, PageHeader, StatusText, Tabs, formatDateTime, timeAgo } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import { usePermissions, useRefunds, type RefundTab } from './api';
import { RefundActions } from './MoneyActions';
import { DataTable, ListSkeleton, LoadMore, REFUND_LABELS, refundTone } from './ui';

const TABS: Array<{ value: RefundTab; label: string }> = [
  { value: 'open', label: 'Waiting' },
  { value: 'processed', label: 'Processed' },
  { value: 'rejected', label: 'Rejected' },
];

/** Manual GCash refunds: approve, send by GCash, then record the reference. */
export default function PaymentsPage() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'open') as RefundTab;
  const list = useRefunds(tab, perms.canHandleMoney);

  if (!perms.canHandleMoney) {
    return (
      <div>
        <PageHeader title="Refunds" />
        <Notice>Refunds are approved and sent by finance and admin staff. You can request a refund from an order’s page.</Notice>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Refunds" />
      <Tabs label="Refund status" value={tab} onChange={(v) => setParams(v === 'open' ? {} : { tab: v }, { replace: true })} items={TABS} className="mb-3" />
      {tab === 'open' && (
        <p className="mb-4 text-small text-ink-3">Approve a request, send the money to the customer by GCash, then mark it processed with the GCash reference.</p>
      )}
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No refunds waiting' : `No ${tab} refunds`} icon={<CreditCard className="size-8" />}>
          {tab === 'open' && 'Refunds are requested automatically when a paid order is cancelled, or by staff from an order.'}
        </EmptyState>
      ) : (
        <>
          <DataTable
            label="Refunds"
            rows={list.items}
            rowKey={(r) => r.id}
            columns={[
              {
                header: 'Order',
                cell: (r) => (
                  <Link to={`/admin/orders/${r.order_id}`} className="font-mono font-semibold hover:underline">
                    {r.orders?.code ?? 'Order'}
                  </Link>
                ),
              },
              {
                header: 'Customer / store',
                cell: (r) => (
                  <span className="text-small">
                    {r.orders?.customer_name}
                    <span className="block text-ink-3">{r.orders?.merchant_name}</span>
                  </span>
                ),
              },
              { header: 'Reason', cell: (r) => <span className="line-clamp-2 text-small text-ink-2">{r.reason}</span>, className: 'max-w-64' },
              { header: 'Amount', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.amount_minor)}</span> },
              {
                header: 'Status',
                cell: (r) => (
                  <span>
                    <StatusText tone={refundTone(r.status)}>{REFUND_LABELS[r.status]}</StatusText>
                    {r.reference && <span className="block text-micro break-all text-ink-3">GCash ref {r.reference}</span>}
                    {r.processed_at && <span className="block text-micro text-ink-3">{formatDateTime(r.processed_at)}</span>}
                  </span>
                ),
              },
              { header: 'Requested', align: 'right', cell: (r) => <span className="text-ink-2">{timeAgo(r.created_at)}</span> },
              { header: <span className="sr-only">Actions</span>, align: 'right', cell: (r) => <RefundActions refund={r} /> },
            ]}
            mobile={(r) => (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link to={`/admin/orders/${r.order_id}`} className="font-mono font-semibold underline-offset-4 hover:underline">
                    {r.orders?.code ?? 'Order'}
                  </Link>
                  <Money minor={r.amount_minor} className="font-semibold" />
                </div>
                <p className="text-small text-ink-3">
                  {r.orders?.customer_name} · {r.orders?.merchant_name} · {timeAgo(r.created_at)}
                </p>
                <p className="text-small text-ink-2">{r.reason}</p>
                <StatusText tone={refundTone(r.status)}>{REFUND_LABELS[r.status]}</StatusText>
                {r.reference && <p className="text-micro break-all text-ink-3">GCash ref {r.reference}</p>}
                <RefundActions refund={r} />
              </div>
            )}
          />
          <LoadMore paged={list} />
        </>
      )}
    </div>
  );
}
