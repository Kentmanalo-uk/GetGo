import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { acceptAndPay, createCustomer, createPlatform, createRider, createStore, placeOrder, sel, type Store, type World } from './fixtures';

describe('rider ratings and public profiles', () => {
  let db: TestDb;
  let world: World;
  let store: Store;
  let rider: string;
  let customer: { id: string; addressId: string };
  let orderId: string;

  const order = async (who: { id: string; addressId: string }) => {
    await db.as(who.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    return placeOrder(db, who.id, store.merchantId, who.addressId);
  };

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    rider = await createRider(db, world, 'rider@example.test'); // "Rico Rider"
    customer = await createCustomer(db, world, 'customer@example.test');
    orderId = await order(customer);
    await acceptAndPay(db, orderId, customer.id, rider);
  });

  test('ratings wait for the delivery to be completed', async () => {
    expect((await db.expectError(customer.id, `select rate_rider($1, 5)`, [orderId])).hint).toBe('not_completed');
    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [orderId]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [orderId]);
  });

  test('only the customer rates, with 1 to 5 stars, and can change it', async () => {
    const stranger = await createCustomer(db, world, 'stranger@example.test');
    expect((await db.expectError(stranger.id, `select rate_rider($1, 5)`, [orderId])).hint).toBe('order_not_found');
    expect((await db.expectError(customer.id, `select rate_rider($1, 6)`, [orderId])).hint).toBe('invalid_rating');
    await db.as(customer.id, `select rate_rider($1, 4, 'Fast, but forgot the sauce')`, [orderId]);
    await db.as(customer.id, `select rate_rider($1, 5, 'Fast and friendly')`, [orderId]);
    const rows = await db.sql<{ rating: number; comment: string }>(`select rating, comment from rider_reviews where order_id = $1`, [orderId]);
    expect(rows).toEqual([{ rating: 5, comment: 'Fast and friendly' }]);
    // The rider was told once, not on every change.
    expect(await db.sql(`select 1 from notifications where user_id = $1 and kind = 'rider.rated'`, [rider])).toHaveLength(1);
    // Reviews aren't readable by other customers directly.
    expect(await db.as(stranger.id, `select * from rider_reviews`)).toEqual([]);
  });

  test('the public profile shows safe details and stats only', async () => {
    const someone = await db.createUser('someone@example.test');
    const [{ p }] = await db.as<{ p: Record<string, any> }>(someone, `select rider_public_profile($1) as p`, [rider]);
    expect(p).toMatchObject({
      id: rider,
      display_name: 'Rico R.',
      vehicle_type: 'motorcycle',
      verified: true,
      completed_count: 1,
      rating_count: 1,
      reviews: [{ rating: 5, comment: 'Fast and friendly' }],
    });
    expect(Number(p.rating_avg)).toBe(5);
    expect(JSON.stringify(p)).not.toMatch(/09190000000|ABC 123|gcash/i);
    expect((await db.expectError('anon', `select rider_public_profile($1)`, [rider])).code).toBe('42501');
    const [{ none }] = await db.as<{ none: unknown }>(someone, `select rider_public_profile($1) as none`, [someone]);
    expect(none).toBeNull();
  });
});
