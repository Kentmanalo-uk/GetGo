-- Official Philippine Standard Geographic Codes (PSGC) so areas and addresses
-- use the government's list of provinces, cities/municipalities and
-- barangays (served to the app by the public PSGC API).

-- Each service area is one city/municipality.
alter table public.service_areas
  add column psgc_code text unique check (psgc_code is null or psgc_code ~ '^[0-9]{9,10}$'),
  add column province_code text check (province_code is null or province_code ~ '^[0-9]{9,10}$');

-- The barangay picked from the official list (null when typed by hand).
alter table public.addresses
  add column barangay_code text check (barangay_code is null or barangay_code ~ '^[0-9]{9,10}$');
grant update (barangay_code) on public.addresses to authenticated;
