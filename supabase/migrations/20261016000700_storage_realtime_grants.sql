-- Storage buckets and policies, realtime publication, and explicit execute
-- grants for client-callable functions.

-- ---------------------------------------------------------------------------
-- Storage
--   media (public read): store branding and product photos
--     merchants/{merchant_id}/...       written by store owners/managers
--     applications/{application_id}/... written by the applicant while editable
--   partner-documents (private): verification documents
--     {user_id}/{application_id}/...    written by the applicant while editable,
--                                       read by the applicant and reviewers
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('partner-documents', 'partner-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

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
  end if;
  return false;
end $$;

create or replace function public.storage_document_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if array_length(v_parts, 1) < 3 or v_parts[1] !~ '^[0-9a-fA-F-]{36}$' or v_parts[2] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  if p_write then
    return v_parts[1]::uuid = auth.uid() and public.application_is_editable(v_parts[2]::uuid);
  end if;
  return v_parts[1]::uuid = auth.uid() or public.has_role('admin') or public.has_role('support');
end $$;

create policy "media public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');
create policy "media scoped insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.storage_media_writable(name));
create policy "media scoped update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.storage_media_writable(name))
  with check (bucket_id = 'media' and public.storage_media_writable(name));
create policy "media scoped delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.storage_media_writable(name));

create policy "documents owner or reviewer read" on storage.objects for select to authenticated
  using (bucket_id = 'partner-documents' and public.storage_document_access(name, false));
create policy "documents owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-documents' and public.storage_document_access(name, true));
create policy "documents owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-documents' and public.storage_document_access(name, true));

-- ---------------------------------------------------------------------------
-- Realtime: postgres_changes respects RLS, so subscribers only receive rows
-- they can select.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.order_status_history, public.notifications, public.assignments;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Client-callable functions (authenticated users; each re-checks permissions)
-- ---------------------------------------------------------------------------
grant execute on function
  public.cart_add_item(uuid, uuid, jsonb, int, text),
  public.cart_update_item(uuid, uuid, jsonb, int, text),
  public.cart_set_quantity(uuid, int),
  public.cart_clear(uuid),
  public.quote_checkout(uuid, uuid, text),
  public.place_order(uuid, uuid, text, text, bigint, text),
  public.rider_accept_order(uuid),
  public.rider_release_order(uuid, text),
  public.submit_gcash_payment(uuid, text, text),
  public.confirm_gcash_payment(uuid, boolean, text),
  public.update_order_status(uuid, public.order_status, text),
  public.assign_rider(uuid, uuid),
  public.request_refund(uuid, bigint, text),
  public.review_refund(uuid, text, text),
  public.submit_partner_application(uuid),
  public.application_missing_items(uuid),
  public.review_partner_application(uuid, public.application_status, text),
  public.set_store_published(uuid, boolean),
  public.set_store_paused(uuid, boolean, timestamptz),
  public.replace_store_hours(uuid, jsonb),
  public.save_product(uuid, jsonb),
  public.set_product_status(uuid, public.product_status),
  public.set_product_availability(uuid, boolean),
  public.set_option_availability(uuid, boolean),
  public.save_option_group(uuid, jsonb),
  public.delete_option_group(uuid),
  public.set_merchant_status(uuid, public.merchant_status, text),
  public.grant_role(text, public.app_role),
  public.revoke_role(uuid, public.app_role),
  public.create_rider(text, text, text, public.vehicle_type, text, uuid, text, text),
  public.set_rider_status(uuid, public.rider_status),
  public.admin_overview(),
  public.my_roles()
to authenticated;

-- Public (anonymous) read helpers.
grant execute on function
  public.search_catalog(text, uuid),
  public.price_configuration(uuid, uuid, jsonb, int)
to anon, authenticated;
