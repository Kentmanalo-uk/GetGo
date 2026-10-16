-- Trusted cart, checkout, order lifecycle, payment, refund and settlement
-- workflows. Every function re-checks the caller's permissions; clients have no
-- direct write access to the tables these functions maintain.
--
-- Errors raised for customers use errcode P0001 with a machine-readable code in
-- HINT and a customer-facing MESSAGE.

create or replace function public.format_php(p_minor bigint)
returns text language sql immutable as $$
  select '₱' || to_char(p_minor / 100.0, 'FM999,999,990.00');
$$;

create or replace function public.gen_order_code()
returns text language plpgsql volatile as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text := '';
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return 'GG-' || v_code;
end $$;

-- Canonical fingerprint of an option selection, independent of order.
create or replace function public.options_key(p_options jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select coalesce(string_agg(s.option_value_id::text || ':' || s.quantity, ',' order by s.option_value_id), '')
  from public.parse_option_selection(p_options) s;
$$;

create or replace function public.notify_merchant(p_merchant_id uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select user_id, p_kind, p_title, p_body, p_link from public.merchant_members where merchant_id = p_merchant_id;
$$;

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------
create or replace function public.assert_configuration(p_product_id uuid, p_variant_id uuid, p_options jsonb, p_quantity int)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_result record;
begin
  select * into v_result from public.price_configuration(p_product_id, p_variant_id, p_options, p_quantity);
  if v_result.error_code is not null then
    raise exception '%', v_result.error_message using errcode = 'P0001', hint = v_result.error_code;
  end if;
  return v_result.unit_price_minor;
end $$;

create or replace function public.cart_add_item(
  p_product_id uuid, p_variant_id uuid, p_options jsonb, p_quantity int, p_instructions text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_merchant_id uuid;
  v_cart_id uuid;
  v_item public.cart_items%rowtype;
  v_key text;
  v_unit bigint;
  v_instructions text := nullif(trim(p_instructions), '');
begin
  if v_user is null then
    raise exception 'Sign in to add items to your cart.' using errcode = '42501';
  end if;
  v_unit := public.assert_configuration(p_product_id, p_variant_id, p_options, p_quantity);
  v_key := public.options_key(p_options);
  select merchant_id into v_merchant_id from public.products where id = p_product_id;

  insert into public.carts (user_id, merchant_id) values (v_user, v_merchant_id)
  on conflict (user_id, merchant_id) do update set updated_at = now()
  returning id into v_cart_id;

  -- Merge with an identical configuration already in the cart.
  select * into v_item from public.cart_items
  where cart_id = v_cart_id and product_id = p_product_id
    and variant_id is not distinct from p_variant_id
    and options_key = v_key
    and instructions is not distinct from v_instructions
  for update;

  if found then
    perform public.assert_configuration(p_product_id, p_variant_id, p_options, v_item.quantity + p_quantity);
    update public.cart_items
    set quantity = v_item.quantity + p_quantity, unit_price_snapshot_minor = v_unit
    where id = v_item.id;
    return v_item.id;
  end if;

  insert into public.cart_items (cart_id, product_id, variant_id, quantity, instructions, options_key, unit_price_snapshot_minor)
  values (v_cart_id, p_product_id, p_variant_id, p_quantity, v_instructions, v_key, v_unit)
  returning id into v_item.id;

  insert into public.cart_item_options (cart_item_id, option_value_id, quantity)
  select v_item.id, s.option_value_id, s.quantity from public.parse_option_selection(p_options) s;

  return v_item.id;
end $$;

-- Replace the configuration of an existing cart line (edit from the cart).
create or replace function public.cart_update_item(
  p_cart_item_id uuid, p_variant_id uuid, p_options jsonb, p_quantity int, p_instructions text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.cart_items%rowtype;
  v_unit bigint;
begin
  select ci.* into v_item from public.cart_items ci
  join public.carts c on c.id = ci.cart_id
  where ci.id = p_cart_item_id and c.user_id = auth.uid()
  for update of ci;
  if not found then
    raise exception 'This cart item no longer exists.' using errcode = 'P0001', hint = 'cart_item_missing';
  end if;

  v_unit := public.assert_configuration(v_item.product_id, p_variant_id, p_options, p_quantity);

  update public.cart_items
  set variant_id = p_variant_id, quantity = p_quantity, instructions = nullif(trim(p_instructions), ''),
      options_key = public.options_key(p_options), unit_price_snapshot_minor = v_unit
  where id = v_item.id;

  delete from public.cart_item_options where cart_item_id = v_item.id;
  insert into public.cart_item_options (cart_item_id, option_value_id, quantity)
  select v_item.id, s.option_value_id, s.quantity from public.parse_option_selection(p_options) s;

  update public.carts set updated_at = now() where id = v_item.cart_id;
  return v_item.id;
end $$;

-- Change quantity; 0 removes the line. Limits are re-checked against the
-- product's current configuration rules.
create or replace function public.cart_set_quantity(p_cart_item_id uuid, p_quantity int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.cart_items%rowtype;
  v_max int;
begin
  select ci.* into v_item from public.cart_items ci
  join public.carts c on c.id = ci.cart_id
  where ci.id = p_cart_item_id and c.user_id = auth.uid()
  for update of ci;
  if not found then
    raise exception 'This cart item no longer exists.' using errcode = 'P0001', hint = 'cart_item_missing';
  end if;

  if p_quantity <= 0 then
    delete from public.cart_items where id = v_item.id;
    delete from public.carts c where c.id = v_item.cart_id
      and not exists (select 1 from public.cart_items where cart_id = c.id);
    return;
  end if;

  select max_per_order into v_max from public.products where id = v_item.product_id;
  if p_quantity > least(coalesce(v_max, 99), 99) then
    raise exception 'You can order up to % of this item.', coalesce(v_max, 99)
      using errcode = 'P0001', hint = 'invalid_quantity';
  end if;
  update public.cart_items set quantity = p_quantity where id = v_item.id;
  update public.carts set updated_at = now() where id = v_item.cart_id;
end $$;

create or replace function public.cart_clear(p_merchant_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.carts where user_id = auth.uid() and merchant_id = p_merchant_id;
$$;

-- ---------------------------------------------------------------------------
-- Checkout computation (single source of truth for quote and order creation)
-- ---------------------------------------------------------------------------
create or replace function public.compute_checkout(
  p_user uuid, p_merchant_id uuid, p_fulfillment public.fulfillment_type, p_address_id uuid, p_promo_code text
)
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
  v_merchant_discount bigint := 0;
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
    v_issues := v_issues || jsonb_build_object('code', 'store_unavailable', 'message', 'This store is not taking orders on GETGO right now.');
  elsif v_state = 'paused' then
    v_issues := v_issues || jsonb_build_object('code', 'store_paused', 'message', 'This store has paused new orders. Please try again later.');
  elsif v_state = 'closed' then
    v_issues := v_issues || jsonb_build_object('code', 'store_closed', 'message', 'This store is closed right now.');
  end if;

  if p_fulfillment = 'delivery' then
    if not v_merchant.supports_delivery then
      v_issues := v_issues || jsonb_build_object('code', 'delivery_unavailable', 'message', 'This store offers pickup only.');
    elsif p_address_id is null then
      v_issues := v_issues || jsonb_build_object('code', 'address_required', 'message', 'Choose a delivery address.');
    else
      select * into v_address from public.addresses where id = p_address_id and user_id = p_user;
      if not found then
        v_issues := v_issues || jsonb_build_object('code', 'address_invalid', 'message', 'Choose a delivery address.');
      elsif v_address.service_area_id <> v_merchant.service_area_id then
        v_issues := v_issues || jsonb_build_object('code', 'outside_area',
          'message', format('%s delivers within %s only.', v_merchant.name, v_area.name));
      end if;
    end if;
  elsif not v_merchant.supports_pickup then
    v_issues := v_issues || jsonb_build_object('code', 'pickup_unavailable', 'message', 'This store offers delivery only.');
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

  if p_fulfillment = 'delivery' then
    v_delivery := v_area.delivery_fee_minor;
  end if;
  v_service := v_area.service_fee_minor;
  if v_area.small_order_threshold_minor is not null and v_subtotal > 0 and v_subtotal < v_area.small_order_threshold_minor then
    v_small := v_area.small_order_fee_minor;
  end if;

  -- Promotion
  if v_code is not null then
    select * into v_promo from public.promotions where code = v_code;
    if not found or not v_promo.is_active or v_promo.starts_at > now()
       or (v_promo.ends_at is not null and v_promo.ends_at <= now()) then
      v_promo_message := 'This promo code is not valid.';
    elsif v_promo.merchant_id is not null and v_promo.merchant_id <> p_merchant_id then
      v_promo_message := 'This promo code does not apply to this store.';
    elsif v_subtotal < v_promo.min_subtotal_minor then
      v_promo_message := format('Spend at least %s to use this code.', public.format_php(v_promo.min_subtotal_minor));
    elsif v_promo.discount_type = 'free_delivery' and p_fulfillment <> 'delivery' then
      v_promo_message := 'This code applies to delivery orders only.';
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
      v_discount := case v_promo.discount_type
        when 'percent' then (v_subtotal * v_promo.value) / 10000
        when 'fixed' then least(v_promo.value, v_subtotal)
        else v_delivery
      end;
      if v_promo.max_discount_minor is not null then
        v_discount := least(v_discount, v_promo.max_discount_minor);
      end if;
      if v_promo.funded_by = 'merchant' then
        v_merchant_discount := v_discount;
      end if;
      v_promo_result := jsonb_build_object('code', v_code, 'applied', true, 'promotion_id', v_promo.id,
        'title', v_promo.title, 'message', null);
    else
      v_promo_result := jsonb_build_object('code', v_code, 'applied', false, 'message', v_promo_message);
    end if;
  end if;

  return jsonb_build_object(
    'merchant', jsonb_build_object(
      'id', v_merchant.id, 'name', v_merchant.name, 'slug', v_merchant.slug, 'state', v_state,
      'supports_delivery', v_merchant.supports_delivery, 'supports_pickup', v_merchant.supports_pickup,
      'min_order_minor', v_merchant.min_order_minor, 'prep_time_minutes', v_merchant.prep_time_minutes,
      'service_area_id', v_merchant.service_area_id, 'service_area_name', v_area.name
    ),
    'fulfillment', p_fulfillment,
    'address_id', p_address_id,
    'items', v_items,
    'subtotal_minor', v_subtotal,
    'delivery_fee_minor', v_delivery,
    'service_fee_minor', v_service,
    'small_order_fee_minor', v_small,
    'discount_minor', v_discount,
    'merchant_discount_minor', v_merchant_discount,
    'tax_minor', 0,
    'total_minor', v_subtotal + v_delivery + v_service + v_small - v_discount,
    'currency', 'PHP',
    'promo', v_promo_result,
    'issues', v_issues,
    'can_checkout', jsonb_array_length(v_issues) = 0
  );
end $$;

create or replace function public.quote_checkout(
  p_merchant_id uuid, p_fulfillment public.fulfillment_type, p_address_id uuid default null, p_promo_code text default null
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to check out.' using errcode = '42501';
  end if;
  return public.compute_checkout(auth.uid(), p_merchant_id, p_fulfillment, p_address_id, p_promo_code)
    || jsonb_build_object('online_payments_enabled', (select online_payments_enabled from public.platform_settings));
end $$;

-- ---------------------------------------------------------------------------
-- Order placement
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_merchant_id uuid,
  p_fulfillment public.fulfillment_type,
  p_address_id uuid,
  p_payment_method public.payment_method,
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
  v_profile public.profiles%rowtype;
  v_settings public.platform_settings%rowtype;
  v_status public.order_status;
  v_code text;
  v_name text;
  v_phone text;
  v_delivery_address jsonb;
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

  select * into v_settings from public.platform_settings;
  if p_payment_method = 'online' and not v_settings.online_payments_enabled then
    raise exception 'Online payment is not available yet. Choose cash payment instead.'
      using errcode = 'P0001', hint = 'payment_unavailable';
  end if;

  if nullif(trim(p_promo_code), '') is not null then
    perform 1 from public.promotions where code = upper(trim(p_promo_code)) for update;
  end if;

  v_quote := public.compute_checkout(v_user, p_merchant_id, p_fulfillment, p_address_id, p_promo_code);

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

  if p_fulfillment = 'delivery' then
    select * into v_address from public.addresses where id = p_address_id and user_id = v_user;
    v_name := v_address.recipient_name;
    v_phone := v_address.phone;
    v_delivery_address := jsonb_build_object(
      'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'line1', v_address.line1, 'barangay', v_address.barangay, 'city', v_address.city,
      'landmark', v_address.landmark);
  else
    select * into v_profile from public.profiles where id = v_user;
    if v_profile.phone is null then
      raise exception 'Add a mobile number to your profile so the store can reach you.'
        using errcode = 'P0001', hint = 'phone_required';
    end if;
    v_name := coalesce(v_profile.full_name, v_profile.email, 'Customer');
    v_phone := v_profile.phone;
  end if;

  v_status := case when p_payment_method = 'online' then 'awaiting_payment' else 'pending' end;
  loop
    v_code := public.gen_order_code();
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (
    code, customer_id, merchant_id, status, fulfillment, payment_method, payment_status, service_area_id,
    merchant_name, pickup_address, customer_name, customer_phone, delivery_address, notes,
    subtotal_minor, delivery_fee_minor, service_fee_minor, small_order_fee_minor, discount_minor, tax_minor, total_minor,
    promotion_id, merchant_discount_minor, commission_bps, idempotency_key
  ) values (
    v_code, v_user, p_merchant_id, v_status, p_fulfillment, p_payment_method, 'pending', v_merchant.service_area_id,
    v_merchant.name,
    jsonb_build_object('line1', v_merchant.address_line, 'barangay', v_merchant.barangay, 'city', v_merchant.city, 'phone', v_merchant.phone),
    v_name, v_phone, v_delivery_address, nullif(trim(p_notes), ''),
    (v_quote ->> 'subtotal_minor')::bigint, (v_quote ->> 'delivery_fee_minor')::bigint,
    (v_quote ->> 'service_fee_minor')::bigint, (v_quote ->> 'small_order_fee_minor')::bigint,
    (v_quote ->> 'discount_minor')::bigint, (v_quote ->> 'tax_minor')::bigint, (v_quote ->> 'total_minor')::bigint,
    case when (v_quote -> 'promo' ->> 'applied')::boolean then (v_quote -> 'promo' ->> 'promotion_id')::uuid end,
    (v_quote ->> 'merchant_discount_minor')::bigint, v_merchant.commission_bps, p_idempotency_key
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

  insert into public.payments (order_id, provider, method, status, amount_minor, expires_at)
  values (v_order_id, case when p_payment_method = 'cod' then 'cod' else 'paymongo' end, p_payment_method,
    'pending', (v_quote ->> 'total_minor')::bigint,
    case when p_payment_method = 'online' then now() + make_interval(mins => v_settings.payment_expiry_minutes) end);

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind)
  values (v_order_id, null, v_status, v_user, 'customer');

  if v_status = 'pending' then
    perform public.notify_merchant(p_merchant_id, 'order.new', format('New order %s', v_code),
      format('%s · %s', public.format_php((v_quote ->> 'subtotal_minor')::bigint), initcap(p_fulfillment::text)),
      '/merchant/orders/' || v_order_id);
  end if;

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

-- ---------------------------------------------------------------------------
-- Order lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.order_transition_allowed(
  p_from public.order_status, p_to public.order_status, p_fulfillment public.fulfillment_type
)
returns boolean language sql immutable as $$
  select case p_from
    when 'awaiting_payment' then p_to = 'cancelled'
    when 'pending' then p_to in ('accepted', 'rejected', 'cancelled')
    when 'accepted' then p_to in ('preparing', 'cancelled')
    when 'preparing' then p_to in ('ready', 'cancelled')
    when 'ready' then p_to = 'cancelled'
      or (p_to = 'out_for_delivery' and p_fulfillment = 'delivery')
      or (p_to = 'completed' and p_fulfillment = 'pickup')
    when 'out_for_delivery' then p_to in ('completed', 'cancelled')
    else false
  end;
$$;

-- Side effects shared by every path that ends an order unsuccessfully.
create or replace function public.close_order_unsuccessfully(p_order_id uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.payments%rowtype;
begin
  delete from public.promotion_redemptions where order_id = p_order_id;
  update public.assignments set status = 'released', completed_at = now()
  where order_id = p_order_id and status = 'active';
  update public.payments set status = 'cancelled' where order_id = p_order_id and status = 'pending';

  for v_payment in select * from public.payments where order_id = p_order_id and status = 'paid' loop
    if v_payment.amount_minor - v_payment.refunded_minor > 0 then
      insert into public.refunds (order_id, payment_id, amount_minor, reason, requested_by)
      values (p_order_id, v_payment.id, v_payment.amount_minor - v_payment.refunded_minor,
        coalesce('Order cancelled: ' || p_reason, 'Order cancelled'), p_actor);
    end if;
  end loop;

  update public.orders set payment_status = 'cancelled'
  where id = p_order_id and payment_status in ('pending', 'failed');
end $$;

create or replace function public.update_order_status(
  p_order_id uuid, p_status public.order_status, p_note text default null, p_prep_minutes int default null
)
returns public.orders language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_from public.order_status;
  v_note text := nullif(trim(p_note), '');
  v_is_customer boolean;
  v_is_merchant boolean;
  v_is_rider boolean;
  v_has_rider boolean;
  v_actor text;
  v_prep int;
  v_rider uuid;
begin
  if v_user is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.can_view_order(p_order_id) then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;

  v_from := v_order.status;
  v_is_customer := v_order.customer_id = v_user;
  v_is_merchant := public.is_merchant_member(v_order.merchant_id);
  v_is_rider := exists (select 1 from public.assignments where order_id = p_order_id and rider_id = v_user and status = 'active');
  v_has_rider := exists (select 1 from public.assignments where order_id = p_order_id and status = 'active');

  if not public.order_transition_allowed(v_from, p_status, v_order.fulfillment) then
    raise exception 'This order can no longer be changed to %.', replace(p_status::text, '_', ' ')
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  v_actor := case
    when p_status = 'cancelled' and v_from in ('awaiting_payment', 'pending') and v_is_customer then 'customer'
    when v_from = 'pending' and p_status in ('accepted', 'rejected') and v_is_merchant then 'merchant'
    when v_from in ('accepted', 'preparing') and p_status in ('preparing', 'ready', 'cancelled') and v_is_merchant then 'merchant'
    when v_from = 'ready' and p_status = 'completed' and v_is_merchant then 'merchant'
    when v_from in ('ready', 'out_for_delivery') and p_status in ('out_for_delivery', 'completed') and v_is_rider then 'rider'
    when v_from in ('ready', 'out_for_delivery') and p_status in ('out_for_delivery', 'completed')
         and v_is_merchant and not v_has_rider then 'merchant'
    when public.has_role('admin') or public.has_role('support') then 'admin'
  end;

  if v_actor is null then
    raise exception 'You are not allowed to make this change.' using errcode = '42501';
  end if;
  if p_status in ('rejected', 'cancelled') and v_actor <> 'customer' and v_note is null then
    raise exception 'Give a reason so the customer knows what happened.' using errcode = 'P0001', hint = 'reason_required';
  end if;

  if p_status = 'accepted' then
    v_prep := coalesce(p_prep_minutes, (select prep_time_minutes from public.merchants where id = v_order.merchant_id));
    if v_prep not between 5 and 180 then
      raise exception 'Preparation time must be between 5 and 180 minutes.' using errcode = 'P0001', hint = 'invalid_prep_time';
    end if;
  end if;

  update public.orders set
    status = p_status,
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    prep_time_minutes = case when p_status = 'accepted' then v_prep else prep_time_minutes end,
    estimated_ready_at = case when p_status = 'accepted' then now() + make_interval(mins => v_prep) else estimated_ready_at end,
    ready_at = case when p_status = 'ready' then now() else ready_at end,
    picked_up_at = case when p_status = 'out_for_delivery' then now() else picked_up_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    cancelled_at = case when p_status in ('cancelled', 'rejected') then now() else cancelled_at end,
    reject_reason = case when p_status = 'rejected' then v_note else reject_reason end,
    cancel_reason = case when p_status = 'cancelled' then v_note else cancel_reason end,
    cancelled_by = case when p_status in ('cancelled', 'rejected') then v_user else cancelled_by end
  where id = p_order_id
  returning * into v_order;

  if p_status = 'completed' then
    update public.payments set status = 'paid', paid_at = now()
    where order_id = p_order_id and provider = 'cod' and status = 'pending';
    if v_order.payment_method = 'cod' then
      update public.orders set payment_status = 'paid' where id = p_order_id returning * into v_order;
    end if;
    insert into public.commissions (order_id, merchant_id, rate_bps, base_minor, amount_minor)
    values (p_order_id, v_order.merchant_id, v_order.commission_bps,
      v_order.subtotal_minor - v_order.merchant_discount_minor,
      round((v_order.subtotal_minor - v_order.merchant_discount_minor) * v_order.commission_bps / 10000.0)::bigint)
    on conflict (order_id) do nothing;
    update public.assignments set status = 'completed', completed_at = now()
    where order_id = p_order_id and status = 'active';
  elsif p_status in ('cancelled', 'rejected') then
    select rider_id into v_rider from public.assignments where order_id = p_order_id and status = 'active';
    perform public.close_order_unsuccessfully(p_order_id, v_user, v_note);
    select * into v_order from public.orders where id = p_order_id;
    if v_rider is not null then
      perform public.notify(v_rider, 'order.cancelled', format('Order %s was cancelled', v_order.code), v_note, '/rider');
    end if;
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, note)
  values (p_order_id, v_from, p_status, v_user, v_actor, v_note);

  -- Customer notifications for meaningful milestones.
  if v_actor <> 'customer' then
    if p_status = 'accepted' then
      perform public.notify(v_order.customer_id, 'order.accepted', format('%s accepted your order', v_order.merchant_name),
        format('Estimated ready in about %s minutes.', v_prep), '/orders/' || p_order_id);
    elsif p_status = 'rejected' then
      perform public.notify(v_order.customer_id, 'order.rejected', format('%s could not take your order', v_order.merchant_name),
        v_note, '/orders/' || p_order_id);
    elsif p_status = 'ready' and v_order.fulfillment = 'pickup' then
      perform public.notify(v_order.customer_id, 'order.ready', 'Your order is ready for pickup',
        v_order.merchant_name, '/orders/' || p_order_id);
    elsif p_status = 'out_for_delivery' then
      perform public.notify(v_order.customer_id, 'order.on_the_way', 'Your order is on the way',
        v_order.merchant_name, '/orders/' || p_order_id);
    elsif p_status = 'completed' then
      perform public.notify(v_order.customer_id, 'order.completed', 'Order completed',
        'Thanks for ordering. You can rate your order now.', '/orders/' || p_order_id);
    elsif p_status = 'cancelled' then
      perform public.notify(v_order.customer_id, 'order.cancelled', format('Order %s was cancelled', v_order.code),
        v_note, '/orders/' || p_order_id);
    end if;
  elsif p_status = 'cancelled' and v_from = 'pending' then
    perform public.notify_merchant(v_order.merchant_id, 'order.cancelled',
      format('Order %s was cancelled by the customer', v_order.code), null, '/merchant/orders/' || p_order_id);
  end if;

  if v_actor = 'admin' then
    perform public.log_audit('order.status_changed', 'order', p_order_id::text,
      jsonb_build_object('from', v_from, 'to', p_status, 'note', v_note));
  end if;

  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- Riders
-- ---------------------------------------------------------------------------
create or replace function public.assign_rider(p_order_id uuid, p_rider_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_rider public.rider_profiles%rowtype;
  v_id uuid;
begin
  if not (public.has_role('admin') or public.has_role('support')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.fulfillment <> 'delivery' or v_order.status not in ('pending', 'accepted', 'preparing', 'ready') then
    raise exception 'Riders can be assigned only to open delivery orders.' using errcode = 'P0001', hint = 'invalid_assignment';
  end if;
  select * into v_rider from public.rider_profiles where user_id = p_rider_id;
  if not found or v_rider.status <> 'active' then
    raise exception 'This rider is not active.' using errcode = 'P0001', hint = 'rider_inactive';
  end if;

  update public.assignments set status = 'released', completed_at = now()
  where order_id = p_order_id and status = 'active';
  insert into public.assignments (order_id, rider_id, assigned_by) values (p_order_id, p_rider_id, auth.uid())
  returning id into v_id;

  perform public.notify(p_rider_id, 'assignment.new', format('New delivery %s', v_order.code),
    format('Pick up from %s', v_order.merchant_name), '/rider');
  perform public.log_audit('order.rider_assigned', 'order', p_order_id::text, jsonb_build_object('rider_id', p_rider_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Payments (provider events are applied only by trusted server code)
-- ---------------------------------------------------------------------------
create or replace function public.system_cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status in ('completed', 'cancelled', 'rejected') then
    return;
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_order_id;
  perform public.close_order_unsuccessfully(p_order_id, null, p_reason);
  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, note)
  values (p_order_id, v_order.status, 'cancelled', 'system', p_reason);
  perform public.notify(v_order.customer_id, 'order.cancelled', format('Order %s was cancelled', v_order.code),
    p_reason, '/orders/' || p_order_id);
end $$;

-- Records the provider checkout session for an online payment attempt.
create or replace function public.attach_checkout_session(
  p_order_id uuid, p_provider_ref text, p_checkout_url text, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_payment_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.payment_method <> 'online' or v_order.status <> 'awaiting_payment' then
    raise exception 'Order is not awaiting online payment.' using errcode = 'P0001', hint = 'not_awaiting_payment';
  end if;

  update public.payments set provider_ref = p_provider_ref, checkout_url = p_checkout_url, expires_at = p_expires_at
  where id = (select id from public.payments where order_id = p_order_id and provider = 'paymongo'
              and status = 'pending' and provider_ref is null limit 1)
  returning id into v_payment_id;

  if v_payment_id is null then
    -- A retry after a failed attempt: supersede pending attempts, keep history.
    update public.payments set status = 'cancelled'
    where order_id = p_order_id and provider = 'paymongo' and status = 'pending';
    insert into public.payments (order_id, provider, method, status, amount_minor, provider_ref, checkout_url, expires_at)
    values (p_order_id, 'paymongo', 'online', 'pending', v_order.total_minor, p_provider_ref, p_checkout_url, p_expires_at)
    returning id into v_payment_id;
  end if;
  update public.orders set payment_status = 'pending' where id = p_order_id;
  return v_payment_id;
end $$;

-- Applies a verified provider event exactly once.
-- p_event_type is normalized: payment.paid | payment.failed | payment.expired
create or replace function public.apply_payment_event(
  p_provider text, p_event_id text, p_event_type text, p_provider_ref text, p_amount_minor bigint, p_payload jsonb
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event_id uuid;
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_result text;
begin
  insert into public.payment_events (provider, event_id, event_type, provider_ref, payload)
  values (p_provider, p_event_id, p_event_type, p_provider_ref, coalesce(p_payload, '{}'))
  on conflict (provider, event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    return 'duplicate';
  end if;

  select * into v_payment from public.payments where provider = p_provider and provider_ref = p_provider_ref for update;
  if not found then
    v_result := 'unknown_payment';
  else
    select * into v_order from public.orders where id = v_payment.order_id for update;

    if p_event_type = 'payment.paid' then
      if v_payment.status in ('paid', 'refunded', 'partially_refunded') then
        v_result := 'already_paid';
      elsif p_amount_minor is distinct from v_payment.amount_minor then
        v_result := 'amount_mismatch';
        perform public.notify_staff('payment.mismatch', format('Payment amount mismatch on %s', v_order.code),
          format('Expected %s, provider reported %s.', public.format_php(v_payment.amount_minor),
            public.format_php(coalesce(p_amount_minor, 0))), '/admin/payments');
      else
        update public.payments set status = 'paid', paid_at = now(), failure_reason = null where id = v_payment.id;
        update public.orders set payment_status = 'paid' where id = v_order.id;
        if v_order.status = 'awaiting_payment' then
          update public.orders set status = 'pending' where id = v_order.id;
          insert into public.order_status_history (order_id, from_status, to_status, actor_kind, note)
          values (v_order.id, 'awaiting_payment', 'pending', 'system', 'Payment confirmed');
          perform public.notify_merchant(v_order.merchant_id, 'order.new', format('New order %s', v_order.code),
            format('%s · Paid online', public.format_php(v_order.subtotal_minor)), '/merchant/orders/' || v_order.id);
          v_result := 'paid';
        elsif v_order.status in ('cancelled', 'rejected') then
          insert into public.refunds (order_id, payment_id, amount_minor, reason)
          values (v_order.id, v_payment.id, v_payment.amount_minor, 'Payment received after the order was closed.');
          perform public.notify_staff('refund.required', format('Refund needed for %s', v_order.code),
            'Payment arrived after the order was closed.', '/admin/payments');
          v_result := 'paid_after_close';
        else
          v_result := 'paid';
        end if;
      end if;
    elsif p_event_type = 'payment.failed' then
      if v_payment.status = 'pending' then
        update public.payments set status = 'failed', failure_reason = coalesce(p_payload ->> 'failure_reason', 'Payment failed')
        where id = v_payment.id;
        if v_order.status = 'awaiting_payment' then
          update public.orders set payment_status = 'failed' where id = v_order.id;
        end if;
        v_result := 'failed';
      else
        v_result := 'ignored';
      end if;
    elsif p_event_type = 'payment.expired' then
      if v_payment.status = 'pending' then
        update public.payments set status = 'expired' where id = v_payment.id;
        if v_order.status = 'awaiting_payment' and not exists (
          select 1 from public.payments where order_id = v_order.id and status in ('pending', 'paid')
        ) then
          perform public.system_cancel_order(v_order.id, 'Payment was not completed in time.');
        end if;
        v_result := 'expired';
      else
        v_result := 'ignored';
      end if;
    else
      v_result := 'ignored';
    end if;
  end if;

  update public.payment_events set processed_at = now(), result = v_result where id = v_event_id;
  return v_result;
end $$;

-- Cancels online orders whose payment window has passed. Run on a schedule.
create or replace function public.expire_stale_orders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order record;
  v_count int := 0;
begin
  for v_order in
    select o.id from public.orders o, public.platform_settings s
    where o.status = 'awaiting_payment'
      and o.created_at < now() - make_interval(mins => s.payment_expiry_minutes)
      and not exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'paid')
    for update of o skip locked
  loop
    update public.payments set status = 'expired' where order_id = v_order.id and status = 'pending';
    perform public.system_cancel_order(v_order.id, 'Payment was not completed in time.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
create or replace function public.request_refund(p_order_id uuid, p_amount_minor bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.payments%rowtype;
  v_open bigint;
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_payment from public.payments
  where order_id = p_order_id and status in ('paid', 'partially_refunded')
  order by paid_at desc limit 1 for update;
  if not found then
    raise exception 'This order has no captured payment to refund.' using errcode = 'P0001', hint = 'no_payment';
  end if;
  select coalesce(sum(amount_minor), 0) into v_open from public.refunds
  where payment_id = v_payment.id and status in ('requested', 'approved');
  if p_amount_minor is null or p_amount_minor <= 0
     or p_amount_minor > v_payment.amount_minor - v_payment.refunded_minor - v_open then
    raise exception 'Refund amount exceeds the refundable balance of %.',
      public.format_php(v_payment.amount_minor - v_payment.refunded_minor - v_open)
      using errcode = 'P0001', hint = 'refund_too_large';
  end if;
  insert into public.refunds (order_id, payment_id, amount_minor, reason, requested_by)
  values (p_order_id, v_payment.id, p_amount_minor, p_reason, auth.uid()) returning id into v_id;
  perform public.log_audit('refund.requested', 'refund', v_id::text,
    jsonb_build_object('order_id', p_order_id, 'amount_minor', p_amount_minor));
  return v_id;
end $$;

-- p_action: approve | reject | mark_processed
create or replace function public.review_refund(p_refund_id uuid, p_action text, p_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_status public.payment_status;
  v_code text;
  v_customer uuid;
begin
  if not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found.' using errcode = 'P0001';
  end if;

  if p_action = 'approve' and v_refund.status = 'requested' then
    update public.refunds set status = 'approved', reviewed_by = auth.uid() where id = p_refund_id;
  elsif p_action = 'reject' and v_refund.status in ('requested', 'approved') then
    update public.refunds set status = 'rejected', reviewed_by = auth.uid() where id = p_refund_id;
  elsif p_action = 'mark_processed' and v_refund.status = 'approved' then
    if nullif(trim(p_reference), '') is null then
      raise exception 'Enter the provider or transfer reference.' using errcode = 'P0001', hint = 'reference_required';
    end if;
    select * into v_payment from public.payments where id = v_refund.payment_id for update;
    if v_payment.refunded_minor + v_refund.amount_minor > v_payment.amount_minor then
      raise exception 'Refund exceeds the captured amount.' using errcode = 'P0001', hint = 'refund_too_large';
    end if;
    v_status := case when v_payment.refunded_minor + v_refund.amount_minor = v_payment.amount_minor
                     then 'refunded' else 'partially_refunded' end;
    update public.payments set refunded_minor = refunded_minor + v_refund.amount_minor, status = v_status
    where id = v_payment.id;
    update public.refunds set status = 'processed', reference = trim(p_reference), processed_at = now(),
      reviewed_by = auth.uid() where id = p_refund_id;
    update public.orders set payment_status = v_status where id = v_refund.order_id
    returning code, customer_id into v_code, v_customer;
    perform public.notify(v_customer, 'refund.processed', format('Refund processed for %s', v_code),
      format('%s has been refunded.', public.format_php(v_refund.amount_minor)), '/orders/' || v_refund.order_id);
  else
    raise exception 'This refund cannot be changed that way.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  perform public.log_audit('refund.' || p_action, 'refund', p_refund_id::text,
    jsonb_build_object('reference', p_reference, 'amount_minor', v_refund.amount_minor));
end $$;

-- ---------------------------------------------------------------------------
-- Settlements
-- ---------------------------------------------------------------------------
create or replace function public.generate_settlement(p_merchant_id uuid, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_gross bigint;
  v_commission bigint;
  v_refunds bigint;
  v_count int;
begin
  if not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_end < p_start or p_end >= (now() at time zone 'Asia/Manila')::date then
    raise exception 'Choose a period that has already ended.' using errcode = 'P0001', hint = 'invalid_period';
  end if;
  if exists (select 1 from public.settlements where merchant_id = p_merchant_id
             and daterange(period_start, period_end, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'A settlement already covers part of this period.' using errcode = 'P0001', hint = 'overlap';
  end if;

  perform 1 from public.merchants where id = p_merchant_id for update;

  select count(*), coalesce(sum(c.base_minor), 0), coalesce(sum(c.amount_minor), 0)
  into v_count, v_gross, v_commission
  from public.commissions c join public.orders o on o.id = c.order_id
  where c.merchant_id = p_merchant_id and c.settlement_id is null
    and (o.completed_at at time zone 'Asia/Manila')::date between p_start and p_end;

  select coalesce(sum(r.amount_minor), 0) into v_refunds
  from public.refunds r
  join public.commissions c on c.order_id = r.order_id
  join public.orders o on o.id = r.order_id
  where c.merchant_id = p_merchant_id and c.settlement_id is null and r.status = 'processed'
    and (o.completed_at at time zone 'Asia/Manila')::date between p_start and p_end;

  insert into public.settlements (merchant_id, period_start, period_end, order_count, gross_minor,
    commission_minor, refunds_minor, net_minor, created_by)
  values (p_merchant_id, p_start, p_end, v_count, v_gross, v_commission, v_refunds,
    v_gross - v_commission - v_refunds, auth.uid())
  returning id into v_id;

  update public.commissions c set settlement_id = v_id
  from public.orders o
  where o.id = c.order_id and c.merchant_id = p_merchant_id and c.settlement_id is null
    and (o.completed_at at time zone 'Asia/Manila')::date between p_start and p_end;

  perform public.log_audit('settlement.generated', 'settlement', v_id::text,
    jsonb_build_object('merchant_id', p_merchant_id, 'net_minor', v_gross - v_commission - v_refunds));
  return v_id;
end $$;

create or replace function public.update_settlement_status(p_settlement_id uuid, p_status public.settlement_status, p_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settlement public.settlements%rowtype;
begin
  if not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_settlement from public.settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'Settlement not found.' using errcode = 'P0001';
  end if;
  if v_settlement.status = 'draft' and p_status = 'approved' then
    update public.settlements set status = 'approved', approved_by = auth.uid() where id = p_settlement_id;
  elsif v_settlement.status = 'approved' and p_status = 'paid' then
    if nullif(trim(p_reference), '') is null then
      raise exception 'Enter the payout reference.' using errcode = 'P0001', hint = 'reference_required';
    end if;
    update public.settlements set status = 'paid', paid_at = now(), reference = trim(p_reference) where id = p_settlement_id;
    perform public.notify_merchant(v_settlement.merchant_id, 'settlement.paid', 'Payout sent',
      format('%s for %s to %s', public.format_php(v_settlement.net_minor), v_settlement.period_start, v_settlement.period_end),
      '/merchant/finances');
  else
    raise exception 'This settlement cannot move to %.', p_status using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  perform public.log_audit('settlement.' || p_status, 'settlement', p_settlement_id::text,
    jsonb_build_object('reference', p_reference));
end $$;

-- ---------------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.notify_merchant(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.compute_checkout(uuid, uuid, public.fulfillment_type, uuid, text) from public, anon, authenticated;
revoke execute on function public.close_order_unsuccessfully(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.system_cancel_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.attach_checkout_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_payment_event(text, text, text, text, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
grant execute on function public.attach_checkout_session(uuid, text, text, timestamptz) to service_role;
grant execute on function public.apply_payment_event(text, text, text, text, bigint, jsonb) to service_role;
grant execute on function public.expire_stale_orders() to service_role;

revoke execute on function public.cart_add_item(uuid, uuid, jsonb, int, text) from public, anon;
revoke execute on function public.cart_update_item(uuid, uuid, jsonb, int, text) from public, anon;
revoke execute on function public.cart_set_quantity(uuid, int) from public, anon;
revoke execute on function public.cart_clear(uuid) from public, anon;
revoke execute on function public.quote_checkout(uuid, public.fulfillment_type, uuid, text) from public, anon;
revoke execute on function public.place_order(uuid, public.fulfillment_type, uuid, public.payment_method, text, text, bigint, text) from public, anon;
revoke execute on function public.update_order_status(uuid, public.order_status, text, int) from public, anon;
revoke execute on function public.assign_rider(uuid, uuid) from public, anon;
revoke execute on function public.request_refund(uuid, bigint, text) from public, anon;
revoke execute on function public.review_refund(uuid, text, text) from public, anon;
revoke execute on function public.generate_settlement(uuid, date, date) from public, anon;
revoke execute on function public.update_settlement_status(uuid, public.settlement_status, text) from public, anon;
