-- Trusted cart, checkout, order lifecycle, GCash payment and refund
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

  v_delivery := v_area.delivery_fee_minor;
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

create or replace function public.quote_checkout(p_merchant_id uuid, p_address_id uuid default null, p_promo_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to check out.' using errcode = '42501';
  end if;
  return public.compute_checkout(auth.uid(), p_merchant_id, p_address_id, p_promo_code);
end $$;

-- Notifies every active rider in an area about an order to accept.
create or replace function public.notify_area_riders(p_service_area_id uuid, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select user_id, 'order.available', p_title, p_body, p_link
  from public.rider_profiles where service_area_id = p_service_area_id and status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Order placement
-- ---------------------------------------------------------------------------
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
    promotion_id, idempotency_key
  ) values (
    v_code, v_user, p_merchant_id, v_merchant.service_area_id, v_merchant.name,
    jsonb_build_object('line1', v_merchant.address_line, 'barangay', v_merchant.barangay, 'city', v_merchant.city, 'phone', v_merchant.phone),
    v_address.recipient_name, v_address.phone,
    jsonb_build_object(
      'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'line1', v_address.line1, 'barangay', v_address.barangay, 'city', v_address.city, 'landmark', v_address.landmark),
    nullif(trim(p_notes), ''),
    (v_quote ->> 'subtotal_minor')::bigint, (v_quote ->> 'delivery_fee_minor')::bigint,
    (v_quote ->> 'service_fee_minor')::bigint, (v_quote ->> 'small_order_fee_minor')::bigint,
    (v_quote ->> 'discount_minor')::bigint, (v_quote ->> 'total_minor')::bigint,
    case when (v_quote -> 'promo' ->> 'applied')::boolean then (v_quote -> 'promo' ->> 'promotion_id')::uuid end,
    p_idempotency_key
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

-- ---------------------------------------------------------------------------
-- Order lifecycle
--   pending → accepted            rider accepts (or staff assigns)
--   accepted → pending            rider releases before payment
--   accepted → payment_submitted  customer submits the GCash reference
--   payment_submitted → buying    rider confirms the GCash payment
--   payment_submitted → accepted  rider did not receive it
--   buying → out_for_delivery     rider has the items
--   out_for_delivery → completed  delivered
--   open states → cancelled       customer (before paying), rider (after
--                                 payment, with a reason) or staff
-- ---------------------------------------------------------------------------
create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'pending' then p_to in ('accepted', 'cancelled')
    when 'accepted' then p_to in ('pending', 'payment_submitted', 'cancelled')
    when 'payment_submitted' then p_to in ('accepted', 'buying', 'cancelled')
    when 'buying' then p_to in ('out_for_delivery', 'cancelled')
    when 'out_for_delivery' then p_to in ('completed', 'cancelled')
    else false
  end;
$$;

create or replace function public.record_transition(
  p_order_id uuid, p_from public.order_status, p_to public.order_status, p_actor_kind text, p_note text
)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, note)
  values (p_order_id, p_from, p_to, auth.uid(), p_actor_kind, p_note);
$$;

-- Assigns a rider and tells the customer where to send payment.
create or replace function public.start_assignment(p_order_id uuid, p_rider_id uuid, p_assigned_by uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rider public.rider_profiles%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_rider from public.rider_profiles where user_id = p_rider_id;
  update public.assignments set status = 'released', completed_at = now() where order_id = p_order_id and status = 'active';
  insert into public.assignments (order_id, rider_id, assigned_by) values (p_order_id, p_rider_id, p_assigned_by);
  update public.orders set status = 'accepted', accepted_at = now(), payment_status = 'pending'
  where id = p_order_id returning * into v_order;
  update public.payments set payee_name = v_rider.gcash_name, payee_number = v_rider.gcash_number,
    status = 'pending', gcash_reference = null, sender_name = null, submitted_at = null, rejection_note = null
  where order_id = p_order_id;
  perform public.notify(v_order.customer_id, 'order.accepted',
    format('%s accepted your order', split_part(v_rider.full_name, ' ', 1)),
    format('Send %s by GCash to %s (%s), then enter the reference number.', public.format_php(v_order.total_minor),
      v_rider.gcash_name, v_rider.gcash_number),
    '/orders/' || p_order_id);
end $$;

create or replace function public.rider_accept_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.is_area_rider(v_order.service_area_id) then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Another rider already accepted this order.' using errcode = 'P0001', hint = 'already_taken';
  end if;
  perform public.start_assignment(p_order_id, auth.uid(), auth.uid());
  perform public.record_transition(p_order_id, 'pending', 'accepted', 'rider', null);
end $$;

create or replace function public.assign_rider(p_order_id uuid, p_rider_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_rider public.rider_profiles%rowtype;
begin
  if not (public.has_role('admin') or public.has_role('support')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status not in ('pending', 'accepted') then
    raise exception 'Riders can be assigned only before payment is submitted.' using errcode = 'P0001', hint = 'invalid_assignment';
  end if;
  select * into v_rider from public.rider_profiles where user_id = p_rider_id;
  if not found or v_rider.status <> 'active' or v_rider.service_area_id <> v_order.service_area_id then
    raise exception 'Choose an active rider from the order’s area.' using errcode = 'P0001', hint = 'rider_unavailable';
  end if;
  perform public.start_assignment(p_order_id, p_rider_id, auth.uid());
  perform public.record_transition(p_order_id, v_order.status, 'accepted', 'admin', 'Rider assigned by GETGO');
  perform public.notify(p_rider_id, 'assignment.new', format('Order %s assigned to you', v_order.code),
    format('Buy from %s', v_order.merchant_name), '/rider');
  perform public.log_audit('order.rider_assigned', 'order', p_order_id::text, jsonb_build_object('rider_id', p_rider_id));
end $$;

-- The rider can hand an order back before the customer pays.
create or replace function public.rider_release_order(p_order_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not exists (select 1 from public.assignments where order_id = p_order_id and rider_id = auth.uid() and status = 'active') then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'accepted' then
    raise exception 'You can only release an order before the customer pays.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  update public.assignments set status = 'released', completed_at = now() where order_id = p_order_id and status = 'active';
  update public.orders set status = 'pending', accepted_at = null where id = p_order_id;
  update public.payments set payee_name = null, payee_number = null where order_id = p_order_id;
  perform public.record_transition(p_order_id, 'accepted', 'pending', 'rider', nullif(trim(p_note), ''));
  perform public.notify(v_order.customer_id, 'order.released', 'Finding another rider',
    'Your rider couldn’t take this order. Don’t send payment yet — we’re finding another rider.', '/orders/' || p_order_id);
  perform public.notify_area_riders(v_order.service_area_id, format('Order %s needs a rider', v_order.code),
    format('Buy from %s', v_order.merchant_name), '/rider');
end $$;

create or replace function public.submit_gcash_payment(p_order_id uuid, p_reference text, p_sender_name text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_reference text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_rider uuid;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'accepted' then
    raise exception 'Send payment only after a rider accepts your order.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if v_reference !~ '^[0-9A-Z]{6,30}$' then
    raise exception 'Enter the reference number from your GCash receipt.' using errcode = 'P0001', hint = 'invalid_reference';
  end if;
  if exists (select 1 from public.payments where gcash_reference = v_reference and order_id <> p_order_id) then
    raise exception 'This reference number was already used for another order.' using errcode = 'P0001', hint = 'duplicate_reference';
  end if;
  update public.payments set status = 'submitted', gcash_reference = v_reference,
    sender_name = nullif(trim(p_sender_name), ''), submitted_at = now(), rejection_note = null
  where order_id = p_order_id;
  update public.orders set status = 'payment_submitted', payment_status = 'submitted' where id = p_order_id;
  perform public.record_transition(p_order_id, 'accepted', 'payment_submitted', 'customer', null);
  select rider_id into v_rider from public.assignments where order_id = p_order_id and status = 'active';
  perform public.notify(v_rider, 'payment.submitted', format('Payment sent for %s', v_order.code),
    format('Check your GCash for %s, reference %s.', public.format_php(v_order.total_minor), v_reference), '/rider');
end $$;

-- The assigned rider confirms whether the GCash payment arrived.
create or replace function public.confirm_gcash_payment(p_order_id uuid, p_received boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not exists (select 1 from public.assignments where order_id = p_order_id and rider_id = auth.uid() and status = 'active') then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'payment_submitted' then
    raise exception 'There is no payment waiting for confirmation.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  if p_received then
    update public.payments set status = 'paid', confirmed_at = now(), confirmed_by = auth.uid() where order_id = p_order_id;
    update public.orders set status = 'buying', payment_status = 'paid', paid_at = now() where id = p_order_id;
    perform public.record_transition(p_order_id, 'payment_submitted', 'buying', 'rider', 'Payment received');
    perform public.notify(v_order.customer_id, 'order.buying', 'Payment received',
      format('Your rider is buying your order at %s.', v_order.merchant_name), '/orders/' || p_order_id);
  else
    if nullif(trim(p_note), '') is null then
      raise exception 'Tell the customer what’s wrong with the payment.' using errcode = 'P0001', hint = 'reason_required';
    end if;
    update public.payments set status = 'pending', rejection_note = trim(p_note), gcash_reference = null, submitted_at = null
    where order_id = p_order_id;
    update public.orders set status = 'accepted', payment_status = 'pending' where id = p_order_id;
    perform public.record_transition(p_order_id, 'payment_submitted', 'accepted', 'rider', trim(p_note));
    perform public.notify(v_order.customer_id, 'payment.not_received', 'Your rider hasn’t received the payment',
      trim(p_note), '/orders/' || p_order_id);
  end if;
end $$;

-- Side effects shared by every path that cancels an order.
create or replace function public.close_order_unsuccessfully(p_order_id uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.payments%rowtype;
begin
  delete from public.promotion_redemptions where order_id = p_order_id;
  update public.assignments set status = 'released', completed_at = now() where order_id = p_order_id and status = 'active';
  select * into v_payment from public.payments where order_id = p_order_id for update;
  if v_payment.status = 'paid' then
    insert into public.refunds (order_id, payment_id, amount_minor, reason, requested_by)
    values (p_order_id, v_payment.id, v_payment.amount_minor - v_payment.refunded_minor,
      coalesce('Order cancelled: ' || p_reason, 'Order cancelled'), p_actor);
    perform public.notify_staff('refund.required', 'GCash refund needed', p_reason, '/admin/payments');
  else
    update public.payments set status = 'cancelled' where id = v_payment.id;
    update public.orders set payment_status = 'cancelled' where id = p_order_id;
  end if;
end $$;

-- Delivery progress and cancellation.
create or replace function public.update_order_status(p_order_id uuid, p_status public.order_status, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_from public.order_status;
  v_note text := nullif(trim(p_note), '');
  v_is_rider boolean;
  v_actor text;
  v_rider uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.can_view_order(p_order_id) then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  v_from := v_order.status;
  if p_status not in ('out_for_delivery', 'completed', 'cancelled') or not public.order_transition_allowed(v_from, p_status) then
    raise exception 'This order can no longer be changed to %.', replace(p_status::text, '_', ' ')
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  select rider_id into v_rider from public.assignments where order_id = p_order_id and status = 'active';
  v_is_rider := v_rider is not null and v_rider = auth.uid();

  v_actor := case
    when p_status = 'cancelled' and v_from in ('pending', 'accepted') and v_order.customer_id = auth.uid() then 'customer'
    when p_status in ('out_for_delivery', 'completed') and v_is_rider then 'rider'
    when p_status = 'cancelled' and v_from in ('buying', 'out_for_delivery') and v_is_rider then 'rider'
    when public.has_role('admin') or public.has_role('support') then 'admin'
  end;
  if v_actor is null then
    raise exception 'You are not allowed to make this change.' using errcode = '42501';
  end if;
  if p_status = 'cancelled' and v_actor <> 'customer' and v_note is null then
    raise exception 'Give a reason so the customer knows what happened.' using errcode = 'P0001', hint = 'reason_required';
  end if;

  update public.orders set
    status = p_status,
    picked_up_at = case when p_status = 'out_for_delivery' then now() else picked_up_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelled' then v_note else cancel_reason end,
    cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end
  where id = p_order_id;

  if p_status = 'completed' then
    update public.assignments set status = 'completed', completed_at = now() where order_id = p_order_id and status = 'active';
  elsif p_status = 'cancelled' then
    perform public.close_order_unsuccessfully(p_order_id, auth.uid(), v_note);
    if v_rider is not null and not v_is_rider then
      perform public.notify(v_rider, 'order.cancelled', format('Order %s was cancelled', v_order.code), v_note, '/rider');
    end if;
  end if;

  perform public.record_transition(p_order_id, v_from, p_status, v_actor, v_note);

  if v_actor <> 'customer' then
    if p_status = 'out_for_delivery' then
      perform public.notify(v_order.customer_id, 'order.on_the_way', 'Your order is on the way', v_order.merchant_name, '/orders/' || p_order_id);
    elsif p_status = 'completed' then
      perform public.notify(v_order.customer_id, 'order.completed', 'Order delivered',
        'Thanks for ordering. You can rate the store now.', '/orders/' || p_order_id);
    elsif p_status = 'cancelled' then
      perform public.notify(v_order.customer_id, 'order.cancelled', format('Order %s was cancelled', v_order.code),
        v_note, '/orders/' || p_order_id);
    end if;
  end if;

  if v_actor = 'admin' then
    perform public.log_audit('order.status_changed', 'order', p_order_id::text,
      jsonb_build_object('from', v_from, 'to', p_status, 'note', v_note));
  end if;

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- Refunds (manual GCash transfers recorded by staff)
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
  select * into v_payment from public.payments where order_id = p_order_id and status = 'paid' for update;
  if not found then
    raise exception 'This order has no confirmed payment to refund.' using errcode = 'P0001', hint = 'no_payment';
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

-- p_action: approve | reject | mark_processed (with the GCash reference)
create or replace function public.review_refund(p_refund_id uuid, p_action text, p_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
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
      raise exception 'Enter the GCash reference of the refund transfer.' using errcode = 'P0001', hint = 'reference_required';
    end if;
    select * into v_payment from public.payments where id = v_refund.payment_id for update;
    if v_payment.refunded_minor + v_refund.amount_minor > v_payment.amount_minor then
      raise exception 'Refund exceeds the amount paid.' using errcode = 'P0001', hint = 'refund_too_large';
    end if;
    update public.payments set refunded_minor = refunded_minor + v_refund.amount_minor,
      status = case when refunded_minor + v_refund.amount_minor = amount_minor then 'refunded'::public.payment_status else status end
    where id = v_payment.id returning * into v_payment;
    update public.refunds set status = 'processed', reference = trim(p_reference), processed_at = now(),
      reviewed_by = auth.uid() where id = p_refund_id;
    update public.orders set payment_status = v_payment.status where id = v_refund.order_id
    returning code, customer_id into v_code, v_customer;
    perform public.notify(v_customer, 'refund.processed', format('Refund sent for %s', v_code),
      format('%s was sent back to your GCash (ref %s).', public.format_php(v_refund.amount_minor), trim(p_reference)),
      '/orders/' || v_refund.order_id);
  else
    raise exception 'This refund cannot be changed that way.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  perform public.log_audit('refund.' || p_action, 'refund', p_refund_id::text,
    jsonb_build_object('reference', p_reference, 'amount_minor', v_refund.amount_minor));
end $$;

-- ---------------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.notify_merchant(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_area_riders(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.compute_checkout(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.close_order_unsuccessfully(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.start_assignment(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_transition(uuid, public.order_status, public.order_status, text, text) from public, anon, authenticated;
revoke execute on function public.assert_configuration(uuid, uuid, jsonb, int) from public, anon, authenticated;

revoke execute on function public.cart_add_item(uuid, uuid, jsonb, int, text) from public, anon;
revoke execute on function public.cart_update_item(uuid, uuid, jsonb, int, text) from public, anon;
revoke execute on function public.cart_set_quantity(uuid, int) from public, anon;
revoke execute on function public.cart_clear(uuid) from public, anon;
revoke execute on function public.quote_checkout(uuid, uuid, text) from public, anon;
revoke execute on function public.place_order(uuid, uuid, text, text, bigint, text) from public, anon;
revoke execute on function public.rider_accept_order(uuid) from public, anon;
revoke execute on function public.rider_release_order(uuid, text) from public, anon;
revoke execute on function public.assign_rider(uuid, uuid) from public, anon;
revoke execute on function public.submit_gcash_payment(uuid, text, text) from public, anon;
revoke execute on function public.confirm_gcash_payment(uuid, boolean, text) from public, anon;
revoke execute on function public.update_order_status(uuid, public.order_status, text) from public, anon;
revoke execute on function public.request_refund(uuid, bigint, text) from public, anon;
revoke execute on function public.review_refund(uuid, text, text) from public, anon;
