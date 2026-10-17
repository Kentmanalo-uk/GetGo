import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import type { FeedItem } from './api';

/**
 * Items the customer opened recently, kept on this device only (per account,
 * or "guest" when signed out) — nothing is sent to GETGO. Names, prices,
 * photos and availability are refreshed from the live catalog when shown.
 */
type Viewed = Pick<FeedItem, 'id' | 'name' | 'image_path' | 'price_minor' | 'has_sizes' | 'is_available' | 'merchant_id' | 'merchant_name' | 'merchant_slug'> & {
  viewed_at: number;
};

const MAX = 12;
const keyFor = (userId: string | null) => `getgo.recent.${userId ?? 'guest'}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Viewed[]>();

function read(key: string): Viewed[] {
  if (!cache.has(key)) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
      cache.set(key, Array.isArray(parsed) ? parsed : []);
    } catch {
      cache.set(key, []);
    }
  }
  return cache.get(key)!;
}

function write(key: string, items: Viewed[]) {
  cache.set(key, items);
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage full or blocked: keep it for this session only */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  // Keep other tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith('getgo.recent.')) {
      cache.delete(e.key);
      listeners.forEach((l) => l());
    }
  });
}

/** Records a view (most recent first, no duplicates). */
export function recordView(userId: string | null, item: Omit<Viewed, 'viewed_at'>) {
  const key = keyFor(userId);
  write(key, [{ ...item, viewed_at: Date.now() }, ...read(key).filter((i) => i.id !== item.id)].slice(0, MAX));
}

export function clearRecentlyViewed(userId: string | null) {
  write(keyFor(userId), []);
}

/** Recently viewed items, refreshed from the catalog; unpublished items drop out. */
export function useRecentlyViewed() {
  const { userId } = useAuth();
  const key = keyFor(userId);
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(key),
    () => [] as Viewed[],
  );
  const ids = items.map((i) => i.id);

  const live = useQuery({
    queryKey: ['recently-viewed', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('products')
          .select('id, name, image_path, base_price_minor, is_available, status, product_variants(price_minor, is_available)')
          .in('id', ids)
          .eq('status', 'published'),
      ) as Array<{
        id: string;
        name: string;
        image_path: string | null;
        base_price_minor: number;
        is_available: boolean;
        product_variants: Array<{ price_minor: number; is_available: boolean }>;
      }>,
  });

  const fresh = new Map(live.data?.map((p) => [p.id, p]));
  const list: FeedItem[] = items
    .filter((i) => !live.data || fresh.has(i.id))
    .map((i) => {
      const p = fresh.get(i.id);
      const prices = p?.product_variants.map((v) => v.price_minor) ?? [];
      return {
        id: i.id,
        name: p?.name ?? i.name,
        image_path: p ? p.image_path : i.image_path,
        is_available: p ? p.is_available : i.is_available,
        price_minor: p ? (prices.length ? Math.min(...prices) : p.base_price_minor) : i.price_minor,
        has_sizes: p ? p.product_variants.length > 1 : i.has_sizes,
        merchant_id: i.merchant_id,
        merchant_name: i.merchant_name,
        merchant_slug: i.merchant_slug,
        merchant_state: 'open',
        merchant_category: 'restaurant',
        merchant_logo_path: null,
        orders: 0,
      };
    });

  return { items: list, clear: () => clearRecentlyViewed(userId) };
}
