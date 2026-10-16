import { Link, useParams } from 'react-router';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Select } from '@/components/ui/Field';
import { PageHeader, StatusText, formatDateTime } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/domain/money';
import { Composer, TicketThread, useSendMessage, useTicket, type Ticket, type TicketStatus } from '@/features/support/SupportPages';
import { personLabel, useOrderSummary, usePermissions, useProfiles, useUpdateTicket } from './api';
import { ORDER_STATUS_LABELS, RoleNote, STAFF_TICKET_LABELS, orderTone, ticketTone } from './ui';

const STATUSES: TicketStatus[] = ['open', 'pending', 'resolved', 'closed'];

function TicketControls({ ticket }: { ticket: Ticket }) {
  const perms = usePermissions();
  const update = useUpdateTicket();
  const toast = useToast();
  const assignee = useProfiles([ticket.assigned_to]);
  const mine = ticket.assigned_to === perms.userId;

  const change = async (changes: Parameters<typeof update.mutateAsync>[0]['changes'], message: string) => {
    try {
      await update.mutateAsync({ ticketId: ticket.id, changes });
      toast(message);
    } catch {
      /* shown inline */
    }
  };

  return (
    <div className="space-y-5">
      <FormError error={update.error} />
      <Field label="Status">
        {(p) => (
          <Select
            {...p}
            value={ticket.status}
            disabled={update.isPending}
            onChange={(e) => void change({ status: e.target.value as TicketStatus }, `Marked ${STAFF_TICKET_LABELS[e.target.value as TicketStatus].toLowerCase()}`)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STAFF_TICKET_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Priority">
        {(p) => (
          <Select
            {...p}
            value={ticket.priority}
            disabled={update.isPending}
            onChange={(e) => void change({ priority: e.target.value as Ticket['priority'] }, 'Priority updated')}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        )}
      </Field>
      <div>
        <p className="mb-1 text-small font-semibold">Assigned to</p>
        <p className="mb-2 text-small text-ink-2">
          {ticket.assigned_to ? (mine ? 'You' : personLabel(assignee.data?.[ticket.assigned_to], 'Another staff member')) : 'Nobody yet'}
        </p>
        {mine ? (
          <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => void change({ assigned_to: null }, 'Unassigned')}>
            Unassign me
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={update.isPending || !perms.userId} onClick={() => void change({ assigned_to: perms.userId }, 'Assigned to you')}>
            Assign to me
          </Button>
        )}
      </div>
    </div>
  );
}

export default function SupportThreadPage() {
  const { ticketId } = useParams();
  const perms = usePermissions();
  const query = useTicket(perms.canHandleTickets ? ticketId : undefined);
  const send = useSendMessage(ticketId ?? '', true);
  const ticket = query.data?.ticket ?? null;
  const people = useProfiles([ticket?.user_id]);
  const order = useOrderSummary(ticket?.order_id);

  if (!perms.canHandleTickets) {
    return (
      <div>
        <PageHeader title="Support request" back="/admin" />
        <Notice>Support requests are handled by admin and support staff.</Notice>
      </div>
    );
  }
  if (query.isPending) return <PageLoading rows={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!ticket) return <EmptyState title="Request not found" action={<ButtonLink to="/admin/support" variant="secondary">All requests</ButtonLink>} />;

  const customer = people.data?.[ticket.user_id];

  return (
    <div>
      <PageHeader title={ticket.subject} back="/admin/support">
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <StatusText tone={ticketTone(ticket.status)}>{STAFF_TICKET_LABELS[ticket.status]}</StatusText>
          {ticket.priority === 'high' && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-accent-ink">High priority</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>Opened {formatDateTime(ticket.created_at)}</span>
        </span>
      </PageHeader>

      <div className="space-y-10 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12 lg:space-y-0">
        <div className="min-w-0">
          {query.data.messages.length === 0 ? (
            <p className="text-small text-ink-3">No messages yet.</p>
          ) : (
            <TicketThread messages={query.data.messages} viewerIsStaff />
          )}
          <div className="mt-6 space-y-2 border-t border-line pt-4">
            <FormError error={send.error} />
            <Composer onSend={(body) => send.mutateAsync(body)} pending={send.isPending} placeholder="Reply as GETGO Support" />
            <RoleNote>
              Sending a reply marks the request “Waiting on customer”.{ticket.status === 'closed' && ' This request is closed; replying reopens it.'}
            </RoleNote>
          </div>
        </div>

        <aside className="space-y-8 text-small">
          <section>
            <h2 className="mb-1 font-semibold">Customer</h2>
            {customer ? (
              <p className="text-ink-2">
                {personLabel(customer)}
                {customer.email && <span className="block text-ink-3">{customer.email}</span>}
                {customer.phone && (
                  <a href={`tel:${customer.phone}`} className="block text-ink-3 underline underline-offset-4">
                    {customer.phone}
                  </a>
                )}
              </p>
            ) : (
              <p className="text-ink-3">{people.isPending ? 'Loading…' : 'Profile unavailable'}</p>
            )}
          </section>

          {ticket.order_id && (
            <section>
              <h2 className="mb-1 font-semibold">Order</h2>
              {order.data ? (
                <Link to={`/admin/orders/${order.data.id}`} className="block hover:underline">
                  <span className="font-mono font-semibold">{order.data.code}</span> · {order.data.merchant_name}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ink-3">
                    <StatusText tone={orderTone(order.data.status)}>{ORDER_STATUS_LABELS[order.data.status] ?? order.data.status}</StatusText>
                    <span aria-hidden>·</span>
                    <span className="tabular">{formatMoney(order.data.total_minor)}</span>
                  </span>
                </Link>
              ) : order.isError ? (
                <FormError error={order.error} />
              ) : (
                <p className="text-ink-3">{order.isPending ? 'Loading…' : 'Order unavailable'}</p>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-3 font-semibold">Handling</h2>
            <TicketControls ticket={ticket} />
          </section>
        </aside>
      </div>
    </div>
  );
}
