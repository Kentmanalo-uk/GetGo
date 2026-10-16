-- Delivery fees per barangay. Admins set a price for each barangay of a
-- town (service area); barangays without a price use the area's default fee.

create table public.barangay_fees (
  service_area_id uuid not null references public.service_areas (id) on delete cascade,
  barangay_code text not null check (barangay_code ~ '^[0-9]{9,10}$'),
  barangay_name text not null check (char_length(barangay_name) between 1 and 120),
  delivery_fee_minor bigint not null check (delivery_fee_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key (service_area_id, barangay_code)
);
create index barangay_fees_name_idx on public.barangay_fees (service_area_id, lower(barangay_name));

alter table public.barangay_fees enable row level security;
revoke all on public.barangay_fees from anon, authenticated;
-- Fees are public (customers see them before ordering); writes go through set_barangay_fees.
grant select on public.barangay_fees to anon, authenticated;
create policy barangay_fees_select on public.barangay_fees for select to anon, authenticated using (true);

-- The delivery fee for an address: its barangay's price (matched by PSGC code,
-- or by name for typed addresses), otherwise the area's default fee.
create or replace function public.delivery_fee_for(p_service_area_id uuid, p_barangay_code text, p_barangay_name text)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select delivery_fee_minor from public.barangay_fees
     where service_area_id = p_service_area_id and barangay_code = p_barangay_code),
    (select delivery_fee_minor from public.barangay_fees
     where service_area_id = p_service_area_id and lower(barangay_name) = lower(trim(p_barangay_name))
     limit 1),
    (select delivery_fee_minor from public.service_areas where id = p_service_area_id)
  );
$$;

-- Replaces an area's barangay prices in one step.
-- p_fees: [{ barangay_code, barangay_name, delivery_fee_minor }]
create or replace function public.set_barangay_fees(p_service_area_id uuid, p_fees jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.service_areas where id = p_service_area_id) then
    raise exception 'Area not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if jsonb_typeof(p_fees) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_fees) f
    where coalesce(f ->> 'barangay_code', '') !~ '^[0-9]{9,10}$'
       or coalesce(trim(f ->> 'barangay_name'), '') = ''
       or coalesce(f ->> 'delivery_fee_minor', '') !~ '^[0-9]{1,9}$'
  ) then
    raise exception 'Each barangay needs a valid price.' using errcode = 'P0001', hint = 'invalid_fees';
  end if;

  delete from public.barangay_fees where service_area_id = p_service_area_id;
  insert into public.barangay_fees (service_area_id, barangay_code, barangay_name, delivery_fee_minor)
  select distinct on (f ->> 'barangay_code') p_service_area_id, f ->> 'barangay_code', trim(f ->> 'barangay_name'),
    (f ->> 'delivery_fee_minor')::bigint
  from jsonb_array_elements(p_fees) f;
  get diagnostics v_count = row_count;

  perform public.log_audit('area.barangay_fees_set', 'service_area', p_service_area_id::text,
    jsonb_build_object('barangays', v_count));
  return v_count;
end $$;

create or replace function public.compute_checkout(p_user uuid, p_merchant_id uuid, p_address_id uuid, p_promo_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_merchant public.merchants%rowtype;
  v_area public.service_areas%rowtype;
  v_address public.addresses%rowtype;
  v_promo public.promotions%rowtype;
  v_cart_id uuid;
  v_item record;
  v_price record;
  v_selection jsonb;
  v_details jsonb;
  v_items jsonb := '[]';
  v_issues jsonb := '[]';
  v_item_errors int := 0;
  v_subtotal bigint := 0;
  v_delivery bigint := 0;
  v_service bigint := 0;
  v_small bigint := 0;
  v_discount bigint := 0;
  v_promo_result jsonb;
  v_promo_message text;
  v_state text;
  v_code text := upper(nullif(trim(p_promo_code), ''));
  v_used int;
begin
  select * into v_merchant from public.merchants where id = p_merchant_id;
  if not found then
    raise exception 'Store not found.' using errcode = 'P0001', hint = 'store_not_found';
  end if;
  select * into v_area from public.service_areas where id = v_merchant.service_area_id;
  v_state := public.store_state(p_merchant_id);

  if not public.merchant_is_public(p_merchant_id) then
    v_issues := v_issues || jsonb_build_object('code', 'store_unavailable', 'message', 'This store is not available on GETGO right now.');
  elsif v_state = 'paused' then
    v_issues := v_issues || jsonb_build_object('code', 'store_paused', 'message', 'This store is temporarily closed. Please try again later.');
  elsif v_state = 'closed' then
    v_issues := v_issues || jsonb_build_object('code', 'store_closed', 'message', 'This store is closed right now, so a rider can’t buy from it.');
  end if;

  if p_address_id is null then
    v_issues := v_issues || jsonb_build_object('code', 'address_required', 'message', 'Choose a delivery address.');
  else
    select * into v_address from public.addresses where id = p_address_id and user_id = p_user;
    if not found then
      v_issues := v_issues || jsonb_build_object('code', 'address_invalid', 'message', 'Choose a delivery address.');
    elsif v_address.service_area_id <> v_merchant.service_area_id then
      v_issues := v_issues || jsonb_build_object('code', 'outside_area',
        'message', format('Riders for %s deliver within %s only.', v_merchant.name, v_area.name));
    end if;
  end if;

  select id into v_cart_id from public.carts where user_id = p_user and merchant_id = p_merchant_id;

  for v_item in
    select ci.*, p.name as product_name, pv.name as variant_name
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    left join public.product_variants pv on pv.id = ci.variant_id
    where ci.cart_id = v_cart_id
    order by ci.created_at, ci.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object('option_value_id', cio.option_value_id, 'quantity', cio.quantity)), '[]')
    into v_selection
    from public.cart_item_options cio where cio.cart_item_id = v_item.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'option_value_id', ov.id, 'group_id', g.id, 'group_name', g.name, 'option_name', ov.name,
             'price_delta_minor', ov.price_delta_minor, 'quantity', cio.quantity)
           order by pog.sort_order nulls last, g.name, ov.sort_order, ov.name), '[]')
    into v_details
    from public.cart_item_options cio
    join public.option_values ov on ov.id = cio.option_value_id
    join public.option_groups g on g.id = ov.group_id
    left join public.product_option_groups pog on pog.group_id = g.id and pog.product_id = v_item.product_id
    where cio.cart_item_id = v_item.id;

    select * into v_price from public.price_configuration(v_item.product_id, v_item.variant_id, v_selection, v_item.quantity);
    if v_price.error_code is null then
      v_subtotal := v_subtotal + v_price.unit_price_minor * v_item.quantity;
    else
      v_item_errors := v_item_errors + 1;
    end if;

    v_items := v_items || jsonb_build_object(
      'cart_item_id', v_item.id,
      'product_id', v_item.product_id,
      'variant_id', v_item.variant_id,
      'product_name', v_item.product_name,
      'variant_name', v_item.variant_name,
      'quantity', v_item.quantity,
      'instructions', v_item.instructions,
      'selection', v_selection,
      'options', v_details,
      'unit_price_minor', v_price.unit_price_minor,
      'line_total_minor', v_price.unit_price_minor * v_item.quantity,
      'previous_unit_price_minor', v_item.unit_price_snapshot_minor,
      'price_changed', v_price.error_code is null and v_price.unit_price_minor <> v_item.unit_price_snapshot_minor,
      'error_code', v_price.error_code,
      'error_message', v_price.error_message
    );
  end loop;

  if jsonb_array_length(v_items) = 0 then
    v_issues := v_issues || jsonb_build_object('code', 'cart_empty', 'message', 'Your cart is empty.');
  elsif v_item_errors > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'item_problems', 'message', 'Some items in your cart need attention.');
  elsif v_subtotal < v_merchant.min_order_minor then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum',
      'message', format('Minimum order for %s is %s.', v_merchant.name, public.format_php(v_merchant.min_order_minor)));
  end if;

  if not v_area.is_active then
    v_issues := v_issues || jsonb_build_object('code', 'area_inactive', 'message', 'GETGO is not operating in this area right now.');
  end if;

  -- Delivery is priced per barangay when the admin has set barangay prices.
  v_delivery := case when v_address.id is not null
    then public.delivery_fee_for(v_area.id, v_address.barangay_code, v_address.barangay)
    else v_area.delivery_fee_minor end;
  v_service := v_area.service_fee_minor;
  if v_area.small_order_threshold_minor is not null and v_subtotal > 0 and v_subtotal < v_area.small_order_threshold_minor then
    v_small := v_area.small_order_fee_minor;
  end if;

  if v_code is not null then
    select * into v_promo from public.promotions where code = v_code;
    if not found or not v_promo.is_active or v_promo.starts_at > now()
       or (v_promo.ends_at is not null and v_promo.ends_at <= now()) then
      v_promo_message := 'This promo code is not valid.';
    elsif v_promo.merchant_id is not null and v_promo.merchant_id <> p_merchant_id then
      v_promo_message := 'This promo code does not apply to this store.';
    elsif v_subtotal < v_promo.min_subtotal_minor then
      v_promo_message := format('Spend at least %s to use this code.', public.format_php(v_promo.min_subtotal_minor));
    else
      if v_promo.usage_limit is not null then
        select count(*) into v_used from public.promotion_redemptions where promotion_id = v_promo.id;
        if v_used >= v_promo.usage_limit then
          v_promo_message := 'This promo has been fully redeemed.';
        end if;
      end if;
      if v_promo_message is null then
        select count(*) into v_used from public.promotion_redemptions where promotion_id = v_promo.id and user_id = p_user;
        if v_used >= v_promo.per_user_limit then
          v_promo_message := 'You have already used this promo code.';
        end if;
      end if;
    end if;

    if v_promo_message is null then
      -- Discounts come out of GETGO's fees; the rider still pays the store's
      -- full listed prices.
      v_discount := case v_promo.discount_type
        when 'percent' then (v_subtotal * v_promo.value) / 10000
        when 'fixed' then v_promo.value
        else v_delivery
      end;
      if v_promo.max_discount_minor is not null then
        v_discount := least(v_discount, v_promo.max_discount_minor);
      end if;
      v_discount := least(v_discount, v_delivery + v_service + v_small);
      v_promo_result := jsonb_build_object('code', v_code, 'applied', true, 'promotion_id', v_promo.id,
        'title', v_promo.title, 'message', null);
    else
      v_promo_result := jsonb_build_object('code', v_code, 'applied', false, 'message', v_promo_message);
    end if;
  end if;

  return jsonb_build_object(
    'merchant', jsonb_build_object(
      'id', v_merchant.id, 'name', v_merchant.name, 'slug', v_merchant.slug, 'state', v_state,
      'min_order_minor', v_merchant.min_order_minor,
      'service_area_id', v_merchant.service_area_id, 'service_area_name', v_area.name
    ),
    'address_id', p_address_id,
    'items', v_items,
    'subtotal_minor', v_subtotal,
    'delivery_fee_minor', v_delivery,
    'service_fee_minor', v_service,
    'small_order_fee_minor', v_small,
    'discount_minor', v_discount,
    'total_minor', v_subtotal + v_delivery + v_service + v_small - v_discount,
    'currency', 'PHP',
    'promo', v_promo_result,
    'issues', v_issues,
    'can_checkout', jsonb_array_length(v_issues) = 0
  );
end $$;

-- Storefronts also report the lowest delivery fee in their area so listings
-- can say "from ₱X" when prices vary by barangay.
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
  coalesce(bf.varies, false) as delivery_fee_varies
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

revoke execute on function public.compute_checkout(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.set_barangay_fees(uuid, jsonb) from public, anon;
grant execute on function public.set_barangay_fees(uuid, jsonb) to authenticated;
grant execute on function public.delivery_fee_for(uuid, text, text) to anon, authenticated;
