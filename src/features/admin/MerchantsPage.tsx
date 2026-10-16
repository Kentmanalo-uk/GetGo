import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Store } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/ui/Feedback';
import { PageHeader, StatusText, StoreMark, Tabs, formatDate } from '@/components/ui/Display';
import { CATEGORY_LABELS } from '@/types/models';
import { useMerchants, type MerchantTab } from './api';
import { DataTable, ListSkeleton, LoadMore, MERCHANT_STATUS_LABELS, SearchBox, merchantTone } from './ui';

const TABS: Array<{ value: MerchantTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'closed', label: 'Closed' },
];

export default function MerchantsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('status')) ? params.get('status') : 'all') as MerchantTab;
  const search = params.get('q') ?? '';
  const list = useMerchants(tab, search);

  const update = useCallback(
    (key: string, value: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value && value !== 'all') next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const onSearch = useCallback((value: string) => update('q', value), [update]);

  return (
    <div>
      <PageHeader title="Merchants" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs label="Merchant status" value={tab} onChange={(v) => update('status', v)} items={TABS} className="sm:flex-1" />
        <SearchBox value={search} onChange={onSearch} placeholder="Search name or slug" label="Search merchants" className="sm:mb-1.5" />
      </div>
      <div className="mt-4">
        {list.query.isPending ? (
          <ListSkeleton />
        ) : list.query.isError ? (
          <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState title={search ? 'No merchants match your search' : 'No merchants here'} icon={<Store className="size-8" />}>
            {search ? 'Try part of the store name or its link slug.' : 'Approved partner applications appear here as merchants.'}
          </EmptyState>
        ) : (
          <>
            <DataTable
              label="Merchants"
              rows={list.items}
              rowKey={(m) => m.id}
              rowLink={(m) => `/admin/merchants/${m.id}`}
              columns={[
                {
                  header: 'Store',
                  cell: (m) => (
                    <span className="flex items-center gap-3">
                      <StoreMark name={m.name} logoPath={m.logo_path} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}</span>
                        <span className="block truncate text-small font-normal text-ink-3">/{m.slug}</span>
                      </span>
                    </span>
                  ),
                },
                { header: 'Category', cell: (m) => CATEGORY_LABELS[m.category] },
                { header: 'Area', cell: (m) => m.service_areas?.name ?? '—' },
                { header: 'Status', cell: (m) => <StatusText tone={merchantTone(m.status)}>{MERCHANT_STATUS_LABELS[m.status]}</StatusText> },
                { header: 'Listed', cell: (m) => <span className="text-small text-ink-2">{m.is_published ? 'Published' : 'Hidden'}</span> },
                { header: 'Joined', align: 'right', cell: (m) => <span className="text-ink-2">{formatDate(m.created_at)}</span> },
              ]}
              mobile={(m) => (
                <div className="flex items-center gap-3">
                  <StoreMark name={m.name} logoPath={m.logo_path} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-3">
                      <StatusText tone={merchantTone(m.status)}>{MERCHANT_STATUS_LABELS[m.status]}</StatusText>
                      <span aria-hidden>·</span>
                      <span>{m.is_published ? 'Published' : 'Hidden'}</span>
                      {m.service_areas && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{m.service_areas.name}</span>
                        </>
                      )}
                    </p>
                  </div>
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
