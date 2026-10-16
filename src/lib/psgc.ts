import { useQuery } from '@tanstack/react-query';

/**
 * Philippine Standard Geographic Code (PSGC) data from the public PSGC API
 * (https://psgc.gitlab.io/api). The list changes rarely, so results are
 * cached for the whole session. Callers fall back to manual entry if the API
 * is unreachable.
 */
const BASE = 'https://psgc.gitlab.io/api';

export interface PsgcPlace {
  code: string;
  name: string;
}

async function getList(path: string): Promise<PsgcPlace[]> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error('The address list is unavailable right now.');
  const rows = (await res.json()) as Array<{ code: string; name: string }>;
  return rows.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
}

const cached = { staleTime: Infinity, gcTime: Infinity, retry: 1 } as const;

export function usePsgcProvinces(enabled = true) {
  return useQuery({ queryKey: ['psgc', 'provinces'], queryFn: () => getList('/provinces/'), enabled, ...cached });
}

export function usePsgcMunicipalities(provinceCode: string | null | undefined) {
  return useQuery({
    queryKey: ['psgc', 'municipalities', provinceCode],
    queryFn: () => getList(`/provinces/${provinceCode}/cities-municipalities/`),
    enabled: Boolean(provinceCode),
    ...cached,
  });
}

export function usePsgcBarangays(municipalityCode: string | null | undefined) {
  return useQuery({
    queryKey: ['psgc', 'barangays', municipalityCode],
    queryFn: () => getList(`/cities-municipalities/${municipalityCode}/barangays/`),
    enabled: Boolean(municipalityCode),
    ...cached,
  });
}
