import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchRoute, type LatLng } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

/**
 * The road route between two pins, for the map and the delivery fee. When a
 * route is found, its distance is saved so the server can price the trip by
 * real road distance (it keeps the value between the straight line and twice
 * it), and open quotes are refreshed.
 */
export function useRoute(from: LatLng | null, to: LatLng | null) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['route', from?.lat, from?.lng, to?.lat, to?.lng],
    enabled: Boolean(from && to),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const route = await fetchRoute(from!, to!, signal);
      if (route && userId) {
        const { error } = await supabase.rpc('save_route_km', {
          p_from_lat: from!.lat,
          p_from_lng: from!.lng,
          p_to_lat: to!.lat,
          p_to_lng: to!.lng,
          p_road_km: Math.round(route.km * 100) / 100,
        });
        if (!error) {
          qc.invalidateQueries({ queryKey: ['quote'] });
          qc.invalidateQueries({ queryKey: ['service-quote'] });
        }
      }
      return route;
    },
  });
}
