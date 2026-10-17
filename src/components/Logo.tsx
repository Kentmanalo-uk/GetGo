import { cx } from './ui/cx';

/** GETGO wordmark — "GET & GO": a small ampersand, then "GO" in white on the brand pink. */
export function Logo({ inverted, className, suffix }: { inverted?: boolean; className?: string; suffix?: string }) {
  return (
    <span className={cx('inline-flex items-baseline gap-2 select-none', className)}>
      <span className="sr-only">GETGO</span>
      <span
        aria-hidden
        className={cx('inline-flex items-center text-[1.375rem] leading-none font-extrabold tracking-[-0.04em]', inverted ? 'text-white' : 'text-ink')}
      >
        GET
        <span className={cx('-mx-px text-[0.58em] font-extrabold tracking-[-0.04em]', inverted ? 'text-accent' : 'text-accent-fill')}>
          &amp;
        </span>
        <span className="rounded-[5px] bg-accent-fill px-[2px] py-[1px] text-white">
          GO
        </span>
      </span>
      {suffix && <span className={cx('text-small font-semibold', inverted ? 'text-white/70' : 'text-ink-3')}>{suffix}</span>}
    </span>
  );
}
