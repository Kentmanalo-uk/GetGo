/**
 * End-to-end check of every Supabase connection the app uses, against the
 * real project: Auth sessions, PostgREST queries (with the app's exact select
 * strings and embeds), RPC functions, RLS, Storage policies and Realtime.
 *
 * Creates throwaway accounts and data tagged "e2e", and removes all of it in
 * afterAll. Run with:  SUPABASE_SERVICE_ROLE_KEY=... npm run test:live
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ORDER_SELECT, PRODUCT_SELECT } from '@/features/consumer/api';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const URL_ = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const run = Boolean(URL_ && ANON && SERVICE);
const tag = `e2e${Date.now().toString(36)}`;
const password = `E2e!${randomUUID()}`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const admin: SupabaseClient = run ? createClient(URL_, SERVICE!, opts) : (null as never);
const anon: SupabaseClient = run ? createClient(URL_, ANON, opts) : (null as never);

interface Actor {
  id: string;
  email: string;
  db: SupabaseClient;
}

async function makeUser(role: string, phone: string): Promise<Actor> {
  const email = `${tag}-${role}@getgo.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${role}`, phone },
  });
  if (error) throw error;
  const db = createClient(URL_, ANON, opts);
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, db };
}

/** Unwraps a supabase-js result, failing the test with the API's message. */
function ok<T>(result: { data: T; error: { message: string; code?: string; hint?: string | null } | null }, label: string): NonNullable<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message} (${result.error.code ?? ''} ${result.error.hint ?? ''})`);
  // Writes without .select() legitimately return no data; callers that read
  // data assert on it explicitly.
  return result.data as NonNullable<T>;
}

const pdf = new Blob([new TextEncoder().encode('%PDF-1.4\n% e2e test document\n')], { type: 'application/pdf' });
const png = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))], {
  type: 'image/png',
});

describe.skipIf(!run)('live Supabase connections', () => {
  let a: Actor; // admin
  let owner: Actor;
  let customer: Actor;
  let rider: Actor;
  let stranger: Actor;
  let areaId: string;
  let appId: string;
  let merchantId: string;
  let productId: string;
  let regularId: string;
  let drinkTea: string;
  let addressId: string;
  let orderId: string;
  const uploaded: Array<{ bucket: string; path: string }> = [];
  const extraUsers: string[] = [];
  const extraMerchants: string[] = [];

  beforeAll(async () => {
    [a, owner, customer, rider, stranger] = await Promise.all([
      makeUser('admin', '09170000001'),
      makeUser('owner', '09170000002'),
      makeUser('customer', '09170000003'),
      makeUser('rider', '09170000004'),
      makeUser('stranger', '09170000005'),
    ]);
    ok(await admin.from('user_roles').insert({ user_id: a.id, role: 'admin' }), 'grant admin');
  });

  afterAll(async () => {
    if (!run) return;
    for (const { bucket, path } of uploaded) await admin.storage.from(bucket).remove([path]);
    const ids = [a, owner, customer, rider, stranger].filter(Boolean).map((u) => u.id);
    await admin.from('orders').delete().in('customer_id', ids);
    await admin.from('promotions').delete().like('code', `${tag.toUpperCase()}%`);
    if (merchantId) await admin.from('merchants').delete().eq('id', merchantId);
    if (extraMerchants.length) await admin.from('merchants').delete().in('id', extraMerchants);
    await admin.from('support_tickets').delete().in('user_id', ids);
    for (const id of [...ids, ...extraUsers]) await admin.auth.admin.deleteUser(id);
    if (areaId) await admin.from('service_areas').delete().eq('id', areaId);
  });

  test('auth sessions and identity query', async () => {
    const identity = ok(
      await customer.db
        .from('merchant_members')
        .select('merchant_id, role, merchant:merchants(id, name, slug, status, is_published, category, logo_path)')
        .eq('user_id', customer.id),
      'memberships',
    );
    expect(identity).toEqual([]);
    const profile = ok(await customer.db.from('profiles').select('id, email, full_name, phone, email_verified_at').eq('id', customer.id).single(), 'profile');
    expect(profile).toMatchObject({ email: customer.email, full_name: 'E2E customer', phone: '09170000003', email_verified_at: null });
    const roles = ok(await a.db.from('user_roles').select('role').eq('user_id', a.id), 'roles');
    expect(roles).toEqual([{ role: 'admin' }]);
    const verify = await customer.db.rpc('confirm_email_verification');
    expect(verify.error?.hint).toBe('not_verified'); // password session doesn't prove the inbox
  });

  test('admin configures an area and reads the overview', async () => {
    const area = ok(
      await a.db
        .from('service_areas')
        .insert({ name: `E2E ${tag}`, city: 'Naga City', province: 'Camarines Sur', is_active: true, delivery_fee_minor: 4900, service_fee_minor: 1000, typical_delivery_minutes: 25 })
        .select()
        .single(),
      'create area',
    );
    areaId = area.id;
    const overview = ok(await a.db.rpc('admin_overview'), 'admin_overview');
    expect(overview).toHaveProperty('orders_waiting_for_rider');
    expect((await customer.db.rpc('admin_overview')).error?.code).toBe('42501');
  });

  test('partner application with private documents and branding uploads', async () => {
    const app = ok(
      await owner.db
        .from('partner_applications')
        .insert({
          business_name: `E2E Kitchen ${tag}`,
          category: 'restaurant',
          owner_name: 'E2E owner',
          owner_phone: '09170000002',
          owner_email: owner.email,
          address_line: '1 Test St',
          barangay: 'Dinaga',
          city: 'Naga City',
          service_area_id: areaId,
          hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '00:00', closes: '23:59' })),
          menu_items: [{ name: 'Rice Meal', price_minor: 12000, category: 'Meals' }],
        })
        .select()
        .single(),
      'create application',
    );
    appId = app.id;

    for (const docType of ['government_id', 'business_permit', 'dti_sec_registration']) {
      const path = `${owner.id}/${appId}/${docType}-${randomUUID()}.pdf`;
      ok(await owner.db.storage.from('partner-documents').upload(path, pdf, { contentType: 'application/pdf' }), `upload ${docType}`);
      uploaded.push({ bucket: 'partner-documents', path });
      ok(
        await owner.db.from('application_documents').insert({
          application_id: appId,
          doc_type: docType,
          storage_path: path,
          file_name: `${docType}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: pdf.size,
        }),
        `record ${docType}`,
      );
    }
    const logoPath = `applications/${appId}/${randomUUID()}.png`;
    ok(await owner.db.storage.from('media').upload(logoPath, png, { contentType: 'image/png' }), 'upload logo');
    uploaded.push({ bucket: 'media', path: logoPath });
    ok(await owner.db.from('partner_applications').update({ logo_path: logoPath }).eq('id', appId).select(), 'save logo');

    // Someone else can't upload into this applicant's folder.
    const intrusion = await stranger.db.storage.from('partner-documents').upload(`${owner.id}/${appId}/x.pdf`, pdf, { contentType: 'application/pdf' });
    expect(intrusion.error).not.toBeNull();

    expect(ok(await owner.db.rpc('application_missing_items', { p_application_id: appId }), 'missing items')).toEqual([]);
    ok(await owner.db.rpc('submit_partner_application', { p_application_id: appId }), 'submit');
  });

  test('admin reviews documents and approves the store', async () => {
    const docs = ok(await a.db.from('application_documents').select('*').eq('application_id', appId), 'admin docs');
    expect(docs).toHaveLength(3);
    const signed = ok(await a.db.storage.from('partner-documents').createSignedUrl(docs[0].storage_path, 60), 'admin signed url');
    const download = await fetch(signed.signedUrl);
    expect(download.status).toBe(200);
    // Documents stay private from everyone else.
    expect(ok(await stranger.db.from('application_documents').select('id').eq('application_id', appId), 'stranger docs')).toEqual([]);
    expect((await stranger.db.storage.from('partner-documents').createSignedUrl(docs[0].storage_path, 60)).error).not.toBeNull();
    expect((await anon.storage.from('partner-documents').download(docs[0].storage_path)).error).not.toBeNull();

    merchantId = ok(await a.db.rpc('review_partner_application', { p_application_id: appId, p_decision: 'approved', p_notes: 'E2E approved' }), 'approve') as string;
    expect(merchantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('store owner sets up products, choices, photo, hours and publishes', async () => {
    const memberships = ok(
      await owner.db.from('merchant_members').select('merchant_id, role, merchant:merchants(id, name, slug, status, is_published, category, logo_path)').eq('user_id', owner.id),
      'owner memberships',
    );
    expect(memberships).toHaveLength(1);

    const group = ok(
      await owner.db.rpc('save_option_group', {
        p_merchant_id: merchantId,
        p_group: { name: 'Drink', min_select: 1, max_select: 1, values: [{ name: 'Iced tea', price_delta_minor: 0 }, { name: 'Coke', price_delta_minor: 1500 }] },
      }),
      'save choices',
    ) as string;
    const drafts = ok(await owner.db.from('products').select(PRODUCT_SELECT).eq('merchant_id', merchantId), 'catalog products') as unknown as Array<{ id: string }>;
    productId = drafts[0].id;

    const imagePath = `merchants/${merchantId}/products/${randomUUID()}.png`;
    ok(await owner.db.storage.from('media').upload(imagePath, png, { contentType: 'image/png' }), 'upload product photo');
    uploaded.push({ bucket: 'media', path: imagePath });
    expect((await stranger.db.storage.from('media').upload(`merchants/${merchantId}/x.png`, png, { contentType: 'image/png' })).error).not.toBeNull();

    ok(
      await owner.db.rpc('save_product', {
        p_merchant_id: merchantId,
        p_product: {
          id: productId,
          name: 'Rice Meal',
          description: 'E2E',
          image_path: imagePath,
          base_price_minor: 12000,
          status: 'published',
          is_available: true,
          max_per_order: 10,
          variants: [{ name: 'Regular', price_minor: 12000, is_available: true }],
          option_group_ids: [group],
        },
      }),
      'save product',
    );
    const groups = ok(
      await owner.db
        .from('option_groups')
        .select('id, merchant_id, name, min_select, max_select, option_values(id, group_id, name, price_delta_minor, is_available, max_quantity, sort_order)')
        .eq('merchant_id', merchantId),
      'catalog groups',
    ) as Array<{ option_values: Array<{ id: string; name: string }> }>;
    drinkTea = groups[0].option_values.find((v) => v.name === 'Iced tea')!.id;
    ok(await owner.db.from('categories').insert({ merchant_id: merchantId, name: 'E2E extra' }), 'create category');

    ok(
      await owner.db.rpc('replace_store_hours', {
        p_merchant_id: merchantId,
        p_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '00:00', closes: '23:59' })),
      }),
      'hours',
    );
    ok(await owner.db.from('store_hour_exceptions').upsert({ merchant_id: merchantId, date: '2099-12-25', is_closed: true, note: 'E2E' }, { onConflict: 'merchant_id,date' }), 'exception');
    ok(await owner.db.rpc('set_store_paused', { p_merchant_id: merchantId, p_paused: true, p_until: null }), 'pause');
    expect(ok(await owner.db.rpc('store_state', { p_merchant_id: merchantId }), 'state paused')).toBe('paused');
    ok(await owner.db.rpc('set_store_paused', { p_merchant_id: merchantId, p_paused: false, p_until: null }), 'unpause');
    ok(await owner.db.rpc('set_store_published', { p_merchant_id: merchantId, p_published: true }), 'publish');
    ok(await owner.db.from('merchants').update({ description: 'E2E store' }).eq('id', merchantId), 'update profile');
  });

  test('anonymous browsing uses only public data', async () => {
    const fronts = ok(await anon.from('storefronts').select('*').eq('service_area_id', areaId), 'storefronts') as Array<Record<string, unknown>>;
    expect(fronts).toHaveLength(1);
    expect(fronts[0]).toMatchObject({ state: 'open', delivery_fee_minor: 4900 });
    const variants = ok(await anon.from('products').select(PRODUCT_SELECT).eq('merchant_id', merchantId).eq('status', 'published'), 'public products');
    expect(variants).toHaveLength(1);
    ok(await anon.from('categories').select('id').eq('merchant_id', merchantId), 'public categories');
    ok(await anon.from('store_hours').select('weekday, opens_at, closes_at').eq('merchant_id', merchantId), 'public hours');
    ok(await anon.from('store_reviews').select('*').eq('merchant_id', merchantId), 'public reviews');
    ok(await anon.from('promotions').select('*').eq('is_active', true), 'public promos');
    ok(await anon.from('platform_settings').select('*').single(), 'settings');
    const feed = ok(await anon.rpc('home_feed', { p_service_area_id: areaId }), 'home feed') as { meals: Array<{ name: string }>; new_stores: unknown[] };
    expect(feed.meals.map((i) => i.name)).toContain('Rice Meal');
    expect(feed.new_stores).toHaveLength(1);
    const explore = ok(await anon.rpc('explore_items', { p_service_area_id: areaId, p_section: 'meals', p_offset: 0, p_limit: 24 }), 'explore') as Array<{ name: string }>;
    expect(explore.map((i) => i.name)).toContain('Rice Meal');
    const search = ok(await anon.rpc('search_catalog', { p_query: 'Rice Meal', p_service_area_id: areaId }), 'search') as { products: unknown[] };
    expect(search.products.length).toBeGreaterThan(0);
    const media = await fetch(anon.storage.from('media').getPublicUrl(uploaded.find((u) => u.path.startsWith('merchants/'))!.path).data.publicUrl);
    expect(media.status).toBe(200);
    expect((await anon.from('merchants').select('id')).error).not.toBeNull();
  });

  test('admin adds the rider and a promo code', async () => {
    ok(
      await a.db.rpc('create_rider', {
        p_email: rider.email,
        p_full_name: 'E2E Rider',
        p_phone: '09170000004',
        p_vehicle: 'motorcycle',
        p_plate: 'E2E 123',
        p_service_area_id: areaId,
        p_gcash_name: 'E2E R.',
        p_gcash_number: '09171234567',
      }),
      'create rider',
    );
    ok(
      await a.db.from('promotions').insert({ code: `${tag.toUpperCase()}OFF`.slice(0, 20), title: 'E2E promo', discount_type: 'fixed', value: 500 }),
      'create promo',
    );
  });

  test('customer orders with live updates; rider is paid by GCash and delivers', async () => {
    const address = ok(
      await customer.db
        .from('addresses')
        .insert({ label: 'Home', recipient_name: 'E2E customer', phone: '09170000003', line1: '2 Test Ave', barangay: 'Lerma', city: 'Naga City', service_area_id: areaId, is_default: true })
        .select()
        .single(),
      'address',
    );
    addressId = address.id;

    const product = ok(await customer.db.from('products').select(PRODUCT_SELECT).eq('id', productId).single(), 'product') as unknown as {
      product_variants: Array<{ id: string }>;
    };
    regularId = product.product_variants[0].id;

    const invalid = await customer.db.rpc('cart_add_item', { p_product_id: productId, p_variant_id: regularId, p_options: [], p_quantity: 1 });
    expect(invalid.error?.hint).toBe('group_min');
    ok(
      await customer.db.rpc('cart_add_item', {
        p_product_id: productId,
        p_variant_id: regularId,
        p_options: [{ option_value_id: drinkTea, quantity: 1 }],
        p_quantity: 2,
        p_instructions: 'E2E',
      }),
      'add to cart',
    );
    const carts = ok(await customer.db.from('carts').select('id, merchant_id, updated_at, cart_items(quantity)'), 'carts') as Array<{ cart_items: Array<{ quantity: number }> }>;
    expect(carts[0].cart_items[0].quantity).toBe(2);
    ok(await customer.db.from('storefronts').select('id, name, slug, logo_path, state').in('id', [merchantId]), 'cart stores');

    const promo = `${tag.toUpperCase()}OFF`.slice(0, 20);
    const quote = ok(await customer.db.rpc('quote_checkout', { p_merchant_id: merchantId, p_address_id: addressId, p_promo_code: promo }), 'quote') as {
      can_checkout: boolean;
      total_minor: number;
      discount_minor: number;
      issues: unknown[];
    };
    expect(quote.issues).toEqual([]);
    expect(quote.discount_minor).toBe(500);
    expect(quote.total_minor).toBe(24000 + 4900 + 1000 - 500);

    const key = `e2e-${randomUUID()}`;
    const place = () =>
      customer.db.rpc('place_order', {
        p_merchant_id: merchantId,
        p_address_id: addressId,
        p_notes: 'E2E',
        p_promo_code: promo,
        p_expected_total_minor: quote.total_minor,
        p_idempotency_key: key,
      });
    orderId = ok(await place(), 'place order') as string;
    expect(ok(await place(), 'retry is idempotent')).toBe(orderId);

    // Realtime: the customer's order page listens for changes.
    const events: string[] = [];
    const channel = customer.db
      .channel(`e2e-order-${randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (p) => {
        events.push((p.new as { status: string }).status);
      });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('realtime subscribe timed out')), 20_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error(`realtime ${status}`));
        }
      });
    });

    // The rider finds the open order with its shopping list.
    const open = ok(await rider.db.from('orders').select(ORDER_SELECT).eq('status', 'pending').eq('service_area_id', areaId), 'rider open orders') as unknown as Array<{
      id: string;
      order_items: unknown[];
    }>;
    expect(open.map((o) => o.id)).toContain(orderId);
    expect(open[0].order_items).toHaveLength(1);
    expect(ok(await stranger.db.from('orders').select('id').eq('id', orderId), 'stranger orders')).toEqual([]);
    expect(ok(await owner.db.from('orders').select('id').eq('id', orderId), 'store sees no orders')).toEqual([]);

    ok(await rider.db.rpc('rider_accept_order', { p_order_id: orderId }), 'accept');

    // The customer's order view with the app's exact embeds.
    const view = ok(await customer.db.from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle(), 'customer order') as unknown as {
      status: string;
      payments: unknown;
      assignments: Array<{ rider: { full_name: string } | null }>;
    };
    expect(view.status).toBe('accepted');
    // payments.order_id is unique, so the API embeds a single object (the app relies on this).
    expect(Array.isArray(view.payments)).toBe(false);
    expect(view.payments).toMatchObject({ payee_name: 'E2E R.', payee_number: '09171234567', status: 'pending' });
    expect(view.assignments[0].rider?.full_name).toBe('E2E Rider');
    ok(await customer.db.from('order_status_history').select('*').eq('order_id', orderId).order('created_at'), 'history');

    const reference = String(Date.now()).padEnd(13, '7');
    ok(await customer.db.rpc('submit_gcash_payment', { p_order_id: orderId, p_reference: reference, p_sender_name: 'E2E customer' }), 'submit payment');
    const mine = ok(
      await rider.db
        .from('assignments')
        .select(`id, status, completed_at, order:orders(${ORDER_SELECT})`)
        .eq('rider_id', rider.id)
        .in('status', ['active', 'completed']),
      'rider assignments',
    ) as unknown as Array<{ order: { payments: unknown } }>;
    expect(mine[0].order.payments).toMatchObject({ gcash_reference: reference, status: 'submitted' });

    ok(await rider.db.rpc('confirm_gcash_payment', { p_order_id: orderId, p_received: true }), 'confirm payment');
    ok(await rider.db.rpc('update_order_status', { p_order_id: orderId, p_status: 'out_for_delivery' }), 'out for delivery');
    ok(await rider.db.rpc('update_order_status', { p_order_id: orderId, p_status: 'completed' }), 'delivered');

    const deadline = Date.now() + 15_000;
    while (!events.includes('completed') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    await customer.db.removeChannel(channel);
    expect(events).toContain('accepted');
    expect(events).toContain('completed');
  });

  test('after delivery: review, notifications, support', async () => {
    ok(await customer.db.from('reviews').insert({ order_id: orderId, merchant_id: merchantId, rating: 5, comment: 'E2E' }), 'review');
    const notes = ok(await customer.db.from('notifications').select('*').order('created_at', { ascending: false }).limit(50), 'notifications') as Array<{
      id: string;
      kind: string;
    }>;
    expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(['order.accepted', 'order.completed']));
    ok(await customer.db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', notes.map((n) => n.id)), 'mark read');

    const ticket = ok(await customer.db.from('support_tickets').insert({ subject: 'E2E help', order_id: orderId }).select('id').single(), 'ticket') as { id: string };
    ok(await customer.db.from('ticket_messages').insert({ ticket_id: ticket.id, body: 'E2E message' }), 'ticket message');
    ok(await a.db.from('ticket_messages').insert({ ticket_id: ticket.id, body: 'E2E reply', is_staff: true }), 'staff reply');
    ok(await a.db.from('support_tickets').update({ status: 'pending' }).eq('id', ticket.id), 'ticket status');
    expect(ok(await stranger.db.from('support_tickets').select('id').eq('id', ticket.id), 'stranger tickets')).toEqual([]);
  });

  test('cancellation after payment opens a refund that finance processes', async () => {
    ok(await customer.db.rpc('cart_add_item', { p_product_id: productId, p_variant_id: regularId, p_options: [{ option_value_id: drinkTea, quantity: 1 }], p_quantity: 1 }), 'add');
    const quote = ok(await customer.db.rpc('quote_checkout', { p_merchant_id: merchantId, p_address_id: addressId, p_promo_code: null }), 'quote') as { total_minor: number };
    const second = ok(
      await customer.db.rpc('place_order', {
        p_merchant_id: merchantId,
        p_address_id: addressId,
        p_notes: null,
        p_promo_code: null,
        p_expected_total_minor: quote.total_minor,
        p_idempotency_key: `e2e-${randomUUID()}`,
      }),
      'place',
    ) as string;
    ok(await a.db.rpc('assign_rider', { p_order_id: second, p_rider_id: rider.id }), 'assign rider');
    ok(await customer.db.rpc('submit_gcash_payment', { p_order_id: second, p_reference: String(Date.now() + 1).padEnd(13, '3'), p_sender_name: null }), 'pay');
    ok(await rider.db.rpc('confirm_gcash_payment', { p_order_id: second, p_received: true }), 'confirm');
    ok(await rider.db.rpc('update_order_status', { p_order_id: second, p_status: 'cancelled', p_note: 'E2E store closed' }), 'rider cancels');

    const refund = ok(await a.db.from('refunds').select('*').eq('order_id', second).single(), 'refund') as { id: string; amount_minor: number };
    expect(refund.amount_minor).toBe(quote.total_minor);
    ok(await a.db.rpc('review_refund', { p_refund_id: refund.id, p_action: 'approve', p_reference: null }), 'approve refund');
    ok(await a.db.rpc('review_refund', { p_refund_id: refund.id, p_action: 'mark_processed', p_reference: 'E2EREF123' }), 'process refund');
    const order = ok(await customer.db.from('orders').select('payment_status').eq('id', second).single(), 'order') as { payment_status: string };
    expect(order.payment_status).toBe('refunded');
    const audit = ok(await a.db.from('audit_logs').select('action').in('entity_id', [second, refund.id]), 'audit') as Array<{ action: string }>;
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['order.rider_assigned', 'refund.mark_processed']));
  });

  test('rider signs up with their details and is approved by an admin', async () => {
    const email = `${tag}-newrider@getgo.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'E2E New Rider',
        phone: '09170000006',
        rider_application: { vehicle: 'bicycle', plate: '', service_area_id: areaId, gcash_name: 'E2E N.', gcash_number: '0917 000 0006' },
      },
    });
    if (created.error) throw created.error;
    extraUsers.push(created.data.user.id);
    const db = createClient(URL_, ANON, opts);
    expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();

    const pending = ok(await db.from('rider_profiles').select('status, gcash_number').eq('user_id', created.data.user.id).single(), 'own application') as {
      status: string;
      gcash_number: string;
    };
    expect(pending).toEqual({ status: 'pending', gcash_number: '09170000006' });
    expect(ok(await db.from('orders').select('id').eq('status', 'pending'), 'pending rider sees no orders')).toEqual([]);

    ok(await a.db.rpc('set_rider_status', { p_user_id: created.data.user.id, p_status: 'active' }), 'approve rider');
    const roles = ok(await db.from('user_roles').select('role').eq('user_id', created.data.user.id), 'rider roles');
    expect(roles).toEqual([{ role: 'rider' }]);
  });

  test('admin creates a store for a new email; it is claimed at sign-up and admin manages it', async () => {
    const ownerEmail = `${tag}-newowner@getgo.test`;
    const result = ok(
      await a.db.rpc('admin_create_store', {
        p_owner_email: ownerEmail,
        p_store: {
          name: `E2E Admin Store ${tag}`,
          category: 'grocery',
          address_line: '4 Test Rd',
          barangay: 'Centro',
          city: 'Naga City',
          service_area_id: areaId,
          hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '08:00', closes: '20:00' })),
        },
      }),
      'admin create store',
    ) as { merchant_id: string; owner_linked: boolean };
    extraMerchants.push(result.merchant_id);
    expect(result.owner_linked).toBe(false);
    expect((await customer.db.rpc('admin_create_store', { p_owner_email: 'x@getgo.test', p_store: {} })).error?.code).toBe('42501');

    // Admin manages the catalog and details through the same API the store uses.
    const productId = ok(
      await a.db.rpc('save_product', { p_merchant_id: result.merchant_id, p_product: { name: 'E2E Rice 1kg', base_price_minor: 6500, status: 'published' } }),
      'admin save product',
    ) as string;
    ok(await a.db.rpc('set_product_availability', { p_product_id: productId, p_available: false }), 'admin availability');
    ok(await a.db.from('merchants').update({ description: 'Managed by admin' }).eq('id', result.merchant_id), 'admin edits store');
    const photo = `merchants/${result.merchant_id}/products/${randomUUID()}.png`;
    ok(await a.db.storage.from('media').upload(photo, png, { contentType: 'image/png' }), 'admin uploads photo');
    uploaded.push({ bucket: 'media', path: photo });

    // The owner signs up with that email and gets the store.
    const signup = createClient(URL_, ANON, opts);
    const created = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true, user_metadata: { full_name: 'E2E New Owner' } });
    if (created.error) throw created.error;
    extraUsers.push(created.data.user.id);
    expect((await signup.auth.signInWithPassword({ email: ownerEmail, password })).error).toBeNull();
    const memberships = ok(
      await signup.from('merchant_members').select('merchant_id, role, merchant:merchants(id, name, slug, status, is_published, category, logo_path)').eq('user_id', created.data.user.id),
      'owner memberships',
    ) as Array<{ merchant_id: string; role: string }>;
    expect(memberships).toEqual([expect.objectContaining({ merchant_id: result.merchant_id, role: 'owner' })]);
    const products = ok(await signup.from('products').select('name, is_available').eq('merchant_id', result.merchant_id), 'owner sees admin edits');
    expect(products).toEqual([{ name: 'E2E Rice 1kg', is_available: false }]);
  });

  test('barangay delivery prices apply at checkout', async () => {
    // The customer's address barangay is "Lerma" (typed, so matched by name).
    ok(
      await a.db.rpc('set_barangay_fees', {
        p_service_area_id: areaId,
        p_fees: [{ barangay_code: '175203999', barangay_name: 'Lerma', delivery_fee_minor: 2500 }],
      }),
      'set barangay fees',
    );
    expect((await owner.db.rpc('set_barangay_fees', { p_service_area_id: areaId, p_fees: [] })).error?.code).toBe('42501');
    ok(await customer.db.rpc('cart_add_item', { p_product_id: productId, p_variant_id: regularId, p_options: [{ option_value_id: drinkTea, quantity: 1 }], p_quantity: 1 }), 'add');
    const quote = ok(await customer.db.rpc('quote_checkout', { p_merchant_id: merchantId, p_address_id: addressId, p_promo_code: null }), 'quote') as { delivery_fee_minor: number };
    expect(quote.delivery_fee_minor).toBe(2500);
    const front = ok(await anon.from('storefronts').select('delivery_fee_from_minor, delivery_fee_varies').eq('id', merchantId).single(), 'storefront fee') as {
      delivery_fee_from_minor: number;
      delivery_fee_varies: boolean;
    };
    expect(front).toEqual({ delivery_fee_from_minor: 2500, delivery_fee_varies: true });
    ok(await customer.db.rpc('cart_clear', { p_merchant_id: merchantId }), 'clear cart');
  });
});
