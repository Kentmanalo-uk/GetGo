import type { ReactNode } from 'react';
import { ArrowLeft } from '@/components/icons';
import { Link, useNavigate } from 'react-router';
import { cx } from './cx';
import { formatMoney } from '@/domain/money';
import type { StatusTone } from '@/domain/orderStatus';
import { mediaUrl } from '@/lib/media';

export function PageHeader({
  title,
  back,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  /** A path, or true to go back in history. */
  back?: string | true;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <header className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 pt-5 pb-4 lg:pt-8 lg:pb-6', className)}>
      {back && (
        <button
          type="button"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
          className="-ml-2 inline-flex size-10 items-center justify-center rounded-control hover:bg-canvas"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-title font-bold lg:text-display">{title}</h1>
        {children && <div className="mt-1 text-ink-3">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeading({ title, action, className, id }: { title: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cx('mb-3 flex items-baseline justify-between gap-3', className)}>
      <h2 id={id} className="text-heading font-semibold">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function Money({ minor, className, fixed }: { minor: number | null | undefined; className?: string; fixed?: boolean }) {
  return <span className={cx('tabular', className)}>{formatMoney(minor, { fixed })}</span>;
}

const toneClass: Record<StatusTone, { dot: string; text: string }> = {
  attention: { dot: 'bg-accent-strong ring-2 ring-accent/40', text: 'text-ink font-semibold' },
  progress: { dot: 'bg-ink-3', text: 'text-ink-2' },
  done: { dot: 'bg-accent-ink', text: 'text-ink-3' },
  muted: { dot: 'bg-ink-4', text: 'text-ink-3' },
  danger: { dot: 'bg-danger', text: 'text-danger' },
};

/** Restrained status treatment: a small dot and a word, no pill. */
export function StatusText({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  const t = toneClass[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-small', t.text, className)}>
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', t.dot)} />
      {children}
    </span>
  );
}

/** Store logo, or a typographic monogram when none is uploaded. */
export function StoreMark({ name, logoPath, size = 'md', className }: { name: string; logoPath?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { xs: 'size-5 text-[9px]', sm: 'size-10 text-small', md: 'size-14 text-heading', lg: 'size-20 text-title' };
  const url = mediaUrl(logoPath);
  const radius = size === 'xs' ? 'rounded-full' : 'rounded-media';
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return url ? (
    <img src={url} alt="" loading="lazy" className={cx('shrink-0 bg-canvas object-cover', radius, sizes[size], className)} />
  ) : (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center bg-ink font-bold text-accent', radius, sizes[size], className)}>
      {initials || 'G'}
    </span>
  );
}

/** Product or cover image with a quiet placeholder when there is no photo. */
export function MediaImage({ path, alt, className, eager }: { path?: string | null; alt: string; className?: string; eager?: boolean }) {
  const url = mediaUrl(path);
  if (!url) return <div aria-hidden className={cx('bg-canvas', className)} />;
  return <img src={url} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className={cx('bg-canvas object-cover', className)} />;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: ReactNode; count?: number }>;
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('no-scrollbar -mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cx(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-3 text-small font-semibold whitespace-nowrap transition-colors',
              active ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {item.label}
            {item.count != null && item.count > 0 && (
              <span className={cx('tabular rounded px-1.5 text-micro', active ? 'bg-accent-fill text-white' : 'bg-canvas text-ink-2')}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Two-column label/value row used in summaries and detail panes. */
export function DataRow({ label, children, className, strong }: { label: ReactNode; children: ReactNode; className?: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-1.5', strong && 'font-semibold', className)}>
      <dt className={strong ? 'text-ink' : 'text-ink-3'}>{label}</dt>
      <dd className="tabular text-right">{children}</dd>
    </div>
  );
}

export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('font-semibold underline decoration-line-strong underline-offset-4 hover:decoration-ink', className)}>
      {children}
    </Link>
  );
}

export function formatDateTime(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  });
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDateTime(iso);
}
