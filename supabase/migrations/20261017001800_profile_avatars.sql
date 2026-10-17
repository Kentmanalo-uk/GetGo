-- Profile pictures. Each person uploads to media/avatars/<their id>/ and saves
-- the path on their profile; nobody else can write there.

alter table public.profiles
  add column avatar_path text check (avatar_path is null or avatar_path ~ ('^avatars/' || id::text || '/[A-Za-z0-9._-]+$'));
grant update (avatar_path) on public.profiles to authenticated;

create or replace function public.storage_media_writable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if array_length(v_parts, 1) < 3 or v_parts[2] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  if v_parts[1] = 'merchants' then
    return public.can_manage_merchant(v_parts[2]::uuid);
  elsif v_parts[1] = 'applications' then
    return public.application_is_editable(v_parts[2]::uuid);
  elsif v_parts[1] = 'avatars' then
    return array_length(v_parts, 1) = 3 and v_parts[2]::uuid = auth.uid();
  end if;
  return false;
end $$;
