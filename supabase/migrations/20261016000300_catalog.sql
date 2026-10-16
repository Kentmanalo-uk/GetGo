-- Catalog: store categories, products, variants and reusable option groups,
-- plus the authoritative configuration pricing function.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (merchant_id, name),
  unique (id, merchant_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 600),
  image_path text,
  base_price_minor bigint not null check (base_price_minor >= 0),
  currency char(3) not null default 'PHP' check (currency = 'PHP'),
  status public.product_status not null default 'draft',
  is_available boolean not null default true,
  max_per_order int not null default 20 check (max_per_order between 1 and 99),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id),
  foreign key (category_id, merchant_id) references public.categories (id, merchant_id) on delete set null (category_id)
);
create index products_merchant_idx on public.products (merchant_id, status, sort_order);
create index products_search_idx on public.products using gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Variants replace the base price (e.g. Regular / Large). When a product has
-- variants, exactly one must be chosen.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_minor bigint not null check (price_minor >= 0),
  is_available boolean not null default true,
  sort_order int not null default 0,
  unique (product_id, name)
);
create index product_variants_product_idx on public.product_variants (product_id, sort_order);

-- Reusable option groups (e.g. "Choice of drink", "Add-ons").
create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select between 1 and 50),
  created_at timestamptz not null default now(),
  unique (id, merchant_id),
  check (min_select <= max_select)
);
create index option_groups_merchant_idx on public.option_groups (merchant_id);

create table public.option_values (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_delta_minor bigint not null default 0 check (price_delta_minor >= 0),
  is_available boolean not null default true,
  max_quantity int not null default 1 check (max_quantity between 1 and 20),
  sort_order int not null default 0,
  unique (group_id, name)
);
create index option_values_group_idx on public.option_values (group_id, sort_order);

create table public.product_option_groups (
  product_id uuid not null,
  group_id uuid not null,
  merchant_id uuid not null,
  sort_order int not null default 0,
  primary key (product_id, group_id),
  foreign key (product_id, merchant_id) references public.products (id, merchant_id) on delete cascade,
  foreign key (group_id, merchant_id) references public.option_groups (id, merchant_id) on delete cascade
);
create index product_option_groups_group_idx on public.product_option_groups (group_id);

-- Parses an options payload (already shape-checked) into rows.
create or replace function public.parse_option_selection(p_options jsonb)
returns table (option_value_id uuid, quantity int)
language sql immutable set search_path = public, pg_temp as $$
  select (e ->> 'option_value_id')::uuid, coalesce((e ->> 'quantity')::int, 1)
  from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) e;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative configuration pricing.
--
-- p_options: [{ "option_value_id": uuid, "quantity": int }]
-- Returns the unit price, or an error code and customer-facing message. Never
-- raises for invalid input so that carts can report every problem at once.
-- The browser mirrors these rules in src/domain/customization.ts for preview
-- only; this function is what checkout trusts.
-- ---------------------------------------------------------------------------
create or replace function public.price_configuration(
  p_product_id uuid, p_variant_id uuid, p_options jsonb, p_quantity int
)
returns table (unit_price_minor bigint, error_code text, error_message text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_base bigint;
  v_delta bigint;
  v_bad record;
  v_group record;
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
begin
  select * into v_product from public.products where id = p_product_id;
  if not found or v_product.status <> 'published' or not public.merchant_is_public(v_product.merchant_id) then
    return query select null::bigint, 'product_unavailable'::text, 'This item is no longer available.'::text;
    return;
  end if;
  if not v_product.is_available then
    return query select null::bigint, 'product_sold_out'::text, format('%s is sold out.', v_product.name);
    return;
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_product.max_per_order then
    return query select null::bigint, 'invalid_quantity'::text,
      format('You can order up to %s of %s.', v_product.max_per_order, v_product.name);
    return;
  end if;

  if exists (select 1 from public.product_variants where product_id = p_product_id) then
    if p_variant_id is null then
      return query select null::bigint, 'variant_required'::text, format('Choose a size for %s.', v_product.name);
      return;
    end if;
    select * into v_variant from public.product_variants where id = p_variant_id and product_id = p_product_id;
    if not found then
      return query select null::bigint, 'invalid_variant'::text, format('Choose a size for %s.', v_product.name);
      return;
    end if;
    if not v_variant.is_available then
      return query select null::bigint, 'variant_sold_out'::text,
        format('%s (%s) is sold out.', v_product.name, v_variant.name);
      return;
    end if;
    v_base := v_variant.price_minor;
  else
    if p_variant_id is not null then
      return query select null::bigint, 'invalid_variant'::text, 'This item has no size options.'::text;
      return;
    end if;
    v_base := v_product.base_price_minor;
  end if;

  -- Shape of the options payload.
  if jsonb_typeof(v_options) <> 'array' or exists (
    select 1 from jsonb_array_elements(v_options) e
    where jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'option_value_id', '') !~ '^[0-9a-fA-F-]{36}$'
      or (e ? 'quantity' and coalesce(e ->> 'quantity', '') !~ '^[0-9]{1,3}$')
  ) then
    return query select null::bigint, 'invalid_options'::text, 'The selected options are not valid.'::text;
    return;
  end if;

  if (select count(*) from public.parse_option_selection(v_options))
     <> (select count(distinct option_value_id) from public.parse_option_selection(v_options)) then
    return query select null::bigint, 'duplicate_option'::text, 'An option was selected more than once.'::text;
    return;
  end if;

  -- Every selected value must belong to a group attached to this product.
  select s.option_value_id, s.quantity, ov.name, ov.is_available, ov.max_quantity, pog.group_id
  into v_bad
  from public.parse_option_selection(v_options) s
  left join public.option_values ov on ov.id = s.option_value_id
  left join public.product_option_groups pog on pog.group_id = ov.group_id and pog.product_id = p_product_id
  where ov.id is null or pog.group_id is null or not ov.is_available
     or s.quantity < 1 or s.quantity > ov.max_quantity
  limit 1;
  if found then
    if v_bad.name is null or v_bad.group_id is null then
      return query select null::bigint, 'invalid_option'::text, 'One of the selected options is no longer offered.'::text;
    elsif not v_bad.is_available then
      return query select null::bigint, 'option_sold_out'::text, format('%s is sold out.', v_bad.name);
    else
      return query select null::bigint, 'invalid_option_quantity'::text,
        format('You can add up to %s of %s.', v_bad.max_quantity, v_bad.name);
    end if;
    return;
  end if;

  -- Group selection limits, in display order.
  for v_group in
    select g.name, g.min_select, g.max_select,
           coalesce((select sum(s.quantity) from public.parse_option_selection(v_options) s join public.option_values ov on ov.id = s.option_value_id
                     where ov.group_id = g.id), 0)::int as selected
    from public.product_option_groups pog
    join public.option_groups g on g.id = pog.group_id
    where pog.product_id = p_product_id
    order by pog.sort_order, g.name
  loop
    if v_group.selected < v_group.min_select then
      return query select null::bigint, 'group_min'::text,
        case when v_group.min_select = 1 then format('Choose %s.', lower(v_group.name))
             else format('Choose at least %s for %s.', v_group.min_select, lower(v_group.name)) end;
      return;
    end if;
    if v_group.selected > v_group.max_select then
      return query select null::bigint, 'group_max'::text,
        format('Choose up to %s for %s.', v_group.max_select, lower(v_group.name));
      return;
    end if;
  end loop;

  select coalesce(sum(ov.price_delta_minor * s.quantity), 0) into v_delta
  from public.parse_option_selection(v_options) s join public.option_values ov on ov.id = s.option_value_id;

  return query select v_base + v_delta, null::text, null::text;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.option_groups enable row level security;
alter table public.option_values enable row level security;
alter table public.product_option_groups enable row level security;

revoke all on public.categories, public.products, public.product_variants, public.option_groups,
  public.option_values, public.product_option_groups from anon, authenticated;

grant select on public.categories, public.products, public.product_variants, public.option_groups,
  public.option_values, public.product_option_groups to anon, authenticated;

-- Categories: simple single-table writes by owners/managers.
grant insert, update, delete on public.categories to authenticated;
create policy categories_select on public.categories for select to anon, authenticated
  using (public.merchant_is_public(merchant_id) or public.is_merchant_member(merchant_id) or public.is_staff());
create policy categories_insert on public.categories for insert to authenticated
  with check (public.can_manage_merchant(merchant_id));
create policy categories_update on public.categories for update to authenticated
  using (public.can_manage_merchant(merchant_id)) with check (public.can_manage_merchant(merchant_id));
create policy categories_delete on public.categories for delete to authenticated
  using (public.can_manage_merchant(merchant_id));

-- Products and their configuration are read publicly only when published in a
-- public store. Writes go through save_product / save_option_group.
create policy products_select on public.products for select to anon, authenticated
  using (
    (status = 'published' and public.merchant_is_public(merchant_id))
    or public.is_merchant_member(merchant_id) or public.is_staff()
  );

create or replace function public.product_is_visible(p_product_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.products p where p.id = p_product_id and (
      (p.status = 'published' and public.merchant_is_public(p.merchant_id))
      or public.is_merchant_member(p.merchant_id) or public.is_staff()
    )
  );
$$;

create policy product_variants_select on public.product_variants for select to anon, authenticated
  using (public.product_is_visible(product_id));
create policy option_groups_select on public.option_groups for select to anon, authenticated
  using (public.merchant_is_public(merchant_id) or public.is_merchant_member(merchant_id) or public.is_staff());
create policy option_values_select on public.option_values for select to anon, authenticated
  using (exists (
    select 1 from public.option_groups g where g.id = group_id
      and (public.merchant_is_public(g.merchant_id) or public.is_merchant_member(g.merchant_id) or public.is_staff())
  ));
create policy product_option_groups_select on public.product_option_groups for select to anon, authenticated
  using (public.product_is_visible(product_id));
