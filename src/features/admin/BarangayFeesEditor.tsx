import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { formatMoney, parsePesos, toPesoInput } from '@/domain/money';
import { usePsgcBarangays } from '@/lib/psgc';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import type { ServiceArea } from '@/types/models';

interface FeeRow {
  barangay_code: string;
  barangay_name: string;
  delivery_fee_minor: number;
}

function useBarangayFees(areaId: string) {
  return useQuery({
    queryKey: ['admin', 'barangay-fees', areaId],
    queryFn: async () =>
      unwrap(await supabase.from('barangay_fees').select('barangay_code, barangay_name, delivery_fee_minor').eq('service_area_id', areaId)) as FeeRow[],
  });
}

function useSaveBarangayFees(areaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fees: FeeRow[]) => unwrap(await supabase.rpc('set_barangay_fees', { p_service_area_id: areaId, p_fees: fees })) as number,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'barangay-fees', areaId] });
      qc.invalidateQueries({ queryKey: ['storefronts'] });
      qc.invalidateQueries({ queryKey: ['quote'] });
    },
  });
}

/**
 * Delivery price for each barangay of a town. Blank means the town's default
 * delivery fee applies. "Same price for all" fills every barangay at once.
 */
export function BarangayFeesEditor({ area, onDone }: { area: ServiceArea; onDone: () => void }) {
  const barangays = usePsgcBarangays(area.psgc_code);
  const saved = useBarangayFees(area.id);
  const save = useSaveBarangayFees(area.id);
  const toast = useToast();
  const [prices, setPrices] = useState<Record<string, string> | null>(null);
  const [allPrice, setAllPrice] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data && prices === null) {
      setPrices(Object.fromEntries(saved.data.map((f) => [f.barangay_code, toPesoInput(f.delivery_fee_minor)])));
    }
  }, [saved.data, prices]);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (barangays.data ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [barangays.data, filter]);

  if (!area.psgc_code) {
    return (
      <Notice tone="warning" title="This area isn’t linked to the official town list">
        Edit the area and choose its province and city or municipality first. Then you can price each barangay here.
      </Notice>
    );
  }
  if (barangays.isPending || saved.isPending || prices === null) return <PageLoading rows={3} />;
  if (barangays.isError) return <ErrorState error={barangays.error} onRetry={() => barangays.refetch()} />;
  if (saved.isError) return <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;

  const all = barangays.data ?? [];
  const setCount = all.filter((b) => (prices[b.code] ?? '').trim() !== '').length;

  const applyToAll = () => {
    const minor = parsePesos(allPrice);
    if (minor == null) return setError('Enter a price like 30 or 45.50 to apply to every barangay.');
    setError(null);
    setPrices(Object.fromEntries(all.map((b) => [b.code, toPesoInput(minor)])));
  };

  const submit = async () => {
    const fees: FeeRow[] = [];
    for (const b of all) {
      const raw = (prices[b.code] ?? '').trim();
      if (!raw) continue;
      const minor = parsePesos(raw);
      if (minor == null) return setError(`Check the price for ${b.name}.`);
      fees.push({ barangay_code: b.code, barangay_name: b.name, delivery_fee_minor: minor });
    }
    setError(null);
    try {
      const n = await save.mutateAsync(fees);
      toast(n ? `Saved prices for ${n} barangays` : 'All barangays use the default fee');
      onDone();
    } catch {
      /* shown below */
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-small text-ink-3">
        Leave a barangay blank to charge the town’s default delivery fee ({formatMoney(area.delivery_fee_minor)}).
      </p>

      <div className="flex flex-wrap items-end gap-2 rounded-media bg-canvas p-3">
        <Field label="Same price for all barangays" className="min-w-40 flex-1">
          {(p) => <Input {...p} prefix="₱" inputMode="decimal" value={allPrice} onChange={(e) => setAllPrice(e.target.value)} placeholder="e.g. 40" />}
        </Field>
        <Button variant="dark" onClick={applyToAll} disabled={!allPrice.trim()}>
          Apply to all {all.length}
        </Button>
        <Button variant="ghost" onClick={() => setPrices({})}>
          Clear all
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a barangay"
            aria-label="Find a barangay"
            className="h-10 w-full rounded-control border border-line-strong pr-3 pl-9 focus:border-ink focus:ring-2 focus:ring-accent focus:outline-none"
          />
        </div>
        <span className="tabular shrink-0 text-small text-ink-3">
          {setCount} of {all.length} priced
        </span>
      </div>

      <ul className="divide-y divide-line border-y border-line">
        {list.map((b) => (
          <li key={b.code} className="flex items-center justify-between gap-4 py-2">
            <label htmlFor={`fee-${b.code}`} className="min-w-0 flex-1 truncate">
              {b.name}
            </label>
            <div className="w-32 shrink-0">
              <Input
                id={`fee-${b.code}`}
                prefix="₱"
                inputMode="decimal"
                value={prices[b.code] ?? ''}
                placeholder={toPesoInput(area.delivery_fee_minor)}
                onChange={(e) => setPrices({ ...prices, [b.code]: e.target.value })}
                aria-label={`Delivery price for ${b.name}`}
              />
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="py-4 text-small text-ink-3">No barangay matches “{filter}”.</li>}
      </ul>

      {error && <Notice tone="danger">{error}</Notice>}
      <FormError error={save.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} loading={save.isPending}>
          Save barangay prices
        </Button>
      </div>
    </div>
  );
}
