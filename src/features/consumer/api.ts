import { useEffect } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { realtimeChannel } from '@/lib/realtime';
import { unwrap } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';
import type { ConfigurableProduct } from '@/domain/customization';
import type {
  Address,
  Category,
  OrderWithItems,
  ProductRow,
  Promotion,
  Quote,
  ServiceArea,
  StatusHistoryEntry,
  Storefront,
} from '@/types/models';

export const PRODUCT_SELECT =
  'id, merchant_id, category_id, name, description, image_path, base_price_minor, status, is_available, max_per_order, sort_order, updated_at, ' +
  'product_variants(id, product_id, name, price_minor, is_available, sort_order), ' +
  'product_option_groups(sort_order, group_id, option_groups(id, merchant_id, name, min_select, max_select, ' +
  'option_values(id, group_id, name, price_delta_minor, is_available, max_quantity, sort_order)))';

/** Shapes a product row (with nested configuration) for the customizer. */
export function toConfigurable(p: ProductRow): ConfigurableProduct {
  return {
    id: p.id,
    name: p.name,
    base_price_minor: p.base_price_minor,
    is_available: p.is_available,
    max_per_order: p.max_per_order,
    variants: [...p.product_variants].sort((a, b) => a.sort_order - b.sort_order),
    groups: [...p.product_option_groups]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((l) => l.option_groups)
      .map((l) => ({
        id: l.option_groups!.id,
        name: l.option_groups!.name,
        min_select: l.option_groups!.min_select,
        max_select: l.option_groups!.max_select,
        values: [...l.option_groups!.option_values].sort((a, b) => a.sort_order - b.sort_order),
      })),
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
export function useServiceAreas() {
  return useQuery({
    queryKey: ['service-areas', 'active'],
    queryFn: async () =>
      unwrap(await supabase.from('service_areas').select('*').eq('is_active', true).order('name')) as ServiceArea[],
    staleTime: 10 * 60_000,
  });
}

export function useStorefronts(areaId: string | null) {
  return useQuery({
    queryKey: ['storefronts', areaId],
    enabled: Boolean(areaId),
    queryFn: async () =>
      unwrap(await supabase.from('storefronts').select('*').eq('service_area_id', areaId!).order('name')) as Storefront[],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // open/closed state is time-dependent
  });
}

export function useStorefront(slug: string | undefined) {
  return useQuery({
    queryKey: ['storefront', slug],
    enabled: Boolean(slug),
    queryFn: async () => unwrap(await supabase.from('storefronts').select('*').eq('slug', slug!).maybeSingle()) as Storefront | null,
    refetchInterval: 2 * 60_000,
  });
}

export function useStoreMenu(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['menu', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => {
      const [categories, products] = await Promise.all([
        supabase.from('categories').select('id, merchant_id, name, sort_order').eq('merchant_id', merchantId!).order('sort_order').order('name').then(unwrap),
        supabase
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('merchant_id', merchantId!)
          .eq('status', 'published')
          .order('sort_order')
          .order('name')
          .then(unwrap),
      ]);
      return { categories: categories as Category[], products: products as unknown as ProductRow[] };
    },
    staleTime: 60_000,
  });
}

/** One published item with its sizes and choices (public data). */
export function useProduct(productId: string | null | undefined) {
  return useQuery({
    queryKey: ['product', productId],
    enabled: Boolean(productId),
    queryFn: async () => unwrap(await supabase.from('products').select(PRODUCT_SELECT).eq('id', productId!).maybeSingle()) as unknown as ProductRow | null,
  });
}

export function useStoreHours(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['store-hours', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () =>
      unwrap(await supabase.from('store_hours').select('weekday, opens_at, closes_at').eq('merchant_id', merchantId!)) as Array<{
        weekday: number;
        opens_at: string;
        closes_at: string;
      }>,
    staleTime: 10 * 60_000,
  });
}

export function useStoreReviews(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['store-reviews', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () =>
      unwrap(
        await supabase.from('store_reviews').select('*').eq('merchant_id', merchantId!).order('created_at', { ascending: false }).limit(20),
      ) as Array<{ id: string; rating: number; comment: string | null; created_at: string; reviewer_first_name: string }>,
  });
}

export interface FeedItem {
  id: string;
  name: string;
  image_path: string | null;
  is_available: boolean;
  price_minor: number;
  has_sizes: boolean;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  merchant_state: Storefront['state'];
  merchant_category: Storefront['category'];
  merchant_logo_path: string | null;
  orders: number;
}

export interface HomeFeed {
  popular: FeedItem[];
  meals: FeedItem[];
  essentials: FeedItem[];
  new_stores: Storefront[];
}

/** Home page item and store sections for an area (public data only). */
export function useHomeFeed(areaId: string | null) {
  return useQuery({
    queryKey: ['home-feed', areaId],
    enabled: Boolean(areaId),
    queryFn: async () => unwrap(await supabase.rpc('home_feed', { p_service_area_id: areaId })) as HomeFeed,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export type ExploreSection = 'all' | 'popular' | 'meals' | 'essentials';
const EXPLORE_PAGE = 24;

/** Paged items for the Explore page ("Load more" fetches the next page). */
export function useExploreItems(areaId: string | null, section: ExploreSection) {
  return useInfiniteQuery({
    queryKey: ['explore', areaId, section],
    enabled: Boolean(areaId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await supabase.rpc('explore_items', { p_service_area_id: areaId, p_section: section, p_offset: pageParam, p_limit: EXPLORE_PAGE }),
      ) as FeedItem[],
    getNextPageParam: (last, pages) => (last.length === EXPLORE_PAGE ? pages.length * EXPLORE_PAGE : undefined),
    staleTime: 60_000,
  });
}

export function usePublicPromotions() {
  return useQuery({
    queryKey: ['promotions', 'public'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('promotions')
          .select('*')
          .eq('is_active', true)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(6),
      ) as Promotion[],
    staleTime: 5 * 60_000,
  });
}

export interface SearchResult {
  stores: Storefront[];
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    image_path: string | null;
    base_price_minor: number;
    is_available: boolean;
    merchant_id: string;
    merchant_name: string;
    merchant_slug: string;
    merchant_state: Storefront['state'];
  }>;
}

export function useCatalogSearch(query: string, areaId: string | null) {
  return useQuery({
    queryKey: ['search', areaId, query],
    enabled: query.trim().length >= 2,
    queryFn: async () => unwrap(await supabase.rpc('search_catalog', { p_query: query, p_service_area_id: areaId })) as SearchResult,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------
export function useAddresses() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['addresses', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(await supabase.from('addresses').select('*').order('is_default', { ascending: false }).order('created_at')) as Address[],
  });
}

export type AddressInput = Omit<Address, 'id' | 'is_default'> & { is_default?: boolean };

export function useSaveAddress() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...input }: AddressInput & { id?: string }) => {
      if (input.is_default) {
        await supabase.from('addresses').update({ is_default: false }).eq('is_default', true).then(unwrap);
      }
      const query = id
        ? supabase.from('addresses').update(input).eq('id', id).select().single()
        : supabase.from('addresses').insert(input).select().single();
      return unwrap(await query) as Address;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses', userId] }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('addresses').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses', userId] }),
  });
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
export interface CartSummary {
  id: string;
  merchant_id: string;
  updated_at: string;
  item_count: number;
  store: Pick<Storefront, 'id' | 'name' | 'slug' | 'logo_path' | 'state'> | null;
}

export function useCarts() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['carts', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<CartSummary[]> => {
      const carts = unwrap(
        await supabase.from('carts').select('id, merchant_id, updated_at, cart_items(quantity)').order('updated_at', { ascending: false }),
      ) as Array<{ id: string; merchant_id: string; updated_at: string; cart_items: Array<{ quantity: number }> }>;
      const ids = carts.map((c) => c.merchant_id);
      const stores = ids.length
        ? (unwrap(await supabase.from('storefronts').select('id, name, slug, logo_path, state').in('id', ids)) as CartSummary['store'][])
        : [];
      return carts
        .map((c) => ({
          id: c.id,
          merchant_id: c.merchant_id,
          updated_at: c.updated_at,
          item_count: c.cart_items.reduce((sum, i) => sum + i.quantity, 0),
          store: stores.find((s) => s!.id === c.merchant_id) ?? null,
        }))
        .filter((c) => c.item_count > 0);
    },
  });
}

function useInvalidateCart() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return () => {
    qc.invalidateQueries({ queryKey: ['carts', userId] });
    qc.invalidateQueries({ queryKey: ['quote'] });
  };
}

export interface CartLineInput {
  productId: string;
  variantId: string | null;
  options: Array<{ option_value_id: string; quantity: number }>;
  quantity: number;
  instructions: string;
}

export function useAddToCart() {
  const invalidate = useInvalidateCart();
  return useMutation({
    mutationFn: async (input: CartLineInput) =>
      unwrap(
        await supabase.rpc('cart_add_item', {
          p_product_id: input.productId,
          p_variant_id: input.variantId,
          p_options: input.options,
          p_quantity: input.quantity,
          p_instructions: input.instructions || null,
        }),
      ) as string,
    onSuccess: invalidate,
  });
}

export function useUpdateCartItem() {
  const invalidate = useInvalidateCart();
  return useMutation({
    mutationFn: async (input: CartLineInput & { cartItemId: string }) =>
      unwrap(
        await supabase.rpc('cart_update_item', {
          p_cart_item_id: input.cartItemId,
          p_variant_id: input.variantId,
          p_options: input.options,
          p_quantity: input.quantity,
          p_instructions: input.instructions || null,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSetCartQuantity() {
  const invalidate = useInvalidateCart();
  return useMutation({
    mutationFn: async ({ cartItemId, quantity }: { cartItemId: string; quantity: number }) =>
      unwrap(await supabase.rpc('cart_set_quantity', { p_cart_item_id: cartItemId, p_quantity: quantity })),
    onSuccess: invalidate,
  });
}

export function useClearCart() {
  const invalidate = useInvalidateCart();
  return useMutation({
    mutationFn: async (merchantId: string) => unwrap(await supabase.rpc('cart_clear', { p_merchant_id: merchantId })),
    onSuccess: invalidate,
  });
}

/** Server-computed cart and checkout breakdown — the only prices we display at checkout. */
export function useQuote(params: { merchantId: string | undefined; addressId: string | null; promo: string | null }) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['quote', userId, params.merchantId, params.addressId, params.promo],
    enabled: Boolean(userId && params.merchantId),
    queryFn: async () =>
      unwrap(
        await supabase.rpc('quote_checkout', {
          p_merchant_id: params.merchantId,
          p_address_id: params.addressId,
          p_promo_code: params.promo,
        }),
      ) as Quote,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

export interface PlaceOrderInput {
  merchantId: string;
  addressId: string;
  notes: string;
  promo: string | null;
  expectedTotalMinor: number;
  idempotencyKey: string;
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async (input: PlaceOrderInput) =>
      unwrap(
        await supabase.rpc('place_order', {
          p_merchant_id: input.merchantId,
          p_address_id: input.addressId,
          p_notes: input.notes || null,
          p_promo_code: input.promo,
          p_expected_total_minor: input.expectedTotalMinor,
          p_idempotency_key: input.idempotencyKey,
        }),
      ) as string,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['carts', userId] });
      qc.invalidateQueries({ queryKey: ['quote'] });
      qc.invalidateQueries({ queryKey: ['orders', userId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const ORDER_SELECT =
  '*, order_items(id, product_id, product_name, variant_name, unit_price_minor, quantity, line_total_minor, instructions, product:products(image_path), ' +
  'order_item_options(id, group_name, option_name, price_delta_minor, quantity)), ' +
  'payments(id, method, status, amount_minor, refunded_minor, payee_name, payee_number, gcash_reference, sender_name, submitted_at, confirmed_at, rejection_note), ' +
  'assignments(status, rider_id, rider:rider_profiles(full_name, phone, vehicle_type, plate_number))';

export function useMyOrders(scope: 'active' | 'all' = 'all') {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['orders', userId, scope],
    enabled: Boolean(userId),
    queryFn: async () => {
      let q = supabase.from('orders').select(ORDER_SELECT).eq('customer_id', userId!).order('created_at', { ascending: false });
      q = scope === 'active'
        ? q.in('status', ['pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery']).limit(5)
        : q.limit(50);
      return unwrap(await q) as unknown as OrderWithItems[];
    },
  });
}

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ['order', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const [order, history] = await Promise.all([
        supabase.from('orders').select(ORDER_SELECT).eq('id', orderId!).maybeSingle().then(unwrap),
        supabase.from('order_status_history').select('*').eq('order_id', orderId!).order('created_at').then(unwrap),
      ]);
      return { order: order as unknown as OrderWithItems | null, history: history as StatusHistoryEntry[] };
    },
  });
}

/**
 * Live updates for orders visible to the current user. Realtime respects RLS;
 * on any change we refetch through the normal query path. The channel is torn
 * down on unmount, and queries refetch on reconnect/focus to recover from
 * missed events.
 */
export function useOrderRealtime(filter: { column: 'id' | 'merchant_id' | 'customer_id'; value: string | null | undefined }, keys: unknown[][]) {
  const qc = useQueryClient();
  const keyString = JSON.stringify(keys);
  useEffect(() => {
    if (!filter.value) return;
    const channel = realtimeChannel(`orders:${filter.column}:${filter.value}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `${filter.column}=eq.${filter.value}` }, () => {
        for (const key of JSON.parse(keyString) as unknown[][]) qc.invalidateQueries({ queryKey: key });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter.column, filter.value, keyString, qc]);
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; status: string; note?: string }) =>
      unwrap(await supabase.rpc('update_order_status', { p_order_id: input.orderId, p_status: input.status, p_note: input.note ?? null })),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ['order', input.orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['rider'] });
    },
  });
}

/** Customer chooses to pay in cash on delivery (when the rider offered it). */
export function useChooseCod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => unwrap(await supabase.rpc('choose_cash_on_delivery', { p_order_id: orderId })),
    onSuccess: (_d, orderId) => {
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** Customer reports the GCash transfer they sent to their rider. */
export function useSubmitGcashPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; reference: string; senderName: string }) =>
      unwrap(
        await supabase.rpc('submit_gcash_payment', {
          p_order_id: input.orderId,
          p_reference: input.reference,
          p_sender_name: input.senderName || null,
        }),
      ),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ['order', input.orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; merchantId: string; rating: number; comment: string }) =>
      unwrap(
        await supabase.from('reviews').insert({
          order_id: input.orderId,
          merchant_id: input.merchantId,
          rating: input.rating,
          comment: input.comment.trim() || null,
        }),
      ),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ['review', input.orderId] });
      qc.invalidateQueries({ queryKey: ['store-reviews', input.merchantId] });
    },
  });
}

export function useOrderReview(orderId: string | undefined) {
  return useQuery({
    queryKey: ['review', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => unwrap(await supabase.from('reviews').select('id, rating, comment').eq('order_id', orderId!).maybeSingle()) as {
      id: string;
      rating: number;
      comment: string | null;
    } | null,
  });
}
