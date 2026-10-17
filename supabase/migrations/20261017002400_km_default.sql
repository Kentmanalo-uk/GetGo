-- Delivery is priced by distance (km) by default.
--
-- Every area now prices delivery per km unless an admin picks per-barangay
-- prices (still available in Admin → Areas & fees → Delivery pricing).
--   * Food and shop orders: when the store is pinned, the customer's address
--     must be pinned too (checkout asks for it).
--   * Padala: both stops are pinned. Errands: the drop-off is pinned; the
--     errand place may stay unpinned ("any pharmacy").
--   * A trip that can't be measured (an unpinned store or errand place) pays
--     the barangay price, but never less than the km base fee.

alter table public.service_areas alter column delivery_pricing set default 'distance';
update public.service_areas set delivery_pricing = 'distance' where delivery_pricing = 'barangay';

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
  -- Without both pins: the barangay price, but in km-priced areas never less
  -- than the km base fee, so skipping the pin is never the cheaper choice.
  return jsonb_build_object(
    'fee_minor', case when p_area.delivery_pricing = 'distance' then greatest(p_fallback_minor, p_area.km_base_fee_minor) else p_fallback_minor end,
    'distance_km', v_km, 'basis', 'barangay', 'by_road', v_by_road);
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
  if v_area.delivery_pricing = 'distance' and v_merchant.lat is not null and v_address.id is not null and v_address.lat is null then
    v_issues := v_issues || jsonb_build_object('code', 'pin_required',
      'message', 'Pin your address on the map. Delivery here is priced by distance.');
  end if;
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

  if v_area.delivery_pricing = 'distance' then
    if p_service = 'padala' and (v_pickup ->> 'lat') is null then
      raise exception 'Pin the pickup on the map. Delivery here is priced by distance.' using errcode = 'P0001', hint = 'pin_required';
    end if;
    if (v_dropoff ->> 'lat') is null then
      raise exception 'Pin the drop-off on the map. Delivery here is priced by distance.' using errcode = 'P0001', hint = 'pin_required';
    end if;
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
