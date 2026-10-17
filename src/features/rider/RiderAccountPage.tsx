import { Link, useNavigate } from 'react-router';
import { Bell, ChevronRight, FileText, LifeBuoy, LogOut, Store } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServiceAreas } from '@/features/consumer/api';
import { NotificationsPage } from '@/features/consumer/AccountPages';
import { formatDate } from '@/components/ui/Display';
import type { IconComponent } from '@/components/icons';
import { VEHICLE_LABELS } from './api';
import { useRider } from './RiderLayout';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-small text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{value}</dd>
    </div>
  );
}

function MenuLink({ to, icon: Icon, label, onClick }: { to?: string; icon: IconComponent; label: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon className="size-5 text-ink-3" aria-hidden />
      <span className="flex-1 text-left font-semibold">{label}</span>
      {to && <ChevronRight className="size-4 text-ink-3" aria-hidden />}
    </>
  );
  const cls = 'flex w-full items-center gap-3 py-3.5 hover:text-ink';
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function RiderAccountPage() {
  const { profile } = useRider();
  const auth = useAuth();
  const navigate = useNavigate();
  const areas = useServiceAreas();
  const area = areas.data?.find((a) => a.id === profile.service_area_id);

  return (
    <div className="mx-auto max-w-2xl space-y-8 pt-6 pb-6 lg:pt-10">
      <header className="flex items-center gap-4">
        <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-soft text-title font-bold text-accent-ink">
          {profile.full_name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-title font-bold">{profile.full_name}</h1>
          <p className="text-small text-ink-3">
            GETGO rider since {formatDate(profile.created_at)}
            {auth.profile?.email && <span className="block truncate">{auth.profile.email}</span>}
          </p>
        </div>
      </header>

      <section aria-labelledby="details-heading">
        <h2 id="details-heading" className="text-heading font-semibold">
          Rider details
        </h2>
        <dl className="mt-2 divide-y divide-line border-y border-line">
          <Row label="Mobile number" value={profile.phone} />
          <Row label="Vehicle" value={VEHICLE_LABELS[profile.vehicle_type]} />
          {profile.plate_number && <Row label="Plate number" value={profile.plate_number} />}
          <Row label="Delivery area" value={area ? `${area.name}, ${area.city}` : '—'} />
        </dl>
      </section>

      <section aria-labelledby="gcash-heading">
        <h2 id="gcash-heading" className="text-heading font-semibold">
          GCash for payments
        </h2>
        <p className="mt-1 text-small text-ink-3">Customers send each order’s payment here before you buy the items.</p>
        <dl className="mt-2 divide-y divide-line border-y border-line">
          <Row label="Account name" value={profile.gcash_name} />
          <Row label="GCash number" value={profile.gcash_number} />
        </dl>
        <p className="mt-3 text-small text-ink-3">
          Need to change your details?{' '}
          <Link to="/account/support/new" className="font-semibold text-ink underline underline-offset-4">
            Ask GETGO support
          </Link>
        </p>
      </section>

      <nav aria-label="More" className="divide-y divide-line border-y border-line">
        <MenuLink to="/rider/notifications" icon={Bell} label="Notifications" />
        <MenuLink to="/account/support" icon={LifeBuoy} label="Support requests" />
        <MenuLink to="/legal" icon={FileText} label="Terms and privacy" />
        <MenuLink to="/" icon={Store} label="Order on GETGO" />
        <MenuLink icon={LogOut} label="Sign out" onClick={() => auth.signOut().then(() => navigate('/rider/sign-in'))} />
      </nav>
    </div>
  );
}

export function RiderNotificationsPage() {
  return <NotificationsPage embedded />;
}
