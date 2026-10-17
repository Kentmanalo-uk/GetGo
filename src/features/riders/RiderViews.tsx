import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BadgeCheck, Bike, ChatText, ChevronRight, Phone, Star } from '@/components/icons';
import { smsLink } from '@/lib/deeplinks';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Textarea } from '@/components/ui/Field';
import { PageHeader, formatDate } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/errors';
import { useMyRiderReview, useRateRider, useRiderPublicProfile, type RiderPublicProfile } from './api';

const VEHICLES: Record<RiderPublicProfile['vehicle_type'], string> = { motorcycle: 'Motorcycle', bicycle: 'Bicycle', car: 'Car' };

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-micro font-semibold text-accent-ink', className)}>
      <BadgeCheck className="size-3.5" weight="fill" aria-hidden /> Verified
    </span>
  );
}

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('inline-flex', className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx('size-4', n <= Math.round(value) ? 'text-ink' : 'text-line-strong')} weight="fill" aria-hidden />
      ))}
    </span>
  );
}

/** Rating and completed deliveries in one line, e.g. "★ 4.9 (32) · 120 deliveries". */
export function RiderStats({ profile, className }: { profile: RiderPublicProfile; className?: string }) {
  return (
    <p className={cx('flex flex-wrap items-center gap-x-1.5 text-small text-ink-3', className)}>
      {profile.rating_count > 0 ? (
        <span className="inline-flex items-center gap-1 font-semibold text-ink">
          <Star className="size-3.5" weight="fill" aria-hidden />
          {Number(profile.rating_avg).toFixed(1)}
          <span className="font-normal text-ink-3">({profile.rating_count})</span>
        </span>
      ) : (
        <span>New rider</span>
      )}
      <span aria-hidden>·</span>
      <span className="tabular">
        {profile.completed_count} {profile.completed_count === 1 ? 'delivery' : 'deliveries'}
      </span>
    </p>
  );
}

/**
 * The rider on a customer's order: photo, name, verified badge, rating and
 * deliveries, with call and profile links. Phone and plate are shown only
 * because this customer's order is assigned to them.
 */
export function OrderRiderCard({
  riderId,
  rider,
  orderCode,
  canCall,
}: {
  riderId: string;
  rider: { full_name: string; phone: string; vehicle_type: string; plate_number: string | null };
  orderCode: string;
  canCall: boolean;
}) {
  const profile = useRiderPublicProfile(riderId);
  const p = profile.data;
  const name = p?.display_name ?? rider.full_name;
  return (
    <section aria-label="Your rider" className="rounded-sheet bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-small font-semibold text-ink-3">Your rider</p>
        <Link to={`/riders/${riderId}`} className="inline-flex items-center gap-0.5 text-small font-semibold text-ink underline-offset-4 hover:underline">
          View profile <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <Avatar name={name} path={p?.avatar_path} size="md" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
            <span className="truncate">{name}</span>
            {p?.verified && <VerifiedBadge />}
          </p>
          {p ? <RiderStats profile={p} /> : <p className="text-small text-ink-3">&nbsp;</p>}
          <p className="text-small text-ink-3">
            {VEHICLES[rider.vehicle_type as RiderPublicProfile['vehicle_type']] ?? rider.vehicle_type}
            {rider.plate_number && ` · ${rider.plate_number}`}
          </p>
        </div>
      </div>
      {canCall && (
        <div className="mt-4 flex gap-2">
          <a
            href={`tel:${rider.phone}`}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-control bg-ink px-3 text-small font-semibold text-white hover:bg-ink-2"
          >
            <Phone className="size-4" aria-hidden /> Call
          </a>
          <a
            href={smsLink(rider.phone, `Hi ${rider.full_name.split(' ')[0]}, this is about my GETGO order ${orderCode}.`)}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-control bg-accent-fill px-3 text-small font-semibold text-white hover:bg-accent-fill-hover"
          >
            <ChatText className="size-4" aria-hidden /> Message
          </a>
        </div>
      )}
    </section>
  );
}

/** Star rating for the rider after a completed order (can be changed later). */
export function RateRider({ orderId, riderId, riderName }: { orderId: string; riderId: string; riderName: string }) {
  const existing = useMyRiderReview(orderId);
  const rate = useRateRider(orderId, riderId);
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  if (existing.isPending) return null;

  if (existing.data && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
        <span>You rated {riderName}</span>
        <Stars value={existing.data.rating} />
        <button
          type="button"
          className="font-semibold underline underline-offset-4"
          onClick={() => {
            setRating(existing.data!.rating);
            setComment(existing.data!.comment ?? '');
            setEditing(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        rate.mutateAsync({ rating, comment }).then(
          () => {
            toast('Thanks for rating your rider');
            setEditing(false);
          },
          () => undefined,
        );
      }}
    >
      <fieldset>
        <legend className="mb-1 font-semibold">How was {riderName}?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={rating === n}
              className="inline-flex size-11 items-center justify-center rounded-control hover:bg-canvas"
            >
              <Star className={cx('size-7', n <= rating ? 'text-accent-strong' : 'text-line-strong')} weight="fill" aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
      {rating > 0 && (
        <>
          <Textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Say thanks or tell us what could be better (optional)" aria-label="Comment" />
          {rate.error && <Notice tone="danger">{userMessage(rate.error)}</Notice>}
          <Button type="submit" variant="dark" loading={rate.isPending}>
            Rate rider
          </Button>
        </>
      )}
    </form>
  );
}

/** Public rider profile (/riders/:riderId). */
export function RiderProfilePage() {
  const { riderId } = useParams();
  const profile = useRiderPublicProfile(riderId);

  if (profile.isPending) {
    return (
      <div className="page-x mx-auto max-w-2xl">
        <PageLoading rows={2} />
      </div>
    );
  }
  if (profile.isError) return <ErrorState className="page-x mx-auto max-w-2xl" error={profile.error} onRetry={() => profile.refetch()} />;
  const p = profile.data;
  if (!p) {
    return (
      <div className="page-x mx-auto max-w-2xl">
        <PageHeader title="Rider" back={true} />
        <EmptyState title="Rider not found">This rider isn’t on GETGO anymore.</EmptyState>
      </div>
    );
  }

  return (
    <div className="page-x mx-auto max-w-2xl pb-12">
      <PageHeader title="Rider profile" back={true} />
      <section className="rounded-sheet bg-surface p-6 text-center shadow-card">
        <Avatar name={p.display_name} path={p.avatar_path} size="lg" className="mx-auto size-24" />
        <h1 className="mt-4 text-title font-bold">{p.display_name}</h1>
        <div className="mt-2 flex justify-center">
          {p.verified ? (
            <VerifiedBadge />
          ) : (
            <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-semibold text-ink-3">Not currently active</span>
          )}
        </div>
        <dl className="mt-6 grid grid-cols-3 divide-x divide-line">
          <div>
            <dt className="text-micro text-ink-3">Rating</dt>
            <dd className="mt-0.5 flex items-center justify-center gap-1 text-heading font-bold">
              {p.rating_count > 0 ? (
                <>
                  <Star className="size-4" weight="fill" aria-hidden /> {Number(p.rating_avg).toFixed(1)}
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-micro text-ink-3">Deliveries</dt>
            <dd className="tabular mt-0.5 text-heading font-bold">{p.completed_count}</dd>
          </div>
          <div>
            <dt className="text-micro text-ink-3">Riding since</dt>
            <dd className="mt-0.5 text-heading font-bold">{new Date(p.member_since).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</dd>
          </div>
        </dl>
        <p className="mt-5 inline-flex items-center gap-1.5 text-small text-ink-3">
          <Bike className="size-4" aria-hidden /> {VEHICLES[p.vehicle_type]}
        </p>
      </section>

      {p.verified && (
        <p className="mt-4 text-center text-small text-ink-3">
          Verified means GETGO checked this rider’s details before approving them to deliver.
        </p>
      )}

      <section aria-labelledby="reviews-heading" className="mt-10">
        <h2 id="reviews-heading" className="text-heading font-semibold">
          What customers say
        </h2>
        {p.reviews.length === 0 ? (
          <p className="mt-2 text-ink-3">No comments yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {p.reviews.map((r, i) => (
              <li key={i} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <Stars value={r.rating} />
                  <span className="text-micro text-ink-3">{formatDate(r.created_at)}</span>
                </div>
                <p className="mt-1 text-ink-2">{r.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
