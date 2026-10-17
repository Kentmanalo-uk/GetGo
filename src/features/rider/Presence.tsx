import { Bike, Package } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/components/ui/cx';
import { userMessage } from '@/lib/errors';
import { useOnlineRiders } from '@/features/riders/api';
import { useSetOnline } from './api';
import { useRider } from './RiderLayout';

/** Turns the rider online or offline, with a short confirmation. */
export function useOnlineSwitch() {
  const { profile } = useRider();
  const setOnline = useSetOnline();
  const toast = useToast();
  const toggle = (online = !profile.is_online) =>
    setOnline.mutateAsync(online).then(
      () => toast(online ? 'You’re online. New orders will show up here.' : 'You’re offline. You won’t get new orders.'),
      (error) => toast(userMessage(error)),
    );
  return { online: profile.is_online, toggle, pending: setOnline.isPending };
}

const dot = (online: boolean) => <span aria-hidden className={cx('size-2 shrink-0 rounded-full', online ? 'bg-success' : 'bg-ink-4')} />;

/** Compact Online/Offline switch for the header and sidebar. */
export function OnlineSwitch({ className }: { className?: string }) {
  const { online, toggle, pending } = useOnlineSwitch();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label={online ? 'You’re online. Go offline' : 'You’re offline. Go online'}
      disabled={pending}
      onClick={() => toggle()}
      className={cx(
        'inline-flex h-9 items-center gap-2 rounded-full border pr-1 pl-3 text-small font-semibold transition-colors disabled:opacity-60',
        online ? 'border-success/30 bg-success-soft text-success' : 'border-line-strong bg-surface text-ink-3',
        className,
      )}
    >
      {dot(online)}
      {online ? 'Online' : 'Offline'}
      <span className={cx('relative inline-flex h-6 w-10 items-center rounded-full transition-colors', online ? 'bg-success' : 'bg-line-strong')}>
        <span className={cx('inline-block size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none', online ? 'translate-x-5' : 'translate-x-1')} />
      </span>
    </button>
  );
}

/** The rider's status at the top of Home: online or offline, and the switch. */
export function PresenceCard() {
  const { profile } = useRider();
  const { online, toggle, pending } = useOnlineSwitch();
  const riders = useOnlineRiders(profile.service_area_id);
  const others = Math.max(0, (riders.data ?? 0) - (online ? 1 : 0));

  return (
    <section
      aria-label="Your status"
      className={cx('flex flex-col gap-4 rounded-sheet p-5 sm:flex-row sm:items-center', online ? 'bg-success-soft' : 'border border-line-strong bg-canvas')}
    >
      <span className={cx('inline-flex size-12 shrink-0 items-center justify-center rounded-full', online ? 'bg-success text-white' : 'bg-surface text-ink-4')}>
        <Bike className="size-6" weight="fill" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('flex items-center gap-2 text-heading font-bold', online ? 'text-success' : 'text-ink')}>
          {dot(online)}
          {online ? 'You’re online' : 'You’re offline'}
        </p>
        <p className="text-small text-ink-2">
          {online
            ? 'Customers in your area can order, and new orders show up here. Keep GETGO open to stay online.'
            : others > 0
              ? `${others} other ${others === 1 ? 'rider is' : 'riders are'} online in your area. Go online to get orders too.`
              : 'No rider in your area is online, so customers can’t order. Go online when you’re ready.'}
        </p>
      </div>
      <Button variant={online ? 'secondary' : 'primary'} loading={pending} onClick={() => toggle()} className="shrink-0">
        {online ? 'Go offline' : 'Go online'}
      </Button>
    </section>
  );
}

/** In place of new orders while the rider is offline. */
export function OfflineOrders() {
  const { toggle, pending } = useOnlineSwitch();
  return (
    <div className="flex flex-col items-start gap-4 rounded-sheet border border-dashed border-line-strong p-5 sm:flex-row sm:items-center">
      <Package className="size-8 shrink-0 text-ink-4" weight="fill" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Go online to see new orders</p>
        <p className="text-small text-ink-3">While you’re offline, you won’t get new orders. Jobs you already accepted stay in My jobs.</p>
      </div>
      <Button loading={pending} onClick={() => toggle(true)} className="shrink-0">
        Go online
      </Button>
    </div>
  );
}
