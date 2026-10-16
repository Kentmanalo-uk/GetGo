import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createApplication, createCustomer, createPlatform, createRider, createStore, placeOrder, sel, type Store, type World } from './fixtures';

describe('row level security and privilege boundaries', () => {
  let db: TestDb;
  let world: World;
  let storeA: Store;
  let storeB: Store;
  let alice: { id: string; addressId: string };
  let bob: { id: string; addressId: string };
  let aliceOrder: string;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    storeA = await createStore(db, world, 'owner-a@example.test', 'Store A');
    storeB = await createStore(db, world, 'owner-b@example.test', 'Store B');
    alice = await createCustomer(db, world, 'alice@example.test');
    bob = await createCustomer(db, world, 'bob@example.test');
    await db.as(alice.id, `select cart_add_item($1, $2, $3, 1)`, [storeA.productId, storeA.regularId, sel(storeA.options['Iced tea'])]);
    aliceOrder = await placeOrder(db, alice.id, storeA.merchantId, alice.addressId);
  });

  test('every public table has RLS enabled', async () => {
    const rows = await db.sql<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  test('customers cannot read each other’s orders, carts, addresses or payments', async () => {
    await db.as(bob.id, `select cart_add_item($1, $2, $3, 1)`, [storeA.productId, storeA.regularId, sel(storeA.options['Iced tea'])]);
    expect(await db.as(alice.id, `select id from carts where user_id = $1`, [bob.id])).toHaveLength(0);
    expect(await db.as(alice.id, `select id from addresses where user_id = $1`, [bob.id])).toHaveLength(0);
    expect(await db.as(bob.id, `select id from orders where id = $1`, [aliceOrder])).toHaveLength(0);
    expect(await db.as(bob.id, `select id from order_items where order_id = $1`, [aliceOrder])).toHaveLength(0);
    expect(await db.as(bob.id, `select id from payments where order_id = $1`, [aliceOrder])).toHaveLength(0);
    expect(await db.as(bob.id, `select id from addresses where id = $1`, [alice.addressId])).toHaveLength(0);
    expect((await db.expectError(bob.id, `select update_order_status($1, 'cancelled')`, [aliceOrder])).hint).toBe('order_not_found');
    const bobCartItem = await db.as<{ id: string }>(bob.id, `select id from cart_items`);
    expect((await db.expectError(alice.id, `select cart_set_quantity($1, 5)`, [bobCartItem[0].id])).hint).toBe('cart_item_missing');
  });

  test('merchants are isolated from other stores', async () => {
    expect(await db.as(storeB.owner, `select id from orders where id = $1`, [aliceOrder])).toHaveLength(0);
    expect(await db.as(storeB.owner, `select id from merchants where id = $1`, [storeA.merchantId])).toHaveLength(0);
    expect((await db.expectError(storeB.owner, `select update_order_status($1, 'cancelled', 'x')`, [aliceOrder])).hint).toBe('order_not_found');
    expect((await db.expectError(storeB.owner, `select save_product($1, '{"name":"Hack","base_price_minor":1}')`, [storeA.merchantId])).code).toBe('42501');
    expect((await db.expectError(storeB.owner, `select set_product_availability($1, false)`, [storeA.productId])).code).toBe('42501');
    expect((await db.expectError(storeB.owner, `select set_store_published($1, false)`, [storeA.merchantId])).code).toBe('42501');
    // Linking another store's option group to your product is refused by FK.
    expect(
      (await db.expectError(storeB.owner, `select save_product($1, $2)`, [
        storeB.merchantId,
        JSON.stringify({ id: storeB.productId, name: 'X', base_price_minor: 100, option_group_ids: [storeA.drinkGroupId] }),
      ])).hint,
    ).toBe('invalid_reference');
    const updated = await db.as(storeB.owner, `update merchants set name = 'Pwned' where id = $1 returning id`, [storeA.merchantId]);
    expect(updated).toHaveLength(0);
  });

  test('store staff can mark items sold out but not edit or publish', async () => {
    const staff = await db.createUser('staff@example.test');
    await db.sql(`insert into merchant_members (merchant_id, user_id, role) values ($1, $2, 'staff')`, [storeA.merchantId, staff]);
    await db.as(staff, `select set_product_availability($1, true)`, [storeA.productId]);
    expect((await db.expectError(staff, `select set_store_published($1, false)`, [storeA.merchantId])).code).toBe('42501');
    expect((await db.expectError(staff, `select save_product($1, '{"name":"X","base_price_minor":1}')`, [storeA.merchantId])).code).toBe('42501');
    expect(await db.as(staff, `select id from orders`)).toHaveLength(0);
  });

  test('ordinary users cannot escalate privileges or touch protected columns', async () => {
    const insertRole = await db.expectError(alice.id, `insert into user_roles (user_id, role) values ($1, 'admin')`, [alice.id]);
    expect(insertRole.code).toBe('42501');
    expect((await db.expectError(alice.id, `select grant_role('alice@example.test', 'admin')`)).code).toBe('42501');
    expect((await db.expectError(alice.id, `update merchants set status = 'active'`)).code).toBe('42501');
    expect((await db.expectError(alice.id, `update orders set total_minor = 1 where id = $1`, [aliceOrder])).code).toBe('42501');
    expect((await db.expectError(alice.id, `update orders set status = 'completed' where id = $1`, [aliceOrder])).code).toBe('42501');
    expect((await db.expectError(alice.id, `update payments set status = 'paid' where order_id = $1`, [aliceOrder])).code).toBe('42501');
    expect((await db.expectError(alice.id, `insert into payments (order_id, amount_minor, status) values ($1, 1, 'paid')`, [aliceOrder])).code).toBe('42501');
    expect((await db.expectError(alice.id, `select confirm_gcash_payment($1, true)`, [aliceOrder])).hint).toBe('order_not_found');
    expect(await db.as(alice.id, `update platform_settings set support_email = 'x@y.z' returning id`)).toHaveLength(0);
    expect(await db.as(alice.id, `update service_areas set delivery_fee_minor = 0 returning id`)).toHaveLength(0);
    expect((await db.expectError(alice.id, `select review_partner_application(gen_random_uuid(), 'approved', null)`)).code).toBe('42501');
    expect((await db.expectError(alice.id, `select admin_overview()`)).code).toBe('42501');
    expect(await db.as(alice.id, `select id from audit_logs`)).toHaveLength(0);
    expect(await db.as(alice.id, `select id from profiles where id <> $1`, [alice.id])).toHaveLength(0);
    // Profile edits are limited to name and phone.
    expect((await db.expectError(alice.id, `update profiles set email = 'x@y.z' where id = $1`, [alice.id])).code).toBe('42501');
    // Admins cannot demote themselves (prevents lock-out).
    expect((await db.expectError(world.admin, `select revoke_role($1, 'admin')`, [world.admin])).hint).toBe('self_demotion');
  });

  test('applicants cannot change application status or review fields', async () => {
    const applicant = await db.createUser('sneaky@example.test');
    const appId = await createApplication(db, applicant, world.areaId, 'Sneaky Store');
    expect((await db.expectError(applicant, `update partner_applications set status = 'approved' where id = $1`, [appId])).code).toBe('42501');
    expect((await db.expectError(applicant, `update partner_applications set merchant_id = $2 where id = $1`, [appId, storeA.merchantId])).code).toBe('42501');
    expect((await db.expectError(applicant, `insert into partner_applications (business_name, status) values ('x', 'approved')`)).code).toBe('42501');
    expect(await db.as(alice.id, `select id from partner_applications where id = $1`, [appId])).toHaveLength(0);
    const [missing] = await db.as<{ m: string[] }>(alice.id, `select application_missing_items($1) as m`, [appId]);
    expect(missing.m).toEqual(['Application not found']);
  });

  test('verification documents are private to the applicant and reviewers', async () => {
    const applicant = await db.createUser('docs@example.test');
    const appId = await createApplication(db, applicant, world.areaId, 'Docs Store');
    const path = `${applicant}/${appId}/government_id.pdf`;

    const visible = (actor: string) => db.as(actor, `select name from storage.objects where bucket_id = 'partner-documents' and name = $1`, [path]);
    expect(await visible(applicant)).toHaveLength(1);
    expect(await visible(world.support)).toHaveLength(1);
    expect(await visible(world.admin)).toHaveLength(1);
    expect(await visible(alice.id)).toHaveLength(0);
    expect(await visible(storeA.owner)).toHaveLength(0);
    expect(await db.as('anon', `select name from storage.objects where bucket_id = 'partner-documents'`)).toHaveLength(0);
    expect(await db.as(alice.id, `select id from application_documents where application_id = $1`, [appId])).toHaveLength(0);

    // Uploading into someone else's folder or application is refused.
    expect((await db.expectError(alice.id, `insert into storage.objects (bucket_id, name) values ('partner-documents', $1)`, [`${applicant}/${appId}/evil.pdf`])).code).toBe('42501');
    expect((await db.expectError(alice.id, `insert into storage.objects (bucket_id, name) values ('partner-documents', $1)`, [`${alice.id}/${appId}/evil.pdf`])).code).toBe('42501');

    // Once submitted, the applicant can no longer replace documents.
    await db.as(applicant, `select submit_partner_application($1)`, [appId]);
    expect((await db.expectError(applicant, `insert into storage.objects (bucket_id, name) values ('partner-documents', $1)`, [`${applicant}/${appId}/late.pdf`])).code).toBe('42501');
    expect(await db.as(applicant, `delete from storage.objects where name = $1 returning id`, [path])).toHaveLength(0);
  });

  test('media uploads are scoped to stores the user manages', async () => {
    const ok = `merchants/${storeA.merchantId}/products/meal.webp`;
    await db.as(storeA.owner, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [ok]);
    expect((await db.expectError(storeB.owner, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`merchants/${storeA.merchantId}/x.webp`])).code).toBe('42501');
    expect((await db.expectError(alice.id, `insert into storage.objects (bucket_id, name) values ('media', 'random/x.webp')`)).code).toBe('42501');
    expect(await db.as('anon', `select name from storage.objects where name = $1`, [ok])).toHaveLength(1);
  });

  test('anonymous visitors see only published storefront data', async () => {
    await db.as(storeB.owner, `select set_store_published($1, false)`, [storeB.merchantId]);
    expect(await db.as('anon', `select id from storefronts where id = $1`, [storeB.merchantId])).toHaveLength(0);
    expect(await db.as('anon', `select id from products where merchant_id = $1`, [storeB.merchantId])).toHaveLength(0);
    expect(await db.as('anon', `select id from option_groups where merchant_id = $1`, [storeB.merchantId])).toHaveLength(0);
    expect((await db.expectError('anon', `select id from merchants`)).code).toBe('42501');
    expect((await db.expectError('anon', `select id from orders`)).code).toBe('42501');
    expect((await db.expectError('anon', `select cart_add_item($1, $2, '[]', 1)`, [storeA.productId, storeA.regularId])).code).toBe('42501');
    expect(await db.as('anon', `select id from storefronts where id = $1`, [storeA.merchantId])).toHaveLength(1);
    await db.as(storeB.owner, `select set_store_published($1, true)`, [storeB.merchantId]);

    // Suspended stores disappear and cannot be republished by the owner.
    await db.as(world.admin, `select set_merchant_status($1, 'suspended', 'Permit expired')`, [storeB.merchantId]);
    expect(await db.as('anon', `select id from storefronts where id = $1`, [storeB.merchantId])).toHaveLength(0);
    expect((await db.expectError(storeB.owner, `select set_store_published($1, true)`, [storeB.merchantId])).hint).toBe('store_inactive');
  });

  test('rider GCash details and payments are visible only to the parties of the order', async () => {
    const rider = await createRider(db, world, 'visible-rider@example.test');
    const otherRider = await createRider(db, world, 'other-rider@example.test');
    await db.as(alice.id, `select cart_add_item($1, $2, $3, 1)`, [storeA.productId, storeA.regularId, sel(storeA.options['Iced tea'])]);
    const orderId = await placeOrder(db, alice.id, storeA.merchantId, alice.addressId);
    const seen = (actor: string) => db.as(actor, `select gcash_number from rider_profiles where user_id = $1`, [rider]);

    expect(await seen(alice.id)).toHaveLength(0);
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    expect(await seen(alice.id)).toHaveLength(1);
    expect(await seen(bob.id)).toHaveLength(0);
    expect(await seen(storeA.owner)).toHaveLength(0);
    expect(await seen(otherRider)).toHaveLength(0);

    const payment = (actor: string) => db.as(actor, `select id from payments where order_id = $1`, [orderId]);
    expect(await payment(rider)).toHaveLength(1);
    expect(await payment(otherRider)).toHaveLength(0);
    expect(await payment(storeA.owner)).toHaveLength(0);
    expect(await payment(bob.id)).toHaveLength(0);
  });

  test('support tickets are private to the requester and support staff', async () => {
    const [t] = await db.as<{ id: string }>(alice.id, `insert into support_tickets (subject, order_id) values ('Missing item', $1) returning id`, [aliceOrder]);
    await db.as(alice.id, `insert into ticket_messages (ticket_id, body) values ($1, 'My drink was missing')`, [t.id]);
    expect(await db.as(bob.id, `select id from support_tickets where id = $1`, [t.id])).toHaveLength(0);
    expect((await db.expectError(bob.id, `insert into ticket_messages (ticket_id, body) values ($1, 'hi')`, [t.id])).code).toBe('42501');
    expect((await db.expectError(bob.id, `insert into support_tickets (subject, order_id) values ('Not mine', $1)`, [aliceOrder])).code).toBe('42501');
    expect((await db.expectError(alice.id, `insert into ticket_messages (ticket_id, body, is_staff) values ($1, 'fake staff', true)`, [t.id])).code).toBe('42501');
    await db.as(world.support, `insert into ticket_messages (ticket_id, body, is_staff) values ($1, 'Sorry! Refund on the way', true)`, [t.id]);
    expect(await db.as(world.finance, `select id from support_tickets where id = $1`, [t.id])).toHaveLength(0);
  });
});
