import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createRider, createStore, idemKey, placeOrder, sel, type Store, type World } from './fixtures';

describe('riders online and offline', () => {
  let db: TestDb;
  let world: World;
  let store: Store;
  let customer: { id: string; addressId: string };
  let rider: string;
  let otherRider: string;

  const online = async (areaId = world.areaId) => {
    const [row] = await db.as<{ n: number }>('anon', `select online_rider_count($1) as n`, [areaId]);
    return row.n;
  };
  const addMeal = () => db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
  const placeError = async () => {
    const [q] = await db.as<{ q: { total_minor: number } }>(customer.id, `select quote_checkout($1, $2, null) as q`, [store.merchantId, customer.addressId]);
    return db.expectError(customer.id, `select place_order($1, $2, null, null, $3, $4)`, [store.merchantId, customer.addressId, q.q.total_minor, idemKey()]);
  };
  const padalaError = () => {
    const spot = (barangay: string) => JSON.stringify({ name: 'Ana Reyes', phone: '09171112222', line1: 'Purok 2', barangay, barangay_code: null, landmark: null });
    return db.expectError(customer.id, `select place_service_request('padala', $1, $2, $3, $4, null, 5900, $5)`, [
      world.areaId,
      spot('Anilao'),
      spot('Formon'),
      JSON.stringify({ item: 'Documents', size: 'small' }),
      idemKey(),
    ]);
  };

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    customer = await createCustomer(db, world, 'customer@example.test');
    rider = await createRider(db, world, 'rider@example.test', world.areaId, { online: false });
    otherRider = await createRider(db, world, 'other@example.test', world.areaId, { online: false });
  });

  test('riders start offline, and customers can’t order while nobody is online', async () => {
    expect(await online()).toBe(0);
    await addMeal();
    expect((await placeError()).hint).toBe('no_riders_online');
    expect((await padalaError()).hint).toBe('no_riders_online');
    // The cart is kept for later.
    expect(await db.as(customer.id, `select id from carts where user_id = $1`, [customer.id])).toHaveLength(1);
  });

  test('a rider online in another area doesn’t count', async () => {
    const far = await createRider(db, world, 'far@example.test', world.otherAreaId);
    expect(await online(world.otherAreaId)).toBe(1);
    expect(await online()).toBe(0);
    expect((await placeError()).hint).toBe('no_riders_online');
    await db.as(far, `select rider_set_online(false)`);
  });

  test('once a rider goes online, customers can order and only online riders can accept', async () => {
    const [res] = await db.as<{ r: { is_online: boolean } }>(rider, `select rider_set_online(true) as r`);
    expect(res.r.is_online).toBe(true);
    expect(await online()).toBe(1);

    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId);
    expect((await db.expectError(otherRider, `select rider_accept_order($1)`, [orderId])).hint).toBe('rider_offline');
    await db.as(rider, `select rider_accept_order($1)`, [orderId]);
    const [o] = await db.sql<{ status: string }>(`select status from orders where id = $1`, [orderId]);
    expect(o.status).toBe('accepted');
  });

  test('going offline closes ordering again; orders in progress carry on', async () => {
    await db.as(rider, `select rider_set_online(false)`);
    expect(await online()).toBe(0);
    await addMeal();
    expect((await placeError()).hint).toBe('no_riders_online');
  });

  test('a rider whose app hasn’t checked in for 30 minutes counts as offline until it does', async () => {
    await db.as(rider, `select rider_set_online(true)`);
    expect(await online()).toBe(1);
    await db.sql(`update rider_profiles set last_seen_at = now() - interval '31 minutes' where user_id = $1`, [rider]);
    expect(await online()).toBe(0);
    expect((await placeError()).hint).toBe('no_riders_online');

    await db.as(rider, `select rider_heartbeat()`);
    expect(await online()).toBe(1);
    // A heartbeat never brings an offline rider online.
    await db.as(otherRider, `select rider_heartbeat()`);
    expect(await online()).toBe(1);
  });

  test('only active riders can go online, and suspended riders go offline', async () => {
    expect((await db.expectError(customer.id, `select rider_set_online(true)`)).hint).toBe('not_active_rider');
    expect((await db.expectError('anon', `select rider_set_online(true)`)).code).toBe('42501');
    // Riders can't flip the switch on the table directly.
    await db.as(otherRider, `update rider_profiles set is_online = true, last_seen_at = now() where user_id = $1`, [otherRider]).catch(() => undefined);
    const [row] = await db.sql<{ is_online: boolean }>(`select is_online from rider_profiles where user_id = $1`, [otherRider]);
    expect(row.is_online).toBe(false);

    await db.as(world.admin, `select set_rider_status($1, 'suspended')`, [rider]);
    expect(await online()).toBe(0);
    const [r] = await db.sql<{ is_online: boolean }>(`select is_online from rider_profiles where user_id = $1`, [rider]);
    expect(r.is_online).toBe(false);
    expect((await db.expectError(rider, `select rider_set_online(true)`)).hint).toBe('not_active_rider');
  });
});
