-- GETGO foundation: enums, identity, roles, platform configuration, addresses,
-- notifications and audit logging.
--
-- Conventions used across all migrations:
--   * Money is stored as bigint minor units (centavos) with an explicit currency.
--   * Every exposed table has RLS enabled and explicit grants. Supabase grants
--     ALL to anon/authenticated by default, so each table revokes first and then
--     grants only what clients need. Multi-row or privileged writes go through
--     SECURITY DEFINER functions that re-check permissions themselves.
--   * Business-local time is Asia/Manila.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'support', 'finance', 'rider');
create type public.application_status as enum ('draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'rejected');
create type public.merchant_category as enum ('restaurant', 'cafe', 'bakery', 'grocery', 'convenience', 'specialty');
create type public.merchant_status as enum ('active', 'suspended', 'closed');
create type public.member_role as enum ('owner', 'manager', 'staff');
create type public.product_status as enum ('draft', 'published', 'archived');
create type public.order_status as enum (
  'awaiting_payment', 'pending', 'accepted', 'preparing', 'ready',
  'out_for_delivery', 'completed', 'rejected', 'cancelled'
);
create type public.fulfillment_type as enum ('delivery', 'pickup');
create type public.payment_method as enum ('cod', 'online');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded');
create type public.refund_status as enum ('requested', 'approved', 'processed', 'rejected');
create type public.settlement_status as enum ('draft', 'approved', 'paid');
create type public.ticket_status as enum ('open', 'pending', 'resolved', 'closed');
create type public.service_type as enum ('pabili', 'padala', 'errand');
create type public.booking_status as enum ('requested', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type public.assignment_status as enum ('active', 'completed', 'released');
create type public.rider_status as enum ('active', 'suspended');
create type public.vehicle_type as enum ('motorcycle', 'bicycle', 'car');
create type public.document_type as enum ('business_permit', 'dti_sec_registration', 'bir_registration', 'government_id', 'food_safety_permit', 'other');

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Role helpers. SECURITY DEFINER so they can read user_roles regardless of the
-- caller's RLS visibility; they only ever answer about auth.uid().
create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('admin');
$$;

-- Platform staff: anyone with an operational back-office role.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'support', 'finance')
  );
$$;

create or replace function public.my_roles()
returns public.app_role[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(role order by role), '{}') from public.user_roles where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only; written only by trusted functions and triggers)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function public.log_audit(p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'));
$$;

-- Generic row-change audit trigger for configuration tables.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text;
begin
  v_id := case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  perform public.log_audit(
    lower(tg_op), tg_table_name, v_id,
    case tg_op
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      else jsonb_build_object('old', to_jsonb(old))
    end
  );
  return coalesce(new, old);
end $$;

create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Platform configuration
-- ---------------------------------------------------------------------------
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  city text not null,
  province text not null,
  is_active boolean not null default false,
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  service_fee_minor bigint not null default 0 check (service_fee_minor >= 0),
  small_order_threshold_minor bigint check (small_order_threshold_minor is null or small_order_threshold_minor > 0),
  small_order_fee_minor bigint not null default 0 check (small_order_fee_minor >= 0),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger service_areas_touch before update on public.service_areas
  for each row execute function public.touch_updated_at();
create trigger service_areas_audit after insert or update or delete on public.service_areas
  for each row execute function public.audit_row_change();

-- Single-row platform settings. Commission terms are configured by an admin;
-- nothing here is pre-filled with invented commercial terms.
create table public.platform_settings (
  id boolean primary key default true check (id),
  online_payments_enabled boolean not null default false,
  payment_expiry_minutes int not null default 30 check (payment_expiry_minutes between 5 and 240),
  standard_commission_bps int check (standard_commission_bps is null or standard_commission_bps between 0 and 5000),
  partner_fee_note text check (char_length(partner_fee_note) <= 2000),
  support_email text,
  support_phone text,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true);
create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();
create trigger platform_settings_audit after update on public.platform_settings
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Customer addresses
-- ---------------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  recipient_name text not null check (char_length(recipient_name) between 2 and 120),
  phone text not null check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  line1 text not null check (char_length(line1) between 3 and 200),
  barangay text not null check (char_length(barangay) between 2 and 80),
  city text not null check (char_length(city) between 2 and 80),
  landmark text check (char_length(landmark) <= 200),
  service_area_id uuid not null references public.service_areas (id),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create unique index addresses_one_default on public.addresses (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, p_title, p_body, p_link);
$$;

create or replace function public.notify_staff(p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct user_id, p_kind, p_title, p_body, p_link
  from public.user_roles where role in ('admin', 'support');
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.service_areas enable row level security;
alter table public.platform_settings enable row level security;
alter table public.addresses enable row level security;
alter table public.notifications enable row level security;

revoke all on public.profiles, public.user_roles, public.audit_logs, public.service_areas,
  public.platform_settings, public.addresses, public.notifications from anon, authenticated;

-- profiles: users read and edit their own name/phone; staff can read all.
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: users see their own roles, admins see all. No client writes; roles
-- change only through admin functions.
grant select on public.user_roles to authenticated;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- audit_logs: admins only, read-only.
grant select on public.audit_logs to authenticated;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_admin());

-- service_areas: active areas are public; admins manage all.
grant select on public.service_areas to anon, authenticated;
grant insert, update, delete on public.service_areas to authenticated;
create policy service_areas_public_select on public.service_areas for select to anon, authenticated
  using (is_active or public.is_staff());
create policy service_areas_admin_insert on public.service_areas for insert to authenticated
  with check (public.is_admin());
create policy service_areas_admin_update on public.service_areas for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy service_areas_admin_delete on public.service_areas for delete to authenticated
  using (public.is_admin());

-- platform_settings: readable by everyone (it carries only public-facing terms
-- and feature flags); only admins update.
grant select on public.platform_settings to anon, authenticated;
grant update (online_payments_enabled, payment_expiry_minutes, standard_commission_bps,
  partner_fee_note, support_email, support_phone) on public.platform_settings to authenticated;
create policy platform_settings_select on public.platform_settings for select to anon, authenticated using (true);
create policy platform_settings_update on public.platform_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- addresses: owner only.
grant select, insert, delete on public.addresses to authenticated;
grant update (label, recipient_name, phone, line1, barangay, city, landmark, service_area_id, is_default)
  on public.addresses to authenticated;
create policy addresses_select on public.addresses for select to authenticated using (user_id = auth.uid());
create policy addresses_insert on public.addresses for insert to authenticated with check (user_id = auth.uid());
create policy addresses_update on public.addresses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_delete on public.addresses for delete to authenticated using (user_id = auth.uid());

-- notifications: owner reads and marks read.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Internal helpers are not callable by clients.
revoke execute on function public.log_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_staff(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.audit_row_change() from public, anon, authenticated;
