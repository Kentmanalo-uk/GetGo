-- GETGO Partner stores.
--
-- A store is a GETGO partner once its owner has joined: they applied and were
-- approved, or claimed a listing GETGO created, and now manage it themselves.
-- Other listings are independent stores GETGO lists from public information;
-- the app labels them so customers aren't misled.
--
-- "Partner" is the name of the free store program. It is not a legal
-- partnership, joint venture, agency or franchise.

create or replace view public.storefronts with (security_barrier = true) as
select
  m.id, m.slug, m.name, m.category, m.description, m.logo_path, m.cover_path,
  m.address_line, m.barangay, m.city, m.service_area_id, sa.name as service_area_name,
  m.min_order_minor, sa.delivery_fee_minor, sa.service_fee_minor, sa.typical_delivery_minutes, m.currency,
  public.store_state(m.id) as state,
  public.next_open_at(m.id) as next_open_at,
  r.rating_avg, coalesce(r.rating_count, 0) as rating_count,
  m.created_at,
  least(sa.delivery_fee_minor, coalesce(bf.min_fee, sa.delivery_fee_minor)) as delivery_fee_from_minor,
  coalesce(bf.varies, false) as delivery_fee_varies,
  exists (select 1 from public.merchant_members mm where mm.merchant_id = m.id) as is_partner
from public.merchants m
join public.service_areas sa on sa.id = m.service_area_id
left join lateral (
  select round(avg(rating)::numeric, 1) as rating_avg, count(*) as rating_count
  from public.reviews where merchant_id = m.id
) r on true
left join lateral (
  select min(delivery_fee_minor) as min_fee,
    (min(delivery_fee_minor) <> max(delivery_fee_minor) or min(delivery_fee_minor) <> sa.delivery_fee_minor) as varies
  from public.barangay_fees where service_area_id = sa.id
) bf on true
where m.is_published and m.status = 'active' and sa.is_active;

revoke all on public.storefronts from anon, authenticated;
grant select on public.storefronts to anon, authenticated;
