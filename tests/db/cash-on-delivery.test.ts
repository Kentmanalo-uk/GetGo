import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createRider, createStore, gcashRef, placeOrder, sel, type Store, type World } from './fixtures';

describe('cash on delivery', () => {
  let db: TestDb;
  let world: World;
  let store: Store;
  let rider: string;
  let customer: { id: string; addressId: string };

  const newOrder = async () => {
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    const id = await placeOrder(db, customer.id, store.merchantId, customer.addressId);
    await db.as(rider, `select rider_accept_order($1)`, [id]);
    return id;
  };
  const order = async (id: string) => (await db.sql<Record<string, any>>(`select o.status, o.payment_status, o.cod_allowed, p.method, p.status as pay from orders o join payments p on p.order_id = o.id where o.id = $1`, [id]))[0];

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    rider = await createRider(db, world, 'rider@example.test');
    customer = await createCustomer(db, world, 'customer@example.test');
  });

  test('customers can choose COD only when the rider offers it', async () => {
    const id = await newOrder();
    expect((await db.expectError(customer.id, `select choose_cash_on_delivery($1)`, [id])).hint).toBe('cod_unavailable');
    expect((await db.expectError(customer.id, `select rider_set_cod($1, true)`, [id])).hint).toBe('order_not_found');

    await db.as(rider, `select rider_set_cod($1, true)`, [id]);
    expect((await order(id)).cod_allowed).toBe(true);
    const [note] = await db.sql<{ kind: string }>(`select kind from notifications where user_id = $1 order by created_at desc limit 1`, [customer.id]);
    expect(note.kind).toBe('order.cod_available');

    await db.as(customer.id, `select choose_cash_on_delivery($1)`, [id]);
    expect(await order(id)).toMatchObject({ status: 'buying', payment_status: 'pending', method: 'cod', pay: 'pending' });
    // Once started, COD can't be withdrawn and GCash can't be submitted.
    expect((await db.expectError(rider, `select rider_set_cod($1, false)`, [id])).hint).toBe('invalid_transition');
    expect((await db.expectError(customer.id, `select submit_gcash_payment($1, $2, null)`, [id, gcashRef()])).hint).toBe('invalid_transition');

    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [id]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [id]);
    expect(await order(id)).toMatchObject({ status: 'completed', payment_status: 'paid', method: 'cod', pay: 'paid' });
  });

  test('a cancelled COD order has nothing to refund, and release resets COD', async () => {
    const id = await newOrder();
    await db.as(rider, `select rider_set_cod($1, true)`, [id]);
    await db.as(customer.id, `select choose_cash_on_delivery($1)`, [id]);
    await db.as(rider, `select update_order_status($1, 'cancelled', 'Store is closed')`, [id]);
    expect(await order(id)).toMatchObject({ status: 'cancelled', pay: 'cancelled' });
    expect(await db.sql(`select 1 from refunds where order_id = $1`, [id])).toEqual([]);

    const other = await newOrder();
    await db.as(rider, `select rider_set_cod($1, true)`, [other]);
    await db.as(rider, `select rider_release_order($1)`, [other]);
    expect(await order(other)).toMatchObject({ status: 'pending', cod_allowed: false });
  });

  test('GCash still works as before when COD is offered', async () => {
    const id = await newOrder();
    await db.as(rider, `select rider_set_cod($1, true)`, [id]);
    await db.as(customer.id, `select submit_gcash_payment($1, $2, null)`, [id, gcashRef()]);
    await db.as(rider, `select confirm_gcash_payment($1, true)`, [id]);
    expect(await order(id)).toMatchObject({ status: 'buying', payment_status: 'paid', method: 'gcash' });
  });
});
