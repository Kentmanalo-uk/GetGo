-- Carts, promotions, orders, riders, GCash payments, refunds, reviews, support
-- and bookings. Tables and RLS only; the trusted workflows that write to them
-- live in the following migration.
--
-- Operating model: stores list their products; a GETGO rider accepts an
-- order, the customer pays the rider by GCash, the rider buys the items at the
-- store and delivers them. Stores never handle orders.

-- ---------------------------------------------------------------------------
-- Carts (one per customer per store)
-- ---------------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_id)
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  quantity int not null check (quantity between 1 and 99),
  instructions text check (char_length(instructions) <= 200),
  -- Normalized configuration fingerprint used to merge identical items.
  options_key text not null default '',
  -- Unit price when added, so checkout can flag price changes.
  unit_price_snapshot_minor bigint not null check (unit_price_snapshot_minor >= 0),
  created_at timestamptz not null default now()
);
create index cart_items_cart_idx on public.cart_items (cart_id);

create table public.cart_item_options (
  cart_item_id uuid not null references public.cart_items (id) on delete cascade,
  option_value_id uuid not null references public.option_values (id) on delete cascade,
  quantity int not null default 1 check (quantity between 1 and 20),
  primary key (cart_item_id, option_value_id)
);

-- ---------------------------------------------------------------------------
-- Promotions (platform-funded discounts, optionally limited to one store)
-- ---------------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 300),
  merchant_id uuid references public.merchants (id) on delete cascade,
  discount_type text not null check (discount_type in ('percent', 'fixed', 'free_delivery')),
  -- percent: basis points (1000 = 10%); fixed: minor units; free_delivery: unused (0)
  value bigint not null default 0 check (value >= 0),
  max_discount_minor bigint check (max_discount_minor is null or max_discount_minor > 0),
  min_subtotal_minor bigint not null default 0 check (min_subtotal_minor >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  per_user_limit int not null default 1 check (per_user_limit > 0),
  is_active boolean not null default true,
  is_public boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (discount_type <> 'percent' or value between 1 and 10000)
);
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Riders
-- ---------------------------------------------------------------------------
create table public.rider_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  full_name text not null,
  phone text not null,
  vehicle_type public.vehicle_type not null,
  plate_number text,
  service_area_id uuid not null references public.service_areas (id),
  -- Customers send payment for their order to this GCash account.
  gcash_name text not null check (char_length(gcash_name) between 2 and 120),
  gcash_number text not null check (gcash_number ~ '^(\+63|0)9[0-9]{9}$'),
  status public.rider_status not null default 'active',
  created_at timestamptz not null default now()
);

create or replace function public.is_area_rider(p_service_area_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.rider_profiles
    where user_id = auth.uid() and status = 'active' and service_area_id = p_service_area_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid not null references public.profiles (id),
  merchant_id uuid not null references public.merchants (id),
  status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'pending',
  service_area_id uuid not null references public.service_areas (id),
  -- Store snapshot so customers and riders see the store as it was ordered
  -- from without needing read access to the merchants table.
  merchant_name text not null,
  pickup_address jsonb not null,
  customer_name text not null,
  customer_phone text not null,
  delivery_address jsonb not null,
  notes text check (char_length(notes) <= 300),
  -- subtotal: the store's listed prices the rider pays at the store.
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  service_fee_minor bigint not null default 0 check (service_fee_minor >= 0),
  small_order_fee_minor bigint not null default 0 check (small_order_fee_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  promotion_id uuid references public.promotions (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  cancel_reason text,
  cancelled_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  paid_at timestamptz,
  picked_up_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check (total_minor = subtotal_minor + delivery_fee_minor + service_fee_minor + small_order_fee_minor - discount_minor)
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_open_area_idx on public.orders (service_area_id, created_at) where status = 'pending';
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_merchant_idx on public.orders (merchant_id, created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  variant_name text,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity int not null check (quantity > 0),
  line_total_minor bigint not null,
  instructions text,
  check (line_total_minor = unit_price_minor * quantity)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  option_value_id uuid references public.option_values (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta_minor bigint not null check (price_delta_minor >= 0),
  quantity int not null default 1 check (quantity > 0)
);
create index order_item_options_item_idx on public.order_item_options (order_item_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null check (actor_kind in ('customer', 'rider', 'admin', 'system')),
  note text,
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  discount_minor bigint not null check (discount_minor >= 0),
  created_at timestamptz not null default now()
);
create index promotion_redemptions_promo_idx on public.promotion_redemptions (promotion_id, user_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  rider_id uuid not null references public.rider_profiles (user_id),
  status public.assignment_status not null default 'active',
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index assignments_one_active on public.assignments (order_id) where status = 'active';
create index assignments_rider_idx on public.assignments (rider_id, status);

-- ---------------------------------------------------------------------------
-- Payments: one manual GCash payment per order, sent by the customer to the
-- assigned rider and confirmed by that rider.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  provider text not null default 'gcash' check (provider = 'gcash'),
  status public.payment_status not null default 'pending',
  amount_minor bigint not null check (amount_minor >= 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  -- Account the customer was told to pay (snapshot of the rider's details).
  payee_name text,
  payee_number text,
  gcash_reference text check (gcash_reference is null or gcash_reference ~ '^[0-9A-Za-z]{6,30}$'),
  sender_name text check (char_length(sender_name) <= 120),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  rejection_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (refunded_minor <= amount_minor)
);
-- A GCash reference can settle only one order.
create unique index payments_reference_unique on public.payments (gcash_reference) where gcash_reference is not null;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null check (char_length(reason) between 3 and 500),
  status public.refund_status not null default 'requested',
  -- GCash reference of the refund transfer.
  reference text,
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index refunds_status_idx on public.refunds (status, created_at);
create index refunds_order_idx on public.refunds (order_id);

-- ---------------------------------------------------------------------------
-- Reviews, support, bookings
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  customer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create index reviews_merchant_idx on public.reviews (merchant_id, created_at desc);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  subject text not null check (char_length(subject) between 3 and 120),
  status public.ticket_status not null default 'open',
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_status_idx on public.support_tickets (status, updated_at desc);
create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

-- Padala / errand bookings. Intake is not yet operational; the table exists
-- so the workflow can be enabled without schema changes.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  service public.service_type not null,
  status public.booking_status not null default 'requested',
  service_area_id uuid not null references public.service_areas (id),
  pickup jsonb not null,
  dropoff jsonb not null,
  details text check (char_length(details) <= 1000),
  quote_minor bigint check (quote_minor is null or quote_minor >= 0),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_assigned_rider(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.assignments
    where order_id = p_order_id and rider_id = auth.uid() and status in ('active', 'completed')
  );
$$;

-- Customer, assigned rider, staff, or an active rider in the area while the
-- order is still waiting for someone to accept it.
create or replace function public.can_view_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.orders o where o.id = p_order_id and (
      o.customer_id = auth.uid()
      or public.is_assigned_rider(o.id)
      or (o.status = 'pending' and public.is_area_rider(o.service_area_id))
      or public.is_staff()
    )
  );
$$;

create or replace function public.owns_cart(p_cart_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.carts where id = p_cart_id and user_id = auth.uid());
$$;

-- The customer sees the rider currently assigned to their order.
create or replace function public.can_see_rider(p_rider_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.assignments a join public.orders o on o.id = a.order_id
    where a.rider_id = p_rider_id and a.status = 'active' and o.customer_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.cart_item_options enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_status_history enable row level security;
alter table public.rider_profiles enable row level security;
alter table public.assignments enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.reviews enable row level security;
alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.bookings enable row level security;

revoke all on public.carts, public.cart_items, public.cart_item_options, public.promotions,
  public.promotion_redemptions, public.orders, public.order_items, public.order_item_options,
  public.order_status_history, public.rider_profiles, public.assignments, public.payments,
  public.refunds, public.reviews, public.support_tickets, public.ticket_messages, public.bookings
  from anon, authenticated;

-- Carts: owner reads; all writes go through cart_* functions.
grant select on public.carts, public.cart_items, public.cart_item_options to authenticated;
create policy carts_select on public.carts for select to authenticated using (user_id = auth.uid());
create policy cart_items_select on public.cart_items for select to authenticated using (public.owns_cart(cart_id));
create policy cart_item_options_select on public.cart_item_options for select to authenticated
  using (exists (select 1 from public.cart_items ci where ci.id = cart_item_id and public.owns_cart(ci.cart_id)));

-- Promotions: public active promotions are visible; admins manage.
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;
create policy promotions_select on public.promotions for select to anon, authenticated
  using (
    (is_active and is_public and starts_at <= now() and (ends_at is null or ends_at > now())
      and (merchant_id is null or public.merchant_is_public(merchant_id)))
    or public.is_staff()
  );
create policy promotions_insert on public.promotions for insert to authenticated with check (public.is_admin());
create policy promotions_update on public.promotions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy promotions_delete on public.promotions for delete to authenticated using (public.is_admin());

grant select on public.promotion_redemptions to authenticated;
create policy promotion_redemptions_select on public.promotion_redemptions for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Orders: customer, assigned rider, area riders (open orders only), staff.
-- No direct writes: the workflow functions are the only paths.
grant select on public.orders, public.order_items, public.order_item_options, public.order_status_history to authenticated;
create policy orders_select on public.orders for select to authenticated
  using (
    customer_id = auth.uid() or public.is_assigned_rider(id)
    or (status = 'pending' and public.is_area_rider(service_area_id))
    or public.is_staff()
  );
create policy order_items_select on public.order_items for select to authenticated
  using (public.can_view_order(order_id));
create policy order_item_options_select on public.order_item_options for select to authenticated
  using (exists (select 1 from public.order_items oi where oi.id = order_item_id and public.can_view_order(oi.order_id)));
create policy order_status_history_select on public.order_status_history for select to authenticated
  using (public.can_view_order(order_id));

-- Riders: own profile, staff, and the customer of the order they're assigned to.
grant select on public.rider_profiles, public.assignments to authenticated;
create policy rider_profiles_select on public.rider_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_staff() or public.can_see_rider(user_id));
create policy assignments_select on public.assignments for select to authenticated
  using (rider_id = auth.uid() or public.is_staff()
         or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

-- Payments: the paying customer, the assigned rider, finance/admin.
grant select on public.payments to authenticated;
create policy payments_select on public.payments for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or public.is_assigned_rider(order_id)
    or public.is_staff()
  );

grant select on public.refunds to authenticated;
create policy refunds_select on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or public.is_staff()
  );

-- Reviews: customers review their own completed orders once.
grant select, insert on public.reviews to authenticated;
create policy reviews_select on public.reviews for select to authenticated
  using (customer_id = auth.uid() or public.is_merchant_member(merchant_id) or public.is_staff());
create policy reviews_insert on public.reviews for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()
                and o.merchant_id = reviews.merchant_id and o.status = 'completed')
  );

-- Support: users manage their own tickets; support staff manage all.
grant select, insert on public.support_tickets to authenticated;
grant update (status, priority, assigned_to) on public.support_tickets to authenticated;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin') or public.has_role('support'));
create policy support_tickets_insert on public.support_tickets for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'open' and assigned_to is null
    and (order_id is null or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()))
  );
create policy support_tickets_update on public.support_tickets for update to authenticated
  using (public.has_role('admin') or public.has_role('support'))
  with check (public.has_role('admin') or public.has_role('support'));

grant select, insert on public.ticket_messages to authenticated;
create policy ticket_messages_select on public.ticket_messages for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id
                 and (t.user_id = auth.uid() or public.has_role('admin') or public.has_role('support'))));
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      (is_staff and (public.has_role('admin') or public.has_role('support')))
      or (not is_staff and exists (select 1 from public.support_tickets t
                                   where t.id = ticket_id and t.user_id = auth.uid() and t.status <> 'closed'))
    )
  );

-- Bookings: read-only for the owner and staff until intake is enabled.
grant select on public.bookings to authenticated;
create policy bookings_select on public.bookings for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());
