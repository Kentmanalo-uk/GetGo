-- Padala and errands.
--
-- Padala: a rider picks up a parcel or documents at one address and brings it
-- to another in the same town. Errand: a rider does a task for the customer —
-- buys something that isn't listed on GETGO, pays a bill, picks something up —
-- and brings back the result.
--
-- Both are orders without a store, so they reuse the whole order lifecycle:
-- a rider in the area accepts, the customer sends the total to the rider by
-- GCash, the rider confirms the payment, does the job and delivers.
--   * padala total  = delivery fee + service fee + padala fee
--   * errand total  = budget (money the rider spends for the customer)
--                     + delivery fee + service fee + errand fee
-- The rider returns any unspent budget in cash with the receipt, and records
-- what was spent.
--
-- The delivery fee is the barangay price of whichever stop is farther (the
-- higher of the two barangay prices), so the same per-barangay pricing admins
-- set for food and shops applies.

-- The unused bookings placeholder is replaced by service orders.
drop table if exists public.bookings;
drop type if exists public.booking_status;

-- ---------------------------------------------------------------------------
-- Per-area settings (admins edit service_areas directly, RLS-guarded)
-- ---------------------------------------------------------------------------
alter table public.service_areas
  add column padala_enabled boolean not null default true,
  add column errands_enabled boolean not null default true,
  add column padala_fee_minor bigint not null default 0 check (padala_fee_minor >= 0),
  add column errand_fee_minor bigint not null default 2000 check (errand_fee_minor >= 0),
  add column errand_max_budget_minor bigint not null default 300000 check (errand_max_budget_minor >= 0);

-- ---------------------------------------------------------------------------
-- Orders carry their service
-- ---------------------------------------------------------------------------
alter table public.orders
  add column service public.service_type not null default 'pabili',
  -- Padala: { item, size }. Errand: { type, description, budget_minor }.
  add column task jsonb,
  -- Errands: what the rider actually spent out of the budget (subtotal).
  add column spent_minor bigint,
  alter column merchant_id drop not null,
  add constraint orders_service_shape check (
    (service = 'pabili' and merchant_id is not null and task is null)
    or (service <> 'pabili' and merchant_id is null and jsonb_typeof(task) = 'object')
  ),
  add constraint orders_spent_within_budget check (spent_minor is null or spent_minor between 0 and subtotal_minor);

create index orders_service_idx on public.orders (service, created_at desc) where service <> 'pabili';

-- One line describing the job, for notifications.
create or replace function public.order_job_line(p_order public.orders)
returns text language sql immutable as $$
  select case p_order.service
    when 'pabili' then 'Buy from ' || p_order.merchant_name
    else p_order.merchant_name || ' · to Brgy. ' || coalesce(p_order.delivery_address ->> 'barangay', '')
  end;
$$;

-- Checks one stop (pickup, errand place or drop-off) and returns it cleaned.
-- p_place: { name, phone, line1, barangay, barangay_code, landmark }
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

  return jsonb_build_object(
    'name', v_name, 'phone', nullif(v_phone, ''), 'line1', v_line1, 'barangay', v_barangay,
    'barangay_code', v_code, 'city', p_area.city, 'landmark', v_landmark
  );
end $$;

-- Validates a padala or errand request and prices it. Raises with a hint
-- the app can show; returns the cleaned request and its amounts.
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

  v_delivery := greatest(
    public.delivery_fee_for(v_area.id, v_pickup ->> 'barangay_code', v_pickup ->> 'barangay'),
    public.delivery_fee_for(v_area.id, v_dropoff ->> 'barangay_code', v_dropoff ->> 'barangay')
  );

  return jsonb_build_object(
    'service', p_service, 'title', v_title, 'service_area_id', v_area.id,
    'pickup', v_pickup, 'dropoff', v_dropoff, 'task', v_task,
    'subtotal_minor', v_budget, 'delivery_fee_minor', v_delivery, 'service_fee_minor', v_service_fee,
    'total_minor', v_budget + v_delivery + v_service_fee
  );
end $$;

-- What the customer sees before sending the request.
create or replace function public.quote_service_request(
  p_service public.service_type, p_service_area_id uuid, p_pickup jsonb, p_dropoff jsonb, p_task jsonb
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'subtotal_minor', q -> 'subtotal_minor', 'delivery_fee_minor', q -> 'delivery_fee_minor',
    'service_fee_minor', q -> 'service_fee_minor', 'total_minor', q -> 'total_minor')
  from public.compute_service_request(p_service, p_service_area_id, p_pickup, p_dropoff, p_task) q;
$$;

-- Sends a padala or errand request to the area's riders.
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
    idempotency_key
  ) values (
    v_code, v_user, null, p_service, v_req -> 'task', p_service_area_id, v_req ->> 'title', v_req -> 'pickup',
    coalesce(nullif(trim(v_profile.full_name), ''), v_dropoff ->> 'name'),
    coalesce(nullif(trim(v_profile.phone), ''), v_dropoff ->> 'phone'),
    jsonb_build_object(
      'label', 'Drop-off', 'recipient_name', v_dropoff ->> 'name', 'phone', v_dropoff ->> 'phone',
      'line1', v_dropoff ->> 'line1', 'barangay', v_dropoff ->> 'barangay', 'barangay_code', v_dropoff ->> 'barangay_code',
      'city', v_dropoff ->> 'city', 'landmark', v_dropoff ->> 'landmark'),
    nullif(trim(p_notes), ''),
    (v_req ->> 'subtotal_minor')::bigint, (v_req ->> 'delivery_fee_minor')::bigint, (v_req ->> 'service_fee_minor')::bigint,
    0, 0, (v_req ->> 'total_minor')::bigint,
    p_idempotency_key
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

-- Errands: the rider records what they spent, so the customer knows the
-- change they'll get back.
create or replace function public.rider_record_spent(p_order_id uuid, p_spent_minor bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not exists (select 1 from public.assignments where order_id = p_order_id and rider_id = auth.uid() and status = 'active') then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.service <> 'errand' or v_order.status not in ('buying', 'out_for_delivery') then
    raise exception 'You can record spending only while doing an errand.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if p_spent_minor is null or p_spent_minor < 0 or p_spent_minor > v_order.subtotal_minor then
    raise exception 'The amount spent must be between ₱0 and the budget of %.', public.format_php(v_order.subtotal_minor)
      using errcode = 'P0001', hint = 'invalid_amount';
  end if;
  update public.orders set spent_minor = p_spent_minor where id = p_order_id;
end $$;

-- ---------------------------------------------------------------------------
-- Lifecycle functions: same rules, wording that fits each service
-- ---------------------------------------------------------------------------
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
    public.order_job_line(v_order), '/rider/jobs/' || p_order_id);
  perform public.log_audit('order.rider_assigned', 'order', p_order_id::text, jsonb_build_object('rider_id', p_rider_id));
end $$;

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
    public.order_job_line(v_order), '/rider/orders/' || p_order_id);
end $$;

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
      case v_order.service
        when 'padala' then 'Your rider is on the way to pick up your parcel.'
        when 'errand' then 'Your rider is starting your errand.'
        else format('Your rider is buying your order at %s.', v_order.merchant_name)
      end, '/orders/' || p_order_id);
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
      perform public.notify(v_rider, 'order.cancelled', format('Order %s was cancelled', v_order.code), v_note, '/rider/jobs/' || p_order_id);
    end if;
  end if;

  perform public.record_transition(p_order_id, v_from, p_status, v_actor, v_note);

  if v_actor <> 'customer' then
    if p_status = 'out_for_delivery' then
      perform public.notify(v_order.customer_id, 'order.on_the_way',
        case v_order.service when 'padala' then 'Your parcel is on the way' when 'errand' then 'Your rider is on the way back' else 'Your order is on the way' end,
        v_order.merchant_name, '/orders/' || p_order_id);
    elsif p_status = 'completed' then
      perform public.notify(v_order.customer_id, 'order.completed',
        case v_order.service when 'padala' then 'Parcel delivered' when 'errand' then 'Errand done' else 'Order delivered' end,
        case v_order.service when 'pabili' then 'Thanks for ordering. You can rate the store now.' else 'Thanks for using GETGO.' end,
        '/orders/' || p_order_id);
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
-- Execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.clean_service_place(public.service_areas, jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public.compute_service_request(public.service_type, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.order_job_line(public.orders) from public, anon, authenticated;
revoke execute on function public.quote_service_request(public.service_type, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.place_service_request(public.service_type, uuid, jsonb, jsonb, jsonb, text, bigint, text) from public, anon;
revoke execute on function public.rider_record_spent(uuid, bigint) from public, anon;
grant execute on function public.quote_service_request(public.service_type, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.place_service_request(public.service_type, uuid, jsonb, jsonb, jsonb, text, bigint, text) to authenticated;
grant execute on function public.rider_record_spent(uuid, bigint) to authenticated;
