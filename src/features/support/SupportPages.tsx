import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMyOrders } from '@/features/consumer/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, FormError, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, StatusText, formatDateTime } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export interface Ticket {
  id: string;
  user_id: string;
  order_id: string | null;
  subject: string;
  status: TicketStatus;
  priority: 'normal' | 'high';
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}
export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_staff: boolean;
  created_at: string;
}

export const TICKET_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  pending: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function useTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket', ticketId],
    enabled: Boolean(ticketId),
    queryFn: async () => {
      const [ticket, messages] = await Promise.all([
        supabase.from('support_tickets').select('*').eq('id', ticketId!).maybeSingle().then(unwrap),
        supabase.from('ticket_messages').select('*').eq('ticket_id', ticketId!).order('created_at').then(unwrap),
      ]);
      return { ticket: ticket as Ticket | null, messages: messages as TicketMessage[] };
    },
  });
}

export function useSendMessage(ticketId: string, asStaff = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      unwrap(await supabase.from('ticket_messages').insert({ ticket_id: ticketId, body, is_staff: asStaff }));
      if (asStaff) unwrap(await supabase.from('support_tickets').update({ status: 'pending' }).eq('id', ticketId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function TicketThread({ messages, viewerIsStaff }: { messages: TicketMessage[]; viewerIsStaff: boolean }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const mine = m.is_staff === viewerIsStaff;
        return (
          <li key={m.id} className={cx('max-w-[85%]', mine ? 'ml-auto text-right' : '')}>
            <p className="mb-1 text-micro text-ink-3">
              {m.is_staff ? 'GETGO Support' : viewerIsStaff ? 'Customer' : 'You'} · {formatDateTime(m.created_at)}
            </p>
            <div className={cx('inline-block rounded-media px-4 py-2.5 text-left whitespace-pre-wrap', mine ? 'bg-ink text-white' : 'bg-canvas')}>{m.body}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function Composer({ onSend, pending, disabled, placeholder }: { onSend: (body: string) => Promise<unknown>; pending: boolean; disabled?: boolean; placeholder: string }) {
  const [body, setBody] = useState('');
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        try {
          await onSend(body.trim());
          setBody('');
        } catch {
          /* shown by caller */
        }
      }}
    >
      <Textarea rows={2} aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} disabled={disabled} maxLength={4000} className="flex-1" />
      <Button type="submit" variant="dark" loading={pending} disabled={disabled || !body.trim()}>
        Send
      </Button>
    </form>
  );
}

export function SupportListPage() {
  const { userId } = useAuth();
  const tickets = useQuery({
    queryKey: ['tickets', 'mine', userId],
    enabled: Boolean(userId),
    queryFn: async () => unwrap(await supabase.from('support_tickets').select('*').eq('user_id', userId!).order('updated_at', { ascending: false })) as Ticket[],
  });
  return (
    <div className="page-x mx-auto max-w-3xl pb-10">
      <PageHeader title="Help" back="/account" actions={<Link to="/account/support/new" className="font-semibold underline underline-offset-4">New request</Link>} />
      {tickets.isPending ? (
        <PageLoading rows={2} />
      ) : tickets.isError ? (
        <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : tickets.data.length === 0 ? (
        <EmptyState title="No support requests" icon={<LifeBuoy className="size-8" />} action={<Link to="/account/support/new" className="font-semibold underline underline-offset-4">Ask for help</Link>}>
          For problems with an order, open the order and choose “Get help with this order”.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {tickets.data.map((t) => (
            <li key={t.id}>
              <Link to={`/account/support/${t.id}`} className="block py-4">
                <p className="font-semibold">{t.subject}</p>
                <p className="mt-0.5 flex items-center gap-2 text-small text-ink-3">
                  <StatusText tone={t.status === 'pending' ? 'attention' : t.status === 'open' ? 'progress' : 'muted'}>{TICKET_LABELS[t.status]}</StatusText>
                  <span aria-hidden>·</span> {formatDateTime(t.updated_at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewSupportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const orders = useMyOrders('all');
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const ticket = unwrap(
        await supabase.from('support_tickets').insert({ subject: subject.trim(), order_id: orderId || null }).select('id').single(),
      ) as { id: string };
      unwrap(await supabase.from('ticket_messages').insert({ ticket_id: ticket.id, body: body.trim() }));
      return ticket.id;
    },
    onSuccess: (id) => navigate(`/account/support/${id}`, { replace: true }),
  });
  return (
    <div className="page-x mx-auto max-w-2xl pb-10">
      <PageHeader title="Ask for help" back="/account/support" />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormError error={create.error} />
        <Field label="Related order" optional>
          {(p) => (
            <Select {...p} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Not about a specific order</option>
              {orders.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.merchant_name} · {formatDateTime(o.created_at)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subject">{(p) => <Input {...p} required minLength={3} maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Missing item, wrong order…" />}</Field>
        <Field label="What happened?">{(p) => <Textarea {...p} required rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Button type="submit" loading={create.isPending} disabled={subject.trim().length < 3 || !body.trim()}>
          Send request
        </Button>
      </form>
    </div>
  );
}

export function SupportThreadPage() {
  const { ticketId } = useParams();
  const query = useTicket(ticketId);
  const send = useSendMessage(ticketId!);
  if (query.isPending) {
    return (
      <div className="page-x mx-auto max-w-2xl">
        <PageLoading rows={3} />
      </div>
    );
  }
  if (query.isError || !query.data.ticket) return <ErrorState className="page-x" error={query.error ?? new Error('Not found')} />;
  const { ticket, messages } = query.data;
  return (
    <div className="page-x mx-auto max-w-2xl pb-10">
      <PageHeader title={ticket.subject} back="/account/support">
        {TICKET_LABELS[ticket.status]}
        {ticket.order_id && (
          <>
            {' · '}
            <Link to={`/orders/${ticket.order_id}`} className="underline underline-offset-4">
              View order
            </Link>
          </>
        )}
      </PageHeader>
      <TicketThread messages={messages} viewerIsStaff={false} />
      <div className="mt-6 border-t border-line pt-4">
        <FormError error={send.error} />
        {ticket.status === 'closed' ? (
          <p className="text-small text-ink-3">This request is closed. Start a new one if you still need help.</p>
        ) : (
          <Composer onSend={(b) => send.mutateAsync(b)} pending={send.isPending} placeholder="Write a reply" />
        )}
      </div>
    </div>
  );
}
