import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Notification } from '@/types/models';

// Live updates for ['notifications', userId] are subscribed once in AuthProvider.
export function useNotifications() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) as Notification[],
  });
}

export function useUnreadCount() {
  const { data } = useNotifications();
  return data?.filter((n) => !n.read_at).length ?? 0;
}

export function useMarkNotificationsRead() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', userId] }),
  });
}
