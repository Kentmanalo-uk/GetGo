-- Email verification that doesn't block sign-in.
--
-- With Supabase's "Confirm email" turned off, people use the app immediately
-- after signing up, and auth.users.email_confirmed_at is set automatically —
-- so it no longer proves anything. GETGO tracks verification itself:
-- the user requests an email sign-in link, opens it, and the resulting
-- session (whose JWT records an email-link sign-in in its `amr` claim) calls
-- confirm_email_verification(). Clients cannot set the column directly.

alter table public.profiles add column email_verified_at timestamptz;

-- Changing the account email requires verifying the new address.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles set email = new.email, email_verified_at = null where id = new.id;
  return new;
end $$;

create or replace function public.confirm_email_verification()
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claims jsonb := auth.jwt();
  v_proven boolean;
  v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  -- An email link (magic link / OTP, signup confirmation or recovery) used
  -- within the last hour proves the user controls the inbox.
  select exists (
    select 1 from jsonb_array_elements(coalesce(v_claims -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink', 'email/signup', 'recovery')
      and to_timestamp((a ->> 'timestamp')::double precision) > now() - interval '1 hour'
  ) into v_proven;

  if not v_proven then
    raise exception 'Open the verification link from your email on this device.' using errcode = 'P0001', hint = 'not_verified';
  end if;

  update public.profiles
  set email_verified_at = coalesce(email_verified_at, now())
  where id = auth.uid() and lower(email) = lower(v_claims ->> 'email')
  returning email_verified_at into v_at;

  if v_at is null then
    raise exception 'This link was for a different email address.' using errcode = 'P0001', hint = 'email_mismatch';
  end if;
  return v_at;
end $$;

revoke execute on function public.confirm_email_verification() from public, anon;
grant execute on function public.confirm_email_verification() to authenticated;
