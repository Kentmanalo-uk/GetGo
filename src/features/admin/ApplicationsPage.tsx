import { useSearchParams } from 'react-router';
import { ClipboardList } from 'lucide-react';
import { EmptyState, ErrorState, Notice } from '@/components/ui/Feedback';
import { PageHeader, StatusText, Tabs, formatDate, formatDateTime } from '@/components/ui/Display';
import { CATEGORY_LABELS } from '@/types/models';
import { useApplicationCounts, useApplications, usePermissions, type ApplicationListRow, type ApplicationTab } from './api';
import { APPLICATION_LABELS, DataTable, ListSkeleton, LoadMore, applicationTone } from './ui';

const TABS: Array<{ value: ApplicationTab; label: string }> = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'needs_changes', label: 'Needs changes' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Drafts' },
];

const EMPTY: Record<ApplicationTab, string> = {
  waiting: 'No applications are waiting for review.',
  needs_changes: 'No applications are waiting on the applicant.',
  approved: 'No approved applications yet.',
  rejected: 'No rejected applications.',
  draft: 'No applications in progress.',
};

export default function ApplicationsPage() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'waiting') as ApplicationTab;
  const counts = useApplicationCounts(perms.canReviewApplications);
  const list = useApplications(tab, perms.canReviewApplications);

  if (!perms.canReviewApplications) {
    return (
      <div>
        <PageHeader title="Applications" />
        <Notice>Partner applications are reviewed by admin and support staff.</Notice>
      </div>
    );
  }

  const dateFor = (a: ApplicationListRow) => (tab === 'waiting' ? a.submitted_at : (a.reviewed_at ?? a.updated_at));

  return (
    <div>
      <PageHeader title="Applications" />
      <Tabs
        label="Application status"
        value={tab}
        onChange={(value) => setParams(value === 'waiting' ? {} : { tab: value }, { replace: true })}
        items={TABS.map((t) => ({ ...t, count: t.value === 'waiting' || t.value === 'needs_changes' ? counts.data?.[t.value] : undefined }))}
        className="mb-4"
      />
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title={EMPTY[tab]} icon={<ClipboardList className="size-8" />} />
      ) : (
        <>
          <DataTable
            label="Applications"
            rows={list.items}
            rowKey={(a) => a.id}
            rowLink={(a) => `/admin/applications/${a.id}`}
            columns={[
              { header: 'Business', cell: (a) => a.business_name || 'Untitled application' },
              { header: 'Category', cell: (a) => (a.category ? CATEGORY_LABELS[a.category] : '—') },
              { header: 'Area', cell: (a) => a.service_areas?.name ?? '—' },
              { header: 'Owner', cell: (a) => a.owner_name || '—' },
              { header: 'Status', cell: (a) => <StatusText tone={applicationTone(a.status)}>{APPLICATION_LABELS[a.status]}</StatusText> },
              {
                header: tab === 'waiting' ? 'Submitted' : 'Updated',
                align: 'right',
                cell: (a) => <span className="text-ink-2">{formatDateTime(dateFor(a))}</span>,
              },
            ]}
            mobile={(a) => (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{a.business_name || 'Untitled application'}</p>
                  <p className="mt-0.5 text-small text-ink-3">
                    {[a.category && CATEGORY_LABELS[a.category], a.service_areas?.name, a.owner_name].filter(Boolean).join(' · ')}
                  </p>
                  <StatusText tone={applicationTone(a.status)} className="mt-1">
                    {APPLICATION_LABELS[a.status]}
                  </StatusText>
                </div>
                <span className="tabular shrink-0 text-small text-ink-3">{formatDate(dateFor(a))}</span>
              </div>
            )}
          />
          <LoadMore paged={list} />
        </>
      )}
    </div>
  );
}
