-- Riders go online and offline.
--
-- An active rider switches "online" when they're ready to take orders. While
-- online, the rider app checks in every couple of minutes; a rider whose app
-- hasn't checked in for 30 minutes (app closed, phone off) counts as offline
-- until they open it again, so a forgotten switch doesn't leave customers
-- waiting on nobody.
--
-- Customers can place a new order (pabili, padala or errand) only while at
-- least one rider in that service area is online, and only online riders can
-- accept orders. Orders already placed keep going as before; staff can still
-- assign any active rider.

alter table public.rider_profiles
  add column is_online boolean not null default false,
  add column last_seen_at timestamptz;

-- How long a rider stays online without the app checking in.
create or replace function public.rider_presence_window()
returns interval language sql immutable as $$ select interval '30 minutes' $$;

create or replace function public.rider_profile_online(p_rider public.rider_profiles)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_rider.status = 'active' and p_rider.is_online
    and p_rider.last_seen_at > now() - public.rider_presence_window();
$$;

-- Number of riders online in an area. Safe for anyone: it's only a count.
create or replace function public.online_rider_count(p_service_area_id uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.rider_profiles r
  where r.service_area_id = p_service_area_id and public.rider_profile_online(r);
$$;

-- The rider goes online or offline. Returns their presence.
create or replace function public.rider_set_online(p_online boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rider public.rider_profiles%rowtype;
begin
  update public.rider_profiles set is_online = coalesce(p_online, false), last_seen_at = now()
  where user_id = auth.uid() and status = 'active'
  returning * into v_rider;
  if not found then
    raise exception 'Only approved, active riders can go online.' using errcode = 'P0001', hint = 'not_active_rider';
  end if;
  return jsonb_build_object('is_online', v_rider.is_online, 'last_seen_at', v_rider.last_seen_at);
end $$;

-- The rider app checks in while it's open, keeping an online rider online.
create or replace function public.rider_heartbeat()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.rider_profiles set last_seen_at = now()
  where user_id = auth.uid() and status = 'active' and is_online;
$$;

-- New customer orders need a rider online in the area. Orders created outside
-- a signed-in session (seed data, maintenance) are not checked.
create or replace function public.orders_require_online_rider()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.status = 'pending' and public.online_rider_count(new.service_area_id) = 0 then
    raise exception 'No riders are online right now, so you can’t order yet. Please try again in a little while.'
      using errcode = 'P0001', hint = 'no_riders_online';
  end if;
  return new;
end $$;
create trigger orders_require_online_rider before insert on public.orders
  for each row execute function public.orders_require_online_rider();

-- Only online riders can accept orders. Accepting also counts as checking in.
create or replace function public.rider_accept_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.is_area_rider(v_order.service_area_id) then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if not exists (select 1 from public.rider_profiles r where r.user_id = auth.uid() and r.is_online) then
    raise exception 'Go online to accept orders.' using errcode = 'P0001', hint = 'rider_offline';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Another rider already accepted this order.' using errcode = 'P0001', hint = 'already_taken';
  end if;
  update public.rider_profiles set last_seen_at = now() where user_id = auth.uid();
  perform public.start_assignment(p_order_id, auth.uid(), auth.uid());
  perform public.record_transition(p_order_id, 'pending', 'accepted', 'rider', null);
end $$;

-- Suspended riders go offline.
create or replace function public.rider_profiles_offline_when_inactive()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> 'active' then
    new.is_online := false;
  end if;
  return new;
end $$;
create trigger rider_profiles_offline_when_inactive before update of status on public.rider_profiles
  for each row execute function public.rider_profiles_offline_when_inactive();

revoke execute on function public.rider_profile_online(public.rider_profiles) from public, anon, authenticated;
revoke execute on function public.orders_require_online_rider() from public, anon, authenticated;
revoke execute on function public.rider_profiles_offline_when_inactive() from public, anon, authenticated;
revoke execute on function public.online_rider_count(uuid) from public;
revoke execute on function public.rider_set_online(boolean) from public, anon;
revoke execute on function public.rider_heartbeat() from public, anon;
grant execute on function public.online_rider_count(uuid) to anon, authenticated;
grant execute on function public.rider_set_online(boolean) to authenticated;
grant execute on function public.rider_heartbeat() to authenticated;
