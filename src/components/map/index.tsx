import { lazy, Suspense, useState, type ComponentProps } from 'react';
import { MapPin } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { LoadingDots } from '@/components/ui/Feedback';
import { cx } from '@/components/ui/cx';
import { ICON_GRADIENT } from '@/components/IconGradient';
import { useRoute } from '@/features/location/useRoute';
import { formatKm, type LatLng } from '@/lib/geo';

// Leaflet loads only when a map is shown.
const LazyPinPicker = lazy(() => import('./LeafletMap').then((m) => ({ default: m.PinPickerMap })));
const LazyRouteMap = lazy(() => import('./LeafletMap').then((m) => ({ default: m.RouteMap })));

function MapLoading({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center justify-center rounded-media bg-canvas text-ink-3', className)}>
      <LoadingDots />
    </div>
  );
}

export function PinPicker(props: ComponentProps<typeof LazyPinPicker>) {
  return (
    <Suspense fallback={<MapLoading className={props.className} />}>
      <LazyPinPicker {...props} />
    </Suspense>
  );
}

export function RouteMap(props: ComponentProps<typeof LazyRouteMap>) {
  return (
    <Suspense fallback={<MapLoading className={props.className} />}>
      <LazyRouteMap {...props} />
    </Suspense>
  );
}

/**
 * A map pin inside a form: shows whether the spot is pinned, and opens an
 * inline map to pin or move it.
 */
export function PinField({
  value,
  onChange,
  center,
  label = 'Exact spot on the map',
  hint = 'Pin it so the rider finds you, and for an exact delivery fee by distance.',
  error,
}: {
  value: LatLng | null;
  onChange: (pin: LatLng | null) => void;
  center: LatLng;
  label?: string;
  hint?: string;
  /** Shown under the field, e.g. when a pin is required. */
  error?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(null);

  if (editing) {
    const start = value ?? center;
    return (
      <div className="space-y-3">
        <p className="text-small font-semibold">{label}</p>
        <PinPicker initial={start} zoom={value ? 18 : 15} onMove={setDraft} className="h-72" />
        <p className="text-small text-ink-3">Move the map until the pin sits on the exact spot, or tap Use my location.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onChange(draft ?? start);
              setEditing(false);
            }}
          >
            Use this spot
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={cx('flex items-center gap-3 rounded-media border p-3', error ? 'border-danger' : 'border-line')}>
        <span className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-full', value ? 'bg-accent-soft' : 'bg-canvas')}>
          <MapPin className={cx('size-5', value ? ICON_GRADIENT : 'text-ink-4')} weight="fill" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold">{value ? 'Pinned on the map' : label}</p>
          <p className="text-small text-ink-3">{value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : hint}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {value && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
          <Button
            size="sm"
            variant={value ? 'secondary' : 'primary'}
            onClick={() => {
              setDraft(null);
              setEditing(true);
            }}
          >
            {value ? 'Move' : 'Pin on map'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-small text-danger">{error}</p>}
    </div>
  );
}

/** The trip on a map, A to B along the road, with its distance. */
export function TripMap({ from, to, km, className }: { from: LatLng; to: LatLng; km?: number | null; className?: string }) {
  const route = useRoute(from, to);
  const shown = km ?? route.data?.km ?? null;
  return (
    <figure className="space-y-2">
      <RouteMap from={from} to={to} line={route.data?.line} className={cx('h-48', className)} />
      <figcaption className="flex items-center justify-between gap-3 text-small text-ink-3">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-ink ring-2 ring-surface" aria-hidden /> From
          <MapPin className={cx('ml-2 size-4', ICON_GRADIENT)} weight="fill" aria-hidden /> To
        </span>
        {shown != null && (
          <span className="tabular font-semibold text-ink">
            {formatKm(shown)} {route.data ? 'by road' : 'approx.'}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
