import { Link } from 'react-router';
import { ArrowRight, Package, Wallet } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServiceAreas } from '@/features/consumer/api';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorState, PageLoading } from '@/components/ui/Feedback';
import { SectionHeading } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { formatMoney } from '@/domain/money';
import type { OrderStatus } from '@/domain/orderStatus';
import { earningWindows, riderEarning, summarizeJobs, useAvailableOrders, useJobs } from './api';
import { JobProgress, OrderCard, StatCard } from './components';
import { useRider } from './RiderLayout';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** What the rider should do next on a job, in a few words. */
export function jobNextHint(status: OrderStatus): string {
  switch (status) {
    case 'accepted':
      return 'Waiting for the customer’s GCash payment';
    case 'payment_submitted':
      return 'Check your GCash and confirm the payment';
    case 'buying':
      return 'Buy the items at the store';
    case 'out_for_delivery':
      return 'Deliver to the customer';
    default:
      return '';
  }
}

export function RiderHomePage() {
  const { userId } = useAuth();
  const { profile } = useRider();
  const areas = useServiceAreas();
  const area = areas.data?.find((a) => a.id === profile.service_area_id);
  const available = useAvailableOrders(profile.service_area_id);
  const jobs = useJobs(userId);
  const today = summarizeJobs(jobs.data?.done ?? [], earningWindows().today);
  const active = jobs.data?.active ?? [];

  return (
    <div className="space-y-10 pt-6 lg:pt-10">
      <header>
        <p className="text-small text-ink-3">{area ? `${area.name} · ${area.city}` : 'Your delivery area'}</p>
        <h1 className="mt-1 text-display font-bold">
          {greeting()}, {profile.full_name.split(' ')[0]}
        </h1>
      </header>

      <section aria-label="Today" className="grid grid-cols-3 gap-3">
        <StatCard label="Earned today" value={formatMoney(today.earnedMinor)} className="col-span-3 sm:col-span-1" />
        <StatCard label="Delivered today" value={today.count} />
        <StatCard label="Active jobs" value={active.length} className="col-span-2 sm:col-span-1" />
      </section>

      {jobs.isError && <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />}

      {active.length > 0 && (
        <section aria-labelledby="current-heading">
          <SectionHeading id="current-heading" title={active.length > 1 ? 'Current jobs' : 'Current job'} />
          <div className="space-y-3">
            {active.map(({ order }) => (
              <Link
                key={order.id}
                to={`/rider/jobs/${order.id}`}
                className="group block rounded-sheet border-2 border-accent bg-accent-soft/40 p-4 transition-colors hover:bg-accent-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-small text-ink-3">{order.code}</p>
                    <p className="truncate text-heading font-bold">{order.merchant_name}</p>
                    <p className="truncate text-small text-ink-2">To Brgy. {order.delivery_address.barangay}</p>
                  </div>
                  <span className="tabular shrink-0 font-bold text-accent-ink">+{formatMoney(riderEarning(order))}</span>
                </div>
                <JobProgress status={order.status} className="mt-4" />
                <p className="mt-4 flex items-center justify-between gap-3 font-semibold">
                  {jobNextHint(order.status)}
                  <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="nearby-heading">
        <SectionHeading
          id="nearby-heading"
          title="New orders near you"
          action={
            (available.data?.length ?? 0) > 0 && (
              <Link to="/rider/orders" className="text-small font-semibold underline-offset-4 hover:underline">
                See all {available.data!.length}
              </Link>
            )
          }
        />
        {available.isPending ? (
          <PageLoading rows={2} />
        ) : available.isError ? (
          <ErrorState error={available.error} onRetry={() => available.refetch()} />
        ) : available.data.length === 0 ? (
          <div className="flex items-center gap-4 rounded-sheet border border-dashed border-line-strong p-5">
            <Package className="size-8 shrink-0 text-ink-4" weight="fill" aria-hidden />
            <div>
              <p className="font-semibold">No orders waiting right now</p>
              <p className="text-small text-ink-3">New orders in your area show up here instantly, and you’ll get a notification.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {available.data.slice(0, 4).map((o) => (
              <OrderCard key={o.id} order={o} to={`/rider/orders/${o.id}`} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Your GCash" className="flex items-center gap-4 rounded-sheet bg-canvas p-5">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface">
          <Wallet className={cx('size-6', ICON_GRADIENT)} weight="fill" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-small text-ink-3">Customers pay you by GCash</p>
          <p className="tabular truncate font-semibold">
            {profile.gcash_number} · {profile.gcash_name}
          </p>
        </div>
        <ButtonLink to="/rider/earnings" variant="secondary" size="sm" className="shrink-0">
          Earnings
        </ButtonLink>
      </section>
    </div>
  );
}
