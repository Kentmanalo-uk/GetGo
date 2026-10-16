import type { ReactNode } from 'react';
import { AlertCircle, Info, RotateCw } from 'lucide-react';
import { cx } from './cx';
import { userMessage } from '@/lib/errors';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={cx('animate-spin motion-reduce:animate-none', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton rounded-md bg-canvas', className)} />;
}

/** Full-area loading placeholder for a page body. */
export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-5 py-6" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-1/2" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="size-16 shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-start gap-3 py-10', className)}>
      {icon && <div className="text-ink-4">{icon}</div>}
      <h2 className="text-heading font-semibold">{title}</h2>
      {children && <div className="max-w-md text-ink-3">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cx('flex flex-col items-start gap-3 py-10', className)}>
      <h2 className="text-heading font-semibold">Couldn’t load this</h2>
      <p className="max-w-md text-ink-3">{userMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 font-semibold underline underline-offset-4">
          <RotateCw className="size-4" aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

/** Inline message block. Tone sets color sparingly. */
export function Notice({
  tone = 'neutral',
  title,
  children,
  className,
  action,
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const tones = {
    neutral: 'bg-canvas text-ink-2',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-accent-soft text-accent-ink',
  };
  const Icon = tone === 'neutral' || tone === 'success' ? Info : AlertCircle;
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cx('flex gap-3 rounded-control px-4 py-3 text-small', tones[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice tone="danger">{userMessage(error)}</Notice>;
}
