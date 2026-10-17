import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from '@/components/icons';
import { cx } from './cx';
import { Button } from './Button';
import { Field, Textarea } from './Field';

/**
 * Bottom sheet on phones, centered dialog from the `sm` breakpoint up.
 * Built on the native <dialog> element for focus trapping, Esc handling and
 * focus restoration.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  hideTitle,
  media,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  hideTitle?: boolean;
  /** Full-bleed content shown above the title (e.g. a product photo). */
  media?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Content stays mounted while the closing transition plays.
  const [mounted, setMounted] = useState(open);
  // "open" is applied a frame after the dialog shows, so the panel is painted
  // in its closed position first and the transition always plays smoothly.
  const [state, setState] = useState<'open' | 'closed'>('closed');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setMounted(true);
      if (!dialog.open) {
        dialog.showModal();
        document.documentElement.style.overflow = 'hidden';
      }
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setState('open'));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    if (!dialog.open) return;
    setState('closed');
    const finish = () => {
      dialog.close();
      setMounted(false);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const t = setTimeout(finish, 330);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  // Phones: drag the top of the sheet down to close it.
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    if (window.matchMedia('(min-width: 640px)').matches || (e.target as HTMLElement).closest('button')) return;
    drag.current = { startY: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panelRef.current) panelRef.current.style.transition = 'none';
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    panelRef.current.style.transform = `translate3d(0, ${drag.current.dy}px, 0)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    if (!d || !panel) return;
    // Hand control back to the stylesheet transition: it glides back up, or
    // continues down from where the finger left it when closing.
    panel.style.transition = '';
    panel.style.transform = '';
    if (d.dy > 90) onClose();
  };

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

  return (
    <dialog
      ref={ref}
      className="sheet"
      data-state={state}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        document.documentElement.style.overflow = '';
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-overlay" aria-hidden onClick={onClose} />
      {(open || mounted) && (
        <div
          ref={panelRef}
          className={cx(
            'sheet-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-sheet bg-surface shadow-sheet',
            'sm:max-h-[85dvh] sm:rounded-sheet sm:shadow-pop',
            widths[size],
          )}
        >
          {/* Drag handle (phones). */}
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1 sm:hidden"
            aria-hidden
          >
            <span className="h-1.5 w-10 rounded-full bg-line-strong" />
          </div>
          {media}
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            className={cx('flex touch-none items-start gap-3 px-5 pt-2 sm:touch-auto sm:pt-4', hideTitle ? 'sr-only' : 'pb-2')}
          >
            <h2 id={titleId} className="min-w-0 flex-1 pt-1.5 text-title font-semibold">
              {title}
            </h2>
            {!media && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 inline-flex size-10 items-center justify-center rounded-control hover:bg-canvas"
              >
                <X className="size-5" aria-hidden />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          {footer && <div className="safe-bottom border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive or privileged actions, optionally with a reason. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  reason,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  /** May return a promise; rejections are expected to be surfaced via `error`. */
  onConfirm: (reason: string) => void | Promise<unknown>;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  reason?: { label: string; placeholder?: string; required?: boolean; suggestions?: string[] };
  loading?: boolean;
  error?: ReactNode;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const missingReason = reason?.required && text.trim().length < 3;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Go back
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={missingReason} onClick={() => void Promise.resolve(onConfirm(text.trim())).catch(() => undefined)}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {body && <div className="text-ink-2">{body}</div>}
        {reason && (
          <>
            {reason.suggestions && (
              <div className="flex flex-wrap gap-2">
                {reason.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setText(s)}
                    className={cx(
                      'rounded-control border px-3 py-1.5 text-small',
                      text === s ? 'border-ink bg-ink text-white' : 'border-line-strong hover:bg-canvas',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <Field label={reason.label} optional={!reason.required}>
              {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} maxLength={300} />}
            </Field>
          </>
        )}
        {error}
      </div>
    </Sheet>
  );
}
