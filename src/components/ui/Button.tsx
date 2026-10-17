import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from './cx';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap rounded-control transition-colors select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill text-white hover:bg-accent-fill-hover active:bg-accent-fill-hover',
  dark: 'bg-ink text-white hover:bg-ink-2',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  danger: 'bg-danger text-white hover:bg-danger/90',
  'danger-quiet': 'text-danger hover:bg-danger-soft',
  link: 'text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink !px-0 !h-auto',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-small',
  md: 'h-11 px-4 text-body',
  lg: 'h-12 px-5 text-body',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', block = false, className?: string) {
  return cx(base, variants[variant], sizes[size], block && 'w-full', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  className,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return <Link className={buttonClass(variant, size, block, className)} {...rest} />;
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cx(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink transition-colors hover:bg-canvas disabled:opacity-40',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
