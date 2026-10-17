import type { ReactNode } from 'react';
import { AlertCircle, Bike, Info, RotateCw } from '@/components/icons';
import { ICON_GRADIENT } from '@/components/IconGradient';
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

/** Three pink dots that pulse in turn — for small spaces. */
export function LoadingDots({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx('loader-fade inline-flex items-center gap-1.5', className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="loader-dot size-2 rounded-full bg-accent-strong" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

/**
 * GETGO's loading animation: the pink rider bobbing along a scrolling road,
 * with speed lines behind. Fades in after a moment so quick loads don't flash.
 */
export function Loader({ label = 'Loading', compact, className }: { label?: string; compact?: boolean; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cx('loader-fade flex flex-col items-center justify-center', compact ? 'py-6' : 'py-20', className)}>
      <div aria-hidden className={cx('relative', compact ? 'h-10 w-24' : 'h-14 w-32')}>
        <span className="loader-wind absolute top-[38%] left-[8%] h-[3px] w-6 rounded-full bg-accent/60" />
        <span className="loader-wind loader-wind-2 absolute top-[58%] left-[2%] h-[3px] w-4 rounded-full bg-accent/40" />
        <span className="loader-wind loader-wind-3 absolute top-[22%] left-[14%] h-[2px] w-3 rounded-full bg-accent/35" />
        <Bike className={cx('loader-bike absolute top-0 left-1/2 -translate-x-1/2', compact ? 'size-8' : 'size-11', ICON_GRADIENT)} weight="fill" />
        <span className="loader-road absolute inset-x-0 bottom-0 h-[3px] rounded-full" />
      </div>
      <p className="mt-3 inline-flex items-baseline gap-0.5 text-small font-semibold text-ink-3">
        {label}
        {[0, 1, 2].map((i) => (
          <span key={i} aria-hidden className="loader-ellipsis" style={{ animationDelay: `${i * 180}ms` }}>
            .
          </span>
        ))}
      </p>
    </div>
  );
}

/** Loading state for a page body. */
export function PageLoading({ label }: { rows?: number; label?: string }) {
  return <Loader label={label} />;
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
