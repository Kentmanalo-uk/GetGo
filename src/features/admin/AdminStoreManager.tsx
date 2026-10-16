import { useMemo } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/Feedback';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, StoreMark } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { MerchantContext, type MerchantContextValue } from '@/features/merchant/MerchantLayout';
import { useMerchant, usePermissions } from './api';

/**
 * Lets administrators run any store's Products, Choices and Store screens.
 * The same components the store owner uses are mounted with this store's
 * context; the database allows admins to manage every store.
 */
export function AdminStoreManager() {
  const { merchantId } = useParams();
  const perms = usePermissions();
  const query = useMerchant(merchantId);
  const m = query.data?.merchant;
  const basePath = `/admin/merchants/${merchantId}/manage`;

  const value = useMemo<MerchantContextValue | null>(
    () =>
      m
        ? {
            merchantId: m.id,
            basePath,
            role: 'owner',
            canManage: perms.isAdmin,
            membership: {
              merchant_id: m.id,
              role: 'owner',
              merchant: { id: m.id, name: m.name, slug: m.slug, status: m.status, is_published: m.is_published, category: m.category, logo_path: m.logo_path },
            },
          }
        : null,
    [m, basePath, perms.isAdmin],
  );

  if (!perms.isAdmin) {
    return <EmptyState title="Only administrators can manage stores" action={<ButtonLink to={`/admin/merchants/${merchantId}`} variant="secondary">Back to store</ButtonLink>} />;
  }
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!m || !value) return <EmptyState title="Store not found" action={<ButtonLink to="/admin/merchants" variant="secondary">All merchants</ButtonLink>} />;

  const tabs = [
    { to: basePath, label: 'Products', end: true },
    { to: `${basePath}/options`, label: 'Choices' },
    { to: `${basePath}/store`, label: 'Store details' },
  ];

  return (
    <MerchantContext.Provider value={value}>
      <PageHeader
        back={`/admin/merchants/${m.id}`}
        title={
          <span className="flex items-center gap-3">
            <StoreMark name={m.name} logoPath={m.logo_path} size="sm" />
            <span className="min-w-0">{m.name}</span>
          </span>
        }
      >
        Managing as GETGO admin
      </PageHeader>
      <nav aria-label="Store sections" className="no-scrollbar -mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx('-mb-px shrink-0 border-b-2 py-3 text-small font-semibold whitespace-nowrap', isActive ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </MerchantContext.Provider>
  );
}
