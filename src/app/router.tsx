import { createBrowserRouter, Navigate, Outlet, useRouteError, type RouteObject } from 'react-router';
import { ConsumerLayout, type RouteHandle } from './layouts/ConsumerLayout';
import { RequireAuth, RequireRole } from '@/features/auth/guards';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVisitTracking } from '@/lib/visits';
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from '@/features/auth/AuthPages';
import HomePage from '@/features/consumer/HomePage';
import { ErrorState } from '@/components/ui/Feedback';
import { ButtonLink } from '@/components/ui/Button';

/** Route-level code splitting: each area loads only when first visited. */
const lazy = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });
const lazyNamed =
  <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  async () => ({ Component: (await load())[name] });

function RouteError() {
  const error = useRouteError();
  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed/.test(error.message);
  return (
    <div className="page-x mx-auto max-w-2xl py-16">
      <ErrorState
        error={chunkFailed ? new Error('A newer version of GETGO is available. Reload to continue.') : error}
        onRetry={() => window.location.reload()}
      />
      <ButtonLink to="/" variant="secondary">
        Go to home
      </ButtonLink>
    </div>
  );
}

/** Every page: checks in for Admin → Visitors, then shows the page. */
function SiteRoot() {
  const { userId } = useAuth();
  useVisitTracking(userId);
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="page-x mx-auto max-w-2xl py-16">
      <h1 className="text-title font-bold">Page not found</h1>
      <p className="mt-2 text-ink-3">The link may be broken, or the page may have moved.</p>
      <ButtonLink to="/" variant="secondary" className="mt-6">
        Go to home
      </ButtonLink>
    </div>
  );
}

const consumerRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: 'search', lazy: lazy(() => import('@/features/consumer/SearchPage')) },
  { path: 'explore', lazy: lazy(() => import('@/features/consumer/ExplorePage')) },
  { path: 'stores/:slug', lazy: lazy(() => import('@/features/consumer/StorePage')) },
  {
    path: 'stores/:slug/items/:productId',
    handle: { hideNav: true } satisfies RouteHandle,
    lazy: lazy(() => import('@/features/consumer/ProductPage')),
  },
  { path: 'cart', lazy: lazy(() => import('@/features/consumer/CartPage')) },
  { path: 'orders', lazy: lazy(() => import('@/features/consumer/OrdersPage')) },
  { path: 'account', lazy: lazyNamed(() => import('@/features/consumer/AccountPages'), 'AccountPage') },
  {
    element: <RequireAuth />,
    children: [
      {
        path: 'checkout/:merchantId',
        handle: { hideNav: true } satisfies RouteHandle,
        lazy: lazy(() => import('@/features/consumer/CheckoutPage')),
      },
      { path: 'orders/:orderId', lazy: lazy(() => import('@/features/consumer/OrderDetailPage')) },
      { path: 'riders/:riderId', lazy: lazyNamed(() => import('@/features/riders/RiderViews'), 'RiderProfilePage') },
      {
        path: 'padala',
        handle: { hideNav: true } satisfies RouteHandle,
        lazy: lazyNamed(() => import('@/features/services/ServiceRequestPages'), 'PadalaPage'),
      },
      {
        path: 'errands',
        handle: { hideNav: true } satisfies RouteHandle,
        lazy: lazyNamed(() => import('@/features/services/ServiceRequestPages'), 'ErrandPage'),
      },
      { path: 'account/addresses', lazy: lazyNamed(() => import('@/features/consumer/AccountPages'), 'AddressesPage') },
      { path: 'account/privacy', lazy: lazyNamed(() => import('@/features/consumer/AccountPages'), 'PrivacyCenterPage') },
      { path: 'notifications', lazy: lazyNamed(() => import('@/features/consumer/AccountPages'), 'NotificationsPage') },
      { path: 'account/support', lazy: lazyNamed(() => import('@/features/support/SupportPages'), 'SupportListPage') },
      { path: 'account/support/new', lazy: lazyNamed(() => import('@/features/support/SupportPages'), 'NewSupportPage') },
      { path: 'account/support/:ticketId', lazy: lazyNamed(() => import('@/features/support/SupportPages'), 'SupportThreadPage') },
    ],
  },
  { path: 'partner', lazy: lazy(() => import('@/features/partner/PartnerLandingPage')) },
  { path: 'legal', lazy: lazyNamed(() => import('@/features/legal/LegalPages'), 'LegalIndexPage') },
  { path: 'legal/terms', lazy: lazyNamed(() => import('@/features/legal/LegalPages'), 'TermsPage') },
  { path: 'legal/privacy', lazy: lazyNamed(() => import('@/features/legal/LegalPages'), 'PrivacyPage') },
  { path: 'legal/stores', lazy: lazyNamed(() => import('@/features/legal/LegalPages'), 'StoreListingsPage') },
  { path: 'legal/riders', lazy: lazyNamed(() => import('@/features/legal/LegalPages'), 'RiderTermsPage') },
  {
    path: 'partner/apply',
    element: <RequireAuth />,
    children: [{ index: true, handle: { hideNav: true } satisfies RouteHandle, lazy: lazy(() => import('@/features/partner/ApplicationPage')) }],
  },
];

export const router = createBrowserRouter([
  {
    element: <SiteRoot />,
    errorElement: <RouteError />,
    children: [
      { path: 'sign-in', element: <SignInPage /> },
      { path: 'sign-up', element: <SignUpPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: '/', element: <ConsumerLayout />, children: [...consumerRoutes, { path: '*', element: <NotFound /> }] },
      {
        path: 'merchant',
        element: <RequireAuth />,
        children: [
          {
            lazy: async () => ({ Component: (await import('@/features/merchant/MerchantLayout')).MerchantLayout }),
            children: [
          { index: true, lazy: lazy(() => import('@/features/merchant/MenuPage')) },
          { path: 'menu', element: <Navigate to="/merchant" replace /> },
          { path: 'menu/new', lazy: lazy(() => import('@/features/merchant/ProductEditorPage')) },
          { path: 'menu/:productId', lazy: lazy(() => import('@/features/merchant/ProductEditorPage')) },
          { path: 'options', lazy: lazy(() => import('@/features/merchant/OptionGroupsPage')) },
          { path: 'store', lazy: lazy(() => import('@/features/merchant/StoreSettingsPage')) },
          { path: 'settings', element: <Navigate to="/merchant/store" replace /> },
            ],
          },
        ],
      },
      {
        path: 'rider',
        children: [
          { path: 'sign-in', lazy: lazyNamed(() => import('@/features/rider/RiderAuthPages'), 'RiderSignInPage') },
          { path: 'sign-up', lazy: lazyNamed(() => import('@/features/rider/RiderAuthPages'), 'RiderSignUpPage') },
          {
            // Pending and new applicants see their application status here.
            element: <RequireAuth signInPath="/rider/sign-in" />,
            children: [
              {
                lazy: async () => ({ Component: (await import('@/features/rider/RiderLayout')).RiderLayout }),
                children: [
                  { index: true, lazy: lazyNamed(() => import('@/features/rider/RiderHomePage'), 'RiderHomePage') },
                  { path: 'orders', lazy: lazyNamed(() => import('@/features/rider/RiderOrdersPages'), 'RiderOrdersPage') },
                  { path: 'orders/:orderId', lazy: lazyNamed(() => import('@/features/rider/RiderOrdersPages'), 'RiderOrderPreviewPage') },
                  { path: 'jobs', lazy: lazyNamed(() => import('@/features/rider/RiderJobsPages'), 'RiderJobsPage') },
                  { path: 'jobs/:orderId', lazy: lazyNamed(() => import('@/features/rider/RiderJobsPages'), 'RiderJobPage') },
                  { path: 'earnings', lazy: lazyNamed(() => import('@/features/rider/RiderEarningsPage'), 'RiderEarningsPage') },
                  { path: 'account', lazy: lazyNamed(() => import('@/features/rider/RiderAccountPage'), 'RiderAccountPage') },
                  { path: 'notifications', lazy: lazyNamed(() => import('@/features/rider/RiderAccountPage'), 'RiderNotificationsPage') },
                ],
              },
            ],
          },
        ],
      },
      {
        path: 'admin',
        element: <RequireRole roles={['admin', 'support', 'finance']} />,
        children: [
          {
            lazy: async () => ({ Component: (await import('@/features/admin/AdminLayout')).AdminLayout }),
            children: [
              { index: true, lazy: lazy(() => import('@/features/admin/OverviewPage')) },
              { path: 'applications', lazy: lazy(() => import('@/features/admin/ApplicationsPage')) },
              { path: 'applications/:applicationId', lazy: lazy(() => import('@/features/admin/ApplicationReviewPage')) },
              { path: 'merchants', lazy: lazy(() => import('@/features/admin/MerchantsPage')) },
              { path: 'merchants/:merchantId', lazy: lazy(() => import('@/features/admin/MerchantDetailPage')) },
              {
                path: 'merchants/:merchantId/manage',
                lazy: async () => ({ Component: (await import('@/features/admin/AdminStoreManager')).AdminStoreManager }),
                children: [
                  { index: true, lazy: lazy(() => import('@/features/merchant/MenuPage')) },
                  { path: 'menu/new', lazy: lazy(() => import('@/features/merchant/ProductEditorPage')) },
                  { path: 'menu/:productId', lazy: lazy(() => import('@/features/merchant/ProductEditorPage')) },
                  { path: 'options', lazy: lazy(() => import('@/features/merchant/OptionGroupsPage')) },
                  { path: 'store', lazy: lazy(() => import('@/features/merchant/StoreSettingsPage')) },
                ],
              },
              { path: 'orders', lazy: lazy(() => import('@/features/admin/OrdersPage')) },
              { path: 'orders/:orderId', lazy: lazy(() => import('@/features/admin/OrderDetailPage')) },
              { path: 'riders', lazy: lazy(() => import('@/features/admin/RidersPage')) },
              { path: 'areas', lazy: lazy(() => import('@/features/admin/AreasPage')) },
              { path: 'promotions', lazy: lazy(() => import('@/features/admin/PromotionsPage')) },
              { path: 'payments', lazy: lazy(() => import('@/features/admin/PaymentsPage')) },
              { path: 'support', lazy: lazy(() => import('@/features/admin/SupportPage')) },
              { path: 'support/:ticketId', lazy: lazy(() => import('@/features/admin/SupportThreadPage')) },
              { path: 'users', lazy: lazy(() => import('@/features/admin/UsersPage')) },
              { path: 'visitors', lazy: lazy(() => import('@/features/admin/VisitorsPage')) },
              { path: 'audit', lazy: lazy(() => import('@/features/admin/AuditPage')) },
              { path: 'settings', lazy: lazy(() => import('@/features/admin/SettingsPage')) },
            ],
          },
        ],
      },
    ],
  },
]);
