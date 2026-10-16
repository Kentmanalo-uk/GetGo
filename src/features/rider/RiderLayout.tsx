import { createContext, useContext, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Bell, ClipboardList, Home, LogOut, Package, Store, User, Wallet } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { useUnreadCount } from '@/features/notifications/api';
import { Logo } from '@/components/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorState, PageLoading } from '@/components/ui/Feedback';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { useAvailableOrders, useJobs, useRiderProfile, useRiderRealtime, type RiderProfile } from './api';

interface RiderContextValue {
  profile: RiderProfile;
}

const RiderContext = createContext<RiderContextValue | null>(null);
export function useRider() {
  const ctx = useContext(RiderContext);
  if (!ctx) throw new Error('useRider must be used inside RiderLayout');
  return ctx;
}

/** Applicants, suspended riders and loading states: a plain page with no navigation. */
function StatusScreen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="page-x mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="safe-top flex items-center justify-between py-4">
        <Link to="/">
          <Logo suffix="Rider" />
        </Link>
        <button type="button" onClick={() => signOut().then(() => navigate('/rider/sign-in'))} className="text-small font-semibold text-ink-3 hover:text-ink">
          Sign out
        </button>
      </header>
      <div className="flex flex-1 flex-col justify-center pb-24">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-accent-soft">
          <Package className={cx('size-7', ICON_GRADIENT)} weight="fill" aria-hidden />
        </span>
        <h1 className="mt-5 text-display font-bold">{title}</h1>
        <div className="mt-2 text-ink-2">{children}</div>
        {action && <div className="mt-6 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function RiderLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const profile = useRiderProfile(auth.userId);
  const active = profile.data?.status === 'active' ? profile.data : null;
  const available = useAvailableOrders(active?.service_area_id ?? null);
  const jobs = useJobs(active ? auth.userId : null);
  const unread = useUnreadCount();
  useRiderRealtime(active ? auth.userId : null, active?.service_area_id ?? null);

  if (profile.isPending) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageLoading rows={3} />
      </div>
    );
  }
  if (profile.isError) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      </div>
    );
  }
  if (!profile.data) {
    return (
      <StatusScreen title="Finish your rider details" action={<ButtonLink to="/rider/sign-up">Add vehicle and GCash details</ButtonLink>}>
        Tell us your vehicle, delivery area and GCash account so GETGO can review your application.
      </StatusScreen>
    );
  }
  if (profile.data.status === 'pending') {
    return (
      <StatusScreen
        title="Your application is being reviewed"
        action={
          <>
            <ButtonLink to="/rider/sign-up" variant="secondary">
              Edit details
            </ButtonLink>
            <ButtonLink to="/" variant="ghost">
              Order on GETGO
            </ButtonLink>
          </>
        }
      >
        GETGO checks every rider before they can accept orders. You’ll get a notification when you’re approved.
      </StatusScreen>
    );
  }
  if (profile.data.status !== 'active' || !active) {
    return (
      <StatusScreen title="Your rider account is suspended" action={<ButtonLink to="/account/support/new">Contact support</ButtonLink>}>
        You can’t accept orders right now. Contact GETGO support for details.
      </StatusScreen>
    );
  }

  const nav = [
    { to: '/rider', label: 'Home', icon: Home, end: true },
    { to: '/rider/orders', label: 'Orders', icon: Package, badge: available.data?.length ?? 0 },
    { to: '/rider/jobs', label: 'My jobs', icon: ClipboardList, badge: jobs.data?.active.length ?? 0 },
    { to: '/rider/earnings', label: 'Earnings', icon: Wallet },
    { to: '/rider/account', label: 'Account', icon: User },
  ];
  const signOut = async () => {
    await auth.signOut();
    navigate('/rider/sign-in');
  };
  const sideLink = ({ isActive }: { isActive: boolean }) =>
    cx('flex items-center gap-3 rounded-control px-3 py-2 text-small font-semibold transition-colors', isActive ? 'bg-canvas text-ink' : 'text-ink-3 hover:text-ink');
  const firstName = active.full_name.split(' ')[0];

  return (
    <RiderContext.Provider value={{ profile: active }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-4 py-6 lg:flex">
          <Link to="/rider" className="px-3">
            <Logo suffix="Rider" />
          </Link>
          <div className="mt-8 flex items-center gap-3 px-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink">
              {firstName.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{active.full_name}</span>
              <span className="block text-small text-ink-3">Active rider</span>
            </span>
          </div>
          <nav aria-label="Rider" className="mt-8 flex-1 space-y-0.5">
            {nav.map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink key={to} to={to} end={end} className={sideLink}>
                <Icon className="size-4" aria-hidden />
                <span className="flex-1">{label}</span>
                {badge ? <span className="tabular rounded-full bg-accent px-1.5 text-micro text-ink">{badge}</span> : null}
              </NavLink>
            ))}
            <NavLink to="/rider/notifications" className={sideLink}>
              <Bell className="size-4" aria-hidden />
              <span className="flex-1">Notifications</span>
              {unread > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-micro text-ink">{unread}</span>}
            </NavLink>
          </nav>
          <div className="space-y-0.5 border-t border-line pt-4">
            <Link to="/" className="flex items-center gap-3 rounded-control px-3 py-2 text-small font-semibold text-ink-3 hover:text-ink">
              <Store className="size-4" aria-hidden /> GETGO for customers
            </Link>
            <button type="button" onClick={signOut} className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-small font-semibold text-ink-3 hover:text-ink">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <Link to="/rider" aria-label="Rider home">
                <Logo suffix="Rider" />
              </Link>
              <Link
                to="/rider/notifications"
                className="relative -mr-2 inline-flex size-10 items-center justify-center"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              >
                <Bell className="size-5" aria-hidden />
                {unread > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-accent-strong ring-2 ring-surface" />}
              </Link>
            </div>
          </header>
          <main id="main" className="page-x mx-auto max-w-4xl pb-28 lg:pb-12">
            <Outlet />
          </main>
        </div>

        <nav aria-label="Rider" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden">
          <ul className="grid h-16 grid-cols-5">
            {nav.map(({ to, label, icon: Icon, end, badge }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-1 text-micro font-semibold', isActive ? 'text-accent-ink' : 'text-ink-4')}
                >
                  {({ isActive }) => (
                    <>
                      <span className="relative">
                        <Icon className={cx('size-6', isActive ? ICON_GRADIENT : 'text-ink-4')} weight="fill" aria-hidden />
                        {badge ? (
                          <span className="tabular absolute -top-1.5 -right-2.5 min-w-4 rounded bg-accent px-1 text-center text-[10px] leading-4 text-ink">{badge}</span>
                        ) : null}
                      </span>
                      {label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </RiderContext.Provider>
  );
}
