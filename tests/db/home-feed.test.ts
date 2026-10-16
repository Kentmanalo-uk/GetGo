import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { acceptAndPay, createCustomer, createPlatform, createRider, createStore, placeOrder, sel, type Store, type World } from './fixtures';

describe('home feed', () => {
  let db: TestDb;
  let world: World;
  let restaurant: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    restaurant = await createStore(db, world, 'resto@example.test', 'Kainan sa Bayan');
  });

  const feed = async () => (await db.as<{ f: any }>('anon', `select home_feed($1) as f`, [world.areaId]))[0].f;

  test('lists published items by section for anonymous visitors', async () => {
    const f = await feed();
    expect(f.popular).toEqual([]);
    expect(f.meals.map((i: any) => i.name)).toEqual(['Bicol Express Rice Meal']);
    expect(f.meals[0]).toMatchObject({ price_minor: 12000, has_sizes: true, merchant_slug: 'kainan-sa-bayan', merchant_state: 'open' });
    expect(f.essentials).toEqual([]);
    expect(f.new_stores.map((s: any) => s.name)).toEqual(['Kainan sa Bayan']);
    // Only public storefront fields, and no order or customer data.
    expect(JSON.stringify(f)).not.toContain('customer');
  });

  test('popular items come from completed orders', async () => {
    const rider = await createRider(db, world, 'feed-rider@example.test');
    const customer = await createCustomer(db, world, 'feed-buyer@example.test');
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [restaurant.productId, restaurant.regularId, sel(restaurant.options['Iced tea'])]);
    const orderId = await placeOrder(db, customer.id, restaurant.merchantId, customer.addressId);
    await acceptAndPay(db, orderId, customer.id, rider);
    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [orderId]);

    const f = await feed();
    expect(f.popular).toEqual([expect.objectContaining({ name: 'Bicol Express Rice Meal', orders: 1 })]);
  });

  test('draft items and unpublished stores stay hidden', async () => {
    await db.as(restaurant.owner, `select save_product($1, '{"name":"Secret Draft","base_price_minor":100,"status":"draft"}')`, [restaurant.merchantId]);
    expect((await feed()).meals.map((i: any) => i.name)).not.toContain('Secret Draft');
    await db.as(restaurant.owner, `select set_store_published($1, false)`, [restaurant.merchantId]);
    const f = await feed();
    expect(f.meals).toEqual([]);
    expect(f.popular).toEqual([]);
    expect(f.new_stores).toEqual([]);
  });
});
