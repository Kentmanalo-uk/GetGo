import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createPlatform, createStore, quote, sel, type Store, type World } from './fixtures';

describe('delivery fees per barangay', () => {
  let db: TestDb;
  let world: World;
  let store: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db); // area default delivery fee: ₱49
    store = await createStore(db, world, 'owner@example.test');
  });

  const fees = (rows: Array<[string, string, number]>) =>
    JSON.stringify(rows.map(([barangay_code, barangay_name, delivery_fee_minor]) => ({ barangay_code, barangay_name, delivery_fee_minor })));

  const customerIn = async (email: string, barangay: string, code: string | null) => {
    const id = await db.createUser(email);
    const [a] = await db.as<{ id: string }>(
      id,
      `insert into addresses (label, recipient_name, phone, line1, barangay, barangay_code, city, service_area_id)
       values ('Home', 'Test', '09181234567', 'Purok 1', $1, $2, 'Naga City', $3) returning id`,
      [barangay, code, world.areaId],
    );
    await db.as(id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    return { id, addressId: a.id };
  };

  test('only admins set barangay prices', async () => {
    expect((await db.expectError(store.owner, `select set_barangay_fees($1, $2)`, [world.areaId, fees([['175203001', 'Anilao', 3000]])])).code).toBe('42501');
    expect((await db.expectError(world.admin, `select set_barangay_fees($1, $2)`, [world.areaId, fees([['bad', 'Anilao', 3000]])])).hint).toBe('invalid_fees');
    const [{ n }] = await db.as<{ n: number }>(world.admin, `select set_barangay_fees($1, $2) as n`, [
      world.areaId,
      fees([
        ['175203001', 'Anilao', 3000],
        ['175203002', 'Batangan', 6000],
      ]),
    ]);
    expect(n).toBe(2);
  });

  test('checkout charges the barangay price, by code or by name, else the default', async () => {
    const picked = await customerIn('picked@example.test', 'Anilao', '175203001');
    expect((await quote(db, picked.id, store.merchantId, picked.addressId)).delivery_fee_minor).toBe(3000);

    const typed = await customerIn('typed@example.test', ' batangan ', null);
    expect((await quote(db, typed.id, store.merchantId, typed.addressId)).delivery_fee_minor).toBe(6000);

    const other = await customerIn('other@example.test', 'Formon', '175203008');
    expect((await quote(db, other.id, store.merchantId, other.addressId)).delivery_fee_minor).toBe(4900);
  });

  test('listings show the lowest fee and whether it varies', async () => {
    const [front] = await db.as<{ delivery_fee_from_minor: number; delivery_fee_varies: boolean }>(
      'anon',
      `select delivery_fee_from_minor, delivery_fee_varies from storefronts where id = $1`,
      [store.merchantId],
    );
    expect(front).toEqual({ delivery_fee_from_minor: 3000, delivery_fee_varies: true });

    // Same price everywhere (the "same price for all" button) → no longer varies.
    await db.as(world.admin, `select set_barangay_fees($1, $2)`, [
      world.areaId,
      fees([
        ['175203001', 'Anilao', 4900],
        ['175203002', 'Batangan', 4900],
      ]),
    ]);
    const [flat] = await db.as<{ delivery_fee_varies: boolean }>('anon', `select delivery_fee_varies from storefronts where id = $1`, [store.merchantId]);
    expect(flat.delivery_fee_varies).toBe(false);
  });
});
