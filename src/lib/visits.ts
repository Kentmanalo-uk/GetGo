import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { supabase } from '@/lib/supabase';

/**
 * Lets staff see who's using GETGO right now (Admin → Visitors). While the app
 * is open and visible, it checks in once a minute and on every page change
 * with: a random ID for this device, the page, the kind of device and browser,
 * and whether it runs in a browser, as an installed app or in the Android app.
 * No IP address or location is sent. Described in the Privacy Policy.
 */

const VISITOR_KEY = 'getgo.visitor';
const ANDROID_KEY = 'getgo.androidApp';
const EVERY_MS = 60_000;

function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode): one ID per page load.
    return (window as Window & { __getgoVisitor?: string }).__getgoVisitor ??= crypto.randomUUID();
  }
}

/** "Android phone", "iPhone", "Windows computer", … */
export function describeDevice(ua = navigator.userAgent): string {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/i.test(ua)) return 'Windows computer';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux computer';
  return 'Other device';
}

/** "Chrome", "Facebook app", "Safari", … */
export function describeBrowser(ua = navigator.userAgent): string {
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook app';
  if (/Messenger/i.test(ua)) return 'Messenger';
  if (/Instagram/i.test(ua)) return 'Instagram app';
  if (/TikTok|musical_ly/i.test(ua)) return 'TikTok app';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Other browser';
}

/** Browser tab, installed web app, or the GETGO Android app (a Trusted Web Activity). */
function appKind(): 'browser' | 'installed' | 'android_app' {
  try {
    // The Android app opens the site with this referrer on the first page only.
    if (document.referrer.startsWith('android-app://site.getandgo.app')) sessionStorage.setItem(ANDROID_KEY, '1');
    if (sessionStorage.getItem(ANDROID_KEY) === '1') return 'android_app';
  } catch {
    /* ignore */
  }
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? 'installed' : 'browser';
}

function checkIn(path: string) {
  void supabase.rpc('track_visit', {
    p_visitor_id: visitorId(),
    p_path: path,
    p_device: describeDevice(),
    p_browser: describeBrowser(),
    p_app: appKind(),
  });
}

/** Check in on every page change, on sign-in/out, and once a minute while the app is visible. */
export function useVisitTracking(userId: string | null) {
  const { pathname } = useLocation();

  useEffect(() => {
    if (document.visibilityState === 'visible') checkIn(pathname);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') checkIn(pathname);
    }, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkIn(pathname);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname, userId]);
}
