import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { acceptAndPay, createCustomer, createPlatform, createRider, createStore, gcashRef, idemKey, placeOrder, quote, sel, type Store, type World } from './fixtures';

describe('configuration pricing (server authority)', () => {
  let db: TestDb;
  let world: World;
  let store: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
  });

  const price = async (variant: string | null, options: string, qty = 1) => {
    const [row] = await db.as<{ unit_price_minor: number | null; error_code: string | null; error_message: string | null }>(
      'anon',
      `select * from price_configuration($1, $2, $3, $4)`,
      [store.productId, variant, options, qty],
    );
    return row;
  };

  test('valid configurations are priced from current data', async () => {
    expect(await price(store.regularId, sel(store.options['Iced tea']))).toMatchObject({ unit_price_minor: 12000, error_code: null });
    expect(await price(store.largeId, sel(store.options['Coke'], [store.options['Extra rice'], 2]))).toMatchObject({
      unit_price_minor: 15000 + 1500 + 4000,
    });
  });

  test.each([
    ['variant required', null, () => sel(), 1, 'variant_required'],
    ['required group missing', 'regular', () => sel(), 1, 'group_min'],
    ['too many in single choice', 'regular', (s: Store) => sel(s.options['Iced tea'], s.options['Coke']), 1, 'group_max'],
    ['sold-out option', 'regular', (s: Store) => sel(s.options['Buko juice']), 1, 'option_sold_out'],
    ['option quantity over limit', 'regular', (s: Store) => sel(s.options['Iced tea'], [s.options['Extra rice'], 3]), 1, 'invalid_option_quantity'],
    ['group maximum by quantity', 'regular', (s: Store) => sel(s.options['Iced tea'], [s.options['Extra rice'], 2], [s.options['Egg'], 1], s.options['Egg']), 1, 'duplicate_option'],
    ['quantity above product limit', 'regular', (s: Store) => sel(s.options['Iced tea']), 11, 'invalid_quantity'],
    ['zero quantity', 'regular', (s: Store) => sel(s.options['Iced tea']), 0, 'invalid_quantity'],
    ['malformed options', 'regular', () => JSON.stringify([{ option_value_id: 'nope' }]), 1, 'invalid_options'],
    ['unknown option', 'regular', () => sel('00000000-0000-0000-0000-000000000000'), 1, 'invalid_option'],
  ])('%s is rejected', async (_name, variant, options, qty, code) => {
    const variantId = variant === 'regular' ? store.regularId : null;
    expect((await price(variantId, options(store), qty)).error_code).toBe(code);
  });

  test('an option from another product or store is rejected', async () => {
    const other = await createStore(db, world, 'other-owner@example.test', 'Other Kitchen');
    const result = await price(store.regularId, sel(store.options['Iced tea'], other.options['Egg']));
    expect(result.error_code).toBe('invalid_option');
  });

  test('a variant of another product is rejected', async () => {
    const other = await createStore(db, world, 'third-owner@example.test', 'Third Kitchen');
    expect((await price(other.regularId, sel(store.options['Iced tea']))).error_code).toBe('invalid_variant');
  });

  test('cart_add_item refuses invalid configurations', async () => {
    const customer = await createCustomer(db, world, 'c1@example.test');
    const err = await db.expectError(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel()]);
    expect(err.hint).toBe('group_min');
    expect(err.message).toBe('Choose drink.');
    expect(await db.as(customer.id, `select id from cart_items`)).toHaveLength(0);
  });

  test('cart edits revalidate and replace the configuration', async () => {
    const customer = await createCustomer(db, world, 'c2@example.test');
    const [{ id }] = await db.as<{ id: string }>(customer.id, `select cart_add_item($1, $2, $3, 1) as id`, [
      store.productId,
      store.regularId,
      sel(store.options['Iced tea']),
    ]);
    await db.as(customer.id, `select cart_update_item($1, $2, $3, 2, 'No onions')`, [id, store.largeId, sel(store.options['Coke'])]);
    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ quantity: 2, unit_price_minor: 16500, variant_name: 'Large', instructions: 'No onions' });
    expect(q.items[0].options.map((o: any) => o.option_name)).toEqual(['Coke']);

    const bad = await db.expectError(customer.id, `select cart_update_item($1, $2, $3, 2)`, [id, store.largeId, sel()]);
    expect(bad.hint).toBe('group_min');

    await db.as(customer.id, `select cart_set_quantity($1, 0)`, [id]);
    expect(await db.as(customer.id, `select id from carts`)).toHaveLength(0);
  });
});

describe('checkout validation', () => {
  let db: TestDb;
  let world: World;
  let store: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    await createRider(db, world, 'online-rider@example.test');
  });

  const addMeal = (customer: string, qty = 1) =>
    db.as(customer, `select cart_add_item($1, $2, $3, $4)`, [store.productId, store.regularId, sel(store.options['Iced tea']), qty]);

  test('price changes after adding are flagged and stale totals are refused', async () => {
    const customer = await createCustomer(db, world, 'price@example.test');
    await addMeal(customer.id);
    const before = await quote(db, customer.id, store.merchantId, customer.addressId);

    await db.sql(`update product_variants set price_minor = 13000 where id = $1`, [store.regularId]);
    const after = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(after.items[0]).toMatchObject({ price_changed: true, previous_unit_price_minor: 12000, unit_price_minor: 13000 });

    const err = await db.expectError(customer.id, `select place_order($1, $2, null, null, $3, $4)`, [
      store.merchantId,
      customer.addressId,
      before.total_minor,
      idemKey(),
    ]);
    expect(err.hint).toBe('total_changed');
    await db.sql(`update product_variants set price_minor = 12000 where id = $1`, [store.regularId]);
  });

  test('client-submitted totals cannot lower the price', async () => {
    const customer = await createCustomer(db, world, 'cheat@example.test');
    await addMeal(customer.id);
    const err = await db.expectError(customer.id, `select place_order($1, $2, null, null, 100, $3)`, [store.merchantId, customer.addressId, idemKey()]);
    expect(err.hint).toBe('total_changed');
  });

  test('closed, temporarily closed and sold-out states block checkout', async () => {
    const customer = await createCustomer(db, world, 'closed@example.test');
    await addMeal(customer.id);

    await db.sql(`insert into store_hour_exceptions (merchant_id, date, is_closed) values ($1, (now() at time zone 'Asia/Manila')::date, true)`, [store.merchantId]);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.issues.map((i: any) => i.code)).toContain('store_closed');
    expect(q.can_checkout).toBe(false);
    const [front] = await db.as<{ state: string; next_open_at: string | null }>('anon', `select state, next_open_at from storefronts where id = $1`, [store.merchantId]);
    expect(front.state).toBe('closed');
    expect(front.next_open_at).not.toBeNull();
    await db.sql(`delete from store_hour_exceptions where merchant_id = $1`, [store.merchantId]);

    await db.as(store.owner, `select set_store_paused($1, true, null)`, [store.merchantId]);
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.issues[0].code).toBe('store_paused');
    await db.as(store.owner, `select set_store_paused($1, false, null)`, [store.merchantId]);

    await db.as(store.owner, `select set_product_availability($1, false)`, [store.productId]);
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.items[0].error_code).toBe('product_sold_out');
    const err = await db.expectError(customer.id, `select place_order($1, $2, null, null, $3, $4)`, [store.merchantId, customer.addressId, q.total_minor, idemKey()]);
    expect(err.message).toBe('Bicol Express Rice Meal is sold out.');
    await db.as(store.owner, `select set_product_availability($1, true)`, [store.productId]);
  });

  test('addresses outside the store area and other users’ addresses are refused', async () => {
    const outside = await createCustomer(db, world, 'far@example.test', world.otherAreaId);
    await addMeal(outside.id);
    const q = await quote(db, outside.id, store.merchantId, outside.addressId);
    expect(q.issues[0].code).toBe('outside_area');

    const other = await createCustomer(db, world, 'neighbor@example.test');
    const q2 = await quote(db, outside.id, store.merchantId, other.addressId);
    expect(q2.issues[0].code).toBe('address_invalid');
    const q3 = await quote(db, outside.id, store.merchantId, null);
    expect(q3.issues[0].code).toBe('address_required');
  });

  test('minimum order and small-order fee', async () => {
    const customer = await createCustomer(db, world, 'min@example.test');
    await db.sql(`update merchants set min_order_minor = 20000 where id = $1`, [store.merchantId]);
    await addMeal(customer.id);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.issues[0]).toMatchObject({ code: 'below_minimum', message: 'Minimum order for Lutong Bahay ni Aling Rosa is ₱200.00.' });
    await db.sql(`update merchants set min_order_minor = 0 where id = $1`, [store.merchantId]);

    await db.sql(`update service_areas set small_order_threshold_minor = 15000, small_order_fee_minor = 1500 where id = $1`, [world.areaId]);
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q).toMatchObject({ subtotal_minor: 12000, small_order_fee_minor: 1500, delivery_fee_minor: 4900, total_minor: 12000 + 1500 + 4900 + 1000 });
    await db.sql(`update service_areas set small_order_threshold_minor = null where id = $1`, [world.areaId]);
  });

  test('promotions reduce fees only, respect limits, and are released on cancellation', async () => {
    await db.as(world.admin, `insert into promotions (code, title, discount_type, value, max_discount_minor, min_subtotal_minor, per_user_limit, usage_limit)
      values ('SAVE10', '10% off', 'percent', 1000, 5000, 10000, 1, 100)`);
    await db.as(world.admin, `insert into promotions (code, title, discount_type, value) values ('FREEDEL', 'Free delivery', 'free_delivery', 0)`);
    const customer = await createCustomer(db, world, 'promo@example.test');
    await addMeal(customer.id, 2);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId, 'save10');
    expect(q.promo).toMatchObject({ applied: true, code: 'SAVE10' });
    expect(q.discount_minor).toBe(2400);
    // The rider still pays the store's full prices.
    expect(q.subtotal_minor).toBe(24000);

    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'FREEDEL');
    expect(q.discount_minor).toBe(4900);

    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId, { promo: 'SAVE10' });
    await addMeal(customer.id, 2);
    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'SAVE10');
    expect(q.promo).toMatchObject({ applied: false, message: 'You have already used this promo code.' });

    await db.as(customer.id, `select update_order_status($1, 'cancelled')`, [orderId]);
    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'SAVE10');
    expect(q.promo.applied).toBe(true);

    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'NOPE');
    expect(q.promo).toMatchObject({ applied: false, message: 'This promo code is not valid.' });
    expect(q.discount_minor).toBe(0);
  });
});

describe('order lifecycle and GCash payment rules', () => {
  let db: TestDb;
  let world: World;
  let store: Store;
  let rider: string;
  let otherRider: string;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    rider = await createRider(db, world, 'rider-a@example.test');
    otherRider = await createRider(db, world, 'rider-b@example.test');
  });

  const newOrder = async (email: string) => {
    const customer = await createCustomer(db, world, email);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId);
    return { customer, orderId };
  };

  test('only one rider can accept an order', async () => {
    const { orderId } = await newOrder('race@example.test');
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    // Once accepted, the order is no longer visible to other riders.
    expect((await db.expectError(otherRider, `select rider_accept_order($1)`, [orderId])).hint).toBe('already_taken');
    expect(await db.as(otherRider, `select id from orders where id = $1`, [orderId])).toHaveLength(0);
  });

  test('payment can only be sent after acceptance, and references are single-use', async () => {
    const { customer, orderId } = await newOrder('pay-early@example.test');
    expect((await db.expectError(customer.id, `select submit_gcash_payment($1, $2, null)`, [orderId, gcashRef()])).hint).toBe('invalid_transition');
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    const ref = gcashRef();
    await db.as(customer.id, `select submit_gcash_payment($1, $2, null)`, [orderId, ref]);

    const second = await newOrder('pay-reuse@example.test');
    await db.as(rider, `select rider_accept_order($1)`, [second.orderId]);
    expect((await db.expectError(second.customer.id, `select submit_gcash_payment($1, $2, null)`, [second.orderId, ref])).hint).toBe('duplicate_reference');
  });

  test('only the assigned rider confirms payments; customers cannot confirm their own', async () => {
    const { customer, orderId } = await newOrder('confirm@example.test');
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    await db.as(customer.id, `select submit_gcash_payment($1, $2, null)`, [orderId, gcashRef()]);
    expect((await db.expectError(customer.id, `select confirm_gcash_payment($1, true)`, [orderId])).hint).toBe('order_not_found');
    expect((await db.expectError(otherRider, `select confirm_gcash_payment($1, true)`, [orderId])).hint).toBe('order_not_found');
    expect((await db.expectError(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId])).hint).toBe('invalid_transition');
    await db.as(rider, `select confirm_gcash_payment($1, true)`, [orderId]);
    const [o] = await db.as<{ status: string; payment_status: string }>(customer.id, `select status, payment_status from orders where id = $1`, [orderId]);
    expect(o).toEqual({ status: 'buying', payment_status: 'paid' });
  });

  test('a rider can release an unpaid order back to the queue', async () => {
    const { customer, orderId } = await newOrder('release@example.test');
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    await db.as(rider, `select rider_release_order($1, 'Motorcycle trouble')`, [orderId]);
    const [o] = await db.as<{ status: string }>(customer.id, `select status from orders where id = $1`, [orderId]);
    expect(o.status).toBe('pending');
    const [p] = await db.as<{ payee_number: string | null }>(customer.id, `select payee_number from payments where order_id = $1`, [orderId]);
    expect(p.payee_number).toBeNull();
    await db.as(otherRider, `select rider_accept_order($1)`, [orderId]);
    await db.as(customer.id, `select submit_gcash_payment($1, $2, null)`, [orderId, gcashRef()]);
    expect((await db.expectError(otherRider, `select rider_release_order($1, null)`, [orderId])).hint).toBe('invalid_transition');
  });

  test('customers cancel freely before paying; afterwards cancellation needs rider or staff and opens a refund', async () => {
    const early = await newOrder('cancel-early@example.test');
    await db.as(rider, `select rider_accept_order($1)`, [early.orderId]);
    await db.as(early.customer.id, `select update_order_status($1, 'cancelled', 'Changed my mind')`, [early.orderId]);
    const [p] = await db.as<{ status: string }>(early.customer.id, `select status from payments where order_id = $1`, [early.orderId]);
    expect(p.status).toBe('cancelled');

    const paid = await newOrder('cancel-paid@example.test');
    await acceptAndPay(db, paid.orderId, paid.customer.id, rider);
    expect((await db.expectError(rider, `select update_order_status($1, 'cancelled')`, [paid.orderId])).hint).toBe('reason_required');
    await db.as(rider, `select update_order_status($1, 'cancelled', 'Store ran out of pork')`, [paid.orderId]);
    const refunds = await db.as<{ amount_minor: number; status: string }>(paid.customer.id, `select amount_minor, status from refunds where order_id = $1`, [paid.orderId]);
    expect(refunds).toEqual([{ amount_minor: 12000 + 4900 + 1000, status: 'requested' }]);

    const [{ id: refundId }] = await db.as<{ id: string }>(world.finance, `select id from refunds where order_id = $1`, [paid.orderId]);
    expect((await db.expectError(world.support, `select review_refund($1, 'approve')`, [refundId])).code).toBe('42501');
    await db.as(world.finance, `select review_refund($1, 'approve')`, [refundId]);
    expect((await db.expectError(world.finance, `select review_refund($1, 'mark_processed', '')`, [refundId])).hint).toBe('reference_required');
    await db.as(world.finance, `select review_refund($1, 'mark_processed', '5012345678901')`, [refundId]);
    const [o] = await db.as<{ payment_status: string }>(paid.customer.id, `select payment_status from orders where id = $1`, [paid.orderId]);
    expect(o.payment_status).toBe('refunded');
  });

  test('staff can assign riders before payment and cancel with a reason (audited)', async () => {
    const { orderId } = await newOrder('staff@example.test');
    const farRider = await createRider(db, world, 'far@example.test', world.otherAreaId);
    expect((await db.expectError(world.support, `select assign_rider($1, $2)`, [orderId, farRider])).hint).toBe('rider_unavailable');
    await db.as(world.support, `select assign_rider($1, $2)`, [orderId, rider]);
    expect((await db.expectError(world.admin, `select update_order_status($1, 'cancelled')`, [orderId])).hint).toBe('reason_required');
    await db.as(world.admin, `select update_order_status($1, 'cancelled', 'Customer called support')`, [orderId]);
    const logs = await db.as<{ action: string }>(world.admin, `select action from audit_logs where entity_id = $1`, [orderId]);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['order.rider_assigned', 'order.status_changed']));
  });

  test('stores have no part in orders', async () => {
    const { orderId } = await newOrder('store-blind@example.test');
    expect(await db.as(store.owner, `select id from orders where id = $1`, [orderId])).toHaveLength(0);
    expect((await db.expectError(store.owner, `select update_order_status($1, 'cancelled', 'x')`, [orderId])).hint).toBe('order_not_found');
  });
});
