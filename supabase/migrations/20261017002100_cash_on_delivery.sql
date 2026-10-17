-- Cash on delivery (COD), offered per order by the rider.
--
-- After accepting an order, the rider can allow COD for it — meaning they're
-- willing to pay the store (or the errand budget) with their own money. The
-- customer then chooses: send the total by GCash first (as before), or pay the
-- rider in cash on delivery. Choosing COD starts the order right away
-- (accepted → buying); the payment is marked paid when the rider completes the
-- delivery. A cancelled COD order has nothing to refund.

alter table public.orders add column cod_allowed boolean not null default false;
alter table public.payments add column method text not null default 'gcash' check (method in ('gcash', 'cod'));

-- The assigned rider allows or withdraws COD while waiting for the customer to pay.
create or replace function public.rider_set_cod(p_order_id uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not exists (select 1 from public.assignments where order_id = p_order_id and rider_id = auth.uid() and status = 'active') then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'accepted' then
    raise exception 'You can change cash on delivery only before the customer pays.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if v_order.cod_allowed = coalesce(p_allowed, false) then
    return;
  end if;
  update public.orders set cod_allowed = coalesce(p_allowed, false) where id = p_order_id;
  perform public.record_transition(p_order_id, 'accepted', 'accepted', 'rider',
    case when p_allowed then 'Cash on delivery allowed' else 'Cash on delivery withdrawn' end);
  if p_allowed then
    perform public.notify(v_order.customer_id, 'order.cod_available', 'Cash on delivery is available',
      format('Pay %s by GCash now, or in cash when your order arrives.', public.format_php(v_order.total_minor)),
      '/orders/' || p_order_id);
  end if;
end $$;

-- The customer chooses cash on delivery; the rider starts right away.
create or replace function public.choose_cash_on_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_rider uuid;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if v_order.status <> 'accepted' then
    raise exception 'You can choose how to pay only while your rider is waiting for payment.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if not v_order.cod_allowed then
    raise exception 'Your rider hasn’t offered cash on delivery for this order.' using errcode = 'P0001', hint = 'cod_unavailable';
  end if;

  update public.payments set method = 'cod', status = 'pending', gcash_reference = null, sender_name = null,
    submitted_at = null, rejection_note = null
  where order_id = p_order_id;
  update public.orders set status = 'buying' where id = p_order_id;
  perform public.record_transition(p_order_id, 'accepted', 'buying', 'customer', 'Cash on delivery');

  select rider_id into v_rider from public.assignments where order_id = p_order_id and status = 'active';
  perform public.notify(v_rider, 'order.cod_chosen', format('%s is cash on delivery', v_order.code),
    format('Start now. Collect %s in cash when you deliver.', public.format_php(v_order.total_minor)),
    '/rider/jobs/' || p_order_id);
end $$;

-- Keeps COD consistent as the order moves: a released order starts over
-- without COD, and completing a COD order records the cash as collected.
create or replace function public.orders_cod_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' and old.status <> 'pending' then
    new.cod_allowed := false;
  elsif new.status = 'completed' and old.status <> 'completed'
        and exists (select 1 from public.payments where order_id = new.id and method = 'cod' and status = 'pending') then
    update public.payments set status = 'paid', confirmed_at = now(), confirmed_by = auth.uid()
    where order_id = new.id and method = 'cod';
    new.payment_status := 'paid';
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
create trigger orders_cod_status before update of status on public.orders
  for each row execute function public.orders_cod_status();

revoke execute on function public.orders_cod_status() from public, anon, authenticated;
revoke execute on function public.rider_set_cod(uuid, boolean) from public, anon;
revoke execute on function public.choose_cash_on_delivery(uuid) from public, anon;
grant execute on function public.rider_set_cod(uuid, boolean) to authenticated;
grant execute on function public.choose_cash_on_delivery(uuid) to authenticated;
