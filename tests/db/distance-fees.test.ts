import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createRider, createStore, idemKey, placeOrder, quote, sel, type Store, type World } from './fixtures';

// Town proper and points north of it (0.009° of latitude ≈ 1 km).
const STORE = { lat: 12.75, lng: 121.4833 };
const north = (deg: number) => ({ lat: STORE.lat + deg, lng: STORE.lng });

describe('delivery priced by distance', () => {
  let db: TestDb;
  let world: World;
  let store: Store;
  let customer: { id: string; addressId: string };

  const roadKm = async (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const [r] = await db.sql<{ km: string }>(`select road_km($1, $2, $3, $4) as km`, [a.lat, a.lng, b.lat, b.lng]);
    return Number(r.km);
  };
  /** The default price: ₱40 for 2 km, ₱10 per km after, rounded up to ₱5 (in centavos). */
  const expectedFee = (km: number) => Math.ceil((4000 + Math.max(0, km - 2) * 1000) / 500) * 500;
  const pinAddress = (p: { lat: number; lng: number } | null) =>
    db.as(customer.id, `update addresses set lat = $1, lng = $2 where id = $3`, [p?.lat ?? null, p?.lng ?? null, customer.addressId]);
  const setPricing = (mode: 'barangay' | 'distance', extra = '') =>
    db.as(world.admin, `update service_areas set delivery_pricing = $1 ${extra} where id = $2`, [mode, world.areaId]);
  const addMeal = () => db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db); // area default delivery ₱49
    store = await createStore(db, world, 'owner@example.test');
    customer = await createCustomer(db, world, 'customer@example.test');
    await createRider(db, world, 'rider@example.test');
    // The store's owner pins the store.
    await db.as(store.owner, `update merchants set lat = $1, lng = $2 where id = $3`, [STORE.lat, STORE.lng, store.merchantId]);
    await addMeal();
  });

  test('the default km price is fair and rounds up to ₱5', async () => {
    const fee = async (km: number) => {
      const [r] = await db.sql<{ f: string }>(`select km_fee(a, $2) as f from service_areas a where id = $1`, [world.areaId, km]);
      return Number(r.f);
    };
    expect(await fee(1)).toBe(4000);
    expect(await fee(2)).toBe(4000);
    expect(await fee(3)).toBe(5000);
    expect(await fee(3.4)).toBe(5500); // ₱54 → ₱55
    expect(await fee(5)).toBe(7000);
    expect(await fee(10)).toBe(12000);
    // Road distance: about 1.3 × the straight line.
    const km = await roadKm(STORE, north(0.09)); // ≈ 10 km straight
    expect(km).toBeGreaterThan(12.9);
    expect(km).toBeLessThanOrEqual(13.1);
  });

  test('areas keep barangay prices until the admin switches to km, but the distance is still shown', async () => {
    await pinAddress(north(0.03));
    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.delivery_basis).toBe('barangay');
    expect(q.delivery_fee_minor).toBe(4900);
    expect(Number(q.distance_km)).toBe(await roadKm(STORE, north(0.03)));
  });

  test('in a km-priced area, a pinned store and address are priced by distance', async () => {
    await setPricing('distance');
    const km = await roadKm(STORE, north(0.03));
    const q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.delivery_basis).toBe('distance');
    expect(q.delivery_fee_minor).toBe(expectedFee(km));
    expect(q.total_minor).toBe(q.subtotal_minor + q.delivery_fee_minor + q.service_fee_minor + q.small_order_fee_minor - q.discount_minor);

    // A short trip costs the base fee.
    await pinAddress(north(0.005));
    expect((await quote(db, customer.id, store.merchantId, customer.addressId)).delivery_fee_minor).toBe(4000);
  });

  test('an unpinned address, or a pin far outside town, falls back to the barangay price', async () => {
    await pinAddress(null);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q).toMatchObject({ delivery_basis: 'barangay', delivery_fee_minor: 4900, distance_km: null });

    await pinAddress({ lat: 14.5995, lng: 120.9842 }); // Manila
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q).toMatchObject({ delivery_basis: 'barangay', delivery_fee_minor: 4900 });
  });

  test('admins can change the km price and set a maximum', async () => {
    await pinAddress(north(0.09)); // ≈ 13 km by road
    await setPricing('distance', ', km_base_fee_minor = 5000, km_base_km = 3, km_rate_minor = 800');
    const km = await roadKm(STORE, north(0.09));
    let q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.delivery_fee_minor).toBe(Math.ceil((5000 + (km - 3) * 800) / 500) * 500);

    await setPricing('distance', ', km_max_fee_minor = 10000');
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(q.delivery_fee_minor).toBe(10000);
    await setPricing('distance', ', km_base_fee_minor = 4000, km_base_km = 2, km_rate_minor = 1000, km_max_fee_minor = null');
  });

  test('placed orders keep the distance and both pins for the rider', async () => {
    await pinAddress(north(0.03));
    const id = await placeOrder(db, customer.id, store.merchantId, customer.addressId);
    const [o] = await db.sql<Record<string, any>>(`select distance_km, delivery_fee_minor, pickup_address, delivery_address from orders where id = $1`, [id]);
    const km = await roadKm(STORE, north(0.03));
    expect(Number(o.distance_km)).toBe(km);
    expect(Number(o.delivery_fee_minor)).toBe(expectedFee(km));
    expect(o.pickup_address).toMatchObject(STORE);
    expect(o.delivery_address).toMatchObject(north(0.03));
  });

  test('padala between two pins is priced by distance; without pins, by barangay', async () => {
    const spot = (barangay: string, pin?: { lat: number; lng: number }) =>
      JSON.stringify({ name: 'Ana Reyes', phone: '09171112222', line1: 'Purok 2', barangay, barangay_code: null, landmark: null, ...pin });
    const task = JSON.stringify({ item: 'Documents', size: 'small' });
    const q = async (a: string, b: string) => {
      const [r] = await db.as<{ q: Record<string, any> }>(customer.id, `select quote_service_request('padala', $1, $2, $3, $4) as q`, [world.areaId, a, b, task]);
      return r.q;
    };

    const pinned = await q(spot('Anilao', STORE), spot('Formon', north(0.05)));
    const km = await roadKm(STORE, north(0.05));
    expect(pinned).toMatchObject({ delivery_basis: 'distance', delivery_fee_minor: expectedFee(km) });
    expect(Number(pinned.distance_km)).toBe(km);

    const unpinned = await q(spot('Anilao'), spot('Formon'));
    expect(unpinned).toMatchObject({ delivery_basis: 'barangay', delivery_fee_minor: 4900, distance_km: null });

    const [row] = await db.as<{ id: string }>(customer.id, `select place_service_request('padala', $1, $2, $3, $4, null, $5, $6) as id`, [
      world.areaId,
      spot('Anilao', STORE),
      spot('Formon', north(0.05)),
      task,
      pinned.total_minor,
      idemKey(),
    ]);
    const [o] = await db.sql<Record<string, any>>(`select distance_km, pickup_address, delivery_address from orders where id = $1`, [row.id]);
    expect(Number(o.distance_km)).toBe(km);
    expect(o.pickup_address).toMatchObject(STORE);
    expect(o.delivery_address).toMatchObject(north(0.05));

    const bad = await db.expectError(customer.id, `select quote_service_request('padala', $1, $2, $3, $4)`, [
      world.areaId,
      spot('Anilao', { lat: 120, lng: 0 }),
      spot('Formon'),
      task,
    ]);
    expect(bad.hint).toBe('invalid_place');
  });

  test('a road distance measured by routing is used, kept between the straight line and twice it', async () => {
    await pinAddress(north(0.03));
    const [s] = await db.sql<{ km: string }>(`select straight_km($1, $2, $3, $4) as km`, [STORE.lat, STORE.lng, north(0.03).lat, north(0.03).lng]);
    const straight = Number(s.km); // ≈ 3.34 km
    const save = async (km: number) => {
      const [r] = await db.as<{ km: string }>(customer.id, `select save_route_km($1, $2, $3, $4, $5) as km`, [STORE.lat, STORE.lng, north(0.03).lat, north(0.03).lng, km]);
      return Number(r.km);
    };

    expect(await save(4.62)).toBe(4.62);
    let q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(Number(q.distance_km)).toBe(4.7);
    expect(q.delivery_fee_minor).toBe(expectedFee(4.7));

    // Too short or too long is clamped.
    expect(await save(1)).toBeCloseTo(straight, 1);
    q = await quote(db, customer.id, store.merchantId, customer.addressId);
    expect(Number(q.distance_km)).toBe(Math.ceil(straight * 10) / 10);
    expect(await save(50)).toBeCloseTo(straight * 2, 1);

    expect((await db.expectError('anon', `select save_route_km(12.75, 121.48, 12.76, 121.48, 2)`)).code).toBe('42501');
    expect((await db.expectError(customer.id, `select save_route_km(12.75, 121.48, 14.6, 120.98, 200)`)).hint).toBe('invalid_route');
    expect((await db.expectError(customer.id, `select * from route_distances`)).code).toBe('42501');
    await save(4.62);
  });

  test('listings say "from" the base km fee in km-priced areas and carry the store pin', async () => {
    const [s] = await db.as<Record<string, any>>('anon', `select delivery_fee_from_minor, delivery_fee_varies, lat, lng from storefronts where id = $1`, [store.merchantId]);
    expect(Number(s.delivery_fee_from_minor)).toBe(4000);
    expect(s.delivery_fee_varies).toBe(true);
    expect(s).toMatchObject(STORE);
  });

  test('pins must be valid and come in pairs; customers can’t pin stores', async () => {
    expect((await db.expectError(customer.id, `update addresses set lat = 95, lng = 121 where id = $1`, [customer.addressId])).code).toBe('23514');
    expect((await db.expectError(customer.id, `update addresses set lat = 12.7, lng = null where id = $1`, [customer.addressId])).code).toBe('23514');
    await db.as(customer.id, `update merchants set lat = 1, lng = 1 where id = $1`, [store.merchantId]);
    const [m] = await db.sql<{ lat: number }>(`select lat from merchants where id = $1`, [store.merchantId]);
    expect(m.lat).toBe(STORE.lat);
  });
});
