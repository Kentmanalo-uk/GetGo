import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import type { ErrandTask, PadalaTask } from '@/types/models';

/** One stop of a padala or errand: who, how to reach them, and where. */
export interface ServicePlace {
  name: string;
  phone: string;
  line1: string;
  barangay: string;
  barangay_code: string | null;
  landmark: string;
  /** Map pin, optional. With both stops pinned, km-priced areas charge by distance. */
  lat?: number | null;
  lng?: number | null;
}

export type ServiceKind = 'padala' | 'errand';

export interface ServiceRequest {
  service: ServiceKind;
  areaId: string;
  pickup: ServicePlace;
  dropoff: ServicePlace;
  task: PadalaTask | ErrandTask;
}

export interface ServiceQuote {
  subtotal_minor: number;
  delivery_fee_minor: number;
  service_fee_minor: number;
  total_minor: number;
  distance_km: number | null;
  delivery_basis: 'distance' | 'barangay';
}

function args(req: ServiceRequest) {
  return {
    p_service: req.service,
    p_service_area_id: req.areaId,
    p_pickup: req.pickup,
    p_dropoff: req.dropoff,
    p_task: req.task,
  };
}

/** Server price for a complete request (null while the form is incomplete). */
export function useServiceQuote(req: ServiceRequest | null) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['service-quote', userId, req],
    enabled: Boolean(userId && req),
    queryFn: async () => unwrap(await supabase.rpc('quote_service_request', args(req!))) as ServiceQuote,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
}

export function usePlaceServiceRequest() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async (input: { req: ServiceRequest; notes: string; expectedTotalMinor: number; idempotencyKey: string }) =>
      unwrap(
        await supabase.rpc('place_service_request', {
          ...args(input.req),
          p_notes: input.notes.trim() || null,
          p_expected_total_minor: input.expectedTotalMinor,
          p_idempotency_key: input.idempotencyKey,
        }),
      ) as string,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['service-quote'] });
      qc.invalidateQueries({ queryKey: ['orders', userId] });
    },
  });
}

/** Errands: the rider records what they spent out of the budget. */
export function useRecordSpent(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (spentMinor: number) => unwrap(await supabase.rpc('rider_record_spent', { p_order_id: orderId, p_spent_minor: spentMinor })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rider'] }),
  });
}
