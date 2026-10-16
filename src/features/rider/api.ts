import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_SELECT } from '@/features/consumer/api';
import { supabase } from '@/lib/supabase';
import { realtimeChannel } from '@/lib/realtime';
import { unwrap } from '@/lib/errors';
import type { OrderWithItems } from '@/types/models';

export interface RiderProfile {
  user_id: string;
  full_name: string;
  phone: string;
  vehicle_type: 'motorcycle' | 'bicycle' | 'car';
  plate_number: string | null;
  service_area_id: string;
  gcash_name: string;
  gcash_number: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
}

export interface Assignment {
  id: string;
  status: 'active' | 'completed' | 'released';
  created_at: string;
  completed_at: string | null;
  order: OrderWithItems | null;
}

/** An assignment whose order the rider can see. */
export type Job = Assignment & { order: OrderWithItems };

export const VEHICLE_LABELS: Record<RiderProfile['vehicle_type'], string> = {
  motorcycle: 'Motorcycle',
  bicycle: 'Bicycle',
  car: 'Car',
};

/**
 * What the rider keeps from an order: the customer sends the order total by
 * GCash, and the rider pays the store the item subtotal.
 */
export function riderEarning(order: Pick<OrderWithItems, 'total_minor' | 'subtotal_minor'>): number {
  return order.total_minor - order.subtotal_minor;
}

export function itemCount(order: OrderWithItems): number {
  return order.order_items.reduce((sum, i) => sum + i.quantity, 0);
}

export function useRiderProfile(userId: string | null) {
  return useQuery({
    queryKey: ['rider', 'profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => unwrap(await supabase.from('rider_profiles').select('*').eq('user_id', userId!).maybeSingle()) as RiderProfile | null,
  });
}

/** Orders in the rider's area waiting for someone to accept them. */
export function useAvailableOrders(areaId: string | null) {
  return useQuery({
    queryKey: ['rider', 'available', areaId],
    enabled: Boolean(areaId),
    queryFn: async () =>
      unwrap(
        await supabase.from('orders').select(ORDER_SELECT).eq('status', 'pending').eq('service_area_id', areaId!).order('created_at').limit(50),
      ) as unknown as OrderWithItems[],
    refetchInterval: 30_000,
  });
}

/** The rider's current and past deliveries, newest first. */
export function useJobs(userId: string | null) {
  return useQuery({
    queryKey: ['rider', 'jobs', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('assignments')
          .select(`id, status, created_at, completed_at, order:orders(${ORDER_SELECT})`)
          .eq('rider_id', userId!)
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(300),
      ) as unknown as Assignment[];
      const jobs = rows.filter((a): a is Job => Boolean(a.order));
      return {
        active: jobs.filter((j) => j.status === 'active'),
        // Completed assignments include orders that ended cancelled after pickup.
        done: jobs.filter((j) => j.status === 'completed'),
      };
    },
    refetchInterval: 30_000,
  });
}

/** One order the rider can see: waiting in their area, or assigned to them. */
export function useRiderOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ['rider', 'order', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => unwrap(await supabase.from('orders').select(ORDER_SELECT).eq('id', orderId!).maybeSingle()) as unknown as OrderWithItems | null,
  });
}

function useRiderMutation<TArgs>(fn: (args: TArgs) => PromiseLike<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => fn(args),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rider'] }),
  });
}

export function useAcceptOrder() {
  return useRiderMutation((orderId: string) => supabase.rpc('rider_accept_order', { p_order_id: orderId }).then(unwrap));
}

export function useConfirmPayment(orderId: string) {
  return useRiderMutation((args: { received: boolean; note?: string }) =>
    supabase.rpc('confirm_gcash_payment', { p_order_id: orderId, p_received: args.received, p_note: args.note ?? null }).then(unwrap),
  );
}

export function useReleaseOrder(orderId: string) {
  return useRiderMutation((note: string) => supabase.rpc('rider_release_order', { p_order_id: orderId, p_note: note || null }).then(unwrap));
}

/** Live updates: new orders in the area and changes to this rider's jobs. */
export function useRiderRealtime(userId: string | null, areaId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['rider'] });
    const channel = realtimeChannel(`rider:${userId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'assignments', filter: `rider_id=eq.${userId}` },
      refresh,
    );
    if (areaId) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `service_area_id=eq.${areaId}` }, refresh);
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, areaId, qc]);
}

/** Start of today and of the last 7 days, in the device's time zone. */
export function earningWindows(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return { today: today.getTime(), week: week.getTime(), month: month.getTime() };
}

/** Earnings and delivery counts for completed deliveries since a time. */
export function summarizeJobs(done: Job[], since: number) {
  const delivered = done.filter((j) => j.order.status === 'completed' && j.completed_at && new Date(j.completed_at).getTime() >= since);
  return {
    count: delivered.length,
    earnedMinor: delivered.reduce((sum, j) => sum + riderEarning(j.order), 0),
  };
}
