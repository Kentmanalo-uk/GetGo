import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
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
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (!open) document.documentElement.style.overflow = '';
    };
  }, [open]);

  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

  return (
    <dialog
      ref={ref}
      className="sheet"
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
      {open && (
        <div
          className={cx(
            'sheet-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-sheet bg-surface shadow-sheet',
            'sm:max-h-[85dvh] sm:rounded-sheet sm:shadow-pop',
            widths[size],
          )}
        >
          {media}
          <div className={cx('flex items-start gap-3 px-5 pt-4', hideTitle ? 'sr-only' : 'pb-2')}>
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
