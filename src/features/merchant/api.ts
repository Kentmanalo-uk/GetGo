import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import { PRODUCT_SELECT } from '@/features/consumer/api';
import type { HoursEntry } from '@/domain/hours';
import type { Category, Merchant, OptionGroupRow, ProductRow, ProductStatus } from '@/types/models';

export function useMerchant(merchantId: string | null) {
  return useQuery({
    queryKey: ['merchant', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => unwrap(await supabase.from('merchants').select('*').eq('id', merchantId!).single()) as Merchant,
  });
}

export function useStoreState(merchantId: string | null) {
  return useQuery({
    queryKey: ['merchant-state', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => unwrap(await supabase.rpc('store_state', { p_merchant_id: merchantId })) as 'open' | 'paused' | 'closed',
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export function useMerchantCatalog(merchantId: string | null) {
  return useQuery({
    queryKey: ['merchant-catalog', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => {
      const [categories, products, groups] = await Promise.all([
        supabase.from('categories').select('*').eq('merchant_id', merchantId!).order('sort_order').order('name').then(unwrap),
        supabase.from('products').select(PRODUCT_SELECT).eq('merchant_id', merchantId!).order('sort_order').order('name').then(unwrap),
        supabase
          .from('option_groups')
          .select('id, merchant_id, name, min_select, max_select, option_values(id, group_id, name, price_delta_minor, is_available, max_quantity, sort_order)')
          .eq('merchant_id', merchantId!)
          .order('name')
          .then(unwrap),
      ]);
      return {
        categories: categories as Category[],
        products: products as unknown as ProductRow[],
        groups: (groups as OptionGroupRow[]).map((g) => ({ ...g, option_values: [...g.option_values].sort((a, b) => a.sort_order - b.sort_order) })),
      };
    },
  });
}

function useInvalidateCatalog(merchantId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['merchant-catalog', merchantId] });
    qc.invalidateQueries({ queryKey: ['menu', merchantId] });
  };
}

export interface ProductInput {
  id?: string;
  category_id: string | null;
  name: string;
  description: string;
  image_path: string | null;
  base_price_minor: number;
  status: ProductStatus;
  is_available: boolean;
  max_per_order: number;
  variants: Array<{ id?: string; name: string; price_minor: number; is_available: boolean }>;
  option_group_ids: string[];
}

export function useSaveProduct(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async (input: ProductInput) => unwrap(await supabase.rpc('save_product', { p_merchant_id: merchantId, p_product: input })) as string,
    onSuccess: invalidate,
  });
}

export function useSetProductStatus(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async ({ productId, status }: { productId: string; status: ProductStatus }) =>
      unwrap(await supabase.rpc('set_product_status', { p_product_id: productId, p_status: status })),
    onSuccess: invalidate,
  });
}

export function useSetProductAvailability(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async ({ productId, available }: { productId: string; available: boolean }) =>
      unwrap(await supabase.rpc('set_product_availability', { p_product_id: productId, p_available: available })),
    onSuccess: invalidate,
  });
}

export interface OptionGroupInput {
  id?: string;
  name: string;
  min_select: number;
  max_select: number;
  values: Array<{ id?: string; name: string; price_delta_minor: number; is_available: boolean; max_quantity: number }>;
}

export function useSaveOptionGroup(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async (input: OptionGroupInput) => unwrap(await supabase.rpc('save_option_group', { p_merchant_id: merchantId, p_group: input })) as string,
    onSuccess: invalidate,
  });
}

export function useDeleteOptionGroup(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async (groupId: string) => unwrap(await supabase.rpc('delete_option_group', { p_group_id: groupId })),
    onSuccess: invalidate,
  });
}

export function useSetOptionAvailability(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return useMutation({
    mutationFn: async ({ valueId, available }: { valueId: string; available: boolean }) =>
      unwrap(await supabase.rpc('set_option_availability', { p_option_value_id: valueId, p_available: available })),
    onSuccess: invalidate,
  });
}

export function useCategoryMutations(merchantId: string | null) {
  const invalidate = useInvalidateCatalog(merchantId);
  return {
    create: useMutation({
      mutationFn: async (name: string) =>
        unwrap(await supabase.from('categories').insert({ merchant_id: merchantId, name: name.trim() }).select().single()) as Category,
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) => unwrap(await supabase.from('categories').update({ name: name.trim() }).eq('id', id)),
      onSuccess: invalidate,
    }),
    reorder: useMutation({
      mutationFn: async (ids: string[]) => {
        for (const [i, id] of ids.entries()) unwrap(await supabase.from('categories').update({ sort_order: i }).eq('id', id));
      },
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from('categories').delete().eq('id', id)),
      onSuccess: invalidate,
    }),
  };
}

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------
export type MerchantProfilePatch = Partial<
  Pick<Merchant, 'name' | 'description' | 'phone' | 'logo_path' | 'cover_path' | 'min_order_minor'>
>;

function useInvalidateMerchant(merchantId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['merchant', merchantId] });
    qc.invalidateQueries({ queryKey: ['merchant-state', merchantId] });
    qc.invalidateQueries({ queryKey: ['identity'] });
    qc.invalidateQueries({ queryKey: ['storefronts'] });
  };
}

export function useUpdateMerchant(merchantId: string | null) {
  const invalidate = useInvalidateMerchant(merchantId);
  return useMutation({
    mutationFn: async (patch: MerchantProfilePatch) => unwrap(await supabase.from('merchants').update(patch).eq('id', merchantId!)),
    onSuccess: invalidate,
  });
}

export function useSetPublished(merchantId: string | null) {
  const invalidate = useInvalidateMerchant(merchantId);
  return useMutation({
    mutationFn: async (published: boolean) => unwrap(await supabase.rpc('set_store_published', { p_merchant_id: merchantId, p_published: published })),
    onSuccess: invalidate,
  });
}

export function useSetPaused(merchantId: string | null) {
  const invalidate = useInvalidateMerchant(merchantId);
  return useMutation({
    mutationFn: async ({ paused, until }: { paused: boolean; until: string | null }) =>
      unwrap(await supabase.rpc('set_store_paused', { p_merchant_id: merchantId, p_paused: paused, p_until: until })),
    onSuccess: invalidate,
  });
}

export function useStoreHoursAdmin(merchantId: string | null) {
  return useQuery({
    queryKey: ['merchant-hours', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => {
      const [hours, exceptions] = await Promise.all([
        supabase.from('store_hours').select('weekday, opens_at, closes_at').eq('merchant_id', merchantId!).then(unwrap),
        supabase.from('store_hour_exceptions').select('*').eq('merchant_id', merchantId!).order('date').then(unwrap),
      ]);
      return {
        hours: (hours as Array<{ weekday: number; opens_at: string; closes_at: string }>).map((h) => ({
          weekday: h.weekday,
          opens: h.opens_at.slice(0, 5),
          closes: h.closes_at.slice(0, 5),
        })) as HoursEntry[],
        exceptions: exceptions as Array<{ id: string; date: string; is_closed: boolean; opens_at: string | null; closes_at: string | null; note: string | null }>,
      };
    },
  });
}

export function useReplaceHours(merchantId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hours: HoursEntry[]) => unwrap(await supabase.rpc('replace_store_hours', { p_merchant_id: merchantId, p_hours: hours })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-hours', merchantId] });
      qc.invalidateQueries({ queryKey: ['merchant-state', merchantId] });
    },
  });
}

export function useHourExceptions(merchantId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['merchant-hours', merchantId] });
    qc.invalidateQueries({ queryKey: ['merchant-state', merchantId] });
  };
  return {
    add: useMutation({
      mutationFn: async (input: { date: string; is_closed: boolean; opens_at: string | null; closes_at: string | null; note: string | null }) =>
        unwrap(await supabase.from('store_hour_exceptions').upsert({ merchant_id: merchantId, ...input }, { onConflict: 'merchant_id,date' })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from('store_hour_exceptions').delete().eq('id', id)),
      onSuccess: invalidate,
    }),
  };
}

