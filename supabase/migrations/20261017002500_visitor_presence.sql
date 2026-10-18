-- Who's using GETGO right now.
--
-- While the app is open it checks in about once a minute (track_visit) with
-- the page, the kind of device and browser, and whether it runs in a browser,
-- as an installed app, or in the Android app. One row per device
-- (visitor_id, kept in the browser); signed-in people are linked to their
-- account. Nothing else is collected: no IP address, no location. Visits are
-- deleted after 30 days; an account's last-seen time is kept with the account.
--
-- Staff (admin, support) see who's online now (checked in within the last 2
-- minutes), today's visitors, and every account with when it was last seen.

create table public.site_visits (
  visitor_id uuid primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  path text not null default '/',
  device text,
  browser text,
  app text not null default 'browser' check (app in ('browser', 'installed', 'android_app')),
  page_views int not null default 1
);
create index site_visits_last_seen_idx on public.site_visits (last_seen_at desc);
create index site_visits_user_idx on public.site_visits (user_id) where user_id is not null;

-- An account's latest activity, kept as long as the account.
create table public.account_activity (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_path text,
  last_device text
);

alter table public.site_visits enable row level security;
alter table public.account_activity enable row level security;
revoke all on public.site_visits, public.account_activity from anon, authenticated;

-- Seconds since a check-in that still count as "online".
create or replace function public.online_window()
returns interval language sql immutable as $$ select interval '2 minutes' $$;

-- The app checks in. Cheap and safe to call often: repeated calls within 20
-- seconds on the same page change nothing.
create or replace function public.track_visit(p_visitor_id uuid, p_path text, p_device text, p_browser text, p_app text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_path text := left(coalesce(nullif(trim(p_path), ''), '/'), 200);
  v_device text := nullif(left(trim(coalesce(p_device, '')), 40), '');
  v_browser text := nullif(left(trim(coalesce(p_browser, '')), 40), '');
  v_app text := case when p_app in ('browser', 'installed', 'android_app') then p_app else 'browser' end;
begin
  if p_visitor_id is null then
    return;
  end if;
  if left(v_path, 1) <> '/' then
    v_path := '/';
  end if;

  insert into public.site_visits as v (visitor_id, user_id, path, device, browser, app)
  values (p_visitor_id, v_user, v_path, v_device, v_browser, v_app)
  on conflict (visitor_id) do update set
    last_seen_at = now(),
    user_id = excluded.user_id,
    path = excluded.path,
    device = coalesce(excluded.device, v.device),
    browser = coalesce(excluded.browser, v.browser),
    app = excluded.app,
    page_views = v.page_views + case when v.path is distinct from excluded.path then 1 else 0 end
  where v.last_seen_at < now() - interval '20 seconds'
     or v.path is distinct from excluded.path
     or v.user_id is distinct from excluded.user_id;

  if v_user is not null then
    insert into public.account_activity as a (user_id, last_seen_at, last_path, last_device)
    values (v_user, now(), v_path, v_device)
    on conflict (user_id) do update set last_seen_at = now(), last_path = excluded.last_path,
      last_device = coalesce(excluded.last_device, a.last_device)
    where a.last_seen_at < now() - interval '20 seconds' or a.last_path is distinct from excluded.last_path;
  end if;

  -- Now and then, forget visits older than 30 days.
  if random() < 0.01 then
    delete from public.site_visits where last_seen_at < now() - interval '30 days';
  end if;
end $$;

create or replace function public.can_view_visitors()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('admin') or public.has_role('support');
$$;

-- What kind of account someone has, for the visitors list.
create or replace function public.account_kind(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then 'Admin'
    when exists (select 1 from public.user_roles where user_id = p_user and role in ('support', 'finance')) then 'Staff'
    when exists (select 1 from public.rider_profiles where user_id = p_user) then 'Rider'
    when exists (select 1 from public.merchant_members where user_id = p_user) then 'Store'
    else 'Customer'
  end;
$$;

-- Who's online now, and today's numbers.
create or replace function public.admin_visitors()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - public.online_window();
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila')) at time zone 'Asia/Manila';
begin
  if not public.can_view_visitors() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'online_total', (select count(*) from public.site_visits where last_seen_at > v_since),
    'online_signed_in', (select count(distinct user_id) from public.site_visits where last_seen_at > v_since and user_id is not null),
    'online_guests', (select count(*) from public.site_visits where last_seen_at > v_since and user_id is null),
    'today_visitors', (select count(*) from public.site_visits where last_seen_at >= v_today),
    'today_signed_in', (select count(distinct user_id) from public.site_visits where last_seen_at >= v_today and user_id is not null),
    'accounts_total', (select count(*) from public.profiles),
    'online', coalesce((
      select jsonb_agg(row_to_json(o) order by o.last_seen_at desc)
      from (
        select v.visitor_id, v.user_id, p.full_name, p.email,
          case when v.user_id is null then 'Guest' else public.account_kind(v.user_id) end as kind,
          v.path, v.device, v.browser, v.app, v.page_views, v.first_seen_at, v.last_seen_at
        from public.site_visits v
        left join public.profiles p on p.id = v.user_id
        where v.last_seen_at > v_since
        order by v.last_seen_at desc
        limit 300
      ) o
    ), '[]'::jsonb)
  );
end $$;

-- Every account, most recently active first. Search by name, email or phone.
create or replace function public.admin_accounts(p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.can_view_visitors() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r))
    from (
      select p.id, p.full_name, p.email, p.phone, p.created_at, public.account_kind(p.id) as kind,
        a.last_seen_at, a.last_path, a.last_device,
        coalesce(a.last_seen_at > now() - public.online_window(), false) as online
      from public.profiles p
      left join public.account_activity a on a.user_id = p.id
      where v_q is null
         or p.full_name ilike '%' || v_q || '%' or p.email ilike '%' || v_q || '%' or p.phone ilike '%' || v_q || '%'
      order by a.last_seen_at desc nulls last, p.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) r
  ), '[]'::jsonb);
end $$;

revoke execute on function public.online_window() from public, anon, authenticated;
revoke execute on function public.can_view_visitors() from public, anon;
revoke execute on function public.account_kind(uuid) from public, anon, authenticated;
revoke execute on function public.track_visit(uuid, text, text, text, text) from public;
revoke execute on function public.admin_visitors() from public, anon;
revoke execute on function public.admin_accounts(text, int, int) from public, anon;
grant execute on function public.track_visit(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.can_view_visitors() to authenticated;
grant execute on function public.admin_visitors() to authenticated;
grant execute on function public.admin_accounts(text, int, int) to authenticated;
