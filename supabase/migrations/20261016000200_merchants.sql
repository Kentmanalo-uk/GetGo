-- Partner applications, merchants, memberships and opening hours.

-- ---------------------------------------------------------------------------
-- Partner applications
-- ---------------------------------------------------------------------------
create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.application_status not null default 'draft',
  business_name text check (char_length(business_name) <= 120),
  category public.merchant_category,
  description text check (char_length(description) <= 600),
  owner_name text check (char_length(owner_name) <= 120),
  owner_phone text check (owner_phone is null or owner_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  owner_email text check (char_length(owner_email) <= 200),
  business_phone text check (business_phone is null or business_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  address_line text check (char_length(address_line) <= 200),
  barangay text check (char_length(barangay) <= 80),
  city text check (char_length(city) <= 80),
  service_area_id uuid references public.service_areas (id),
  -- [{ "weekday": 0-6, "opens": "HH:MM", "closes": "HH:MM" }]
  hours jsonb not null default '[]' check (jsonb_typeof(hours) = 'array'),
  prep_time_minutes int check (prep_time_minutes is null or prep_time_minutes between 5 and 180),
  supports_delivery boolean not null default true,
  supports_pickup boolean not null default false,
  logo_path text,
  cover_path text,
  -- [{ "name": text, "description": text, "price_minor": int, "category": text }]
  menu_items jsonb not null default '[]' check (jsonb_typeof(menu_items) = 'array'),
  review_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  merchant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_applications_status_idx on public.partner_applications (status, submitted_at);
-- One open application per applicant.
create unique index partner_applications_one_open on public.partner_applications (applicant_id)
  where status in ('draft', 'submitted', 'under_review', 'needs_changes');
create trigger partner_applications_touch before update on public.partner_applications
  for each row execute function public.touch_updated_at();

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications (id) on delete cascade,
  applicant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  doc_type public.document_type not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index application_documents_app_idx on public.application_documents (application_id);

create or replace function public.application_is_editable(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.partner_applications
    where id = p_application_id and applicant_id = auth.uid() and status in ('draft', 'needs_changes')
  );
$$;

-- ---------------------------------------------------------------------------
-- Merchants and memberships
-- ---------------------------------------------------------------------------
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  category public.merchant_category not null,
  description text check (char_length(description) <= 600),
  phone text,
  address_line text not null,
  barangay text not null,
  city text not null,
  service_area_id uuid not null references public.service_areas (id),
  logo_path text,
  cover_path text,
  status public.merchant_status not null default 'active',
  is_published boolean not null default false,
  accepting_orders boolean not null default true,
  paused_until timestamptz,
  prep_time_minutes int not null default 20 check (prep_time_minutes between 5 and 180),
  min_order_minor bigint not null default 0 check (min_order_minor >= 0),
  supports_delivery boolean not null default true,
  supports_pickup boolean not null default false,
  commission_bps int not null check (commission_bps between 0 and 5000),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  application_id uuid references public.partner_applications (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supports_delivery or supports_pickup)
);
create index merchants_area_idx on public.merchants (service_area_id) where is_published and status = 'active';
create trigger merchants_touch before update on public.merchants
  for each row execute function public.touch_updated_at();

alter table public.partner_applications
  add constraint partner_applications_merchant_fk foreign key (merchant_id) references public.merchants (id) on delete set null;

create table public.merchant_members (
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);
create index merchant_members_user_idx on public.merchant_members (user_id);
create unique index merchant_members_one_owner on public.merchant_members (merchant_id) where role = 'owner';

create or replace function public.is_merchant_member(p_merchant_id uuid, p_roles public.member_role[] default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.merchant_members
    where merchant_id = p_merchant_id and user_id = auth.uid()
      and (p_roles is null or role = any (p_roles))
  );
$$;

create or replace function public.can_manage_merchant(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_merchant_member(p_merchant_id, array['owner', 'manager']::public.member_role[]);
$$;

create or replace function public.merchant_is_public(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.merchants m
    join public.service_areas sa on sa.id = m.service_area_id
    where m.id = p_merchant_id and m.is_published and m.status = 'active' and sa.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Opening hours (weekday: 0 = Sunday, matching extract(dow))
-- ---------------------------------------------------------------------------
create table public.store_hours (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  check (closes_at > opens_at)
);
create index store_hours_merchant_idx on public.store_hours (merchant_id, weekday);

create table public.store_hour_exceptions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text check (char_length(note) <= 120),
  unique (merchant_id, date),
  check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

create or replace function public.is_store_open(p_merchant_id uuid, p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_local timestamp := p_at at time zone 'Asia/Manila';
  v_exception public.store_hour_exceptions%rowtype;
begin
  select * into v_exception from public.store_hour_exceptions
  where merchant_id = p_merchant_id and date = v_local::date;
  if found then
    return not v_exception.is_closed
      and v_local::time >= v_exception.opens_at and v_local::time < v_exception.closes_at;
  end if;
  return exists (
    select 1 from public.store_hours
    where merchant_id = p_merchant_id
      and weekday = extract(dow from v_local)::int
      and v_local::time >= opens_at and v_local::time < closes_at
  );
end $$;

-- 'open' | 'paused' | 'closed', evaluated at query time on the server.
create or replace function public.store_state(p_merchant_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when m.status <> 'active' then 'closed'
    when not m.accepting_orders and (m.paused_until is null or m.paused_until > now()) then 'paused'
    when public.is_store_open(m.id) then 'open'
    else 'closed'
  end
  from public.merchants m where m.id = p_merchant_id;
$$;

-- Next time the store opens within the coming 7 days (null if never).
create or replace function public.next_open_at(p_merchant_id uuid)
returns timestamptz language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_local timestamp := now() at time zone 'Asia/Manila';
  v_day date;
  v_open time;
  v_exc public.store_hour_exceptions%rowtype;
begin
  for i in 0..7 loop
    v_day := v_local::date + i;
    select * into v_exc from public.store_hour_exceptions where merchant_id = p_merchant_id and date = v_day;
    if found then
      if not v_exc.is_closed and (i > 0 or v_exc.opens_at > v_local::time) then
        return (v_day + v_exc.opens_at) at time zone 'Asia/Manila';
      end if;
      continue;
    end if;
    select min(opens_at) into v_open from public.store_hours
    where merchant_id = p_merchant_id and weekday = extract(dow from v_day)::int
      and (i > 0 or opens_at > v_local::time);
    if v_open is not null then
      return (v_day + v_open) at time zone 'Asia/Manila';
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.partner_applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.store_hours enable row level security;
alter table public.store_hour_exceptions enable row level security;

revoke all on public.partner_applications, public.application_documents, public.merchants,
  public.merchant_members, public.store_hours, public.store_hour_exceptions from anon, authenticated;

-- partner_applications: applicants create and edit their own while editable;
-- status and review fields change only through workflow functions.
grant select on public.partner_applications to authenticated;
grant insert (business_name, category, description, owner_name, owner_phone, owner_email, business_phone,
  address_line, barangay, city, service_area_id, hours, prep_time_minutes, supports_delivery, supports_pickup,
  logo_path, cover_path, menu_items) on public.partner_applications to authenticated;
grant update (business_name, category, description, owner_name, owner_phone, owner_email, business_phone,
  address_line, barangay, city, service_area_id, hours, prep_time_minutes, supports_delivery, supports_pickup,
  logo_path, cover_path, menu_items) on public.partner_applications to authenticated;
create policy partner_applications_select on public.partner_applications for select to authenticated
  using (applicant_id = auth.uid() or public.has_role('admin') or public.has_role('support'));
create policy partner_applications_insert on public.partner_applications for insert to authenticated
  with check (applicant_id = auth.uid() and status = 'draft');
create policy partner_applications_update on public.partner_applications for update to authenticated
  using (applicant_id = auth.uid() and status in ('draft', 'needs_changes'))
  with check (applicant_id = auth.uid() and status in ('draft', 'needs_changes'));

-- application_documents: applicant manages while editable; reviewers read.
grant select, insert, delete on public.application_documents to authenticated;
create policy application_documents_select on public.application_documents for select to authenticated
  using (applicant_id = auth.uid() or public.has_role('admin') or public.has_role('support'));
create policy application_documents_insert on public.application_documents for insert to authenticated
  with check (
    applicant_id = auth.uid()
    and public.application_is_editable(application_id)
    and storage_path like auth.uid()::text || '/' || application_id::text || '/%'
  );
create policy application_documents_delete on public.application_documents for delete to authenticated
  using (applicant_id = auth.uid() and public.application_is_editable(application_id));

-- merchants: members and staff read the full record (the public storefront is
-- exposed through the storefronts view); owners/managers edit profile fields.
grant select on public.merchants to authenticated;
grant update (name, description, phone, logo_path, cover_path, prep_time_minutes, min_order_minor,
  supports_delivery, supports_pickup) on public.merchants to authenticated;
create policy merchants_select on public.merchants for select to authenticated
  using (public.is_merchant_member(id) or public.is_staff());
create policy merchants_update on public.merchants for update to authenticated
  using (public.can_manage_merchant(id)) with check (public.can_manage_merchant(id));

-- merchant_members: members see their team; changes go through functions.
grant select on public.merchant_members to authenticated;
create policy merchant_members_select on public.merchant_members for select to authenticated
  using (user_id = auth.uid() or public.is_merchant_member(merchant_id) or public.is_staff());

-- Team members can see each other's names and contact details.
create or replace function public.shares_merchant_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.merchant_members a
    join public.merchant_members b on b.merchant_id = a.merchant_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;
create policy profiles_select_team on public.profiles for select to authenticated
  using (public.shares_merchant_with(id));

-- store hours: public for public stores; members read; managers write.
grant select on public.store_hours, public.store_hour_exceptions to anon, authenticated;
grant insert, update, delete on public.store_hour_exceptions to authenticated;
create policy store_hours_select on public.store_hours for select to anon, authenticated
  using (public.merchant_is_public(merchant_id) or public.is_merchant_member(merchant_id) or public.is_staff());
create policy store_hour_exceptions_select on public.store_hour_exceptions for select to anon, authenticated
  using (public.merchant_is_public(merchant_id) or public.is_merchant_member(merchant_id) or public.is_staff());
create policy store_hour_exceptions_insert on public.store_hour_exceptions for insert to authenticated
  with check (public.can_manage_merchant(merchant_id));
create policy store_hour_exceptions_update on public.store_hour_exceptions for update to authenticated
  using (public.can_manage_merchant(merchant_id)) with check (public.can_manage_merchant(merchant_id));
create policy store_hour_exceptions_delete on public.store_hour_exceptions for delete to authenticated
  using (public.can_manage_merchant(merchant_id));
