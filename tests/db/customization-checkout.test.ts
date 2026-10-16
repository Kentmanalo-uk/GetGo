import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createStore, idemKey, placeOrder, quote, sel, type Store, type World } from './fixtures';

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

    const err = await db.expectError(
      customer.id,
      `select place_order($1, 'delivery', $2, 'cod', null, null, $3, $4)`,
      [store.merchantId, customer.addressId, before.total_minor, idemKey()],
    );
    expect(err.hint).toBe('total_changed');
    await db.sql(`update product_variants set price_minor = 12000 where id = $1`, [store.regularId]);
  });

  test('client-submitted totals cannot lower the price', async () => {
    const customer = await createCustomer(db, world, 'cheat@example.test');
    await addMeal(customer.id);
    const err = await db.expectError(
      customer.id,
      `select place_order($1, 'delivery', $2, 'cod', null, null, 100, $3)`,
      [store.merchantId, customer.addressId, idemKey()],
    );
    expect(err.hint).toBe('total_changed');
  });

  test('closed, paused and sold-out states block checkout', async () => {
    const customer = await createCustomer(db, world, 'closed@example.test');
    await addMeal(customer.id);

    await db.sql(`insert into store_hour_exceptions (merchant_id, date, is_closed) values ($1, (now() at time zone 'Asia/Manila')::date, true)`, [
      store.merchantId,
    ]);
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
    const err = await db.expectError(customer.id, `select place_order($1, 'delivery', $2, 'cod', null, null, $3, $4)`, [
      store.merchantId,
      customer.addressId,
      q.total_minor,
      idemKey(),
    ]);
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
  });

  test('minimum order, small-order fee and pickup rules', async () => {
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

    // Pickup has no delivery fee and needs a phone number on the profile.
    q = await quote(db, customer.id, store.merchantId, null);
    expect(q.delivery_fee_minor).toBe(0);
    await db.sql(`update profiles set phone = null where id = $1`, [customer.id]);
    const err = await db.expectError(customer.id, `select place_order($1, 'pickup', null, 'cod', null, null, $2, $3)`, [
      store.merchantId,
      q.total_minor,
      idemKey(),
    ]);
    expect(err.hint).toBe('phone_required');
  });

  test('promotions: limits, eligibility and release on cancellation', async () => {
    await db.as(world.admin, `insert into promotions (code, title, discount_type, value, max_discount_minor, min_subtotal_minor, per_user_limit, usage_limit)
      values ('SAVE10', '10% off', 'percent', 1000, 5000, 10000, 1, 100)`);
    const customer = await createCustomer(db, world, 'promo@example.test');
    await addMeal(customer.id, 2);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId, 'save10');
    expect(q.promo).toMatchObject({ applied: true, code: 'SAVE10' });
    expect(q.discount_minor).toBe(2400);
    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId, { promo: 'SAVE10' });

    await addMeal(customer.id, 2);
    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'SAVE10');
    expect(q.promo).toMatchObject({ applied: false, message: 'You have already used this promo code.' });

    // Cancelling releases the redemption.
    await db.as(customer.id, `select update_order_status($1, 'cancelled')`, [orderId]);
    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'SAVE10');
    expect(q.promo.applied).toBe(true);

    q = await quote(db, customer.id, store.merchantId, customer.addressId, 'NOPE');
    expect(q.promo).toMatchObject({ applied: false, message: 'This promo code is not valid.' });
    expect(q.discount_minor).toBe(0);
  });

  test('online payment is refused while the platform has it disabled', async () => {
    const customer = await createCustomer(db, world, 'online@example.test');
    await addMeal(customer.id);
    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.online_payments_enabled).toBe(false);
    const err = await db.expectError(customer.id, `select place_order($1, 'delivery', $2, 'online', null, null, $3, $4)`, [
      store.merchantId,
      customer.addressId,
      q.total_minor,
      idemKey(),
    ]);
    expect(err.hint).toBe('payment_unavailable');
  });
});

describe('order lifecycle permissions', () => {
  let db: TestDb;
  let world: World;
  let store: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
  });

  const newOrder = async (email: string, pickup = false) => {
    const customer = await createCustomer(db, world, email);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    const orderId = await placeOrder(db, customer.id, store.merchantId, pickup ? null : customer.addressId);
    return { customer, orderId };
  };

  test('customers can cancel only before the store accepts', async () => {
    const { customer, orderId } = await newOrder('cancel@example.test');
    const accept = await db.expectError(customer.id, `select update_order_status($1, 'accepted')`, [orderId]);
    expect(accept.code).toBe('42501');
    await db.as(store.owner, `select update_order_status($1, 'accepted')`, [orderId]);
    const late = await db.expectError(customer.id, `select update_order_status($1, 'cancelled')`, [orderId]);
    expect(late.code).toBe('42501');
  });

  test('rejections require a reason and notify the customer', async () => {
    const { customer, orderId } = await newOrder('reject@example.test');
    const noReason = await db.expectError(store.owner, `select update_order_status($1, 'rejected')`, [orderId]);
    expect(noReason.hint).toBe('reason_required');
    await db.as(store.owner, `select update_order_status($1, 'rejected', 'Out of pork today')`, [orderId]);
    const [n] = await db.as<{ title: string; body: string }>(customer.id, `select title, body from notifications where kind = 'order.rejected'`);
    expect(n).toMatchObject({ body: 'Out of pork today' });
    const [o] = await db.as<{ payment_status: string }>(customer.id, `select payment_status from orders where id = $1`, [orderId]);
    expect(o.payment_status).toBe('cancelled');
  });

  test('pickup orders complete at the counter and cannot go out for delivery', async () => {
    const { orderId } = await newOrder('pickup@example.test', true);
    for (const s of ['accepted', 'preparing', 'ready']) {
      await db.as(store.owner, `select update_order_status($1, $2)`, [orderId, s]);
    }
    const wrong = await db.expectError(store.owner, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    expect(wrong.hint).toBe('invalid_transition');
    await db.as(store.owner, `select update_order_status($1, 'completed')`, [orderId]);
  });

  test('assigned riders handle delivery; the store then cannot', async () => {
    const { orderId } = await newOrder('rider-order@example.test');
    const rider = await db.createUser('rider@example.test', 'Rico Rider');
    await db.as(world.admin, `select create_rider('rider@example.test', 'Rico Rider', '09190000000', 'motorcycle', 'ABC 123', $1)`, [world.areaId]);
    await db.as(store.owner, `select update_order_status($1, 'accepted')`, [orderId]);
    await db.as(world.support, `select assign_rider($1, $2)`, [orderId, rider]);

    // The rider can see the order (with pickup details) once assigned.
    const [visible] = await db.as<{ merchant_name: string; pickup_address: any }>(rider, `select merchant_name, pickup_address from orders where id = $1`, [orderId]);
    expect(visible.pickup_address.line1).toBe('12 Elias Angeles St');

    const early = await db.expectError(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    expect(early.hint).toBe('invalid_transition');
    await db.as(store.owner, `select update_order_status($1, 'preparing')`, [orderId]);
    await db.as(store.owner, `select update_order_status($1, 'ready')`, [orderId]);
    const storeDelivers = await db.expectError(store.owner, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    expect(storeDelivers.code).toBe('42501');
    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [orderId]);
    const [a] = await db.as<{ status: string }>(rider, `select status from assignments where order_id = $1`, [orderId]);
    expect(a.status).toBe('completed');
  });

  test('admin overrides are audited', async () => {
    const { orderId } = await newOrder('override@example.test');
    await db.as(world.admin, `select update_order_status($1, 'cancelled', 'Customer called support')`, [orderId]);
    const logs = await db.as<{ action: string }>(world.admin, `select action from audit_logs where entity_id = $1`, [orderId]);
    expect(logs.map((l) => l.action)).toContain('order.status_changed');
  });
});
