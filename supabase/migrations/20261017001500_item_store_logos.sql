-- Include the store's logo with each listed item so item cards can show it
-- beside the store name.

create or replace function public.home_feed(p_service_area_id uuid, p_limit int default 18)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with stores as (
    select * from public.storefronts where service_area_id = p_service_area_id
  ),
  items as (
    select
      p.id, p.name, p.image_path, p.is_available, p.created_at,
      coalesce((select min(v.price_minor) from public.product_variants v where v.product_id = p.id), p.base_price_minor) as price_minor,
      exists (select 1 from public.product_variants v where v.product_id = p.id having count(*) > 1) as has_sizes,
      s.id as merchant_id, s.name as merchant_name, s.slug as merchant_slug, s.state as merchant_state,
      s.category as merchant_category, s.logo_path as merchant_logo_path
    from public.products p
    join stores s on s.id = p.merchant_id
    where p.status = 'published'
  ),
  popularity as (
    select oi.product_id, count(distinct oi.order_id) as orders
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.service_area_id = p_service_area_id and o.status = 'completed'
      and o.completed_at > now() - interval '30 days'
    group by oi.product_id
  ),
  ranked as (
    select i.*, coalesce(pop.orders, 0) as orders,
      (i.merchant_state = 'open') as store_open
    from items i left join popularity pop on pop.product_id = i.id
  ),
  item_json as (
    select r.*, jsonb_build_object(
      'id', r.id, 'name', r.name, 'image_path', r.image_path, 'is_available', r.is_available,
      'price_minor', r.price_minor, 'has_sizes', r.has_sizes,
      'merchant_id', r.merchant_id, 'merchant_name', r.merchant_name, 'merchant_slug', r.merchant_slug,
      'merchant_state', r.merchant_state, 'merchant_category', r.merchant_category, 'merchant_logo_path', r.merchant_logo_path, 'orders', r.orders
    ) as j
    from ranked r
  )
  select jsonb_build_object(
    'popular', coalesce((
      select jsonb_agg(j order by store_open desc, orders desc, name)
      from (select * from item_json where orders > 0 and is_available
            order by store_open desc, orders desc, name limit p_limit) x
    ), '[]'),
    'meals', coalesce((
      select jsonb_agg(j order by store_open desc, is_available desc, (image_path is not null) desc, created_at desc)
      from (select * from item_json where merchant_category in ('restaurant', 'cafe', 'bakery')
            order by store_open desc, is_available desc, (image_path is not null) desc, created_at desc limit p_limit) x
    ), '[]'),
    'essentials', coalesce((
      select jsonb_agg(j order by store_open desc, is_available desc, (image_path is not null) desc, created_at desc)
      from (select * from item_json where merchant_category in ('grocery', 'convenience', 'specialty')
            order by store_open desc, is_available desc, (image_path is not null) desc, created_at desc limit p_limit) x
    ), '[]'),
    'new_stores', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from (select * from stores where created_at > now() - interval '30 days' order by created_at desc limit 10) s
    ), '[]')
  );
$$;

create or replace function public.explore_items(
  p_service_area_id uuid, p_section text default 'all', p_offset int default 0, p_limit int default 24
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with stores as (
    select * from public.storefronts where service_area_id = p_service_area_id
  ),
  popularity as (
    select oi.product_id, count(distinct oi.order_id) as orders
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.service_area_id = p_service_area_id and o.status = 'completed'
      and o.completed_at > now() - interval '30 days'
    group by oi.product_id
  ),
  items as (
    select
      p.id, p.name, p.image_path, p.is_available, p.created_at,
      coalesce((select min(v.price_minor) from public.product_variants v where v.product_id = p.id), p.base_price_minor) as price_minor,
      exists (select 1 from public.product_variants v where v.product_id = p.id having count(*) > 1) as has_sizes,
      s.id as merchant_id, s.name as merchant_name, s.slug as merchant_slug, s.state as merchant_state,
      s.category as merchant_category, s.logo_path as merchant_logo_path, coalesce(pop.orders, 0) as orders
    from public.products p
    join stores s on s.id = p.merchant_id
    left join popularity pop on pop.product_id = p.id
    where p.status = 'published'
      and case coalesce(p_section, 'all')
        when 'popular' then coalesce(pop.orders, 0) > 0 and p.is_available
        when 'meals' then s.category in ('restaurant', 'cafe', 'bakery')
        when 'essentials' then s.category in ('grocery', 'convenience', 'specialty')
        else true
      end
  ),
  page as (
    select *, row_number() over (
      order by (merchant_state = 'open') desc,
        case when p_section = 'popular' then orders end desc nulls last,
        is_available desc, (image_path is not null) desc, created_at desc, id
    ) as rn
    from items
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'image_path', image_path, 'is_available', is_available,
      'price_minor', price_minor, 'has_sizes', has_sizes,
      'merchant_id', merchant_id, 'merchant_name', merchant_name, 'merchant_slug', merchant_slug,
      'merchant_state', merchant_state, 'merchant_category', merchant_category, 'merchant_logo_path', merchant_logo_path, 'orders', orders
    ) order by rn), '[]')
  from page
  where rn > greatest(coalesce(p_offset, 0), 0)
    and rn <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 24), 1), 60);
$$;
