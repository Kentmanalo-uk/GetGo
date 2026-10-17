import { Bike } from '@/components/icons';
import { cx } from '@/components/ui/cx';
import { useOnlineRiders } from './api';

/** True when we know no rider is online in the area (not while loading). */
export function useNoRidersOnline(areaId: string | null | undefined) {
  const riders = useOnlineRiders(areaId);
  return riders.data === 0;
}

/**
 * Shown to customers when no rider in their area is online: they can browse,
 * but can't order until a rider goes online. Renders nothing otherwise.
 */
export function NoRidersNotice({ areaId, className }: { areaId: string | null | undefined; className?: string }) {
  const none = useNoRidersOnline(areaId);
  if (!none) return null;
  return (
    <div role="status" className={cx('flex items-start gap-3 rounded-media bg-warning-soft px-4 py-3 text-warning', className)}>
      <Bike className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
      <div className="min-w-0 text-small">
        <p className="font-semibold">No riders online right now</p>
        <p>You can’t order yet. Look around and check back in a little while. This updates by itself when a rider goes online.</p>
      </div>
    </div>
  );
}
