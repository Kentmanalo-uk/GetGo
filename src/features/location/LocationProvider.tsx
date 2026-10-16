import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAddresses, useServiceAreas } from '@/features/consumer/api';
import type { Address, ServiceArea } from '@/types/models';

const AREA_KEY = 'getgo.area';
const ADDRESS_KEY = 'getgo.address';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode); selection lasts for this session */
  }
}

interface LocationValue {
  ready: boolean;
  areas: ServiceArea[];
  addresses: Address[];
  area: ServiceArea | null;
  address: Address | null;
  setAddressId: (id: string) => void;
  setAreaId: (id: string) => void;
}

const LocationContext = createContext<LocationValue | null>(null);

/**
 * Where the customer is shopping: a saved delivery address when signed in,
 * otherwise a browsing area chosen from active service areas.
 */
export function LocationProvider({ children }: { children: ReactNode }) {
  const areasQuery = useServiceAreas();
  const addressesQuery = useAddresses();
  const [addressId, setAddressIdState] = useState<string | null>(() => read(ADDRESS_KEY));
  const [areaId, setAreaIdState] = useState<string | null>(() => read(AREA_KEY));

  const setAddressId = useCallback((id: string) => {
    write(ADDRESS_KEY, id);
    setAddressIdState(id);
  }, []);
  const setAreaId = useCallback((id: string) => {
    write(AREA_KEY, id);
    write(ADDRESS_KEY, null);
    setAreaIdState(id);
    setAddressIdState(null);
  }, []);

  const value = useMemo<LocationValue>(() => {
    const areas = areasQuery.data ?? [];
    const addresses = addressesQuery.data ?? [];
    const address =
      addresses.find((a) => a.id === addressId) ?? (areaId ? null : (addresses.find((a) => a.is_default) ?? addresses[0] ?? null));
    const area =
      areas.find((a) => a.id === (address?.service_area_id ?? areaId)) ?? (areas.length === 1 ? areas[0] : null);
    return {
      ready: !areasQuery.isPending && (addressesQuery.fetchStatus === 'idle' || !addressesQuery.isPending),
      areas,
      addresses,
      area,
      address,
      setAddressId,
      setAreaId,
    };
  }, [areasQuery.data, areasQuery.isPending, addressesQuery.data, addressesQuery.isPending, addressesQuery.fetchStatus, addressId, areaId, setAddressId, setAreaId]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationContext() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocationContext must be used inside LocationProvider');
  return ctx;
}
