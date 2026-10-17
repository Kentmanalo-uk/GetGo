import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PinField } from '@/components/map';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';
import { ChoiceRow, Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { unwrap } from '@/lib/errors';
import { areaCenter, kmFee, pinOf, type LatLng } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import type { ServiceArea } from '@/types/models';

type Pricing = Pick<ServiceArea, 'delivery_pricing' | 'km_base_fee_minor' | 'km_base_km' | 'km_rate_minor' | 'km_max_fee_minor' | 'center_lat' | 'center_lng'>;

function useSavePricing(areaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Pricing) => unwrap(await supabase.from('service_areas').update(input).eq('id', areaId)),
    onSuccess: () => {
      for (const key of [['admin', 'areas'], ['service-areas'], ['storefronts'], ['quote'], ['service-quote']]) qc.invalidateQueries({ queryKey: key });
    },
  });
}

const PREVIEW_KM = [1, 3, 5, 8, 12];

/**
 * How delivery is priced in an area: per barangay, or by distance between the
 * store (or pickup) and the customer's pin. Trips without both pins always use
 * the barangay price.
 */
export function DeliveryPricingEditor({ area }: { area: ServiceArea }) {
  const save = useSavePricing(area.id);
  const toast = useToast();
  const [mode, setMode] = useState(area.delivery_pricing);
  const [base, setBase] = useState(toPesoInput(area.km_base_fee_minor));
  const [baseKm, setBaseKm] = useState(String(Number(area.km_base_km)));
  const [rate, setRate] = useState(toPesoInput(area.km_rate_minor));
  const [max, setMax] = useState(toPesoInput(area.km_max_fee_minor));
  const [center, setCenter] = useState<LatLng | null>(pinOf({ lat: area.center_lat, lng: area.center_lng }));
  const [error, setError] = useState<string | null>(null);

  const values = {
    km_base_fee_minor: parsePesos(base),
    km_base_km: /^\d+(\.\d)?$/.test(baseKm.trim()) ? Number(baseKm) : null,
    km_rate_minor: parsePesos(rate),
    km_max_fee_minor: max.trim() ? parsePesos(max) : null,
  };
  const valid = values.km_base_fee_minor != null && values.km_base_km != null && values.km_base_km <= 50 && values.km_rate_minor != null && (!max.trim() || (values.km_max_fee_minor ?? 0) > 0);
  const preview = valid ? (values as { km_base_fee_minor: number; km_base_km: number; km_rate_minor: number; km_max_fee_minor: number | null }) : null;

  const onSave = async () => {
    if (!valid) {
      setError('Enter amounts like 40 or 10.50, a base distance up to 50 km, and a maximum above zero (or leave it blank).');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        delivery_pricing: mode,
        km_base_fee_minor: values.km_base_fee_minor!,
        km_base_km: values.km_base_km!,
        km_rate_minor: values.km_rate_minor!,
        km_max_fee_minor: values.km_max_fee_minor,
        center_lat: center?.lat ?? null,
        center_lng: center?.lng ?? null,
      });
      toast('Delivery pricing saved');
    } catch {
      /* shown below */
    }
  };

  return (
    <div className="space-y-5">
      <fieldset className="divide-y divide-line rounded-media border border-line">
        <legend className="sr-only">How delivery is priced</legend>
        <ChoiceRow
          type="radio"
          name="pricing"
          checked={mode === 'distance'}
          onChange={() => setMode('distance')}
          label={
            <span>
              <span className="block font-semibold">By distance (km) · default</span>
              <span className="block text-small text-ink-3">
                Measured along the road from the store or pickup pin to the customer’s pin. Customers pin their address; trips that can’t be measured pay the barangay price, never less than the base fee.
              </span>
            </span>
          }
        />
        <ChoiceRow
          type="radio"
          name="pricing"
          checked={mode === 'barangay'}
          onChange={() => setMode('barangay')}
          label={
            <span>
              <span className="block font-semibold">Per barangay</span>
              <span className="block text-small text-ink-3">Set a price for each barangay yourself (below), or use the area’s default fee.</span>
            </span>
          }
        />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Base fee" hint="Covers the first km.">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />}
        </Field>
        <Field label="Base covers (km)" hint="Kilometres.">
          {(p) => <Input {...p} inputMode="decimal" value={baseKm} onChange={(e) => setBaseKm(e.target.value)} />}
        </Field>
        <Field label="Per km after" hint="Each extra km.">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}
        </Field>
        <Field label="Maximum" optional hint="Blank for none.">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}
        </Field>
      </div>

      {preview && (
        <div className="rounded-media bg-canvas p-4">
          <p className="text-small font-semibold">What customers pay for delivery</p>
          <div className="mt-2 grid grid-cols-5 gap-2 text-center">
            {PREVIEW_KM.map((km) => (
              <div key={km} className="rounded-control bg-surface px-2 py-2">
                <p className="text-micro text-ink-3">{km} km</p>
                <p className="tabular font-bold">{formatMoney(kmFee(preview, km))}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-micro text-ink-3">
            Rounded up to the next ₱5. Suggested: ₱40 for the first 2 km, then ₱10 per km. A motorcycle uses about ₱1.50 of fuel per km and rides back empty, so this
            covers fuel, wear and the rider’s time fairly.
          </p>
        </div>
      )}

      <PinField
        value={center}
        center={areaCenter(area)}
        onChange={setCenter}
        label="Town center"
        hint="Where maps start when customers and stores pin a location here."
      />

      {error && <p className="text-small text-danger">{error}</p>}
      <FormError error={save.error} />
      <div className="flex justify-end">
        <Button onClick={onSave} loading={save.isPending}>
          Save pricing
        </Button>
      </div>
    </div>
  );
}
