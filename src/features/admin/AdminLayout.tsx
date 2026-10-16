import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  ArrowUpRight,
  Bike,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MapPin,
  Menu,
  Receipt,
  Settings,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { IconButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useAuth } from '@/features/auth/AuthProvider';
import type { AppRole } from '@/types/models';
import { ROLE_LABELS, useAdminOverview, type AdminOverview } from './api';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: AppRole[];
  end?: boolean;
  count?: keyof AdminOverview;
}

const STAFF: AppRole[] = ['admin', 'support', 'finance'];

const MAIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutGrid, roles: STAFF, end: true },
  { to: '/admin/applications', label: 'Applications', icon: ClipboardList, roles: ['admin', 'support'], count: 'applications_waiting' },
  { to: '/admin/merchants', label: 'Merchants', icon: Store, roles: STAFF },
  { to: '/admin/orders', label: 'Orders', icon: Receipt, roles: STAFF, count: 'orders_waiting_for_rider' },
  { to: '/admin/riders', label: 'Riders', icon: Bike, roles: STAFF, count: 'riders_pending' },
  { to: '/admin/payments', label: 'Refunds', icon: CreditCard, roles: ['admin', 'finance'], count: 'refunds_waiting' },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy, roles: ['admin', 'support'], count: 'open_tickets' },
];

const SETTINGS_NAV: NavItem[] = [
  { to: '/admin/areas', label: 'Areas & fees', icon: MapPin, roles: STAFF },
  { to: '/admin/promotions', label: 'Promotions', icon: Tag, roles: STAFF },
  { to: '/admin/users', label: 'People & roles', icon: Users, roles: STAFF },
  { to: '/admin/audit', label: 'Audit log', icon: FileText, roles: ['admin'] },
  { to: '/admin/settings', label: 'Platform settings', icon: Settings, roles: ['admin'] },
];

function NavList({ items, counts }: { items: NavItem[]; counts?: AdminOverview }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ to, label, icon: Icon, end, count }) => {
        const n = count && counts ? counts[count] : 0;
        return (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-control px-3 text-small font-semibold transition-colors',
                  isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-canvas hover:text-ink',
                )
              }
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              <span className="flex-1 truncate">{label}</span>
              {n > 0 && (
                <span className="tabular text-micro text-ink-3" aria-label={`${n} waiting`}>
                  {n}
                </span>
              )}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

function Navigation() {
  const { roles, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const overview = useAdminOverview();
  const allowed = (item: NavItem) => item.roles.some((r) => roles.includes(r));
  const main = MAIN_NAV.filter(allowed);
  const settings = SETTINGS_NAV.filter(allowed);
  const staffRoles = roles.filter((r) => r !== 'rider');

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Admin" className="flex-1 space-y-6">
        <NavList items={main} counts={overview.data} />
        {settings.length > 0 && (
          <div>
            <p className="mb-1.5 px-3 text-micro font-semibold text-ink-3">Settings</p>
            <NavList items={settings} />
          </div>
        )}
      </nav>
      <div className="mt-6 space-y-1 border-t border-line pt-4">
        <div className="px-3 pb-2">
          <p className="truncate text-small font-semibold">{profile?.full_name || profile?.email}</p>
          <p className="truncate text-micro text-ink-3">{staffRoles.map((r) => ROLE_LABELS[r]).join(', ')}</p>
        </div>
        <Link to="/" className="flex h-10 items-center gap-3 rounded-control px-3 text-small font-semibold text-ink-2 hover:bg-canvas hover:text-ink">
          <ArrowUpRight className="size-[18px]" aria-hidden />
          Open GETGO app
        </Link>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate('/sign-in', { replace: true });
          }}
          className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-small font-semibold text-ink-2 hover:bg-canvas hover:text-ink"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:flex">
        <Link to="/admin" className="mb-6 px-3" aria-label="GETGO Admin overview">
          <Logo suffix="Admin" />
        </Link>
        <Navigation />
      </aside>

      <div className="safe-top sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link to="/admin" aria-label="GETGO Admin overview">
            <Logo suffix="Admin" />
          </Link>
          <IconButton label="Open menu" className="-mr-2" onClick={() => setMenuOpen(true)}>
            <Menu className="size-5" aria-hidden />
          </IconButton>
        </div>
      </div>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" size="sm">
        <Navigation />
      </Sheet>

      <main id="main" className="page-x mx-auto max-w-6xl pb-16">
        <Outlet />
      </main>
    </div>
  );
}
