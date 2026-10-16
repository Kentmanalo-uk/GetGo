import { cx } from './ui/cx';

/** GETGO wordmark with the "GO" set in the brand accent. */
export function Logo({ inverted, className, suffix }: { inverted?: boolean; className?: string; suffix?: string }) {
  return (
    <span className={cx('inline-flex items-baseline gap-2 select-none', className)}>
      <span className={cx('text-[1.375rem] leading-none font-extrabold tracking-[-0.04em]', inverted ? 'text-white' : 'text-ink')}>
        GET
        <span className={cx('rounded-[5px] px-[3px]', inverted ? 'text-accent' : 'bg-accent text-ink')}>GO</span>
      </span>
      {suffix && <span className={cx('text-small font-semibold', inverted ? 'text-white/70' : 'text-ink-3')}>{suffix}</span>}
    </span>
  );
}
