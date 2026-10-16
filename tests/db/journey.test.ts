import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createApplication, createCustomer, createPlatform, createStore, idemKey, quote, sel, type World } from './fixtures';

/**
 * The primary journey from the definition of done:
 * partner application → admin approval → store setup → product and option
 * configuration → discovery → customization → cart → server-validated checkout
 * → merchant order management → accurate order history.
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

    // Submitted applications are locked for the applicant.
    const locked = await db.as(applicant, `update partner_applications set business_name = 'X' where id = $1 returning id`, [appId]);
    expect(locked).toHaveLength(0);

    const noNotes = await db.expectError(world.support, `select review_partner_application($1, 'needs_changes', null, null)`, [appId]);
    expect(noNotes.hint).toBe('notes_required');
    await db.as(world.support, `select review_partner_application($1, 'needs_changes', 'Business permit photo is blurry', null)`, [appId]);

    const editable = await db.as(applicant, `update partner_applications set description = 'Brewed coffee' where id = $1 returning id`, [appId]);
    expect(editable).toHaveLength(1);
    await db.as(applicant, `select submit_partner_application($1)`, [appId]);
    await db.as(world.support, `select review_partner_application($1, 'under_review', null, null)`, [appId]);

    // Support staff cannot approve; approval requires a commission rate.
    const supportApprove = await db.expectError(world.support, `select review_partner_application($1, 'approved', null, 1200)`, [appId]);
    expect(supportApprove.code).toBe('42501');
    const noCommission = await db.expectError(world.admin, `select review_partner_application($1, 'approved', null, null)`, [appId]);
    expect(noCommission.hint).toBe('commission_required');

    const [{ id: merchantId }] = await db.as<{ id: string }>(
      world.admin,
      `select review_partner_application($1, 'approved', 'Welcome', 1200) as id`,
      [appId],
    );
    const [merchant] = await db.as<Record<string, unknown>>(applicant, `select * from merchants where id = $1`, [merchantId]);
    expect(merchant).toMatchObject({ slug: 'kape-ni-lolo', is_published: false, commission_bps: 1200, status: 'active' });

    // Unpublished store and draft products are invisible to the public.
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

  test('customer orders a customized rice meal and the merchant fulfils it', async () => {
    const store = await createStore(db, world, 'rosa@example.test');
    const customer = await createCustomer(db, world, 'juan@example.test');

    // Discovery
    const [front] = await db.as<Record<string, any>>('anon', `select * from storefronts where id = $1`, [store.merchantId]);
    expect(front.state).toBe('open');
    expect(front.delivery_fee_minor).toBe(4900);
    expect(front).not.toHaveProperty('commission_bps');
    const [search] = await db.as<{ r: any }>('anon', `select search_catalog('bicol', $1) as r`, [world.areaId]);
    expect(search.r.products[0]).toMatchObject({ name: 'Bicol Express Rice Meal', base_price_minor: 12000 });

    // Customization: Large + Coke + 2 extra rice + egg, ×2
    const options = sel(store.options['Coke'], [store.options['Extra rice'], 2], store.options['Egg']);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 2, 'Less spicy please')`, [store.productId, store.largeId, options]);
    // Same configuration merges into one line.
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1, 'Less spicy please')`, [store.productId, store.largeId, options]);
    const lines = await db.as<{ quantity: number }>(customer.id, `select quantity from cart_items`);
    expect(lines).toEqual([{ quantity: 3 }]);

    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    // unit = 150 + 15 + 2×20 + 15 = 220; ×3 = 660; + delivery 49 + service 10 = 719
    expect(q.items[0].unit_price_minor).toBe(22000);
    expect(q.subtotal_minor).toBe(66000);
    expect(q.total_minor).toBe(71900);
    expect(q.can_checkout).toBe(true);

    const key = idemKey();
    const [{ id: orderId }] = await db.as<{ id: string }>(
      customer.id,
      `select place_order($1, 'delivery', $2, 'cod', 'Blue gate', null, $3, $4) as id`,
      [store.merchantId, customer.addressId, q.total_minor, key],
    );
    // A retried submission with the same key returns the same order.
    const [{ id: again }] = await db.as<{ id: string }>(
      customer.id,
      `select place_order($1, 'delivery', $2, 'cod', 'Blue gate', null, $3, $4) as id`,
      [store.merchantId, customer.addressId, q.total_minor, key],
    );
    expect(again).toBe(orderId);
    expect(await db.as(customer.id, `select id from carts`)).toHaveLength(0);

    // The merchant sees the order and works through it.
    const [incoming] = await db.as<Record<string, any>>(store.owner, `select * from orders where id = $1`, [orderId]);
    expect(incoming).toMatchObject({ status: 'pending', total_minor: 71900, customer_name: 'Juan Santos' });
    const notes = await db.as<{ kind: string }>(store.owner, `select kind from notifications`);
    expect(notes.map((n) => n.kind)).toContain('order.new');

    await db.as(store.owner, `select update_order_status($1, 'accepted', null, 25)`, [orderId]);
    await db.as(store.owner, `select update_order_status($1, 'preparing')`, [orderId]);
    const skip = await db.expectError(store.owner, `select update_order_status($1, 'completed')`, [orderId]);
    expect(skip.hint).toBe('invalid_transition');
    await db.as(store.owner, `select update_order_status($1, 'ready')`, [orderId]);
    await db.as(store.owner, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    await db.as(store.owner, `select update_order_status($1, 'completed')`, [orderId]);

    const [done] = await db.as<Record<string, any>>(customer.id, `select * from orders where id = $1`, [orderId]);
    expect(done).toMatchObject({ status: 'completed', payment_status: 'paid', prep_time_minutes: 25 });

    // Accurate history survives later menu edits.
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
    expect(item).toMatchObject({
      product_name: 'Bicol Express Rice Meal',
      variant_name: 'Large',
      unit_price_minor: 22000,
      quantity: 3,
      instructions: 'Less spicy please',
    });
    expect(item.opts).toEqual([
      { g: 'Drink', o: 'Coke', p: 1500, q: 1 },
      { g: 'Add-ons', o: 'Egg', p: 1500, q: 1 },
      { g: 'Add-ons', o: 'Extra rice', p: 2000, q: 2 },
    ]);

    const statuses = await db.as<{ to_status: string; actor_kind: string }>(
      customer.id,
      `select to_status, actor_kind from order_status_history where order_id = $1 order by id`,
      [orderId],
    );
    expect(statuses.map((s) => s.to_status)).toEqual(['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed']);

    const [commission] = await db.as<Record<string, any>>(store.owner, `select * from commissions where order_id = $1`, [orderId]);
    expect(commission).toMatchObject({ rate_bps: 1500, base_minor: 66000, amount_minor: 9900 });

    // Review once, only after completion.
    await db.as(customer.id, `insert into reviews (order_id, merchant_id, rating, comment) values ($1, $2, 5, 'Sarap!')`, [
      orderId,
      store.merchantId,
    ]);
    const [rated] = await db.as<Record<string, any>>('anon', `select rating_avg, rating_count from storefronts where id = $1`, [
      store.merchantId,
    ]);
    expect(rated).toMatchObject({ rating_avg: '5.0', rating_count: 1 });
  });
});
