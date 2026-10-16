import { useState } from 'react';
import { Link } from 'react-router';
import { FileText } from 'lucide-react';
import { EmptyState, ErrorState, Notice } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Field';
import { PageHeader, formatDateTime } from '@/components/ui/Display';
import { personLabel, useAuditLogs, usePermissions, useProfiles, type AuditEntry } from './api';
import { JsonBlock, ListSkeleton, LoadMore } from './ui';

const ENTITY_LABELS: Record<string, string> = {
  order: 'Order',
  merchant: 'Merchant',
  partner_application: 'Application',
  refund: 'Refund',
  rider: 'Rider',
  user_roles: 'Staff role',
  service_areas: 'Service area',
  promotions: 'Promotion',
  platform_settings: 'Platform settings',
};

/** Admin pages an audited entity can be opened on. */
function entityLink(entry: AuditEntry): string | null {
  if (!entry.entity_id) return null;
  switch (entry.entity_type) {
    case 'order':
      return `/admin/orders/${entry.entity_id}`;
    case 'merchant':
      return `/admin/merchants/${entry.entity_id}`;
    case 'partner_application':
      return `/admin/applications/${entry.entity_id}`;
    default:
      return null;
  }
}

function AuditRow({ entry, actor }: { entry: AuditEntry; actor: string }) {
  const [open, setOpen] = useState(false);
  const link = entityLink(entry);
  const hasDetails = entry.details != null && !(typeof entry.details === 'object' && Object.keys(entry.details as object).length === 0);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{entry.action}</p>
          <p className="text-small text-ink-3">
            {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
            {entry.entity_id && (
              <>
                {' · '}
                {link ? (
                  <Link to={link} className="font-mono underline underline-offset-4">
                    {entry.entity_id.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="font-mono">{entry.entity_id.slice(0, 8)}</span>
                )}
              </>
            )}
            {' · '}
            {actor}
          </p>
        </div>
        <span className="tabular shrink-0 text-small text-ink-3">{formatDateTime(entry.created_at, { year: 'numeric' })}</span>
      </div>
      {hasDetails && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 text-small font-semibold text-ink-2 underline-offset-4 hover:underline">
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open && <JsonBlock value={entry.details} />}
        </>
      )}
    </li>
  );
}

export default function AuditPage() {
  const perms = usePermissions();
  const [entity, setEntity] = useState('all');
  const list = useAuditLogs(entity, perms.canConfigure);
  const actors = useProfiles(list.items.map((e) => e.actor_id));

  if (!perms.canConfigure) {
    return (
      <div>
        <PageHeader title="Audit log" />
        <Notice>The audit log is available to administrators.</Notice>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Audit log"
        actions={
          <Select aria-label="Filter by record type" value={entity} onChange={(e) => setEntity(e.target.value)} className="h-9 w-44 text-small">
            <option value="all">All records</option>
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />
      {list.query.isPending ? (
        <ListSkeleton />
      ) : list.query.isError ? (
        <ErrorState error={list.query.error} onRetry={() => list.query.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" icon={<FileText className="size-8" />}>
          Approvals, status changes, refunds, role changes and setting edits are recorded here.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {list.items.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                actor={entry.actor_id ? personLabel(actors.data?.[entry.actor_id], 'Staff member') : 'System'}
              />
            ))}
          </ul>
          <LoadMore paged={list} />
        </>
      )}
    </div>
  );
}
