import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

/**
 * How many riders are online in a service area. Customers can order only
 * while at least one is (the database enforces it too).
 */
export function useOnlineRiders(areaId: string | null | undefined) {
  return useQuery({
    queryKey: ['riders-online', areaId],
    enabled: Boolean(areaId),
    queryFn: async () => unwrap(await supabase.rpc('online_rider_count', { p_service_area_id: areaId })) as number,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** What anyone signed in can see about a rider (see rider_public_profile). */
export interface RiderPublicProfile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  vehicle_type: 'motorcycle' | 'bicycle' | 'car';
  verified: boolean;
  member_since: string;
  completed_count: number;
  rating_avg: number | null;
  rating_count: number;
  reviews: Array<{ rating: number; comment: string; created_at: string }>;
}

export function useRiderPublicProfile(riderId: string | null | undefined) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['rider-public', riderId],
    enabled: Boolean(riderId) && status === 'signed_in',
    queryFn: async () => unwrap(await supabase.rpc('rider_public_profile', { p_rider_id: riderId })) as RiderPublicProfile | null,
    staleTime: 60_000,
  });
}

/** The signed-in customer's rating of the rider on one order, if any. */
export function useMyRiderReview(orderId: string | undefined) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['rider-review', orderId, userId],
    enabled: Boolean(orderId && userId),
    queryFn: async () =>
      unwrap(await supabase.from('rider_reviews').select('rating, comment').eq('order_id', orderId!).eq('customer_id', userId!).maybeSingle()) as {
        rating: number;
        comment: string | null;
      } | null,
  });
}

export function useRateRider(orderId: string, riderId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rating: number; comment: string }) =>
      unwrap(await supabase.rpc('rate_rider', { p_order_id: orderId, p_rating: input.rating, p_comment: input.comment.trim() || null })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-review', orderId] });
      qc.invalidateQueries({ queryKey: ['rider-public', riderId] });
    },
  });
}
