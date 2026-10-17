/**
 * Links that hand off to other apps on the phone: the messaging app and GCash.
 */

/** Opens the default messaging (SMS) app to this number, with a starter message. */
export function smsLink(phone: string, body?: string): string {
  const number = phone.replace(/[^\d+]/g, '');
  // "?&body=" works on both Android and iOS.
  return body ? `sms:${number}?&body=${encodeURIComponent(body)}` : `sms:${number}`;
}

const GCASH_ANDROID_PACKAGE = 'com.globe.gcash.android';
const GCASH_SITE = 'https://www.gcash.com/';

export type Platform = 'android' | 'ios' | 'other';

export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

/**
 * Opens the GCash app. Android launches it directly (or its Play Store page if
 * it isn't installed); iOS uses the GCash app link and falls back to gcash.com
 * when nothing opens.
 */
export function openGcash() {
  const p = platform();
  if (p === 'android') {
    const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${GCASH_ANDROID_PACKAGE}`);
    window.location.href = `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${GCASH_ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
    return;
  }
  if (p === 'ios') {
    window.location.href = 'gcash://';
    // If the app opened, this page is now in the background; otherwise send them to GCash's site.
    setTimeout(() => {
      if (!document.hidden) window.location.href = GCASH_SITE;
    }, 1500);
    return;
  }
  window.open(GCASH_SITE, '_blank', 'noopener');
}
