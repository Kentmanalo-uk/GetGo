-- Home page sections for an area in one call: popular items (from completed
-- orders in the last 30 days, aggregated counts only), meals, groceries and
-- essentials, and newly joined stores. Uses only public storefront and
-- published product data.

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
      s.category as merchant_category
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
      'merchant_state', r.merchant_state, 'merchant_category', r.merchant_category, 'orders', r.orders
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

grant execute on function public.home_feed(uuid, int) to anon, authenticated;
