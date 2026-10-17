import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, Eye, EyeOff, Minus, Plus } from '@/components/icons';
import { cx } from './cx';

const control =
  'block w-full rounded-control border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-4 ' +
  'transition-colors hover:border-ink-4 focus:border-ink focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent ' +
  'disabled:bg-canvas disabled:text-ink-3 aria-invalid:border-danger aria-invalid:ring-danger/20';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}

/** Label + control + hint/error, wired up for assistive technology. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-small font-semibold text-ink">
        <span>{label}</span>
        {optional && <span className="font-normal text-ink-3">Optional</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} className="text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-small text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: string }>(
  function Input({ className, prefix, ...rest }, ref) {
    if (prefix) {
      return (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">{prefix}</span>
          <input ref={ref} className={cx(control, 'h-11 pl-7', className)} {...rest} />
        </div>
      );
    }
    return <input ref={ref} className={cx(control, 'h-11', className)} {...rest} />;
  },
);

/** Password input with a show/hide button. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <input ref={ref} type={visible ? 'text' : 'password'} className={cx(control, 'h-11 pr-11', className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-control text-ink-3 hover:text-ink"
      >
        <Icon className="size-5" aria-hidden />
      </button>
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(control, 'resize-y py-2.5', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(control, 'h-11 appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }>(
  function Checkbox({ label, description, className, ...rest }, ref) {
    return (
      <label className={cx('flex cursor-pointer items-start gap-3 py-1', rest.disabled && 'cursor-not-allowed opacity-60', className)}>
        <input ref={ref} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-ink" {...rest} />
        <span>
          <span className="block">{label}</span>
          {description && <span className="block text-small text-ink-3">{description}</span>}
        </span>
      </label>
    );
  },
);

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-small text-ink-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-ink' : 'bg-line-strong',
        )}
      >
        <span
          className={cx(
            'inline-block size-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  size = 'md',
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const btn = cx(
    'inline-flex items-center justify-center text-ink transition-colors hover:bg-canvas disabled:opacity-35 disabled:hover:bg-transparent',
    size === 'sm' ? 'size-8' : 'size-11',
  );
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-control border border-line-strong">
      <button type="button" className={btn} aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-4" aria-hidden />
      </button>
      <span className={cx('tabular text-center font-semibold', size === 'sm' ? 'w-6 text-small' : 'w-8')} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** A selectable row for single or multiple choice (radio / checkbox semantics). */
export function ChoiceRow({
  type,
  name,
  checked,
  onChange,
  disabled,
  label,
  meta,
  trailing,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <label
      className={cx(
        'flex min-h-12 cursor-pointer items-center gap-3 py-2.5',
        disabled && 'cursor-not-allowed text-ink-4',
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="size-5 shrink-0 accent-ink"
      />
      <span className="min-w-0 flex-1">{label}</span>
      {meta && <span className="tabular shrink-0 text-small text-ink-3">{meta}</span>}
      {trailing}
    </label>
  );
}
