-- Legal and privacy foundations (Philippines).
--
-- * Operator and Data Protection Officer details shown on the legal pages
--   (Data Privacy Act of 2012, RA 10173; Internet Transactions Act of 2023,
--   RA 11967, which asks online platforms to show who operates them).
-- * A record of which version of the Terms, Privacy Policy, Rider Terms and
--   Store Listing Terms each person accepted, and when.
-- * Data subject tools: a copy of your data (right of access/portability)
--   and an account deletion request that GETGO staff process (erasure,
--   subject to records the law requires GETGO to keep).

-- ---------------------------------------------------------------------------
-- Operator details (admins edit; everyone reads)
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column legal_name text check (char_length(legal_name) <= 200),
  add column business_address text check (char_length(business_address) <= 300),
  add column business_registration text check (char_length(business_registration) <= 200),
  add column dpo_name text check (char_length(dpo_name) <= 120),
  add column dpo_email text check (dpo_email is null or dpo_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant update (legal_name, business_address, business_registration, dpo_name, dpo_email) on public.platform_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Legal acceptances
-- ---------------------------------------------------------------------------
create table public.legal_acceptances (
  user_id uuid not null references public.profiles (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'rider_terms', 'store_terms')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;
create policy legal_acceptances_select on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Records that the signed-in person accepted these documents at this version.
create or replace function public.accept_legal(p_documents text[], p_version text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_documents is null or cardinality(p_documents) = 0
     or exists (select 1 from unnest(p_documents) d where d not in ('terms', 'privacy', 'rider_terms', 'store_terms'))
     or coalesce(p_version, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'invalid_request';
  end if;
  insert into public.legal_acceptances (user_id, document, version)
  select auth.uid(), d, p_version from unnest(p_documents) d
  on conflict do nothing;
end $$;

-- Sign-up forms pass { legal: { version, documents } } in the user metadata;
-- record it as soon as the profile exists.
create or replace function public.record_signup_legal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_legal jsonb;
begin
  select raw_user_meta_data -> 'legal' into v_legal from auth.users where id = new.id;
  if jsonb_typeof(v_legal) = 'object' and coalesce(v_legal ->> 'version', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and jsonb_typeof(v_legal -> 'documents') = 'array' then
    insert into public.legal_acceptances (user_id, document, version)
    select new.id, d, v_legal ->> 'version'
    from jsonb_array_elements_text(v_legal -> 'documents') d
    where d in ('terms', 'privacy', 'rider_terms', 'store_terms')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger profiles_record_signup_legal after insert on public.profiles
  for each row execute function public.record_signup_legal();

-- ---------------------------------------------------------------------------
-- Your data: a copy of everything GETGO holds about the signed-in person
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_user),
    'roles', coalesce((select jsonb_agg(role) from public.user_roles where user_id = v_user), '[]'),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.addresses a where a.user_id = v_user), '[]'),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'items', coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = o.id), '[]'),
        'payment', (select to_jsonb(pay) - 'confirmed_by' from public.payments pay where pay.order_id = o.id),
        'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) order by h.created_at)
                             from public.order_status_history h where h.order_id = o.id), '[]')
      ) order by o.created_at)
      from public.orders o where o.customer_id = v_user), '[]'),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r)) from public.reviews r where r.customer_id = v_user), '[]'),
    'support_tickets', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'messages', coalesce((select jsonb_agg(jsonb_build_object('from_staff', m.is_staff, 'body', m.body, 'at', m.created_at) order by m.created_at)
                              from public.ticket_messages m where m.ticket_id = t.id), '[]')))
      from public.support_tickets t where t.user_id = v_user), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.notifications n where n.user_id = v_user), '[]'),
    'rider_profile', (select to_jsonb(rp) from public.rider_profiles rp where rp.user_id = v_user),
    'rider_deliveries', coalesce((
      select jsonb_agg(jsonb_build_object('order_code', o.code, 'service', o.service, 'status', a.status,
        'accepted_at', a.created_at, 'completed_at', a.completed_at, 'total_minor', o.total_minor, 'subtotal_minor', o.subtotal_minor))
      from public.assignments a join public.orders o on o.id = a.order_id where a.rider_id = v_user), '[]'),
    'store_memberships', coalesce((
      select jsonb_agg(jsonb_build_object('store', m.name, 'role', mm.role, 'since', mm.created_at))
      from public.merchant_members mm join public.merchants m on m.id = mm.merchant_id where mm.user_id = v_user), '[]'),
    'legal_acceptances', coalesce((select jsonb_agg(to_jsonb(l) order by l.accepted_at) from public.legal_acceptances l where l.user_id = v_user), '[]')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion requests (processed by staff)
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion(p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_ticket uuid;
  v_open int;
begin
  if v_user is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select id into v_ticket from public.support_tickets
  where user_id = v_user and subject = 'Account deletion request' and status <> 'closed'
  order by created_at desc limit 1;
  if v_ticket is not null then
    return v_ticket;
  end if;
  select count(*) into v_open from public.orders
  where customer_id = v_user and status in ('accepted', 'payment_submitted', 'buying', 'out_for_delivery');
  if v_open > 0 then
    raise exception 'Finish or cancel your orders in progress before deleting your account.'
      using errcode = 'P0001', hint = 'orders_in_progress';
  end if;

  insert into public.support_tickets (user_id, subject, priority) values (v_user, 'Account deletion request', 'high')
  returning id into v_ticket;
  insert into public.ticket_messages (ticket_id, author_id, body)
  values (v_ticket, v_user, 'Please delete my GETGO account and personal data.'
    || coalesce(E'\n\nReason: ' || nullif(left(trim(p_reason), 1000), ''), ''));
  perform public.notify_staff('privacy.deletion_request', 'Account deletion request',
    'A customer asked to delete their account.', '/admin/support/' || v_ticket);
  return v_ticket;
end $$;

-- ---------------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.record_signup_legal() from public, anon, authenticated;
revoke execute on function public.accept_legal(text[], text) from public, anon;
revoke execute on function public.export_my_data() from public, anon;
revoke execute on function public.request_account_deletion(text) from public, anon;
grant execute on function public.accept_legal(text[], text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.request_account_deletion(text) to authenticated;
