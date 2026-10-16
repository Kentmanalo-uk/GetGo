-- Paged item listing for the Explore page. Same public data and ordering as
-- the home feed: open stores first, then available items, items with photos,
-- newest; popular items by completed orders in the last 30 days.
-- p_section: all | popular | meals | essentials

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
      s.category as merchant_category, coalesce(pop.orders, 0) as orders
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
      'merchant_state', merchant_state, 'merchant_category', merchant_category, 'orders', orders
    ) order by rn), '[]')
  from page
  where rn > greatest(coalesce(p_offset, 0), 0)
    and rn <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 24), 1), 60);
$$;

grant execute on function public.explore_items(uuid, text, int, int) to anon, authenticated;
