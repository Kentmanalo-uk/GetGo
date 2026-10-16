import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Feedback';
import { cx } from '@/components/ui/cx';
import { StatusText } from '@/components/ui/Display';
import type { ApplicationStatus, DocumentType } from '@/types/models';
import type { TicketStatus } from '@/features/support/SupportPages';
import type { MerchantStatus, OrderStatus, PagedResult, PaymentStatus, RefundStatus } from './api';

/** Tone accepted by the shared StatusText (dot + word). */
export type StatusTone = ComponentProps<typeof StatusText>['tone'];

// ---------------------------------------------------------------------------
// Labels and tones
// ---------------------------------------------------------------------------
export const APPLICATION_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  needs_changes: 'Needs changes',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function applicationTone(status: ApplicationStatus): StatusTone {
  switch (status) {
    case 'submitted':
      return 'attention';
    case 'under_review':
    case 'needs_changes':
      return 'progress';
    case 'approved':
      return 'done';
    case 'rejected':
      return 'danger';
    default:
      return 'muted';
  }
}

export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = { active: 'Active', suspended: 'Suspended', closed: 'Closed' };

export function merchantTone(status: MerchantStatus): StatusTone {
  return status === 'active' ? 'done' : status === 'suspended' ? 'danger' : 'muted';
}

export const REFUND_LABELS: Record<RefundStatus, string> = {
  requested: 'Requested',
  approved: 'Approved — send via GCash',
  processed: 'Processed',
  rejected: 'Rejected',
};

export function refundTone(status: RefundStatus): StatusTone {
  return status === 'requested' ? 'attention' : status === 'approved' ? 'progress' : status === 'processed' ? 'done' : 'muted';
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Waiting for rider',
  accepted: 'Awaiting GCash payment',
  payment_submitted: 'Payment to confirm',
  buying: 'Rider buying',
  out_for_delivery: 'Out for delivery',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export function orderTone(status: OrderStatus): StatusTone {
  switch (status) {
    case 'pending':
    case 'payment_submitted':
      return 'attention';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'danger';
    default:
      return 'progress';
  }
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Not paid yet',
  submitted: 'GCash reference submitted',
  paid: 'Paid via GCash',
  cancelled: 'No payment',
  refunded: 'Refunded',
};

export function paymentTone(status: PaymentStatus): StatusTone {
  return status === 'submitted' ? 'attention' : status === 'paid' ? 'done' : 'muted';
}

/** Staff-facing wording (the shared labels are written for customers). */
export const STAFF_TICKET_LABELS: Record<TicketStatus, string> = {
  open: 'Needs reply',
  pending: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function ticketTone(status: TicketStatus): StatusTone {
  return status === 'open' ? 'attention' : status === 'pending' ? 'progress' : 'muted';
}

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  business_permit: 'Business permit',
  dti_sec_registration: 'DTI / SEC registration',
  bir_registration: 'BIR registration',
  government_id: 'Government ID',
  food_safety_permit: 'Food safety permit',
  other: 'Other document',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Converts an ISO timestamp to a `datetime-local` value in Asia/Manila. */
export function toManilaInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Interprets a `datetime-local` value as Asia/Manila time (UTC+8, no DST). */
export function fromManilaInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Explains why an action is unavailable to the current role. */
export function RoleNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-small text-ink-3', className)}>{children}</p>;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line border-y border-line" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function LoadMore<T>({ paged }: { paged: PagedResult<T> }) {
  const { query } = paged;
  if (!query.hasNextPage) return null;
  return (
    <div className="pt-4">
      <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        Load more
      </Button>
    </div>
  );
}

/** Debounced search box. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div role="search" className={cx('relative w-full sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 placeholder:text-ink-4 focus:border-ink focus:ring-2 focus:ring-accent focus:outline-none"
      />
    </div>
  );
}

/** Compact label/value used in definition lists inside detail pages. */
export function Detail({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]', className)}>
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responsive table: a real table from md, stacked rows on phones.
// ---------------------------------------------------------------------------
export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowLink,
  mobile,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowLink?: (row: T) => string;
  /** Stacked rendering for small screens. */
  mobile: (row: T) => ReactNode;
  label: string;
}) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-y border-line text-left" aria-label={label}>
          <thead>
            <tr className="border-b border-line text-small text-ink-3">
              {columns.map((c, i) => (
                <th key={i} scope="col" className={cx('px-3 py-2.5 font-semibold first:pl-0 last:pr-0', c.align === 'right' && 'text-right', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const href = rowLink?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={cx('align-top', href && 'cursor-pointer hover:bg-canvas/60')}
                  onClick={
                    href
                      ? (e) => {
                          // Leave inner links and buttons to do their own thing.
                          if ((e.target as HTMLElement).closest('a, button, input, select, textarea, summary')) return;
                          navigate(href);
                        }
                      : undefined
                  }
                >
                  {columns.map((c, i) => (
                    <td key={i} className={cx('px-3 py-3 first:pl-0 last:pr-0', c.align === 'right' && 'tabular text-right', c.className)}>
                      {i === 0 && href ? (
                        <Link to={href} className="font-semibold hover:underline">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line md:hidden" aria-label={label}>
        {rows.map((row) => {
          const href = rowLink?.(row);
          return (
            <li key={rowKey(row)}>
              {href ? (
                <Link to={href} className="block py-3.5">
                  {mobile(row)}
                </Link>
              ) : (
                <div className="py-3.5">{mobile(row)}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Small JSON viewer used for audit details and provider payloads. */
export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-80 overflow-auto rounded-control bg-canvas p-3 text-micro leading-relaxed whitespace-pre-wrap break-all text-ink-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
