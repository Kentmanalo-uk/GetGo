import { useSearchParams } from 'react-router';
import { LifeBuoy } from '@/components/icons';
import { EmptyState, ErrorState, Notice } from '@/components/ui/Feedback';
import { PageHeader, StatusText, Tabs, formatDateTime, timeAgo } from '@/components/ui/Display';
import type { Ticket } from '@/features/support/SupportPages';
import { personLabel, useAdminTickets, useAdminOverview, usePermissions, useProfiles, type TicketTab } from './api';
import { DataTable, ListSkeleton, LoadMore, STAFF_TICKET_LABELS, ticketTone } from './ui';

const TABS: Array<{ value: TicketTab; label: string }> = [
  { value: 'open', label: 'Needs reply' },
  { value: 'pending', label: 'Waiting on customer' },
  { value: 'mine', label: 'Assigned to me' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<TicketTab, string> = {
  open: 'Every request has a reply.',
  pending: 'No requests are waiting on customers.',
  mine: 'No open requests are assigned to you.',
  resolved: 'No resolved requests.',
  closed: 'No closed requests.',
  active: 'No open requests.',
  all: 'No support requests yet.',
};

export default function SupportPage() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'open') as TicketTab;
  const list = useAdminTickets(tab, perms.canHandleTickets);
  const overview = useAdminOverview();
  const people = useProfiles(list.items.flatMap((t) => [t.user_id, t.assigned_to]));

  if (!perms.canHandleTickets) {
    return (
      <div>
        <PageHeader title="Support" />
        <Notice>Support requests are handled by admin and support staff.</Notice>
      </div>
    );
  }

  const assignee = (t: Ticket) => (t.assigned_to ? (t.assigned_to === perms.userId ? 'You' : personLabel(people.data?.[t.assigned_to], 'Staff')) : 'Unassigned');

  return (
    <div>
      <PageHeader title="Support" />
      <Tabs
        label="Request status"
        value={tab}
        onChange={(v) => setParams(v === 'open' ? {} : { tab: v }, { replace: true })}
        items={TABS}
        className="mb-4"
      />
      {overview.data && overview.data.open_tickets > 0 && tab === 'open' && (
        <p className="mb-3 text-small text-ink-3">
          {overview.data.open_tickets} open {overview.data.open_tickets === 1 ? 'request' : 'requests'} in total, including those waiting on customers.
        </p>
      )}
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title={EMPTY[tab]} icon={<LifeBuoy className="size-8" />} />
      ) : (
        <>
          <DataTable
            label="Support requests"
            rows={list.items}
            rowKey={(t) => t.id}
            rowLink={(t) => `/admin/support/${t.id}`}
            columns={[
              { header: 'Subject', cell: (t) => t.subject },
              { header: 'Customer', cell: (t) => <span className="text-small">{personLabel(people.data?.[t.user_id], 'Customer')}</span> },
              {
                header: 'Status',
                cell: (t) => (
                  <span>
                    <StatusText tone={ticketTone(t.status)}>{STAFF_TICKET_LABELS[t.status]}</StatusText>
                    {t.priority === 'high' && <span className="block text-micro font-semibold text-accent-ink">High priority</span>}
                  </span>
                ),
              },
              { header: 'Assigned', cell: (t) => <span className="text-small text-ink-2">{assignee(t)}</span> },
              {
                header: 'Updated',
                align: 'right',
                cell: (t) => (
                  <span className="text-ink-2" title={formatDateTime(t.updated_at, { year: 'numeric' })}>
                    {timeAgo(t.updated_at)}
                  </span>
                ),
              },
            ]}
            mobile={(t) => (
              <div className="space-y-0.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-semibold">{t.subject}</p>
                  <span className="shrink-0 text-small text-ink-3">{timeAgo(t.updated_at)}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-3">
                  <StatusText tone={ticketTone(t.status)}>{STAFF_TICKET_LABELS[t.status]}</StatusText>
                  {t.priority === 'high' && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-semibold text-accent-ink">High priority</span>
                    </>
                  )}
                </p>
                <p className="text-small text-ink-3">
                  {personLabel(people.data?.[t.user_id], 'Customer')} · {assignee(t)}
                </p>
              </div>
            )}
          />
          <LoadMore paged={list} />
        </>
      )}
    </div>
  );
}
