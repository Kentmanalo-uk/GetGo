-- Accounts created before the on_auth_user_created trigger existed (or whose
-- trigger run failed) have no profile row, which leaves the app waiting for
-- one. Backfill them, and let a signed-in user repair their own profile.

insert into public.profiles (id, email, full_name, phone)
select u.id, u.email,
  left(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 120),
  case when trim(u.raw_user_meta_data ->> 'phone') ~ '^\+?[0-9 ()-]{7,20}$' then trim(u.raw_user_meta_data ->> 'phone') end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- The sign-up trigger copied the phone verbatim, so a malformed phone in
-- sign-up metadata violated profiles_phone_check and failed the whole sign-up.
-- Keep only phones that pass the check (the user can add one later).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120),
    case when trim(new.raw_user_meta_data ->> 'phone') ~ '^\+?[0-9 ()-]{7,20}$' then trim(new.raw_user_meta_data ->> 'phone') end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Creates the caller's profile from their auth record if it is missing.
-- Only ever touches auth.uid()'s own row.
create or replace function public.ensure_my_profile()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  insert into public.profiles (id, email, full_name, phone)
  select u.id, u.email,
    left(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 120),
    -- Phone is optional; drop values that don't pass the profile check.
    case when trim(u.raw_user_meta_data ->> 'phone') ~ '^\+?[0-9 ()-]{7,20}$' then trim(u.raw_user_meta_data ->> 'phone') end
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do nothing;
end $$;

revoke execute on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;
