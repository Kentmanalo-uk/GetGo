import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { PageLoading } from '@/components/ui/Feedback';
import type { AppRole } from '@/types/models';

function FullPageLoading() {
  return (
    <div className="page-x mx-auto max-w-3xl">
      <PageLoading rows={3} />
    </div>
  );
}

/** Requires a signed-in user; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signed_out') {
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return children ?? <Outlet />;
}

/**
 * UI-level role gate. The database enforces the same rules independently;
 * this only avoids showing screens a user cannot use.
 */
export function RequireRole({ roles, children }: { roles: AppRole[]; children?: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageLoading />;
  if (auth.status === 'signed_out') {
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (!roles.some((r) => auth.hasRole(r))) return <Navigate to="/" replace />;
  return children ?? <Outlet />;
}
