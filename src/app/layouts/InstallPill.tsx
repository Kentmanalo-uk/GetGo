import { useState } from 'react';
import { useLocation } from 'react-router';
import { X } from '@/components/icons';
import { useInstallApp } from '@/lib/install';

const DISMISS_KEY = 'getgo.installPill.dismissedAt';
const DISMISS_DAYS = 14;
/** The main tabs. Other pages may have their own bar above the bottom nav (e.g. a store's cart bar). */
const TAB_PATHS = ['/', '/explore', '/orders', '/account'];

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** Whether to show the install pill above the mobile bottom nav, and how to close it. */
export function useInstallPill() {
  const app = useInstallApp();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(dismissedRecently);
  const show = !app.installed && !dismissed && (app.canPrompt || app.needsIosHint) && TAB_PATHS.includes(pathname);
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore: hidden for this visit only */
    }
  };
  return { show, dismiss, app };
}

/** "Install GETGO app" pill that sits just above the bottom nav on phones. */
export function InstallPill({ pill }: { pill: ReturnType<typeof useInstallPill> }) {
  const [iosHint, setIosHint] = useState(false);
  if (!pill.show) return null;
  const { app } = pill;
  const install = () => (app.canPrompt ? void app.install() : setIosHint((v) => !v));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center px-4 pb-3">
      <div role="region" aria-label="Install the app" className="install-pill pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full bg-surface py-1.5 pr-1.5 pl-1.5 shadow-card ring-1 ring-line">
        <img src="/pwa-192.png" alt="" className="size-9 shrink-0 rounded-full" />
        <p className="min-w-0 flex-1 text-small leading-tight">
          {iosHint ? (
            <span className="text-ink-2">Tap Share in Safari, then “Add to Home Screen”</span>
          ) : (
            <>
              <span className="block font-semibold">Install GETGO app</span>
              <span className="block truncate text-micro text-ink-3">Free, works like an app</span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={iosHint ? pill.dismiss : install}
          className="h-9 shrink-0 rounded-full bg-accent-fill px-4 text-small font-semibold text-white transition-colors hover:bg-accent-fill-hover"
        >
          {iosHint ? 'Got it' : 'Install'}
        </button>
        <button
          type="button"
          onClick={pill.dismiss}
          aria-label="Close"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-canvas hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
