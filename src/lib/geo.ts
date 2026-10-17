import type { ServiceArea } from '@/types/models';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Bongabong, Oriental Mindoro (town proper): where maps start when an area has no center. */
export const DEFAULT_CENTER: LatLng = { lat: 12.75, lng: 121.4833 };

/** The pin of anything with optional lat/lng, or null. */
export function pinOf(p: { lat?: number | null; lng?: number | null } | null | undefined): LatLng | null {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' ? { lat: p.lat, lng: p.lng } : null;
}

export function areaCenter(area: Pick<ServiceArea, 'center_lat' | 'center_lng'> | null | undefined): LatLng {
  return pinOf(area ? { lat: area.center_lat, lng: area.center_lng } : null) ?? DEFAULT_CENTER;
}

/** Straight-line distance in km. */
export function straightKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The area's price for a trip of `km`, in centavos: the base fee covers the
 * first `km_base_km`, then `km_rate` per km, rounded up to ₱5 and capped at the
 * maximum. Mirrors km_fee in the database (which is what customers pay).
 */
export function kmFee(area: Pick<ServiceArea, 'km_base_fee_minor' | 'km_base_km' | 'km_rate_minor' | 'km_max_fee_minor'>, km: number): number {
  const raw = area.km_base_fee_minor + Math.max(0, km - Number(area.km_base_km)) * area.km_rate_minor;
  const fee = Math.ceil(raw / 500) * 500;
  return area.km_max_fee_minor ? Math.min(fee, area.km_max_fee_minor) : fee;
}

export const formatKm = (km: number) => `${Number(km).toFixed(1)} km`;

export interface Route {
  /** Distance along roads, km. */
  km: number;
  /** The road path as [lat, lng] points. */
  line: Array<[number, number]>;
}

/**
 * The route along real roads between two points, from OpenStreetMap routing
 * (OSRM). Returns null when no route is found or the service is unreachable;
 * callers then fall back to the straight-line estimate.
 */
export async function fetchRoute(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<Route | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { code: string; routes?: Array<{ distance: number; geometry: { coordinates: Array<[number, number]> } }> };
    const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
    if (!route) return null;
    return { km: route.distance / 1000, line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
  } catch {
    return null;
  }
}

/** Google Maps directions to a pin (opens the app on phones). */
export function directionsUrl(to: LatLng, from?: LatLng | null): string {
  const origin = from ? `&origin=${from.lat},${from.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}${origin}&travelmode=driving`;
}
