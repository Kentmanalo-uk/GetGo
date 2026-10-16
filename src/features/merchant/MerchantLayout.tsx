import { createContext, useContext, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { BookOpen, ChevronsUpDown, ListChecks, LogOut, Settings2, Store } from 'lucide-react';
import { useAuth, type Membership } from '@/features/auth/AuthProvider';
import { useMyApplication } from '@/features/partner/api';
import { Logo } from '@/components/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { PageLoading } from '@/components/ui/Feedback';
import { StatusText, StoreMark } from '@/components/ui/Display';
import { Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import type { MemberRole } from '@/types/models';
import { useStoreState } from './api';

interface MerchantContextValue {
  merchantId: string;
  membership: Membership;
  role: MemberRole;
  /** Owners and managers edit the catalog and store; staff only toggle availability. */
  canManage: boolean;
}

const MerchantContext = createContext<MerchantContextValue | null>(null);
export function useMerchantContext() {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error('useMerchantContext must be used inside MerchantLayout');
  return ctx;
}

const STORE_KEY = 'getgo.merchant';

function NoStore() {
  const app = useMyApplication();
  const a = app.data;
  return (
    <div className="page-x mx-auto max-w-xl space-y-4 py-16">
      <Logo suffix="Partner" />
      <h1 className="text-title font-bold">{a && a.status !== 'rejected' ? 'Your application is in progress' : 'You don’t have a store on GETGO yet'}</h1>
      <p className="text-ink-2">
        {a && ['submitted', 'under_review'].includes(a.status)
          ? 'We’re reviewing your application. Your product list opens here as soon as you’re approved.'
          : a && ['draft', 'needs_changes'].includes(a.status)
            ? 'Finish your application to get your store reviewed.'
            : 'Apply to list your store on GETGO.'}
      </p>
      <div className="flex gap-2">
        <ButtonLink to="/partner/apply">{a ? 'View application' : 'Apply now'}</ButtonLink>
        <ButtonLink to="/" variant="secondary">
          Back to GETGO
        </ButtonLink>
      </div>
    </div>
  );
}

function StoreSwitcher({ memberships, current, onChange }: { memberships: Membership[]; current: Membership; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const state = useStoreState(current.merchant_id);
  const label = !current.merchant.is_published ? 'Not published' : state.data === 'open' ? 'Open' : state.data === 'paused' ? 'Temporarily closed' : 'Closed';
  return (
    <>
      <button
        type="button"
        onClick={() => memberships.length > 1 && setOpen(true)}
        className={cx('flex min-w-0 items-center gap-3 text-left', memberships.length > 1 && 'hover:opacity-80')}
        aria-label={memberships.length > 1 ? `Current store: ${current.merchant.name}. Switch store` : undefined}
      >
        <StoreMark name={current.merchant.name} logoPath={current.merchant.logo_path} size="sm" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{current.merchant.name}</span>
          <StatusText tone={label === 'Open' ? 'done' : 'muted'}>{label}</StatusText>
        </span>
        {memberships.length > 1 && <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Switch store" size="sm">
        <ul className="divide-y divide-line">
          {memberships.map((m) => (
            <li key={m.merchant_id}>
              <button
                type="button"
                onClick={() => {
                  onChange(m.merchant_id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <StoreMark name={m.merchant.name} logoPath={m.merchant.logo_path} size="sm" />
                <span className="flex-1 font-semibold">{m.merchant.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

const NAV = [
  { to: '/merchant', label: 'Products', icon: BookOpen, end: true },
  { to: '/merchant/options', label: 'Choices', icon: ListChecks },
  { to: '/merchant/store', label: 'Store', icon: Settings2 },
];

export function MerchantLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  });

  const membership = auth.memberships.find((m) => m.merchant_id === selected) ?? auth.memberships[0] ?? null;
  const value = useMemo<MerchantContextValue | null>(
    () =>
      membership && {
        merchantId: membership.merchant_id,
        membership,
        role: membership.role,
        canManage: membership.role === 'owner' || membership.role === 'manager',
      },
    [membership],
  );

  if (auth.status === 'loading') {
    return (
      <div className="page-x mx-auto max-w-5xl">
        <PageLoading />
      </div>
    );
  }
  if (!value || !membership) return <NoStore />;

  const choose = (id: string) => {
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* ignore */
    }
    setSelected(id);
    navigate('/merchant');
  };
  const signOut = async () => {
    await auth.signOut();
    navigate('/');
  };
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx('flex items-center gap-3 rounded-control px-3 py-2 text-small font-semibold transition-colors', isActive ? 'bg-canvas text-ink' : 'text-ink-3 hover:text-ink');

  return (
    <MerchantContext.Provider value={value}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-4 py-6 lg:flex">
          <Link to="/merchant" className="px-3">
            <Logo suffix="Partner" />
          </Link>
          <div className="mt-8 px-3">
            <StoreSwitcher memberships={auth.memberships} current={membership} onChange={choose} />
          </div>
          <nav aria-label="Partner" className="mt-8 flex-1 space-y-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={linkClass}>
                <Icon className="size-4" aria-hidden /> {label}
              </NavLink>
            ))}
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
              <StoreSwitcher memberships={auth.memberships} current={membership} onChange={choose} />
              <button type="button" onClick={signOut} className="text-small font-semibold text-ink-3">
                Sign out
              </button>
            </div>
          </header>
          <main className="page-x mx-auto max-w-5xl pb-24 lg:pb-12">
            <Outlet />
          </main>
        </div>

        <nav aria-label="Partner" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden">
          <ul className="grid h-16 grid-cols-3">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-1 text-micro font-semibold', isActive ? 'text-ink' : 'text-ink-4')}>
                  <Icon className="size-[22px]" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </MerchantContext.Provider>
  );
}
