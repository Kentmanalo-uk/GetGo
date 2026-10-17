import { mediaUrl } from '@/lib/media';
import { cx } from './ui/cx';

const SIZES = {
  sm: 'size-8 text-small',
  md: 'size-12 text-heading',
  lg: 'size-20 text-title',
} as const;

/** A person's profile picture, or their initials on a soft pink circle. */
export function Avatar({ name, path, size = 'md', className }: { name: string | null | undefined; path?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const url = mediaUrl(path);
  const initials =
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
  return url ? (
    <img src={url} alt="" className={cx('shrink-0 rounded-full bg-canvas object-cover ring-1 ring-line', SIZES[size], className)} />
  ) : (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink', SIZES[size], className)}>
      {initials}
    </span>
  );
}
