-- Delivery priced by distance (km), as an option per area.
--
-- Stores, saved addresses and padala/errand stops can carry a map pin. When an
-- area's delivery_pricing is 'distance' and both ends of the trip are pinned,
-- the delivery fee is
--     base fee (covers the first km_base_km)
--   + km_rate per km after that
-- rounded up to the next ₱5, and capped at km_max_fee when one is set.
--
-- The distance is measured along real roads: the app asks OpenStreetMap
-- routing (OSRM) for the route between the pins and saves it with
-- save_route_km. The server trusts a measured distance only between the
-- straight-line distance and twice it, so a tampered number can't make a trip
-- cheaper than a straight line. Until a route is measured, the distance is the
-- straight line times 1.3, a typical road-to-straight-line ratio in town.
-- Trips without both pins (or over 60 km, a wrong pin) use the barangay price
-- as before, so nothing breaks while people add pins.
--
-- Defaults, fair for customers and riders in a town like Bongabong:
--   ₱40 for the first 2 km, then ₱10 per km. 1 km ₱40 · 3 km ₱50 ·
--   5 km ₱70 · 10 km ₱120. A motorcycle uses about ₱1.50 of fuel per km and
--   rides back empty, so ₱10/km covers fuel, wear and time with a fair margin;
--   the base covers buying and waiting at the counter.

alter table public.service_areas
  add column delivery_pricing text not null default 'barangay' check (delivery_pricing in ('barangay', 'distance')),
  add column km_base_fee_minor bigint not null default 4000 check (km_base_fee_minor >= 0),
  add column km_base_km numeric(4,1) not null default 2 check (km_base_km between 0 and 50),
  add column km_rate_minor bigint not null default 1000 check (km_rate_minor >= 0),
  add column km_max_fee_minor bigint check (km_max_fee_minor is null or km_max_fee_minor > 0),
  -- Where the map starts when pinning a location in this area.
  add column center_lat double precision check (center_lat between -90 and 90),
  add column center_lng double precision check (center_lng between -180 and 180);

-- Bongabong, Oriental Mindoro (town proper). Admins can move it.
update public.service_areas set center_lat = 12.75, center_lng = 121.4833
where center_lat is null and city ilike '%bongabong%';

alter table public.merchants
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint merchants_pin_pair check ((lat is null) = (lng is null));
grant update (lat, lng) on public.merchants to authenticated;

alter table public.addresses
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint addresses_pin_pair check ((lat is null) = (lng is null));
grant update (lat, lng) on public.addresses to authenticated;

-- The trip's estimated road distance, for riders and receipts.
alter table public.orders add column distance_km numeric(6,1);

-- Straight-line (great-circle) distance in km.
create or replace function public.straight_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select (2 * 6371 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)
  )))::numeric;
$$;

-- Road distances measured along real roads, per pair of pins (to ~1 m).
create table public.route_distances (
  from_lat numeric(8,5) not null,
  from_lng numeric(8,5) not null,
  to_lat numeric(8,5) not null,
  to_lng numeric(8,5) not null,
  road_km numeric(7,2) not null check (road_km >= 0),
  updated_at timestamptz not null default now(),
  primary key (from_lat, from_lng, to_lat, to_lng)
);
alter table public.route_distances enable row level security;
revoke all on public.route_distances from anon, authenticated;

create or replace function public.measured_road_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select road_km from public.route_distances
  where from_lat = round(a_lat::numeric, 5) and from_lng = round(a_lng::numeric, 5)
    and to_lat = round(b_lat::numeric, 5) and to_lng = round(b_lng::numeric, 5);
$$;

-- Road distance in km, rounded up to 0.1 km: measured when known, otherwise
-- the straight line × 1.3.
create or replace function public.road_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select ceil(coalesce(
    public.measured_road_km(a_lat, a_lng, b_lat, b_lng),
    public.straight_km(a_lat, a_lng, b_lat, b_lng) * 1.3
  ) * 10) / 10;
$$;

-- The app saves the road distance it got from routing. Kept between the
-- straight line and twice it. Returns the distance kept.
create or replace function public.save_route_km(
  p_from_lat double precision, p_from_lng double precision, p_to_lat double precision, p_to_lng double precision, p_road_km numeric
)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_straight numeric;
  v_km numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  if p_from_lat not between -90 and 90 or p_to_lat not between -90 and 90
     or p_from_lng not between -180 and 180 or p_to_lng not between -180 and 180 or p_road_km is null or p_road_km < 0 then
    raise exception 'Invalid route.' using errcode = 'P0001', hint = 'invalid_route';
  end if;
  v_straight := public.straight_km(p_from_lat, p_from_lng, p_to_lat, p_to_lng);
  if v_straight > 60 then
    raise exception 'Those places are too far apart.' using errcode = 'P0001', hint = 'invalid_route';
  end if;
  v_km := round(least(greatest(p_road_km, v_straight), v_straight * 2), 2);
  insert into public.route_distances (from_lat, from_lng, to_lat, to_lng, road_km)
  values (round(p_from_lat::numeric, 5), round(p_from_lng::numeric, 5), round(p_to_lat::numeric, 5), round(p_to_lng::numeric, 5), v_km)
  on conflict (from_lat, from_lng, to_lat, to_lng) do update set road_km = excluded.road_km, updated_at = now();
  return v_km;
end $$;

-- The area's price for a trip of p_km.
create or replace function public.km_fee(p_area public.service_areas, p_km numeric)
returns bigint language sql immutable as $$
  select case when p_area.km_max_fee_minor is null then f else least(f, p_area.km_max_fee_minor) end
  from (
    select (ceil((p_area.km_base_fee_minor + greatest(0, p_km - p_area.km_base_km) * p_area.km_rate_minor) / 500.0) * 500)::bigint as f
  ) x;
$$;

-- Delivery fee for a trip from p_from to p_to ({lat, lng}, either may be null).
-- Returns { fee_minor, distance_km, basis: 'distance' | 'barangay' }.
create or replace function public.trip_fee(p_area public.service_areas, p_from jsonb, p_to jsonb, p_fallback_minor bigint)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_km numeric;
  v_by_road boolean := false;
begin
  if (p_from ->> 'lat') is not null and (p_from ->> 'lng') is not null
     and (p_to ->> 'lat') is not null and (p_to ->> 'lng') is not null then
    v_km := public.road_km((p_from ->> 'lat')::float8, (p_from ->> 'lng')::float8, (p_to ->> 'lat')::float8, (p_to ->> 'lng')::float8);
    v_by_road := public.measured_road_km((p_from ->> 'lat')::float8, (p_from ->> 'lng')::float8, (p_to ->> 'lat')::float8, (p_to ->> 'lng')::float8) is not null;
    if v_km > 60 then
      v_km := null; -- a pin in the wrong place; don't price by it
    end if;
  end if;
  if p_area.delivery_pricing = 'distance' and v_km is not null then
    return jsonb_build_object('fee_minor', public.km_fee(p_area, v_km), 'distance_km', v_km, 'basis', 'distance', 'by_road', v_by_road);
  end if;
  return jsonb_build_object('fee_minor', p_fallback_minor, 'distance_km', v_km, 'basis', 'barangay', 'by_road', v_by_road);
end $$;

-- Pricing and placement, now distance-aware ----------------------------------
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
  v_trip jsonb;
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

  -- Delivery: by distance from the store to the pinned address when the area
  -- prices by km and both are pinned; otherwise the barangay price.
  v_trip := public.trip_fee(v_area,
    jsonb_build_object('lat', v_merchant.lat, 'lng', v_merchant.lng),
    jsonb_build_object('lat', v_address.lat, 'lng', v_address.lng),
    case when v_address.id is not null
      then public.delivery_fee_for(v_area.id, v_address.barangay_code, v_address.barangay)
      else v_area.delivery_fee_minor end);
  v_delivery := (v_trip ->> 'fee_minor')::bigint;
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
    'distance_km', v_trip -> 'distance_km',
    'delivery_basis', v_trip ->> 'basis',
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

create or replace function public.place_order(
  p_merchant_id uuid,
  p_address_id uuid,
  p_notes text,
  p_promo_code text,
  p_expected_total_minor bigint,
  p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_cart_id uuid;
  v_quote jsonb;
  v_message text;
  v_hint text;
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_merchant public.merchants%rowtype;
  v_address public.addresses%rowtype;
  v_code text;
begin
  if v_user is null then
    raise exception 'Sign in to place an order.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'invalid_request';
  end if;

  -- Serialize concurrent submissions for the same cart.
  select id into v_cart_id from public.carts where user_id = v_user and merchant_id = p_merchant_id for update;

  select id into v_existing from public.orders where customer_id = v_user and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_cart_id is null then
    raise exception 'Your cart is empty.' using errcode = 'P0001', hint = 'cart_empty';
  end if;

  if nullif(trim(p_promo_code), '') is not null then
    perform 1 from public.promotions where code = upper(trim(p_promo_code)) for update;
  end if;

  v_quote := public.compute_checkout(v_user, p_merchant_id, p_address_id, p_promo_code);

  if not (v_quote ->> 'can_checkout')::boolean then
    select i ->> 'error_message' into v_message
    from jsonb_array_elements(v_quote -> 'items') i where i ->> 'error_message' is not null limit 1;
    v_hint := v_quote -> 'issues' -> 0 ->> 'code';
    if v_hint <> 'item_problems' or v_message is null then
      v_message := v_quote -> 'issues' -> 0 ->> 'message';
    end if;
    raise exception '%', v_message using errcode = 'P0001', hint = v_hint;
  end if;

  if p_expected_total_minor is distinct from (v_quote ->> 'total_minor')::bigint then
    raise exception 'Prices or fees have changed. Review your order before placing it.'
      using errcode = 'P0001', hint = 'total_changed';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id;
  select * into v_address from public.addresses where id = p_address_id and user_id = v_user;

  loop
    v_code := public.gen_order_code();
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (
    code, customer_id, merchant_id, service_area_id, merchant_name, pickup_address,
    customer_name, customer_phone, delivery_address, notes,
    subtotal_minor, delivery_fee_minor, service_fee_minor, small_order_fee_minor, discount_minor, total_minor,
    promotion_id, idempotency_key, distance_km
  ) values (
    v_code, v_user, p_merchant_id, v_merchant.service_area_id, v_merchant.name,
    jsonb_build_object('line1', v_merchant.address_line, 'barangay', v_merchant.barangay, 'city', v_merchant.city, 'phone', v_merchant.phone,
      'lat', v_merchant.lat, 'lng', v_merchant.lng),
    v_address.recipient_name, v_address.phone,
    jsonb_build_object(
      'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'line1', v_address.line1, 'barangay', v_address.barangay, 'city', v_address.city, 'landmark', v_address.landmark,
      'lat', v_address.lat, 'lng', v_address.lng),
    nullif(trim(p_notes), ''),
    (v_quote ->> 'subtotal_minor')::bigint, (v_quote ->> 'delivery_fee_minor')::bigint,
    (v_quote ->> 'service_fee_minor')::bigint, (v_quote ->> 'small_order_fee_minor')::bigint,
    (v_quote ->> 'discount_minor')::bigint, (v_quote ->> 'total_minor')::bigint,
    case when (v_quote -> 'promo' ->> 'applied')::boolean then (v_quote -> 'promo' ->> 'promotion_id')::uuid end,
    p_idempotency_key, (v_quote ->> 'distance_km')::numeric
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(v_quote -> 'items') loop
    insert into public.order_items (order_id, product_id, variant_id, product_name, variant_name,
      unit_price_minor, quantity, line_total_minor, instructions)
    values (v_order_id, (v_item ->> 'product_id')::uuid, (v_item ->> 'variant_id')::uuid,
      v_item ->> 'product_name', v_item ->> 'variant_name', (v_item ->> 'unit_price_minor')::bigint,
      (v_item ->> 'quantity')::int, (v_item ->> 'line_total_minor')::bigint, v_item ->> 'instructions')
    returning id into v_item_id;

    insert into public.order_item_options (order_item_id, option_value_id, group_name, option_name, price_delta_minor, quantity)
    select v_item_id, (o ->> 'option_value_id')::uuid, o ->> 'group_name', o ->> 'option_name',
      (o ->> 'price_delta_minor')::bigint, (o ->> 'quantity')::int
    from jsonb_array_elements(v_item -> 'options') o;
  end loop;

  if (v_quote -> 'promo' ->> 'applied')::boolean then
    insert into public.promotion_redemptions (promotion_id, order_id, user_id, discount_minor)
    values ((v_quote -> 'promo' ->> 'promotion_id')::uuid, v_order_id, v_user, (v_quote ->> 'discount_minor')::bigint);
  end if;

  insert into public.payments (order_id, amount_minor) values (v_order_id, (v_quote ->> 'total_minor')::bigint);

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind)
  values (v_order_id, null, 'pending', v_user, 'customer');

  perform public.notify_area_riders(v_merchant.service_area_id, format('New order %s', v_code),
    format('Buy from %s · %s to collect', v_merchant.name, public.format_php((v_quote ->> 'total_minor')::bigint)),
    '/rider');

  delete from public.carts where id = v_cart_id;
  return v_order_id;
exception
  when unique_violation then
    select id into v_existing from public.orders where customer_id = v_user and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return v_existing;
    end if;
    raise;
end $$;

create or replace function public.clean_service_place(
  p_area public.service_areas, p_place jsonb, p_label text, p_phone_required boolean
)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_name text := trim(coalesce(p_place ->> 'name', ''));
  v_phone text := regexp_replace(trim(coalesce(p_place ->> 'phone', '')), '[\s-]', '', 'g');
  v_line1 text := trim(coalesce(p_place ->> 'line1', ''));
  v_barangay text := trim(coalesce(p_place ->> 'barangay', ''));
  v_code text := nullif(trim(coalesce(p_place ->> 'barangay_code', '')), '');
  v_landmark text := nullif(trim(coalesce(p_place ->> 'landmark', '')), '');
  v_lat double precision;
  v_lng double precision;
begin
  if jsonb_typeof(p_place) is distinct from 'object' then
    raise exception 'Add the % details.', p_label using errcode = 'P0001', hint = 'invalid_place';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Enter a name for the %.', p_label using errcode = 'P0001', hint = 'invalid_place';
  end if;
  if (p_phone_required or v_phone <> '') and v_phone !~ '^(\+63|0)9[0-9]{9}$' then
    raise exception 'Enter a mobile number for the %, like 0917 123 4567.', p_label using errcode = 'P0001', hint = 'invalid_phone';
  end if;
  if char_length(v_line1) not between 3 and 200 then
    raise exception 'Enter the street, purok or building for the %.', p_label using errcode = 'P0001', hint = 'invalid_place';
  end if;
  if char_length(v_barangay) not between 2 and 80 then
    raise exception 'Choose the barangay for the %.', p_label using errcode = 'P0001', hint = 'invalid_place';
  end if;
  if char_length(coalesce(v_landmark, '')) > 200 then
    raise exception 'Keep the landmark under 200 characters.' using errcode = 'P0001', hint = 'invalid_place';
  end if;
  if v_code is not null and (
    v_code !~ '^[0-9]{9,10}$'
    -- A barangay's PSGC code shares its town's code except the last 3 digits.
    or (p_area.psgc_code is not null and (char_length(v_code) <> char_length(p_area.psgc_code)
        or left(v_code, char_length(v_code) - 3) <> left(p_area.psgc_code, char_length(p_area.psgc_code) - 3)))
  ) then
    raise exception 'The % must be in %.', p_label, p_area.city using errcode = 'P0001', hint = 'outside_area';
  end if;

  -- Optional map pin, used to price delivery by distance.
  if jsonb_typeof(p_place -> 'lat') = 'number' and jsonb_typeof(p_place -> 'lng') = 'number' then
    v_lat := (p_place ->> 'lat')::double precision;
    v_lng := (p_place ->> 'lng')::double precision;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'The map pin for the % isn’t valid. Pin it again.', p_label using errcode = 'P0001', hint = 'invalid_place';
    end if;
  end if;

  return jsonb_build_object(
    'name', v_name, 'phone', nullif(v_phone, ''), 'line1', v_line1, 'barangay', v_barangay,
    'barangay_code', v_code, 'city', p_area.city, 'landmark', v_landmark, 'lat', v_lat, 'lng', v_lng
  );
end $$;

create or replace function public.compute_service_request(
  p_service public.service_type, p_service_area_id uuid, p_pickup jsonb, p_dropoff jsonb, p_task jsonb
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_area public.service_areas%rowtype;
  v_pickup jsonb;
  v_dropoff jsonb;
  v_task jsonb;
  v_title text;
  v_budget bigint := 0;
  v_type text;
  v_desc text;
  v_item text;
  v_size text;
  v_delivery bigint;
  v_service_fee bigint;
  v_trip jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  if p_service not in ('padala', 'errand') then
    raise exception 'Choose padala or errand.' using errcode = 'P0001', hint = 'invalid_service';
  end if;
  select * into v_area from public.service_areas where id = p_service_area_id and is_active;
  if not found then
    raise exception 'GETGO doesn’t operate in this area yet.' using errcode = 'P0001', hint = 'invalid_area';
  end if;
  if (p_service = 'padala' and not v_area.padala_enabled) or (p_service = 'errand' and not v_area.errands_enabled) then
    raise exception '% isn’t available in % yet.', case p_service when 'padala' then 'Padala' else 'Errands' end, v_area.name
      using errcode = 'P0001', hint = 'service_unavailable';
  end if;
  if jsonb_typeof(p_task) is distinct from 'object' then
    raise exception 'Tell us what the rider should do.' using errcode = 'P0001', hint = 'invalid_task';
  end if;

  if p_service = 'padala' then
    v_item := trim(coalesce(p_task ->> 'item', ''));
    v_size := coalesce(p_task ->> 'size', '');
    if char_length(v_item) not between 2 and 120 then
      raise exception 'Say what you’re sending, e.g. documents or a small box.' using errcode = 'P0001', hint = 'invalid_task';
    end if;
    if v_size not in ('small', 'medium', 'large') then
      raise exception 'Choose the parcel size.' using errcode = 'P0001', hint = 'invalid_task';
    end if;
    v_pickup := public.clean_service_place(v_area, p_pickup, 'pickup', true);
    v_dropoff := public.clean_service_place(v_area, p_dropoff, 'drop-off', true);
    v_task := jsonb_build_object('item', v_item, 'size', v_size);
    v_title := 'Padala · ' || v_item;
    v_service_fee := v_area.service_fee_minor + v_area.padala_fee_minor;
  else
    v_type := coalesce(p_task ->> 'type', '');
    v_desc := trim(coalesce(p_task ->> 'description', ''));
    if v_type not in ('buy', 'bill', 'pickup', 'other') then
      raise exception 'Choose the kind of errand.' using errcode = 'P0001', hint = 'invalid_task';
    end if;
    if char_length(v_desc) not between 5 and 1000 then
      raise exception 'Describe the errand so the rider knows exactly what to do.' using errcode = 'P0001', hint = 'invalid_task';
    end if;
    if coalesce(p_task ->> 'budget_minor', '0') !~ '^[0-9]{1,9}$' then
      raise exception 'Enter the budget in pesos.' using errcode = 'P0001', hint = 'invalid_budget';
    end if;
    v_budget := (coalesce(p_task ->> 'budget_minor', '0'))::bigint;
    if v_type in ('buy', 'bill') and v_budget <= 0 then
      raise exception 'Enter how much the rider may spend.' using errcode = 'P0001', hint = 'budget_required';
    end if;
    if v_budget > v_area.errand_max_budget_minor then
      raise exception 'Errand budgets in % are up to %.', v_area.name, public.format_php(v_area.errand_max_budget_minor)
        using errcode = 'P0001', hint = 'budget_too_large';
    end if;
    v_pickup := public.clean_service_place(v_area, p_pickup, 'errand place', false);
    v_dropoff := public.clean_service_place(v_area, p_dropoff, 'drop-off', true);
    v_task := jsonb_build_object('type', v_type, 'description', v_desc, 'budget_minor', v_budget);
    v_title := 'Errand · ' || case v_type
      when 'buy' then 'Buy something' when 'bill' then 'Pay a bill' when 'pickup' then 'Pick up something' else 'Other task' end;
    v_service_fee := v_area.service_fee_minor + v_area.errand_fee_minor;
  end if;

  -- By distance between the two pins when the area prices by km; otherwise
  -- the higher of the two barangay prices.
  v_trip := public.trip_fee(v_area, v_pickup, v_dropoff, greatest(
    public.delivery_fee_for(v_area.id, v_pickup ->> 'barangay_code', v_pickup ->> 'barangay'),
    public.delivery_fee_for(v_area.id, v_dropoff ->> 'barangay_code', v_dropoff ->> 'barangay')
  ));
  v_delivery := (v_trip ->> 'fee_minor')::bigint;

  return jsonb_build_object(
    'service', p_service, 'title', v_title, 'service_area_id', v_area.id,
    'pickup', v_pickup, 'dropoff', v_dropoff, 'task', v_task,
    'subtotal_minor', v_budget, 'delivery_fee_minor', v_delivery, 'service_fee_minor', v_service_fee,
    'total_minor', v_budget + v_delivery + v_service_fee,
    'distance_km', v_trip -> 'distance_km', 'delivery_basis', v_trip ->> 'basis'
  );
end $$;

create or replace function public.quote_service_request(
  p_service public.service_type, p_service_area_id uuid, p_pickup jsonb, p_dropoff jsonb, p_task jsonb
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'subtotal_minor', q -> 'subtotal_minor', 'delivery_fee_minor', q -> 'delivery_fee_minor',
    'service_fee_minor', q -> 'service_fee_minor', 'total_minor', q -> 'total_minor',
    'distance_km', q -> 'distance_km', 'delivery_basis', q -> 'delivery_basis')
  from public.compute_service_request(p_service, p_service_area_id, p_pickup, p_dropoff, p_task) q;
$$;

create or replace function public.place_service_request(
  p_service public.service_type,
  p_service_area_id uuid,
  p_pickup jsonb,
  p_dropoff jsonb,
  p_task jsonb,
  p_notes text,
  p_expected_total_minor bigint,
  p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_req jsonb;
  v_profile public.profiles%rowtype;
  v_code text;
  v_id uuid;
  v_dropoff jsonb;
begin
  if v_user is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'invalid_request';
  end if;
  -- Serialize this customer's submissions so retries and double taps are safe.
  perform pg_advisory_xact_lock(hashtext('service_request:' || v_user::text));

  select id into v_existing from public.orders where customer_id = v_user and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if char_length(coalesce(p_notes, '')) > 300 then
    raise exception 'Keep the note under 300 characters.' using errcode = 'P0001', hint = 'invalid_notes';
  end if;
  if (select count(*) from public.orders where customer_id = v_user and service <> 'pabili'
      and status in ('pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery')) >= 3 then
    raise exception 'You have 3 padala or errand requests in progress. Wait for one to finish first.'
      using errcode = 'P0001', hint = 'too_many_open';
  end if;

  v_req := public.compute_service_request(p_service, p_service_area_id, p_pickup, p_dropoff, p_task);
  if p_expected_total_minor is distinct from (v_req ->> 'total_minor')::bigint then
    raise exception 'The price changed. Check the new total before sending.' using errcode = 'P0001', hint = 'total_changed';
  end if;

  select * into v_profile from public.profiles where id = v_user;
  v_dropoff := v_req -> 'dropoff';

  loop
    v_code := public.gen_order_code();
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (
    code, customer_id, merchant_id, service, task, service_area_id, merchant_name, pickup_address,
    customer_name, customer_phone, delivery_address, notes,
    subtotal_minor, delivery_fee_minor, service_fee_minor, small_order_fee_minor, discount_minor, total_minor,
    idempotency_key, distance_km
  ) values (
    v_code, v_user, null, p_service, v_req -> 'task', p_service_area_id, v_req ->> 'title', v_req -> 'pickup',
    coalesce(nullif(trim(v_profile.full_name), ''), v_dropoff ->> 'name'),
    coalesce(nullif(trim(v_profile.phone), ''), v_dropoff ->> 'phone'),
    jsonb_build_object(
      'label', 'Drop-off', 'recipient_name', v_dropoff ->> 'name', 'phone', v_dropoff ->> 'phone',
      'line1', v_dropoff ->> 'line1', 'barangay', v_dropoff ->> 'barangay', 'barangay_code', v_dropoff ->> 'barangay_code',
      'city', v_dropoff ->> 'city', 'landmark', v_dropoff ->> 'landmark',
      'lat', v_dropoff -> 'lat', 'lng', v_dropoff -> 'lng'),
    nullif(trim(p_notes), ''),
    (v_req ->> 'subtotal_minor')::bigint, (v_req ->> 'delivery_fee_minor')::bigint, (v_req ->> 'service_fee_minor')::bigint,
    0, 0, (v_req ->> 'total_minor')::bigint,
    p_idempotency_key, (v_req ->> 'distance_km')::numeric
  ) returning id into v_id;

  insert into public.payments (order_id, amount_minor) values (v_id, (v_req ->> 'total_minor')::bigint);
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind)
  values (v_id, null, 'pending', v_user, 'customer');

  perform public.notify_area_riders(p_service_area_id,
    format('New %s %s', case p_service when 'padala' then 'padala' else 'errand' end, v_code),
    format('%s · Brgy. %s → Brgy. %s · %s to collect', v_req ->> 'title', v_req -> 'pickup' ->> 'barangay',
      v_dropoff ->> 'barangay', public.format_php((v_req ->> 'total_minor')::bigint)),
    '/rider/orders/' || v_id);
  return v_id;
end $$;

-- Listings say "from ₱X" with the km base fee in distance-priced areas, and carry the store pin.
create or replace view public.storefronts with (security_barrier = true) as
select
  m.id, m.slug, m.name, m.category, m.description, m.logo_path, m.cover_path,
  m.address_line, m.barangay, m.city, m.service_area_id, sa.name as service_area_name,
  m.min_order_minor, sa.delivery_fee_minor, sa.service_fee_minor, sa.typical_delivery_minutes, m.currency,
  public.store_state(m.id) as state,
  public.next_open_at(m.id) as next_open_at,
  r.rating_avg, coalesce(r.rating_count, 0) as rating_count,
  m.created_at,
  case when sa.delivery_pricing = 'distance' then sa.km_base_fee_minor
    else least(sa.delivery_fee_minor, coalesce(bf.min_fee, sa.delivery_fee_minor)) end as delivery_fee_from_minor,
  sa.delivery_pricing = 'distance' or coalesce(bf.varies, false) as delivery_fee_varies,
  exists (select 1 from public.merchant_members mm where mm.merchant_id = m.id) as is_partner,
  m.lat, m.lng
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

revoke execute on function public.trip_fee(public.service_areas, jsonb, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.road_km(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.straight_km(double precision, double precision, double precision, double precision) to anon, authenticated;
revoke execute on function public.measured_road_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.save_route_km(double precision, double precision, double precision, double precision, numeric) from public, anon;
grant execute on function public.save_route_km(double precision, double precision, double precision, double precision, numeric) to authenticated;
grant execute on function public.km_fee(public.service_areas, numeric) to anon, authenticated;
