-- Partner application workflow, merchant store/catalog management, admin
-- operations, and public storefront read models.

-- ---------------------------------------------------------------------------
-- Partner applications
-- ---------------------------------------------------------------------------
create or replace function public.required_document_types()
returns public.document_type[] language sql immutable as $$
  select array['government_id', 'business_permit', 'dti_sec_registration']::public.document_type[];
$$;

-- Lists what is still missing before an application can be submitted.
create or replace function public.application_missing_items(p_application_id uuid)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_app public.partner_applications%rowtype;
  v_missing text[] := '{}';
  v_doc public.document_type;
begin
  select * into v_app from public.partner_applications
  where id = p_application_id and (applicant_id = auth.uid() or public.is_staff());
  if not found then
    return array['Application not found'];
  end if;
  if coalesce(trim(v_app.business_name), '') = '' then v_missing := array_append(v_missing, ('Business name')::text); end if;
  if v_app.category is null then v_missing := array_append(v_missing, ('Business category')::text); end if;
  if coalesce(trim(v_app.owner_name), '') = '' then v_missing := array_append(v_missing, ('Owner name')::text); end if;
  if v_app.owner_phone is null then v_missing := array_append(v_missing, ('Owner mobile number')::text); end if;
  if coalesce(trim(v_app.address_line), '') = '' or coalesce(trim(v_app.barangay), '') = ''
     or coalesce(trim(v_app.city), '') = '' then
    v_missing := array_append(v_missing, ('Store address')::text);
  end if;
  if v_app.service_area_id is null or not exists (
    select 1 from public.service_areas where id = v_app.service_area_id and is_active
  ) then
    v_missing := array_append(v_missing, ('Service area')::text);
  end if;
  if jsonb_array_length(v_app.hours) = 0 then v_missing := array_append(v_missing, ('Operating hours')::text); end if;
  if jsonb_array_length(v_app.menu_items) = 0 then v_missing := array_append(v_missing, ('At least one menu item')::text); end if;
  foreach v_doc in array public.required_document_types() loop
    if not exists (select 1 from public.application_documents where application_id = p_application_id and doc_type = v_doc) then
      v_missing := array_append(v_missing, (initcap(replace(v_doc::text, '_', ' ')))::text);
    end if;
  end loop;
  return v_missing;
end $$;

-- Validates the hours payload: [{weekday, opens "HH:MM", closes "HH:MM"}].
create or replace function public.validate_hours(p_hours jsonb)
returns void language plpgsql immutable as $$
declare
  v_entry jsonb;
begin
  if jsonb_typeof(p_hours) <> 'array' then
    raise exception 'Opening hours are not valid.' using errcode = 'P0001', hint = 'invalid_hours';
  end if;
  for v_entry in select * from jsonb_array_elements(p_hours) loop
    if (v_entry ->> 'weekday') !~ '^[0-6]$'
       or (v_entry ->> 'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_entry ->> 'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_entry ->> 'closes')::time <= (v_entry ->> 'opens')::time then
      raise exception 'Each day needs an opening time before its closing time.' using errcode = 'P0001', hint = 'invalid_hours';
    end if;
  end loop;
end $$;

create or replace function public.submit_partner_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.partner_applications%rowtype;
  v_missing text[];
begin
  select * into v_app from public.partner_applications
  where id = p_application_id and applicant_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_app.status not in ('draft', 'needs_changes') then
    raise exception 'This application has already been submitted.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  perform public.validate_hours(v_app.hours);
  v_missing := public.application_missing_items(p_application_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Complete these before submitting: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'incomplete';
  end if;

  update public.partner_applications set status = 'submitted', submitted_at = now() where id = p_application_id;
  perform public.log_audit('application.submitted', 'partner_application', p_application_id::text, '{}');
  perform public.notify_staff('application.submitted', 'New partner application', v_app.business_name,
    '/admin/applications/' || p_application_id);
end $$;

create or replace function public.slugify(p_text text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Admin review. p_decision: under_review | needs_changes | approved | rejected
create or replace function public.review_partner_application(
  p_application_id uuid, p_decision public.application_status, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.partner_applications%rowtype;
  v_merchant_id uuid;
  v_slug text;
  v_base text;
  v_n int := 1;
  v_item jsonb;
  v_category_id uuid;
  v_notes text := nullif(trim(p_notes), '');
begin
  if p_decision in ('approved', 'rejected') and not public.is_admin() then
    raise exception 'Only administrators can approve or reject partners.' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.has_role('support')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into v_app from public.partner_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  if not (
    (v_app.status = 'submitted' and p_decision in ('under_review', 'needs_changes', 'approved', 'rejected'))
    or (v_app.status = 'under_review' and p_decision in ('needs_changes', 'approved', 'rejected'))
  ) then
    raise exception 'This application cannot move from % to %.', v_app.status, p_decision
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if p_decision in ('needs_changes', 'rejected') and v_notes is null then
    raise exception 'Explain what the applicant needs to know.' using errcode = 'P0001', hint = 'notes_required';
  end if;

  if p_decision = 'approved' then
    v_base := coalesce(nullif(public.slugify(v_app.business_name), ''), 'store');
    v_slug := v_base;
    while exists (select 1 from public.merchants where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;

    insert into public.merchants (slug, name, category, description, phone, address_line, barangay, city,
      service_area_id, logo_path, cover_path, application_id)
    values (v_slug, v_app.business_name, v_app.category, v_app.description, coalesce(v_app.business_phone, v_app.owner_phone),
      v_app.address_line, v_app.barangay, v_app.city, v_app.service_area_id, v_app.logo_path, v_app.cover_path, v_app.id)
    returning id into v_merchant_id;

    insert into public.merchant_members (merchant_id, user_id, role) values (v_merchant_id, v_app.applicant_id, 'owner');

    insert into public.store_hours (merchant_id, weekday, opens_at, closes_at)
    select v_merchant_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
    from jsonb_array_elements(v_app.hours) h;

    -- The initial menu becomes draft products the owner reviews before publishing.
    for v_item in select * from jsonb_array_elements(v_app.menu_items) loop
      v_category_id := null;
      if nullif(trim(v_item ->> 'category'), '') is not null then
        insert into public.categories (merchant_id, name) values (v_merchant_id, trim(v_item ->> 'category'))
        on conflict (merchant_id, name) do update set name = excluded.name
        returning id into v_category_id;
      end if;
      insert into public.products (merchant_id, category_id, name, description, base_price_minor, status)
      values (v_merchant_id, v_category_id, left(trim(v_item ->> 'name'), 120), left(v_item ->> 'description', 600),
        greatest(coalesce((v_item ->> 'price_minor')::bigint, 0), 0), 'draft');
    end loop;

    update public.partner_applications
    set status = 'approved', review_notes = v_notes, reviewed_by = auth.uid(), reviewed_at = now(), merchant_id = v_merchant_id
    where id = p_application_id;

    perform public.notify(v_app.applicant_id, 'application.approved', 'Your GETGO partner application is approved',
      'Review your product list and publish your store when you are ready.', '/merchant');
  else
    update public.partner_applications
    set status = p_decision, review_notes = coalesce(v_notes, review_notes), reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_application_id;

    if p_decision = 'needs_changes' then
      perform public.notify(v_app.applicant_id, 'application.needs_changes', 'Your application needs changes', v_notes, '/partner/apply');
    elsif p_decision = 'rejected' then
      perform public.notify(v_app.applicant_id, 'application.rejected', 'Your application was not approved', v_notes, '/partner/apply');
    end if;
  end if;

  perform public.log_audit('application.' || p_decision, 'partner_application', p_application_id::text,
    jsonb_build_object('notes', v_notes, 'merchant_id', v_merchant_id));
  return v_merchant_id;
end $$;

-- ---------------------------------------------------------------------------
-- Store management
-- ---------------------------------------------------------------------------
create or replace function public.assert_can_manage(p_merchant_id uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_manage_merchant(p_merchant_id) then
    raise exception 'You do not have permission to manage this store.' using errcode = '42501';
  end if;
end $$;

create or replace function public.set_store_published(p_merchant_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant public.merchants%rowtype;
begin
  perform public.assert_can_manage(p_merchant_id);
  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if p_published then
    if v_merchant.status <> 'active' then
      raise exception 'This store is % and cannot be published.', v_merchant.status using errcode = 'P0001', hint = 'store_inactive';
    end if;
    if not exists (select 1 from public.products where merchant_id = p_merchant_id and status = 'published') then
      raise exception 'Publish at least one product first.' using errcode = 'P0001', hint = 'no_products';
    end if;
    if not exists (select 1 from public.store_hours where merchant_id = p_merchant_id) then
      raise exception 'Set your opening hours first.' using errcode = 'P0001', hint = 'no_hours';
    end if;
  end if;
  update public.merchants set is_published = p_published where id = p_merchant_id;
  perform public.log_audit(case when p_published then 'store.published' else 'store.unpublished' end,
    'merchant', p_merchant_id::text, '{}');
end $$;

-- Any team member can pause intake during a rush.
create or replace function public.set_store_paused(p_merchant_id uuid, p_paused boolean, p_until timestamptz default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_merchant_member(p_merchant_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_paused and p_until is not null and p_until <= now() then
    raise exception 'Choose a time in the future.' using errcode = 'P0001', hint = 'invalid_time';
  end if;
  update public.merchants
  set accepting_orders = not p_paused, paused_until = case when p_paused then p_until end
  where id = p_merchant_id;
end $$;

create or replace function public.replace_store_hours(p_merchant_id uuid, p_hours jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_can_manage(p_merchant_id);
  perform public.validate_hours(p_hours);
  delete from public.store_hours where merchant_id = p_merchant_id;
  insert into public.store_hours (merchant_id, weekday, opens_at, closes_at)
  select p_merchant_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
  from jsonb_array_elements(p_hours) h;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog management
-- ---------------------------------------------------------------------------
-- p_product: { id?, category_id, name, description, image_path, base_price_minor,
--   status, is_available, max_per_order, sort_order,
--   variants: [{ id?, name, price_minor, is_available }], option_group_ids: [uuid] }
create or replace function public.save_product(p_merchant_id uuid, p_product jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_variant jsonb;
  v_keep uuid[] := '{}';
  v_variant_id uuid;
  v_idx int := 0;
  v_status public.product_status := coalesce(nullif(p_product ->> 'status', ''), 'draft')::public.product_status;
begin
  perform public.assert_can_manage(p_merchant_id);

  if coalesce(trim(p_product ->> 'name'), '') = '' then
    raise exception 'Enter a product name.' using errcode = 'P0001', hint = 'name_required';
  end if;
  if coalesce((p_product ->> 'base_price_minor')::bigint, -1) < 0 then
    raise exception 'Enter a valid price.' using errcode = 'P0001', hint = 'invalid_price';
  end if;

  if v_id is null then
    insert into public.products (merchant_id, category_id, name, description, image_path, base_price_minor,
      status, is_available, max_per_order, sort_order)
    values (p_merchant_id, nullif(p_product ->> 'category_id', '')::uuid, trim(p_product ->> 'name'),
      nullif(trim(p_product ->> 'description'), ''), nullif(p_product ->> 'image_path', ''),
      (p_product ->> 'base_price_minor')::bigint, v_status,
      coalesce((p_product ->> 'is_available')::boolean, true),
      coalesce((p_product ->> 'max_per_order')::int, 20), coalesce((p_product ->> 'sort_order')::int, 0))
    returning id into v_id;
  else
    update public.products set
      category_id = nullif(p_product ->> 'category_id', '')::uuid,
      name = trim(p_product ->> 'name'),
      description = nullif(trim(p_product ->> 'description'), ''),
      image_path = nullif(p_product ->> 'image_path', ''),
      base_price_minor = (p_product ->> 'base_price_minor')::bigint,
      status = v_status,
      is_available = coalesce((p_product ->> 'is_available')::boolean, true),
      max_per_order = coalesce((p_product ->> 'max_per_order')::int, 20),
      sort_order = coalesce((p_product ->> 'sort_order')::int, sort_order)
    where id = v_id and merchant_id = p_merchant_id;
    if not found then
      raise exception 'Product not found.' using errcode = 'P0001', hint = 'not_found';
    end if;
  end if;

  -- Variants: update by id, insert new, remove missing.
  for v_variant in select * from jsonb_array_elements(coalesce(p_product -> 'variants', '[]')) loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_variant ->> 'name'), '') = '' or coalesce((v_variant ->> 'price_minor')::bigint, -1) < 0 then
      raise exception 'Each size needs a name and a price.' using errcode = 'P0001', hint = 'invalid_variant';
    end if;
    v_variant_id := nullif(v_variant ->> 'id', '')::uuid;
    if v_variant_id is not null then
      update public.product_variants set name = trim(v_variant ->> 'name'),
        price_minor = (v_variant ->> 'price_minor')::bigint,
        is_available = coalesce((v_variant ->> 'is_available')::boolean, true), sort_order = v_idx
      where id = v_variant_id and product_id = v_id;
      if not found then v_variant_id := null; end if;
    end if;
    if v_variant_id is null then
      insert into public.product_variants (product_id, name, price_minor, is_available, sort_order)
      values (v_id, trim(v_variant ->> 'name'), (v_variant ->> 'price_minor')::bigint,
        coalesce((v_variant ->> 'is_available')::boolean, true), v_idx)
      returning id into v_variant_id;
    end if;
    v_keep := v_keep || v_variant_id;
  end loop;
  delete from public.product_variants where product_id = v_id and not (id = any (v_keep));

  -- Option groups, in the given order.
  delete from public.product_option_groups where product_id = v_id;
  insert into public.product_option_groups (product_id, group_id, merchant_id, sort_order)
  select v_id, g.value::uuid, p_merchant_id, g.ordinality::int
  from jsonb_array_elements_text(coalesce(p_product -> 'option_group_ids', '[]')) with ordinality g;

  return v_id;
exception
  when unique_violation then
    raise exception 'Size names must be different from each other.' using errcode = 'P0001', hint = 'duplicate_name';
  when foreign_key_violation then
    raise exception 'A selected category or option group does not belong to this store.' using errcode = 'P0001', hint = 'invalid_reference';
end $$;

create or replace function public.set_product_status(p_product_id uuid, p_status public.product_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select merchant_id into v_merchant_id from public.products where id = p_product_id;
  perform public.assert_can_manage(v_merchant_id);
  update public.products set status = p_status where id = p_product_id;
end $$;

-- Availability toggles are open to all team members (sold out during service).
create or replace function public.set_product_availability(p_product_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select merchant_id into v_merchant_id from public.products where id = p_product_id;
  if v_merchant_id is null or not public.is_merchant_member(v_merchant_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.products set is_available = p_available where id = p_product_id;
end $$;

create or replace function public.set_option_availability(p_option_value_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select g.merchant_id into v_merchant_id from public.option_values v
  join public.option_groups g on g.id = v.group_id where v.id = p_option_value_id;
  if v_merchant_id is null or not public.is_merchant_member(v_merchant_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.option_values set is_available = p_available where id = p_option_value_id;
end $$;

-- p_group: { id?, name, min_select, max_select,
--   values: [{ id?, name, price_delta_minor, is_available, max_quantity }] }
create or replace function public.save_option_group(p_merchant_id uuid, p_group jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p_group ->> 'id', '')::uuid;
  v_value jsonb;
  v_value_id uuid;
  v_keep uuid[] := '{}';
  v_idx int := 0;
  v_min int := coalesce((p_group ->> 'min_select')::int, 0);
  v_max int := coalesce((p_group ->> 'max_select')::int, 1);
  v_capacity int;
begin
  perform public.assert_can_manage(p_merchant_id);
  if coalesce(trim(p_group ->> 'name'), '') = '' then
    raise exception 'Enter a name for this option group.' using errcode = 'P0001', hint = 'name_required';
  end if;
  if jsonb_array_length(coalesce(p_group -> 'values', '[]')) = 0 then
    raise exception 'Add at least one choice.' using errcode = 'P0001', hint = 'values_required';
  end if;
  if v_min < 0 or v_max < 1 or v_min > v_max then
    raise exception 'The minimum cannot be more than the maximum.' using errcode = 'P0001', hint = 'invalid_limits';
  end if;
  select sum(coalesce((v ->> 'max_quantity')::int, 1)) into v_capacity
  from jsonb_array_elements(p_group -> 'values') v;
  if v_min > v_capacity then
    raise exception 'Customers cannot reach the minimum with these choices.' using errcode = 'P0001', hint = 'invalid_limits';
  end if;

  if v_id is null then
    insert into public.option_groups (merchant_id, name, min_select, max_select)
    values (p_merchant_id, trim(p_group ->> 'name'), v_min, v_max) returning id into v_id;
  else
    update public.option_groups set name = trim(p_group ->> 'name'), min_select = v_min, max_select = v_max
    where id = v_id and merchant_id = p_merchant_id;
    if not found then
      raise exception 'Option group not found.' using errcode = 'P0001', hint = 'not_found';
    end if;
  end if;

  for v_value in select * from jsonb_array_elements(p_group -> 'values') loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_value ->> 'name'), '') = '' or coalesce((v_value ->> 'price_delta_minor')::bigint, -1) < 0 then
      raise exception 'Each choice needs a name and a price (0 for free).' using errcode = 'P0001', hint = 'invalid_value';
    end if;
    v_value_id := nullif(v_value ->> 'id', '')::uuid;
    if v_value_id is not null then
      update public.option_values set name = trim(v_value ->> 'name'),
        price_delta_minor = (v_value ->> 'price_delta_minor')::bigint,
        is_available = coalesce((v_value ->> 'is_available')::boolean, true),
        max_quantity = coalesce((v_value ->> 'max_quantity')::int, 1), sort_order = v_idx
      where id = v_value_id and group_id = v_id;
      if not found then v_value_id := null; end if;
    end if;
    if v_value_id is null then
      insert into public.option_values (group_id, name, price_delta_minor, is_available, max_quantity, sort_order)
      values (v_id, trim(v_value ->> 'name'), (v_value ->> 'price_delta_minor')::bigint,
        coalesce((v_value ->> 'is_available')::boolean, true), coalesce((v_value ->> 'max_quantity')::int, 1), v_idx)
      returning id into v_value_id;
    end if;
    v_keep := v_keep || v_value_id;
  end loop;
  delete from public.option_values where group_id = v_id and not (id = any (v_keep));
  return v_id;
exception
  when unique_violation then
    raise exception 'Choice names in a group must be different.' using errcode = 'P0001', hint = 'duplicate_name';
end $$;

create or replace function public.delete_option_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merchant_id uuid;
begin
  select merchant_id into v_merchant_id from public.option_groups where id = p_group_id;
  perform public.assert_can_manage(v_merchant_id);
  delete from public.option_groups where id = p_group_id;
end $$;

-- ---------------------------------------------------------------------------
-- Admin operations
-- ---------------------------------------------------------------------------
create or replace function public.set_merchant_status(p_merchant_id uuid, p_status public.merchant_status, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for this change.' using errcode = 'P0001', hint = 'reason_required';
  end if;
  update public.merchants set status = p_status,
    is_published = case when p_status = 'active' then is_published else false end
  where id = p_merchant_id;
  perform public.log_audit('merchant.status_changed', 'merchant', p_merchant_id::text,
    jsonb_build_object('status', p_status, 'reason', p_reason));
  perform public.notify_merchant(p_merchant_id, 'store.status', format('Store status changed to %s', p_status), p_reason, '/merchant/settings');
end $$;

create or replace function public.grant_role(p_email text, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_role = 'rider' then
    raise exception 'Add riders from the Riders page so their details are recorded.' using errcode = 'P0001', hint = 'use_riders';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No GETGO account uses this email.' using errcode = 'P0001', hint = 'user_not_found';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (v_user, p_role, auth.uid())
  on conflict do nothing;
  return v_user;
end $$;

create or replace function public.revoke_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and p_role = 'admin' then
    raise exception 'You cannot remove your own admin access.' using errcode = 'P0001', hint = 'self_demotion';
  end if;
  delete from public.user_roles where user_id = p_user_id and role = p_role;
end $$;

create or replace function public.create_rider(
  p_email text, p_full_name text, p_phone text, p_vehicle public.vehicle_type, p_plate text, p_service_area_id uuid,
  p_gcash_name text, p_gcash_number text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No GETGO account uses this email. Ask the rider to sign up first.' using errcode = 'P0001', hint = 'user_not_found';
  end if;
  insert into public.rider_profiles (user_id, full_name, phone, vehicle_type, plate_number, service_area_id, gcash_name, gcash_number)
  values (v_user, trim(p_full_name), trim(p_phone), p_vehicle, nullif(trim(p_plate), ''), p_service_area_id,
    trim(p_gcash_name), regexp_replace(coalesce(p_gcash_number, ''), '[\s-]', '', 'g'))
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone,
    vehicle_type = excluded.vehicle_type, plate_number = excluded.plate_number, service_area_id = excluded.service_area_id,
    gcash_name = excluded.gcash_name, gcash_number = excluded.gcash_number;
  insert into public.user_roles (user_id, role, granted_by) values (v_user, 'rider', auth.uid()) on conflict do nothing;
  perform public.log_audit('rider.saved', 'rider', v_user::text, jsonb_build_object('email', p_email));
  return v_user;
end $$;

create or replace function public.set_rider_status(p_user_id uuid, p_status public.rider_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.rider_profiles set status = p_status where user_id = p_user_id;
  if p_status = 'suspended' then
    update public.assignments set status = 'released', completed_at = now()
    where rider_id = p_user_id and status = 'active';
  end if;
  perform public.log_audit('rider.status_changed', 'rider', p_user_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'applications_waiting', (select count(*) from public.partner_applications where status in ('submitted', 'under_review')),
    'orders_today', (select count(*) from public.orders where (created_at at time zone 'Asia/Manila')::date = v_today),
    'orders_open', (select count(*) from public.orders where status in ('pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery')),
    'orders_waiting_for_rider', (select count(*) from public.orders where status = 'pending'),
    'payments_to_confirm', (select count(*) from public.orders where status = 'payment_submitted'),
    'gmv_today_minor', (select coalesce(sum(total_minor), 0) from public.orders
        where status = 'completed' and (completed_at at time zone 'Asia/Manila')::date = v_today),
    'active_merchants', (select count(*) from public.merchants where status = 'active' and is_published),
    'open_tickets', (select count(*) from public.support_tickets where status in ('open', 'pending')),
    'refunds_waiting', (select count(*) from public.refunds where status in ('requested', 'approved'))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Public read models
-- ---------------------------------------------------------------------------
-- Storefronts expose only public-safe store fields for published, active
-- stores in active areas. Open/closed state is computed at query time.
create view public.storefronts with (security_barrier = true) as
select
  m.id, m.slug, m.name, m.category, m.description, m.logo_path, m.cover_path,
  m.address_line, m.barangay, m.city, m.service_area_id, sa.name as service_area_name,
  m.min_order_minor, sa.delivery_fee_minor, sa.service_fee_minor, sa.typical_delivery_minutes, m.currency,
  public.store_state(m.id) as state,
  public.next_open_at(m.id) as next_open_at,
  r.rating_avg, coalesce(r.rating_count, 0) as rating_count,
  m.created_at
from public.merchants m
join public.service_areas sa on sa.id = m.service_area_id
left join lateral (
  select round(avg(rating)::numeric, 1) as rating_avg, count(*) as rating_count
  from public.reviews where merchant_id = m.id
) r on true
where m.is_published and m.status = 'active' and sa.is_active;

create view public.store_reviews with (security_barrier = true) as
select r.id, r.merchant_id, r.rating, r.comment, r.created_at,
  coalesce(split_part(p.full_name, ' ', 1), 'Customer') as reviewer_first_name
from public.reviews r
join public.profiles p on p.id = r.customer_id
where public.merchant_is_public(r.merchant_id);

revoke all on public.storefronts, public.store_reviews from anon, authenticated;
grant select on public.storefronts, public.store_reviews to anon, authenticated;

-- Search across public stores and products in an area.
create or replace function public.search_catalog(p_query text, p_service_area_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_pattern text;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('stores', '[]'::jsonb, 'products', '[]'::jsonb);
  end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'stores', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.state = 'open' desc, s.name)
      from (select * from public.storefronts
            where (p_service_area_id is null or service_area_id = p_service_area_id)
              and (name ilike v_pattern or description ilike v_pattern or category::text ilike v_pattern)
            limit 20) s
    ), '[]'),
    'products', coalesce((
      select jsonb_agg(x order by x ->> 'name')
      from (
        select jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description, 'image_path', p.image_path,
          'base_price_minor', coalesce((select min(price_minor) from public.product_variants v where v.product_id = p.id), p.base_price_minor),
          'is_available', p.is_available,
          'merchant_id', s.id, 'merchant_name', s.name, 'merchant_slug', s.slug, 'merchant_state', s.state
        ) as x
        from public.products p
        join public.storefronts s on s.id = p.merchant_id
        where p.status = 'published'
          and (p_service_area_id is null or s.service_area_id = p_service_area_id)
          and (p.name ilike v_pattern or p.description ilike v_pattern)
        limit 40
      ) q
    ), '[]')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.assert_can_manage(uuid) from public, anon, authenticated;

revoke execute on function public.submit_partner_application(uuid) from public, anon;
revoke execute on function public.review_partner_application(uuid, public.application_status, text) from public, anon;
revoke execute on function public.set_store_published(uuid, boolean) from public, anon;
revoke execute on function public.set_store_paused(uuid, boolean, timestamptz) from public, anon;
revoke execute on function public.replace_store_hours(uuid, jsonb) from public, anon;
revoke execute on function public.save_product(uuid, jsonb) from public, anon;
revoke execute on function public.set_product_status(uuid, public.product_status) from public, anon;
revoke execute on function public.set_product_availability(uuid, boolean) from public, anon;
revoke execute on function public.set_option_availability(uuid, boolean) from public, anon;
revoke execute on function public.save_option_group(uuid, jsonb) from public, anon;
revoke execute on function public.delete_option_group(uuid) from public, anon;
revoke execute on function public.set_merchant_status(uuid, public.merchant_status, text) from public, anon;
revoke execute on function public.grant_role(text, public.app_role) from public, anon;
revoke execute on function public.revoke_role(uuid, public.app_role) from public, anon;
revoke execute on function public.create_rider(text, text, text, public.vehicle_type, text, uuid, text, text) from public, anon;
revoke execute on function public.set_rider_status(uuid, public.rider_status) from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.application_missing_items(uuid) from public, anon;
