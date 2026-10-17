-- Rider ratings and public rider profiles.
--
-- Customers rate the rider of a completed order (1–5 stars, optional
-- comment). Anyone signed in can see a rider's public profile: first name and
-- last initial, photo, vehicle type, whether GETGO verified them, how long
-- they've ridden, completed deliveries and rating. Phone, plate number, GCash
-- and other details stay private.

create table public.rider_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  rider_id uuid not null references public.rider_profiles (user_id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rider_reviews_rider_idx on public.rider_reviews (rider_id, created_at desc);
create trigger rider_reviews_touch before update on public.rider_reviews
  for each row execute function public.touch_updated_at();

alter table public.rider_reviews enable row level security;
revoke all on public.rider_reviews from anon, authenticated;
grant select on public.rider_reviews to authenticated;
create policy rider_reviews_select on public.rider_reviews for select to authenticated
  using (customer_id = auth.uid() or rider_id = auth.uid() or public.is_staff());

-- The customer rates (or re-rates) the rider who completed their order.
create or replace function public.rate_rider(p_order_id uuid, p_rating int, p_comment text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_rider uuid;
  v_new boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid();
  if not found then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'completed' then
    raise exception 'You can rate your rider after the delivery is completed.' using errcode = 'P0001', hint = 'not_completed';
  end if;
  select rider_id into v_rider from public.assignments where order_id = p_order_id and status = 'completed'
  order by completed_at desc nulls last limit 1;
  if v_rider is null then
    raise exception 'No rider to rate for this order.' using errcode = 'P0001', hint = 'no_rider';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose 1 to 5 stars.' using errcode = 'P0001', hint = 'invalid_rating';
  end if;
  if char_length(coalesce(p_comment, '')) > 500 then
    raise exception 'Keep your comment under 500 characters.' using errcode = 'P0001', hint = 'invalid_comment';
  end if;

  v_new := not exists (select 1 from public.rider_reviews where order_id = p_order_id);
  insert into public.rider_reviews (order_id, rider_id, customer_id, rating, comment)
  values (p_order_id, v_rider, auth.uid(), p_rating, nullif(trim(p_comment), ''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment;

  if v_new then
    perform public.notify(v_rider, 'rider.rated', format('You got %s★ for %s', p_rating, v_order.code),
      nullif(trim(p_comment), ''), '/rider/account');
  end if;
end $$;

-- What anyone signed in may see about a rider.
create or replace function public.rider_public_profile(p_rider_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rider public.rider_profiles%rowtype;
  v_avatar text;
  v_last text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_rider from public.rider_profiles where user_id = p_rider_id and status in ('active', 'suspended');
  if not found then
    return null;
  end if;
  select avatar_path into v_avatar from public.profiles where id = p_rider_id;
  v_last := (regexp_split_to_array(trim(v_rider.full_name), '\s+'))[array_length(regexp_split_to_array(trim(v_rider.full_name), '\s+'), 1)];

  return jsonb_build_object(
    'id', v_rider.user_id,
    'display_name', split_part(trim(v_rider.full_name), ' ', 1)
      || case when v_last is not null and v_last <> split_part(trim(v_rider.full_name), ' ', 1) then ' ' || left(v_last, 1) || '.' else '' end,
    'avatar_path', v_avatar,
    'vehicle_type', v_rider.vehicle_type,
    'verified', v_rider.status = 'active',
    'member_since', v_rider.created_at,
    'completed_count', (
      select count(*) from public.assignments a join public.orders o on o.id = a.order_id
      where a.rider_id = p_rider_id and a.status = 'completed' and o.status = 'completed'),
    'rating_avg', (select round(avg(rating)::numeric, 1) from public.rider_reviews where rider_id = p_rider_id),
    'rating_count', (select count(*) from public.rider_reviews where rider_id = p_rider_id),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('rating', r.rating, 'comment', r.comment, 'created_at', r.created_at) order by r.created_at desc)
      from (select rating, comment, created_at from public.rider_reviews
            where rider_id = p_rider_id and comment is not null order by created_at desc limit 10) r), '[]')
  );
end $$;


-- Your data export also covers ratings given and received.
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
    'rider_ratings_given', coalesce((select jsonb_agg(jsonb_build_object('order_id', rr.order_id, 'rating', rr.rating, 'comment', rr.comment, 'created_at', rr.created_at)) from public.rider_reviews rr where rr.customer_id = v_user), '[]'),
    'rider_ratings_received', coalesce((select jsonb_agg(jsonb_build_object('rating', rr.rating, 'comment', rr.comment, 'created_at', rr.created_at)) from public.rider_reviews rr where rr.rider_id = v_user), '[]'),
    'legal_acceptances', coalesce((select jsonb_agg(to_jsonb(l) order by l.accepted_at) from public.legal_acceptances l where l.user_id = v_user), '[]')
  );
end $$;

revoke execute on function public.rate_rider(uuid, int, text) from public, anon;
revoke execute on function public.rider_public_profile(uuid) from public, anon;
grant execute on function public.rate_rider(uuid, int, text) to authenticated;
grant execute on function public.rider_public_profile(uuid) to authenticated;
