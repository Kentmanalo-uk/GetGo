import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError, Notice, PageLoading, Skeleton } from '@/components/ui/Feedback';
import { Money, PageHeader, SectionHeading, StatusText, StoreMark, formatDate, formatDateTime, timeAgo } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/domain/money';
import { summarizeHours, trimSeconds } from '@/domain/hours';
import { CATEGORY_LABELS } from '@/types/models';
import { personLabel, useMerchant, useMerchantRecentOrders, usePermissions, useSetMerchantStatus, type MerchantStatus } from './api';
import { DataTable, Detail, MERCHANT_STATUS_LABELS, ORDER_STATUS_LABELS, RoleNote, merchantTone, orderTone } from './ui';

const MEMBER_LABELS: Record<string, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

interface StatusChange {
  to: MerchantStatus;
  label: string;
  title: string;
  body: string;
  tone: 'primary' | 'danger';
  suggestions: string[];
}

const STATUS_CHANGES: Record<MerchantStatus, StatusChange[]> = {
  active: [
    {
      to: 'suspended',
      label: 'Suspend store',
      title: 'Suspend this store?',
      body: 'It is hidden from customers immediately and can’t receive new orders. The team keeps dashboard access and sees your reason.',
      tone: 'danger',
      suggestions: ['Menu prices don’t match the store', 'Document verification pending', 'Customer safety complaint'],
    },
    {
      to: 'closed',
      label: 'Close store',
      title: 'Close this store?',
      body: 'Use this when the business has stopped operating or has left GETGO. It is hidden from customers.',
      tone: 'danger',
      suggestions: ['Owner requested closure', 'Business closed'],
    },
  ],
  suspended: [
    {
      to: 'active',
      label: 'Reactivate',
      title: 'Reactivate this store?',
      body: 'The store becomes active again. The owner chooses when to publish it.',
      tone: 'primary',
      suggestions: ['Issue resolved'],
    },
    {
      to: 'closed',
      label: 'Close store',
      title: 'Close this store?',
      body: 'Use this when the business has stopped operating or has left GETGO.',
      tone: 'danger',
      suggestions: ['Owner requested closure', 'Business closed'],
    },
  ],
  closed: [
    {
      to: 'active',
      label: 'Reactivate',
      title: 'Reactivate this store?',
      body: 'The store becomes active again. The owner chooses when to publish it.',
      tone: 'primary',
      suggestions: ['Owner returning to GETGO'],
    },
  ],
};

export default function MerchantDetailPage() {
  const { merchantId } = useParams();
  const perms = usePermissions();
  const query = useMerchant(merchantId);
  const orders = useMerchantRecentOrders(merchantId);
  const setStatus = useSetMerchantStatus();
  const toast = useToast();
  const [change, setChange] = useState<StatusChange | null>(null);

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { merchant: m, members, hours } = query.data;
  if (!m) return <EmptyState title="Merchant not found" action={<ButtonLink to="/admin/merchants" variant="secondary">All merchants</ButtonLink>} />;

  const hoursSummary = summarizeHours(hours.map((h) => ({ weekday: h.weekday, opens: trimSeconds(h.opens_at), closes: trimSeconds(h.closes_at) })));

  return (
    <div>
      <PageHeader
        back="/admin/merchants"
        actions={
          perms.canConfigure && (
            <ButtonLink to={`/admin/merchants/${m.id}/manage`} size="sm">
              Manage products and store
            </ButtonLink>
          )
        }
        title={
          <span className="flex items-center gap-3">
            <StoreMark name={m.name} logoPath={m.logo_path} size="sm" />
            <span className="min-w-0">{m.name}</span>
          </span>
        }
      >
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <StatusText tone={merchantTone(m.status)}>{MERCHANT_STATUS_LABELS[m.status]}</StatusText>
          <span aria-hidden>·</span>
          <span>{m.is_published ? 'Published' : 'Hidden from customers'}</span>
          {m.service_areas && (
            <>
              <span aria-hidden>·</span>
              <span>{m.service_areas.name}</span>
            </>
          )}
        </span>
      </PageHeader>

      {m.pending_owner_email && (
        <Notice className="mb-6" title="Owner hasn’t signed up yet">
          This store is linked to <strong>{m.pending_owner_email}</strong>. It becomes theirs as soon as they create a GETGO account with that email.
        </Notice>
      )}

      <div className="space-y-10 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12 lg:space-y-0">
        <div className="min-w-0 space-y-10">
          <section>
            <SectionHeading title="Profile" />
            <dl className="divide-y divide-line border-y border-line text-small">
              <Detail label="Link">
                {m.is_published && m.status === 'active' ? (
                  <Link to={`/stores/${m.slug}`} className="underline underline-offset-4">
                    /stores/{m.slug}
                  </Link>
                ) : (
                  <span className="text-ink-3">/stores/{m.slug} (not public)</span>
                )}
              </Detail>
              <Detail label="Category">{CATEGORY_LABELS[m.category] ?? m.category}</Detail>
              {m.description && (
                <Detail label="Description">
                  <span className="whitespace-pre-wrap">{m.description}</span>
                </Detail>
              )}
              <Detail label="Phone">{m.phone || '—'}</Detail>
              <Detail label="Address">{[m.address_line, m.barangay, m.city].join(', ')}</Detail>
              {m.accepting_orders === false && (
                <Detail label="Listing paused">{m.paused_until ? `Until ${formatDateTime(m.paused_until)}` : 'Paused by the store'}</Detail>
              )}
              {m.min_order_minor != null && m.min_order_minor > 0 && <Detail label="Minimum order">{formatMoney(m.min_order_minor)}</Detail>}
              <Detail label="Joined">{formatDate(m.created_at)}</Detail>
              {m.application_id && (
                <Detail label="Application">
                  {perms.canReviewApplications ? (
                    <Link to={`/admin/applications/${m.application_id}`} className="underline underline-offset-4">
                      View application
                    </Link>
                  ) : (
                    'On file'
                  )}
                </Detail>
              )}
            </dl>
          </section>

          <section>
            <SectionHeading title="Opening hours" />
            {hours.length ? (
              <dl className="divide-y divide-line border-y border-line text-small">
                {hoursSummary.map((h) => (
                  <Detail key={h.days} label={h.days}>
                    <span className={h.hours === 'Closed' ? 'text-ink-3' : undefined}>{h.hours}</span>
                  </Detail>
                ))}
              </dl>
            ) : (
              <p className="text-small text-ink-3">No opening hours set.</p>
            )}
          </section>

          <section>
            <SectionHeading title="Team" />
            {members.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {members.map((member) => (
                  <li key={member.user_id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{personLabel(member.profile)}</p>
                      <p className="truncate text-small text-ink-3">{[member.profile?.email, member.profile?.phone].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className="shrink-0 text-small text-ink-2">{MEMBER_LABELS[member.role] ?? member.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-3">No team members.</p>
            )}
          </section>

          <section>
            <SectionHeading title="Recent orders" />
            {orders.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : orders.isError ? (
              <ErrorState className="py-4" error={orders.error} onRetry={() => orders.refetch()} />
            ) : orders.data.length === 0 ? (
              <p className="text-small text-ink-3">No orders yet.</p>
            ) : (
              <DataTable
                label="Recent orders"
                rows={orders.data}
                rowKey={(o) => o.id}
                rowLink={(o) => `/admin/orders/${o.id}`}
                columns={[
                  { header: 'Order', cell: (o) => <span className="font-mono">{o.code}</span> },
                  { header: 'Customer', cell: (o) => o.customer_name },
                  { header: 'Status', cell: (o) => <StatusText tone={orderTone(o.status)}>{ORDER_STATUS_LABELS[o.status] ?? o.status}</StatusText> },
                  { header: 'Total', align: 'right', cell: (o) => formatMoney(o.total_minor) },
                  { header: 'Placed', align: 'right', cell: (o) => <span className="text-ink-2">{timeAgo(o.created_at)}</span> },
                ]}
                mobile={(o) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold">{o.code}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-3">
                        <StatusText tone={orderTone(o.status)}>{ORDER_STATUS_LABELS[o.status] ?? o.status}</StatusText>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(o.created_at)}</span>
                      </p>
                    </div>
                    <Money minor={o.total_minor} />
                  </div>
                )}
              />
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <section>
            <h2 className="mb-2 text-heading font-semibold">Store status</h2>
            <p className="mb-3 text-small text-ink-3">
              {m.status === 'active'
                ? 'Active stores can publish their menu for customers.'
                : m.status === 'suspended'
                  ? 'Suspended — hidden from customers.'
                  : 'Closed — hidden from customers.'}
            </p>
            {perms.canConfigure ? (
              <div className="flex flex-wrap gap-2">
                {STATUS_CHANGES[m.status].map((c) => (
                  <Button key={c.to} size="sm" variant={c.tone === 'danger' ? 'danger-quiet' : 'secondary'} onClick={() => setChange(c)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            ) : (
              <RoleNote>Only administrators can suspend, close or reactivate stores.</RoleNote>
            )}
            {m.status !== 'active' && <Notice className="mt-4">After reactivation the owner must publish the store again.</Notice>}
          </section>
        </aside>
      </div>

      {change && (
        <ConfirmDialog
          open
          onClose={() => {
            setChange(null);
            setStatus.reset();
          }}
          title={change.title}
          body={change.body}
          tone={change.tone}
          confirmLabel={change.label}
          reason={{ label: 'Reason (shared with the store team)', required: true, suggestions: change.suggestions }}
          loading={setStatus.isPending}
          error={setStatus.error ? <FormError error={setStatus.error} /> : null}
          onConfirm={async (reason) => {
            await setStatus.mutateAsync({ merchantId: m.id, status: change.to, reason });
            toast(change.to === 'active' ? 'Store reactivated' : `Store ${MERCHANT_STATUS_LABELS[change.to].toLowerCase()}`);
            setChange(null);
          }}
        />
      )}
    </div>
  );
}
