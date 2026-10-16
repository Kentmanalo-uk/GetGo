-- 1. Rider self sign-up: riders apply with their vehicle, area and GCash
--    details; an admin approves them before they can take orders.
-- 2. Admins create stores for an owner email and manage any store's catalog
--    and details. Owners always set their own password: if the email has no
--    account yet, the store is linked when that email signs up.

-- ---------------------------------------------------------------------------
-- Rider applications
-- ---------------------------------------------------------------------------
alter type public.rider_status add value if not exists 'pending' before 'active';

-- Validates and stores a rider application for p_user (pending until approved).
create or replace function public.upsert_rider_application(
  p_user uuid, p_full_name text, p_phone text, p_vehicle public.vehicle_type, p_plate text,
  p_service_area_id uuid, p_gcash_name text, p_gcash_number text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_number text := regexp_replace(coalesce(p_gcash_number, ''), '[\s-]', '', 'g');
begin
  if coalesce(trim(p_full_name), '') = '' or char_length(trim(p_full_name)) > 120 then
    raise exception 'Enter your full name.' using errcode = 'P0001', hint = 'invalid_name';
  end if;
  if coalesce(trim(p_phone), '') !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception 'Enter a mobile number like 0917 123 4567.' using errcode = 'P0001', hint = 'invalid_phone';
  end if;
  if not exists (select 1 from public.service_areas where id = p_service_area_id and is_active) then
    raise exception 'Choose an area where GETGO operates.' using errcode = 'P0001', hint = 'invalid_area';
  end if;
  if coalesce(trim(p_gcash_name), '') = '' then
    raise exception 'Enter the name on your GCash account.' using errcode = 'P0001', hint = 'invalid_gcash';
  end if;
  if v_number !~ '^(\+63|0)9[0-9]{9}$' then
    raise exception 'Enter your GCash number, e.g. 0917 123 4567.' using errcode = 'P0001', hint = 'invalid_gcash';
  end if;

  select status::text into v_status from public.rider_profiles where user_id = p_user;
  if v_status = 'active' then
    raise exception 'You are already a GETGO rider.' using errcode = 'P0001', hint = 'already_rider';
  elsif v_status = 'suspended' then
    raise exception 'Your rider account is suspended. Contact GETGO support.' using errcode = 'P0001', hint = 'suspended';
  end if;

  insert into public.rider_profiles (user_id, full_name, phone, vehicle_type, plate_number, service_area_id, gcash_name, gcash_number, status)
  values (p_user, trim(p_full_name), trim(p_phone), p_vehicle, nullif(upper(trim(p_plate)), ''), p_service_area_id,
    trim(p_gcash_name), v_number, 'pending'::text::public.rider_status)
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone,
    vehicle_type = excluded.vehicle_type, plate_number = excluded.plate_number,
    service_area_id = excluded.service_area_id, gcash_name = excluded.gcash_name, gcash_number = excluded.gcash_number;

  if v_status is null then
    perform public.notify_staff('rider.applied', 'New rider application', trim(p_full_name), '/admin/riders');
  end if;
end $$;

-- A signed-in user applies (or updates their pending application).
create or replace function public.apply_as_rider(
  p_full_name text, p_phone text, p_vehicle public.vehicle_type, p_plate text,
  p_service_area_id uuid, p_gcash_name text, p_gcash_number text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  perform public.upsert_rider_application(auth.uid(), p_full_name, p_phone, p_vehicle, p_plate,
    p_service_area_id, p_gcash_name, p_gcash_number);
end $$;

-- Approving a rider grants the rider role; suspending releases deliveries.
create or replace function public.set_rider_status(p_user_id uuid, p_status public.rider_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_status::text = 'pending' then
    raise exception 'Choose active or suspended.' using errcode = 'P0001', hint = 'invalid_status';
  end if;
  update public.rider_profiles set status = p_status where user_id = p_user_id;
  if not found then
    raise exception 'Rider not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if p_status::text = 'active' then
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, 'rider', auth.uid()) on conflict do nothing;
    perform public.notify(p_user_id, 'rider.approved', 'You’re approved as a GETGO rider', 'Open the rider app to see orders near you.', '/rider');
  else
    update public.assignments set status = 'released', completed_at = now() where rider_id = p_user_id and status = 'active';
  end if;
  perform public.log_audit('rider.status_changed', 'rider', p_user_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.reject_rider_application(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Tell the applicant why.' using errcode = 'P0001', hint = 'reason_required';
  end if;
  delete from public.rider_profiles where user_id = p_user_id and status::text = 'pending';
  if not found then
    raise exception 'No pending application for this person.' using errcode = 'P0001', hint = 'not_found';
  end if;
  perform public.notify(p_user_id, 'rider.rejected', 'Your rider application wasn’t approved', trim(p_reason), '/rider');
  perform public.log_audit('rider.rejected', 'rider', p_user_id::text, jsonb_build_object('reason', trim(p_reason)));
end $$;

-- Admin-added riders are active immediately (this also activates a pending application).
create or replace function public.create_rider(
  p_email text, p_full_name text, p_phone text, p_vehicle public.vehicle_type, p_plate text, p_service_area_id uuid,
  p_gcash_name text, p_gcash_number text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No GETGO account uses this email. Ask the rider to sign up first.' using errcode = 'P0001', hint = 'user_not_found';
  end if;
  insert into public.rider_profiles (user_id, full_name, phone, vehicle_type, plate_number, service_area_id, gcash_name, gcash_number, status)
  values (v_user, trim(p_full_name), trim(p_phone), p_vehicle, nullif(trim(p_plate), ''), p_service_area_id,
    trim(p_gcash_name), regexp_replace(coalesce(p_gcash_number, ''), '[\s-]', '', 'g'), 'active')
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone,
    vehicle_type = excluded.vehicle_type, plate_number = excluded.plate_number, service_area_id = excluded.service_area_id,
    gcash_name = excluded.gcash_name, gcash_number = excluded.gcash_number,
    status = case when public.rider_profiles.status::text = 'pending' then 'active'::public.rider_status else public.rider_profiles.status end;
  insert into public.user_roles (user_id, role, granted_by) values (v_user, 'rider', auth.uid()) on conflict do nothing;
  perform public.log_audit('rider.saved', 'rider', v_user::text, jsonb_build_object('email', p_email));
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Stores created by admins
-- ---------------------------------------------------------------------------
-- Owner email for a store whose owner hasn't signed up yet.
alter table public.merchants add column pending_owner_email text
  check (pending_owner_email is null or pending_owner_email = lower(pending_owner_email));
create index merchants_pending_owner_idx on public.merchants (pending_owner_email) where pending_owner_email is not null;

-- p_store: { name, category, description?, phone?, address_line, barangay,
--            city, service_area_id, hours?: [{weekday, opens, closes}] }
create or replace function public.admin_create_store(p_owner_email text, p_store jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(coalesce(p_owner_email, '')));
  v_owner uuid;
  v_merchant_id uuid;
  v_slug text;
  v_base text;
  v_n int := 1;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can create stores.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid owner email.' using errcode = 'P0001', hint = 'invalid_email';
  end if;
  if coalesce(trim(p_store ->> 'name'), '') = '' then
    raise exception 'Enter the store name.' using errcode = 'P0001', hint = 'name_required';
  end if;
  if coalesce(p_store ->> 'category', '') not in ('restaurant', 'cafe', 'bakery', 'grocery', 'convenience', 'specialty') then
    raise exception 'Choose a store category.' using errcode = 'P0001', hint = 'invalid_category';
  end if;
  if coalesce(trim(p_store ->> 'address_line'), '') = '' or coalesce(trim(p_store ->> 'barangay'), '') = ''
     or coalesce(trim(p_store ->> 'city'), '') = '' then
    raise exception 'Enter the store’s full address.' using errcode = 'P0001', hint = 'address_required';
  end if;
  if not exists (select 1 from public.service_areas where id = nullif(p_store ->> 'service_area_id', '')::uuid) then
    raise exception 'Choose the store’s service area.' using errcode = 'P0001', hint = 'invalid_area';
  end if;
  if p_store ? 'hours' then
    perform public.validate_hours(p_store -> 'hours');
  end if;

  select id into v_owner from public.profiles where lower(email) = v_email;

  v_base := coalesce(nullif(public.slugify(p_store ->> 'name'), ''), 'store');
  v_slug := v_base;
  while exists (select 1 from public.merchants where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.merchants (slug, name, category, description, phone, address_line, barangay, city, service_area_id, pending_owner_email)
  values (v_slug, trim(p_store ->> 'name'), (p_store ->> 'category')::public.merchant_category,
    nullif(trim(p_store ->> 'description'), ''), nullif(trim(p_store ->> 'phone'), ''),
    trim(p_store ->> 'address_line'), trim(p_store ->> 'barangay'), trim(p_store ->> 'city'),
    (p_store ->> 'service_area_id')::uuid, case when v_owner is null then v_email end)
  returning id into v_merchant_id;

  if v_owner is not null then
    insert into public.merchant_members (merchant_id, user_id, role) values (v_merchant_id, v_owner, 'owner');
    perform public.notify(v_owner, 'store.created', format('%s is on GETGO', trim(p_store ->> 'name')),
      'Add your products, then publish your store.', '/merchant');
  end if;

  if jsonb_array_length(coalesce(p_store -> 'hours', '[]')) > 0 then
    insert into public.store_hours (merchant_id, weekday, opens_at, closes_at)
    select v_merchant_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
    from jsonb_array_elements(p_store -> 'hours') h;
  end if;

  perform public.log_audit('store.created_by_admin', 'merchant', v_merchant_id::text,
    jsonb_build_object('owner_email', v_email, 'owner_linked', v_owner is not null));
  return jsonb_build_object('merchant_id', v_merchant_id, 'owner_linked', v_owner is not null, 'slug', v_slug);
end $$;

-- New accounts: create the profile, record a rider application sent with the
-- rider sign-up form, and claim stores an admin created for this email.
-- Invalid rider details never block account creation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app jsonb := new.raw_user_meta_data -> 'rider_application';
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120),
    case when trim(new.raw_user_meta_data ->> 'phone') ~ '^\+?[0-9 ()-]{7,20}$' then trim(new.raw_user_meta_data ->> 'phone') end
  )
  on conflict (id) do nothing;

  if jsonb_typeof(v_app) = 'object' then
    begin
      perform public.upsert_rider_application(new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone',
        (v_app ->> 'vehicle')::public.vehicle_type, v_app ->> 'plate', (v_app ->> 'service_area_id')::uuid,
        v_app ->> 'gcash_name', v_app ->> 'gcash_number');
    exception when others then
      null; -- the rider can complete the application after signing in
    end;
  end if;

  if new.email is not null then
    insert into public.merchant_members (merchant_id, user_id, role)
    select id, new.id, 'owner' from public.merchants where pending_owner_email = lower(new.email)
    on conflict do nothing;
    update public.merchants set pending_owner_email = null where pending_owner_email = lower(new.email);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Admins manage any store's catalog and details
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_merchant(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_merchant_member(p_merchant_id, array['owner', 'manager']::public.member_role[]) or public.is_admin();
$$;

create or replace function public.set_store_paused(p_merchant_id uuid, p_paused boolean, p_until timestamptz default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_merchant_member(p_merchant_id) or public.is_admin()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_paused and p_until is not null and p_until <= now() then
    raise exception 'Choose a time in the future.' using errcode = 'P0001', hint = 'invalid_time';
  end if;
  update public.merchants
  set accepting_orders = not p_paused, paused_until = case when p_paused then p_until end
  where id = p_merchant_id;
end $$;

create or replace function public.set_product_availability(p_product_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select merchant_id into v_merchant_id from public.products where id = p_product_id;
  if v_merchant_id is null or not (public.is_merchant_member(v_merchant_id) or public.is_admin()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.products set is_available = p_available where id = p_product_id;
end $$;

create or replace function public.set_option_availability(p_option_value_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select g.merchant_id into v_merchant_id from public.option_values v
  join public.option_groups g on g.id = v.group_id where v.id = p_option_value_id;
  if v_merchant_id is null or not (public.is_merchant_member(v_merchant_id) or public.is_admin()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.option_values set is_available = p_available where id = p_option_value_id;
end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'applications_waiting', (select count(*) from public.partner_applications where status in ('submitted', 'under_review')),
    'orders_today', (select count(*) from public.orders where (created_at at time zone 'Asia/Manila')::date = v_today),
    'orders_open', (select count(*) from public.orders where status in ('pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery')),
    'orders_waiting_for_rider', (select count(*) from public.orders where status = 'pending'),
    'payments_to_confirm', (select count(*) from public.orders where status = 'payment_submitted'),
    'gmv_today_minor', (select coalesce(sum(total_minor), 0) from public.orders
        where status = 'completed' and (completed_at at time zone 'Asia/Manila')::date = v_today),
    'active_merchants', (select count(*) from public.merchants where status = 'active' and is_published),
    'open_tickets', (select count(*) from public.support_tickets where status in ('open', 'pending')),
    'refunds_waiting', (select count(*) from public.refunds where status in ('requested', 'approved')),
    'riders_pending', (select count(*) from public.rider_profiles where status::text = 'pending')
  );
end $$;

revoke execute on function public.upsert_rider_application(uuid, text, text, public.vehicle_type, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.apply_as_rider(text, text, public.vehicle_type, text, uuid, text, text) from public, anon;
revoke execute on function public.reject_rider_application(uuid, text) from public, anon;
revoke execute on function public.admin_create_store(text, jsonb) from public, anon;
grant execute on function public.apply_as_rider(text, text, public.vehicle_type, text, uuid, text, text) to authenticated;
grant execute on function public.reject_rider_application(uuid, text) to authenticated;
grant execute on function public.admin_create_store(text, jsonb) to authenticated;
