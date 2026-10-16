import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useMatches, useNavigate } from 'react-router';
import { Bell, ChevronDown, Compass, Home, Receipt, Search, ShoppingBag, User } from '@/components/icons';
import { Logo } from '@/components/Logo';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { ButtonLink } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCarts } from '@/features/consumer/api';
import { useLocationContext } from '@/features/location/LocationProvider';
import { AddressSheet } from '@/features/location/AddressSheet';
import { useUnreadCount } from '@/features/notifications/api';
import { env } from '@/lib/supabase';

export interface RouteHandle {
  /** Hide the mobile bottom navigation (focused flows like checkout). */
  hideNav?: boolean;
}

function useCartCount() {
  const { data } = useCarts();
  return data?.reduce((sum, c) => sum + c.item_count, 0) ?? 0;
}

export function AddressButton({ className }: { className?: string }) {
  const { address, area, ready } = useLocationContext();
  const [open, setOpen] = useState(false);
  const label = address ? address.label : area ? area.name : 'Choose your area';
  const detail = address ? `${address.barangay}, ${address.city}` : area ? area.city : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx('group flex min-w-0 items-center gap-1.5 text-left', className)}
        aria-label={`Delivery location: ${label}. Change`}
      >
        <span className="min-w-0">
          <span className="block text-micro font-medium text-ink-3">{address ? 'Deliver to' : 'Browsing'}</span>
          <span className="flex items-center gap-1 font-semibold">
            <span className="truncate">{ready ? label : '…'}</span>
            {detail && <span className="hidden truncate font-normal text-ink-3 sm:inline">· {detail}</span>}
            <ChevronDown className="size-4 shrink-0 text-ink-3 group-hover:text-ink" aria-hidden />
          </span>
        </span>
      </button>
      <AddressSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(value.trim())}`);
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search stores and dishes"
        aria-label="Search stores and dishes"
        className="h-10 w-full rounded-control bg-canvas pr-3 pl-9 text-body placeholder:text-ink-3 focus:bg-surface focus:ring-2 focus:ring-accent focus:outline-none"
      />
    </form>
  );
}

function DesktopHeader() {
  const { status, profile } = useAuth();
  const cartCount = useCartCount();
  const unread = useUnreadCount();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cx('text-small font-semibold transition-colors', isActive ? 'text-ink' : 'text-ink-3 hover:text-ink');

  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-8">
        <Link to="/" aria-label="GETGO home">
          <Logo />
        </Link>
        <AddressButton className="max-w-64" />
        <HeaderSearch />
        <nav aria-label="Main" className="ml-auto flex items-center gap-6">
          <NavLink to="/explore" className={navClass}>
            Explore
          </NavLink>
          <NavLink to="/partner" className={navClass}>
            Partner with GETGO
          </NavLink>
          {status === 'signed_in' ? (
            <>
              <NavLink to="/orders" className={navClass}>
                Orders
              </NavLink>
              <NavLink to="/notifications" className="relative text-ink-2 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell className="size-5" aria-hidden />
                {unread > 0 && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-accent-strong ring-2 ring-surface" />}
              </NavLink>
              <NavLink to="/cart" className="relative flex items-center gap-2 text-small font-semibold" aria-label={`Cart, ${cartCount} items`}>
                <ShoppingBag className="size-5" aria-hidden />
                {cartCount > 0 && <span className="tabular rounded bg-accent px-1.5 text-micro">{cartCount}</span>}
              </NavLink>
              <NavLink to="/account" className={navClass}>
                {profile?.full_name?.split(' ')[0] ?? 'Account'}
              </NavLink>
            </>
          ) : (
            status === 'signed_out' && (
              <ButtonLink to="/sign-in" variant="dark" size="sm">
                Sign in
              </ButtonLink>
            )
          )}
        </nav>
      </div>
    </header>
  );
}

function MobileTopBar() {
  const { status } = useAuth();
  const unread = useUnreadCount();
  return (
    <div className="safe-top sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Link to="/" aria-label="GETGO home">
          <Logo />
        </Link>
        {status === 'signed_in' ? (
          <Link to="/notifications" className="relative -mr-2 inline-flex size-10 items-center justify-center" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Bell className="size-5" aria-hidden />
            {unread > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-accent-strong ring-2 ring-surface" />}
          </Link>
        ) : (
          status === 'signed_out' && (
            <Link to="/sign-in" className="text-small font-semibold underline underline-offset-4">
              Sign in
            </Link>
          )
        )}
      </div>
    </div>
  );
}

function BottomNav() {
  const cartCount = useCartCount();
  const items = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/explore', label: 'Explore', icon: Compass },
    { to: '/cart', label: 'Cart', icon: ShoppingBag, badge: cartCount },
    { to: '/orders', label: 'Orders', icon: Receipt },
    { to: '/account', label: 'Account', icon: User },
  ];
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden">
      <ul className="grid h-16 grid-cols-5">
        {items.map(({ to, label, icon: Icon, end, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx('flex h-full flex-col items-center justify-center gap-1 text-micro font-semibold', isActive ? 'text-accent-ink' : 'text-ink-4')
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    {/* Always filled: grey when inactive, pink gradient when active. */}
                    <Icon className={cx('size-6', isActive ? ICON_GRADIENT : 'text-ink-4')} weight="fill" aria-hidden />
                    {badge ? (
                      <span className="tabular absolute -top-1.5 -right-2.5 min-w-4 rounded bg-accent px-1 text-center text-[10px] leading-4 text-ink">
                        {badge}
                      </span>
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
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-canvas">
      <div className="page-x mx-auto grid max-w-7xl gap-8 py-10 sm:grid-cols-[1fr_auto_auto] sm:gap-16">
        <div className="space-y-2">
          <Logo />
          <p className="max-w-xs text-small text-ink-3">Local restaurants and stores, delivered by people from your area.</p>
        </div>
        <nav aria-label="For businesses" className="space-y-2 text-small">
          <p className="font-semibold">For businesses</p>
          <Link to="/partner" className="block text-ink-2 hover:text-ink">
            Partner with GETGO
          </Link>
          <Link to="/merchant" className="block text-ink-2 hover:text-ink">
            Partner login
          </Link>
          <Link to="/rider/sign-up" className="block text-ink-2 hover:text-ink">
            Deliver with GETGO
          </Link>
          <Link to="/rider/sign-in" className="block text-ink-2 hover:text-ink">
            Rider login
          </Link>
        </nav>
        <nav aria-label="Help" className="space-y-2 text-small">
          <p className="font-semibold">Help</p>
          <Link to="/account/support" className="block text-ink-2 hover:text-ink">
            Support requests
          </Link>
          {env.supportEmail && (
            <a href={`mailto:${env.supportEmail}`} className="block text-ink-2 hover:text-ink">
              {env.supportEmail}
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}

export function ConsumerLayout() {
  const matches = useMatches();
  const hideNav = matches.some((m) => (m.handle as RouteHandle | undefined)?.hideNav);
  return (
    <div className="flex min-h-dvh flex-col">
      <DesktopHeader />
      {!hideNav && <MobileTopBar />}
      <main id="main" className={cx('flex-1', !hideNav && 'pb-20 lg:pb-0')}>
        <Outlet />
      </main>
      <div className="hidden lg:block">
        <SiteFooter />
      </div>
      {!hideNav && <BottomNav />}
    </div>
  );
}
