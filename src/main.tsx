import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LocationProvider } from '@/features/location/LocationProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { Logo } from '@/components/Logo';
import { IconContext } from '@/components/icons';
import { router } from '@/app/router';

function MissingConfiguration() {
  return (
    <main className="page-x mx-auto max-w-xl space-y-4 py-16">
      <Logo />
      <h1 className="text-title font-bold">GETGO isn’t connected to Supabase</h1>
      <p className="text-ink-2">
        Set <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in{' '}
        <code className="font-mono">.env.local</code> (see <code className="font-mono">.env.example</code>), then restart the dev server.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* App-wide icon defaults (Phosphor). */}
    <IconContext.Provider value={{ weight: 'regular', mirrored: false }}>
      {isSupabaseConfigured ? (
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <LocationProvider>
                <RouterProvider router={router} />
              </LocationProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      ) : (
        <MissingConfiguration />
      )}
    </IconContext.Provider>
  </StrictMode>,
);
