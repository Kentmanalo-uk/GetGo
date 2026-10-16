import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, SectionHeading } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { formatMoney } from '@/domain/money';
import { earningWindows, riderEarning, summarizeJobs, useJobs, type Job } from './api';
import { StatCard } from './components';
import { DeliveryHistory } from './RiderJobsPages';

/** Earnings for each of the last 7 days, oldest first. */
function lastSevenDays(done: Job[]) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return { start: d.getTime(), label: d.toLocaleDateString('en-PH', { weekday: 'short' }), earnedMinor: 0, count: 0 };
  });
  for (const j of done) {
    if (j.order.status !== 'completed' || !j.completed_at) continue;
    const t = new Date(j.completed_at).getTime();
    const day = [...days].reverse().find((d) => t >= d.start);
    if (day && t < day.start + 86_400_000) {
      day.earnedMinor += riderEarning(j.order);
      day.count += 1;
    }
  }
  return days;
}

function WeekChart({ done }: { done: Job[] }) {
  const days = lastSevenDays(done);
  const max = Math.max(...days.map((d) => d.earnedMinor), 1);
  return (
    <figure className="rounded-sheet border border-line p-5">
      <figcaption className="text-small text-ink-3">Last 7 days</figcaption>
      <ol className="mt-4 grid h-40 grid-cols-7 items-end gap-2" aria-label="Earnings per day">
        {days.map((d, i) => (
          <li key={d.start} className="flex h-full flex-col items-center justify-end gap-1.5">
            <span className="tabular text-[10px] text-ink-3">{d.earnedMinor > 0 ? formatMoney(d.earnedMinor) : ''}</span>
            <span
              className={cx('w-full max-w-10 rounded-t-md', d.earnedMinor > 0 ? (i === 6 ? 'bg-accent-strong' : 'bg-accent') : 'bg-line')}
              style={{ height: `${Math.max((d.earnedMinor / max) * 100, 3)}%` }}
              aria-label={`${d.label}: ${formatMoney(d.earnedMinor)} from ${d.count} ${d.count === 1 ? 'delivery' : 'deliveries'}`}
            />
            <span className={cx('text-micro', i === 6 ? 'font-semibold text-ink' : 'text-ink-3')}>{i === 6 ? 'Today' : d.label}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function RiderEarningsPage() {
  const { userId } = useAuth();
  const jobs = useJobs(userId);

  if (jobs.isPending) return <PageLoading rows={3} />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />;

  const w = earningWindows();
  const done = jobs.data.done;
  const today = summarizeJobs(done, w.today);
  const week = summarizeJobs(done, w.week);
  const month = summarizeJobs(done, w.month);
  const all = summarizeJobs(done, 0);
  const plural = (n: number) => `${n} ${n === 1 ? 'delivery' : 'deliveries'}`;

  return (
    <div className="space-y-8 pb-6">
      <PageHeader title="Earnings">What customers paid you, minus what you paid the stores.</PageHeader>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" value={formatMoney(today.earnedMinor)} hint={plural(today.count)} />
        <StatCard label="Last 7 days" value={formatMoney(week.earnedMinor)} hint={plural(week.count)} />
        <StatCard label="This month" value={formatMoney(month.earnedMinor)} hint={plural(month.count)} />
        <StatCard label="All time" value={formatMoney(all.earnedMinor)} hint={plural(all.count)} />
      </section>

      <WeekChart done={done} />

      <section aria-labelledby="history-heading">
        <SectionHeading id="history-heading" title="Deliveries" />
        {done.length === 0 ? (
          <EmptyState title="No deliveries yet">Each delivery you complete is listed here with what you earned.</EmptyState>
        ) : (
          <DeliveryHistory jobs={done} />
        )}
      </section>
    </div>
  );
}
