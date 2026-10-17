import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorState, LoadingDots } from '@/components/ui/Feedback';
import { Money, PageHeader, StatusText, TextLink, timeAgo } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABELS } from '@/types/models';
import {
  activeRiderName,
  personLabel,
  useAdminOrders,
  useAdminOverview,
  useAdminTickets,
  useApplications,
  usePermissions,
  useProfiles,
  useRefunds,
  type OrderListRow,
} from './api';
import { ORDER_STATUS_LABELS, REFUND_LABELS, RoleNote, orderTone, refundTone } from './ui';

interface QueueState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function Queue<T>({
  id,
  title,
  count,
  viewAll,
  state,
  items,
  empty,
  render,
  note,
}: {
  id: string;
  title: string;
  count: number | undefined;
  viewAll: string;
  state: QueueState;
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
  note?: ReactNode;
}) {
  return (
    <section aria-labelledby={`queue-${id}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={`queue-${id}`} className="text-heading font-semibold">
          {title}
          {count != null && count > 0 && <span className="tabular ml-2 text-ink-3">{count}</span>}
        </h2>
        <TextLink to={viewAll} className="text-small">
          View all
        </TextLink>
      </div>
      {note}
      {state.isPending ? (
        <div className="border-t border-line pt-3">
          <LoadingDots />
        </div>
      ) : state.isError ? (
        <ErrorState className="py-4" error={state.error} onRetry={() => state.refetch()} />
      ) : items.length === 0 ? (
        <p className="border-t border-line pt-3 text-small text-ink-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">{items.slice(0, 5).map(render)}</ul>
      )}
    </section>
  );
}

function QueueRow({ to, title, meta, trailing }: { to: string; title: ReactNode; meta: ReactNode; trailing?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex items-start gap-3 py-3 hover:bg-canvas/60">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-ink-3">{meta}</div>
        </div>
        {trailing && <div className="shrink-0 text-right text-small">{trailing}</div>}
      </Link>
    </li>
  );
}

function OrderQueueRow({ order }: { order: OrderListRow }) {
  const rider = activeRiderName(order);
  return (
    <QueueRow
      to={`/admin/orders/${order.id}`}
      title={
        <>
          <span className="font-mono">{order.code}</span> · {order.merchant_name}
        </>
      }
      meta={
        <>
          <StatusText tone={orderTone(order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</StatusText>
          {rider && (
            <>
              <span aria-hidden>·</span>
              <span>{rider}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{timeAgo(order.created_at)}</span>
        </>
      }
      trailing={<Money minor={order.total_minor} />}
    />
  );
}

function SummaryStrip() {
  const overview = useAdminOverview();
  if (overview.isError) return <ErrorState className="py-4" error={overview.error} onRetry={() => overview.refetch()} />;
  const d = overview.data;
  const items: Array<{ label: string; value: ReactNode }> = [
    { label: 'Orders today', value: d?.orders_today },
    { label: 'Open orders', value: d?.orders_open },
    { label: 'Delivered sales today', value: d ? formatMoney(d.gmv_today_minor) : undefined },
    { label: 'Live stores', value: d?.active_merchants },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:flex sm:flex-wrap sm:gap-x-12">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-small text-ink-3">{item.label}</dt>
          <dd className="tabular mt-0.5 text-title font-bold">{item.value ?? <LoadingDots />}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function OverviewPage() {
  const perms = usePermissions();
  const overview = useAdminOverview();
  const waiting = useAdminOrders('needs_rider', '', { oldestFirst: true });
  const toConfirm = useAdminOrders('confirm_payment', '', { oldestFirst: true });
  const applications = useApplications('waiting', perms.canReviewApplications);
  const refunds = useRefunds('open', true);
  const tickets = useAdminTickets('active', perms.canHandleTickets);
  const ticketPeople = useProfiles(tickets.items.slice(0, 5).map((t) => t.user_id));
  const counts = overview.data;

  return (
    <div>
      <PageHeader title="Overview" />
      <SummaryStrip />

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <Queue
          id="rider"
          title="Waiting for a rider"
          count={counts?.orders_waiting_for_rider}
          viewAll="/admin/orders?tab=needs_rider"
          state={waiting.query}
          items={waiting.items}
          empty="No orders are waiting for a rider."
          note={!perms.canOperateOrders && <RoleNote className="mb-2">Admin or support staff assign riders.</RoleNote>}
          render={(o) => <OrderQueueRow key={o.id} order={o} />}
        />

        <Queue
          id="payments"
          title="GCash payments to confirm"
          count={counts?.payments_to_confirm}
          viewAll="/admin/orders?tab=confirm_payment"
          state={toConfirm.query}
          items={toConfirm.items}
          empty="No submitted payments are waiting on a rider."
          note={<RoleNote className="mb-2">The assigned rider confirms receipt. Follow up if one waits too long.</RoleNote>}
          render={(o) => <OrderQueueRow key={o.id} order={o} />}
        />

        {perms.canReviewApplications && (
          <Queue
            id="applications"
            title="Applications waiting"
            count={counts?.applications_waiting}
            viewAll="/admin/applications"
            state={applications.query}
            items={applications.items}
            empty="No partner applications are waiting for review."
            render={(a) => (
              <QueueRow
                key={a.id}
                to={`/admin/applications/${a.id}`}
                title={a.business_name || 'Untitled application'}
                meta={[a.category && CATEGORY_LABELS[a.category], a.service_areas?.name].filter(Boolean).join(' · ')}
                trailing={<span className="text-ink-3">{a.status === 'under_review' ? 'In review' : a.submitted_at ? timeAgo(a.submitted_at) : '—'}</span>}
              />
            )}
          />
        )}

        <Queue
          id="refunds"
          title="Refunds waiting"
          count={counts?.refunds_waiting}
          viewAll={perms.canHandleMoney ? '/admin/payments' : '/admin/orders'}
          state={refunds.query}
          items={refunds.items}
          empty="No refunds are waiting."
          note={!perms.canHandleMoney && <RoleNote className="mb-2">Finance or admin staff approve and send refunds.</RoleNote>}
          render={(r) => (
            <QueueRow
              key={r.id}
              to={perms.canHandleMoney ? '/admin/payments' : `/admin/orders/${r.order_id}`}
              title={
                <>
                  <span className="font-mono">{r.orders?.code ?? 'Order'}</span> · {r.orders?.customer_name}
                </>
              }
              meta={
                <>
                  <StatusText tone={refundTone(r.status)}>{REFUND_LABELS[r.status]}</StatusText>
                  <span aria-hidden>·</span>
                  <span>{timeAgo(r.created_at)}</span>
                </>
              }
              trailing={<Money minor={r.amount_minor} />}
            />
          )}
        />

        {perms.canHandleTickets && (
          <Queue
            id="tickets"
            title="Open support requests"
            count={counts?.open_tickets}
            viewAll="/admin/support"
            state={tickets.query}
            items={tickets.items}
            empty="No open support requests."
            render={(t) => (
              <QueueRow
                key={t.id}
                to={`/admin/support/${t.id}`}
                title={t.subject}
                meta={
                  <>
                    {t.priority === 'high' && (
                      <>
                        <StatusText tone="attention">High priority</StatusText>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <span>{personLabel(ticketPeople.data?.[t.user_id], 'Customer')}</span>
                    <span aria-hidden>·</span>
                    <span>{t.status === 'pending' ? 'Waiting on customer' : 'Needs reply'}</span>
                  </>
                }
                trailing={<span className="text-ink-3">{timeAgo(t.updated_at)}</span>}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
