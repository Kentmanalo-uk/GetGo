import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from '@/components/icons';
import { cx } from '@/components/ui/cx';
import type { LatLng } from '@/lib/geo';

// Loaded on demand (see ./index.tsx) so Leaflet stays out of the main bundle.

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const PINK = '#e0266f';
const INK = '#16141a';

const PIN_SVG = `<svg viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 38 14 38s14-13.7 14-24.1C28 6.2 21.7 0 14 0z" fill="${PINK}"/><circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>`;

function baseMap(el: HTMLElement, center: LatLng, zoom: number, interactive = true) {
  const map = L.map(el, {
    center: [center.lat, center.lng],
    zoom,
    zoomControl: interactive,
    attributionControl: true,
    scrollWheelZoom: interactive ? 'center' : false,
  });
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

/**
 * Pick a spot by moving the map under a fixed pin, or jump to the phone's
 * location. Calls onMove with the pinned point after every move.
 */
export function PinPickerMap({ initial, zoom, onMove, className }: { initial: LatLng; zoom: number; onMove: (p: LatLng) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [moving, setMoving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = baseMap(el.current, initial, zoom);
    map.on('movestart', () => setMoving(true));
    map.on('moveend', () => {
      setMoving(false);
      const c = map.getCenter();
      onMoveRef.current({ lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) });
    });
    mapRef.current = map;
    // The map may mount inside an opening sheet; size it once laid out.
    const t = window.setTimeout(() => map.invalidateSize(), 350);
    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- created once; the pin is read from the map

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateError('Your browser can’t share your location.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        mapRef.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 18, { duration: 0.8 });
      },
      () => {
        setLocating(false);
        setLocateError('Couldn’t get your location. Allow location access, or move the map to your spot.');
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  return (
    <div className={cx('relative isolate overflow-hidden rounded-media bg-canvas', className)}>
      <div ref={el} className="absolute inset-0 z-0" />
      {/* The pin stays in the middle; its tip marks the spot. */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-[500]" aria-hidden>
        <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/30 blur-[1px]" />
        <span
          className={cx('absolute block -translate-x-1/2 transition-transform duration-150 motion-reduce:transition-none', moving ? '-translate-y-[calc(100%+8px)]' : '-translate-y-full')}
          dangerouslySetInnerHTML={{ __html: PIN_SVG }}
        />
      </div>
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        className="absolute right-3 bottom-8 z-[500] inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-small font-semibold shadow-card ring-1 ring-line disabled:opacity-60"
      >
        <LocateFixed className={cx('size-4', locating && 'animate-spin')} aria-hidden />
        {locating ? 'Finding you…' : 'Use my location'}
      </button>
      {locateError && <p className="absolute inset-x-3 top-3 z-[500] rounded-control bg-surface px-3 py-2 text-small text-danger shadow-card">{locateError}</p>}
    </div>
  );
}

/**
 * Two pins (A: pickup or store, B: drop-off) and the road between them. With no
 * road path yet, a dashed straight line joins them.
 */
export function RouteMap({ from, to, line, className }: { from: LatLng; to: LatLng; line?: Array<[number, number]> | null; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = baseMap(el.current, from, 14);
    map.scrollWheelZoom.disable();
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const t = window.setTimeout(() => map.invalidateSize(), 350);
    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- drawn below

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const path: Array<[number, number]> = line?.length ? line : [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ];
    if (line?.length) {
      L.polyline(path, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
      L.polyline(path, { color: PINK, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
    } else {
      L.polyline(path, { color: PINK, weight: 4, opacity: 0.8, dashArray: '2 10', lineCap: 'round' }).addTo(layer);
    }
    L.circleMarker([from.lat, from.lng], { radius: 8, color: '#fff', weight: 3, fillColor: INK, fillOpacity: 1 }).addTo(layer);
    L.marker([to.lat, to.lng], {
      icon: L.divIcon({ html: PIN_SVG, className: 'getgo-pin', iconSize: [28, 38], iconAnchor: [14, 38] }),
      keyboard: false,
      interactive: false,
    }).addTo(layer);
    map.fitBounds(L.latLngBounds(path), { padding: [36, 36], maxZoom: 17 });
  }, [from.lat, from.lng, to.lat, to.lng, line]);

  return (
    <div className={cx('relative isolate overflow-hidden rounded-media bg-canvas', className)}>
      <div ref={el} className="absolute inset-0 z-0" />
    </div>
  );
}
