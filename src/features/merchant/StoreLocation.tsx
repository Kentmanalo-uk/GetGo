import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PinField } from '@/components/map';
import { Notice } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useServiceAreas } from '@/features/consumer/api';
import { unwrap, userMessage } from '@/lib/errors';
import { areaCenter, pinOf, type LatLng } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

function useSaveStorePin(merchantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pin: LatLng | null) =>
      unwrap(await supabase.from('merchants').update({ lat: pin?.lat ?? null, lng: pin?.lng ?? null }).eq('id', merchantId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant', merchantId] });
      qc.invalidateQueries({ queryKey: ['admin', 'merchant', merchantId] });
      qc.invalidateQueries({ queryKey: ['storefronts'] });
      qc.invalidateQueries({ queryKey: ['storefront'] });
    },
  });
}

/**
 * Where the store is on the map. Riders navigate to it, and in areas priced by
 * km the delivery fee is measured from here. Used by store owners and admins.
 */
export function StoreLocation({
  merchant,
  readOnly,
}: {
  merchant: { id: string; service_area_id: string; lat?: number | null; lng?: number | null };
  readOnly?: boolean;
}) {
  const save = useSaveStorePin(merchant.id);
  const toast = useToast();
  const areas = useServiceAreas();
  const area = areas.data?.find((a) => a.id === merchant.service_area_id);
  const pin = pinOf(merchant);

  if (readOnly) {
    return <p className="text-small text-ink-3">{pin ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : 'Not pinned on the map yet.'}</p>;
  }
  return (
    <div className="space-y-2">
      <PinField
        value={pin}
        center={pin ?? areaCenter(area)}
        label="Store location"
        hint="Pin the store’s door. Riders navigate here, and delivery by km is measured from it."
        onChange={(next) => save.mutateAsync(next).then(() => toast(next ? 'Store location saved' : 'Pin removed'), () => undefined)}
      />
      {save.error && <Notice tone="danger">{userMessage(save.error)}</Notice>}
    </div>
  );
}
