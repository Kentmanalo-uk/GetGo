import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createApplication, createCustomer, createPlatform, createRider, createStore, gcashRef, idemKey, quote, sel, type World } from './fixtures';

/**
 * The primary journey: partner application → admin approval → product list
 * and choices → customer discovery and customization → cart → server-checked
 * order → rider accepts → customer pays the rider by GCash → rider confirms,
 * buys and delivers → accurate order history.
 */
describe('end-to-end journey', () => {
  let db: TestDb;
  let world: World;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
  });

  test('application states: draft → submitted → needs_changes → submitted → under_review → approved', async () => {
    const applicant = await db.createUser('applicant@example.test');
    const [draft] = await db.as<{ id: string; status: string }>(
      applicant,
      `insert into partner_applications (business_name) values ('Half Done Cafe') returning id, status`,
    );
    expect(draft.status).toBe('draft');

    const incomplete = await db.expectError(applicant, `select submit_partner_application($1)`, [draft.id]);
    expect(incomplete.hint).toBe('incomplete');
    expect(incomplete.message).toContain('Business category');
    expect(incomplete.message).toContain('Government Id');

    // Only one open application at a time.
    const second = await db.expectError(applicant, `insert into partner_applications (business_name) values ('Again')`);
    expect(second.code).toBe('23505');

    await db.sql(`delete from partner_applications where id = $1`, [draft.id]);
    const appId = await createApplication(db, applicant, world.areaId, 'Kape ni Lolo');
    await db.as(applicant, `select submit_partner_application($1)`, [appId]);

    const locked = await db.as(applicant, `update partner_applications set business_name = 'X' where id = $1 returning id`, [appId]);
    expect(locked).toHaveLength(0);

    const noNotes = await db.expectError(world.support, `select review_partner_application($1, 'needs_changes', null)`, [appId]);
    expect(noNotes.hint).toBe('notes_required');
    await db.as(world.support, `select review_partner_application($1, 'needs_changes', 'Business permit photo is blurry')`, [appId]);

    const editable = await db.as(applicant, `update partner_applications set description = 'Brewed coffee' where id = $1 returning id`, [appId]);
    expect(editable).toHaveLength(1);
    await db.as(applicant, `select submit_partner_application($1)`, [appId]);
    await db.as(world.support, `select review_partner_application($1, 'under_review', null)`, [appId]);

    const supportApprove = await db.expectError(world.support, `select review_partner_application($1, 'approved', null)`, [appId]);
    expect(supportApprove.code).toBe('42501');

    const [{ id: merchantId }] = await db.as<{ id: string }>(world.admin, `select review_partner_application($1, 'approved', 'Welcome') as id`, [appId]);
    const [merchant] = await db.as<Record<string, unknown>>(applicant, `select * from merchants where id = $1`, [merchantId]);
    expect(merchant).toMatchObject({ slug: 'kape-ni-lolo', is_published: false, status: 'active' });

    expect(await db.as('anon', `select id from storefronts where id = $1`, [merchantId])).toHaveLength(0);
    expect(await db.as('anon', `select id from products where merchant_id = $1`, [merchantId])).toHaveLength(0);
    const cannotPublish = await db.expectError(applicant, `select set_store_published($1, true)`, [merchantId]);
    expect(cannotPublish.hint).toBe('no_products');

    const history = await db.as<{ action: string }>(world.admin, `select action from audit_logs where entity_id = $1 order by id`, [appId]);
    expect(history.map((h) => h.action)).toEqual([
      'application.submitted',
      'application.needs_changes',
      'application.submitted',
      'application.under_review',
      'application.approved',
    ]);
  });

  test('customer orders a customized meal; a rider is paid by GCash, buys it and delivers', async () => {
    const store = await createStore(db, world, 'rosa@example.test');
    const customer = await createCustomer(db, world, 'juan@example.test');
    const rider = await createRider(db, world, 'rider@example.test');
    const farRider = await createRider(db, world, 'far-rider@example.test', world.otherAreaId);

    // Discovery
    const [front] = await db.as<Record<string, any>>('anon', `select * from storefronts where id = $1`, [store.merchantId]);
    expect(front.state).toBe('open');
    expect(front.delivery_fee_minor).toBe(4900);
    const [search] = await db.as<{ r: any }>('anon', `select search_catalog('bicol', $1) as r`, [world.areaId]);
    expect(search.r.products[0]).toMatchObject({ name: 'Bicol Express Rice Meal', base_price_minor: 12000 });

    // Customization: Large + Coke + 2 extra rice + egg, ×2 (+1 merged)
    const options = sel(store.options['Coke'], [store.options['Extra rice'], 2], store.options['Egg']);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 2, 'Less spicy please')`, [store.productId, store.largeId, options]);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1, 'Less spicy please')`, [store.productId, store.largeId, options]);
    expect(await db.as<{ quantity: number }>(customer.id, `select quantity from cart_items`)).toEqual([{ quantity: 3 }]);

    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    // unit = 150 + 15 + 2×20 + 15 = 220; ×3 = 660; + delivery 49 + service 10 = 719
    expect(q.items[0].unit_price_minor).toBe(22000);
    expect(q.subtotal_minor).toBe(66000);
    expect(q.total_minor).toBe(71900);

    const key = idemKey();
    const [{ id: orderId }] = await db.as<{ id: string }>(customer.id, `select place_order($1, $2, 'Blue gate', null, $3, $4) as id`, [
      store.merchantId,
      customer.addressId,
      q.total_minor,
      key,
    ]);
    const [{ id: again }] = await db.as<{ id: string }>(customer.id, `select place_order($1, $2, 'Blue gate', null, $3, $4) as id`, [
      store.merchantId,
      customer.addressId,
      q.total_minor,
      key,
    ]);
    expect(again).toBe(orderId);
    expect(await db.as(customer.id, `select id from carts`)).toHaveLength(0);

    // Riders in the area see the open order with its shopping list; others don't.
    expect(await db.as(rider, `select id from orders where id = $1`, [orderId])).toHaveLength(1);
    expect(await db.as(rider, `select id from order_items where order_id = $1`, [orderId])).toHaveLength(1);
    expect(await db.as(farRider, `select id from orders where id = $1`, [orderId])).toHaveLength(0);
    expect(await db.as(store.owner, `select id from orders where id = $1`, [orderId])).toHaveLength(0);
    expect((await db.as<{ kind: string }>(rider, `select kind from notifications`)).map((n) => n.kind)).toContain('order.available');

    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    expect((await db.expectError(farRider, `select rider_accept_order($1)`, [orderId])).hint).toBe('order_not_found');

    // The customer sees where to send payment.
    const [payment] = await db.as<Record<string, any>>(customer.id, `select * from payments where order_id = $1`, [orderId]);
    expect(payment).toMatchObject({ status: 'pending', payee_name: 'Rico R.', amount_minor: 71900 });

    const badRef = await db.expectError(customer.id, `select submit_gcash_payment($1, 'abc', null)`, [orderId]);
    expect(badRef.hint).toBe('invalid_reference');
    await db.as(customer.id, `select submit_gcash_payment($1, '1012 345 678 901', 'Juan Santos')`, [orderId]);

    // Rider says it didn't arrive; customer resubmits; rider confirms.
    expect((await db.expectError(rider, `select confirm_gcash_payment($1, false, null)`, [orderId])).hint).toBe('reason_required');
    await db.as(rider, `select confirm_gcash_payment($1, false, 'No transfer with that reference yet')`, [orderId]);
    const [afterReject] = await db.as<{ status: string }>(customer.id, `select status from orders where id = $1`, [orderId]);
    expect(afterReject.status).toBe('accepted');
    await db.as(customer.id, `select submit_gcash_payment($1, $2, 'Juan Santos')`, [orderId, gcashRef()]);
    await db.as(rider, `select confirm_gcash_payment($1, true)`, [orderId]);

    // Customer can no longer cancel once paid.
    expect((await db.expectError(customer.id, `select update_order_status($1, 'cancelled')`, [orderId])).code).toBe('42501');

    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [orderId]);

    const [done] = await db.as<Record<string, any>>(customer.id, `select * from orders where id = $1`, [orderId]);
    expect(done).toMatchObject({ status: 'completed', payment_status: 'paid' });

    // History survives later menu edits.
    await db.as(store.owner, `select save_product($1, $2)`, [
      store.merchantId,
      JSON.stringify({ id: store.productId, name: 'Bicol Express (New)', base_price_minor: 99900, status: 'published', variants: [] }),
    ]);
    const [item] = await db.as<Record<string, any>>(
      customer.id,
      `select oi.product_name, oi.variant_name, oi.unit_price_minor, oi.quantity, oi.instructions,
              (select jsonb_agg(jsonb_build_object('g', group_name, 'o', option_name, 'p', price_delta_minor, 'q', quantity) order by option_name)
                 from order_item_options where order_item_id = oi.id) as opts
       from order_items oi where order_id = $1`,
      [orderId],
    );
    expect(item).toMatchObject({ product_name: 'Bicol Express Rice Meal', variant_name: 'Large', unit_price_minor: 22000, quantity: 3, instructions: 'Less spicy please' });
    expect(item.opts).toEqual([
      { g: 'Drink', o: 'Coke', p: 1500, q: 1 },
      { g: 'Add-ons', o: 'Egg', p: 1500, q: 1 },
      { g: 'Add-ons', o: 'Extra rice', p: 2000, q: 2 },
    ]);

    const statuses = await db.as<{ to_status: string }>(customer.id, `select to_status from order_status_history where order_id = $1 order by id`, [orderId]);
    expect(statuses.map((s) => s.to_status)).toEqual([
      'pending',
      'accepted',
      'payment_submitted',
      'accepted',
      'payment_submitted',
      'buying',
      'out_for_delivery',
      'completed',
    ]);

    await db.as(customer.id, `insert into reviews (order_id, merchant_id, rating, comment) values ($1, $2, 5, 'Sarap!')`, [orderId, store.merchantId]);
    const [rated] = await db.as<Record<string, any>>('anon', `select rating_avg, rating_count from storefronts where id = $1`, [store.merchantId]);
    expect(rated).toMatchObject({ rating_avg: '5.0', rating_count: 1 });
  });
});
