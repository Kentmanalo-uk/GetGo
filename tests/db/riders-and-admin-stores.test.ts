import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createPlatform, type World } from './fixtures';

const HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '08:00', closes: '20:00' }));

describe('rider sign-up and approval', () => {
  let db: TestDb;
  let world: World;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
  });

  const application = (areaId: string) =>
    JSON.stringify({ vehicle: 'motorcycle', plate: 'abc 123', service_area_id: areaId, gcash_name: 'Kent M.', gcash_number: '0917 765 4321' });

  test('signing up with rider details creates a pending application', async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('kent@example.test', jsonb_build_object('full_name', 'Kent Manalo', 'phone', '09171112222', 'rider_application', $1::jsonb)) returning id`,
      [application(world.areaId)],
    );
    const [rider] = await db.as<{ status: string; gcash_number: string; plate_number: string }>(id, `select status, gcash_number, plate_number from rider_profiles where user_id = $1`, [id]);
    expect(rider).toEqual({ status: 'pending', gcash_number: '09177654321', plate_number: 'ABC 123' });
    // Pending riders cannot see or accept orders yet.
    expect(await db.as(id, `select array_to_string(my_roles(), ',') as r`)).toEqual([{ r: '' }]);
    expect((await db.as<{ n: number }>(world.admin, `select (admin_overview() ->> 'riders_pending')::int as n`))[0].n).toBe(1);

    await db.as(world.admin, `select set_rider_status($1, 'active')`, [id]);
    expect(await db.as(id, `select array_to_string(my_roles(), ',') as r`)).toEqual([{ r: 'rider' }]);
    const [{ status }] = await db.as<{ status: string }>(id, `select status from rider_profiles where user_id = $1`, [id]);
    expect(status).toBe('active');
    expect((await db.expectError(id, `select apply_as_rider('Kent', '09171112222', 'motorcycle', null, $1, 'K', '09170000000')`, [world.areaId])).hint).toBe('already_rider');
  });

  test('invalid rider details never block sign-up; the rider can apply later', async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('bad@example.test', jsonb_build_object('full_name', 'Bad Data', 'rider_application', jsonb_build_object('vehicle', 'rocket'))) returning id`,
    );
    expect(await db.as(id, `select status from rider_profiles where user_id = $1`, [id])).toEqual([]);
    const err = await db.expectError(id, `select apply_as_rider('Bad Data', '09171112223', 'bicycle', null, $1, 'B D', '12345')`, [world.areaId]);
    expect(err.hint).toBe('invalid_gcash');
    await db.as(id, `select apply_as_rider('Bad Data', '09171112223', 'bicycle', null, $1, 'B D', '09171112223')`, [world.areaId]);

    expect((await db.expectError(world.admin, `select reject_rider_application($1, '')`, [id])).hint).toBe('reason_required');
    await db.as(world.admin, `select reject_rider_application($1, 'Please use your own GCash account')`, [id]);
    expect(await db.as(id, `select status from rider_profiles where user_id = $1`, [id])).toEqual([]);
    expect((await db.expectError(id, `select set_rider_status($1, 'active')`, [id])).code).toBe('42501');
  });
});

describe('stores created and managed by admins', () => {
  let db: TestDb;
  let world: World;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
  });

  const store = (areaId: string, name: string) =>
    JSON.stringify({ name, category: 'grocery', address_line: '3 Market St', barangay: 'Centro', city: 'Naga City', service_area_id: areaId, hours: HOURS });

  test('an existing account becomes owner immediately', async () => {
    const owner = await db.createUser('existing-owner@example.test');
    const [{ r }] = await db.as<{ r: any }>(world.admin, `select admin_create_store('Existing-Owner@Example.test', $1) as r`, [store(world.areaId, 'Tindahan ni Aling Nena')]);
    expect(r).toMatchObject({ owner_linked: true, slug: 'tindahan-ni-aling-nena' });
    const members = await db.as(owner, `select role from merchant_members where merchant_id = $1`, [r.merchant_id]);
    expect(members).toEqual([{ role: 'owner' }]);
    expect(await db.as(owner, `select count(*)::int n from store_hours where merchant_id = $1`, [r.merchant_id])).toEqual([{ n: 5 }]);
  });

  test('a store for a new email is claimed when that email signs up', async () => {
    const [{ r }] = await db.as<{ r: any }>(world.admin, `select admin_create_store('new-owner@example.test', $1) as r`, [store(world.areaId, 'Sari-Sari Plus')]);
    expect(r.owner_linked).toBe(false);
    const owner = await db.createUser('New-Owner@example.test');
    expect(await db.as(owner, `select role from merchant_members where merchant_id = $1`, [r.merchant_id])).toEqual([{ role: 'owner' }]);
    const [m] = await db.sql<{ pending_owner_email: string | null }>(`select pending_owner_email from merchants where id = $1`, [r.merchant_id]);
    expect(m.pending_owner_email).toBeNull();
  });

  test('only admins create stores, and admins can manage any store', async () => {
    const someone = await db.createUser('someone@example.test');
    expect((await db.expectError(someone, `select admin_create_store('x@example.test', $1)`, [store(world.areaId, 'Nope')])).code).toBe('42501');
    expect((await db.expectError(world.support, `select admin_create_store('x@example.test', $1)`, [store(world.areaId, 'Nope')])).code).toBe('42501');

    const [{ r }] = await db.as<{ r: any }>(world.admin, `select admin_create_store('managed@example.test', $1) as r`, [store(world.areaId, 'Managed Store')]);
    const merchantId = r.merchant_id;
    const [{ id: productId }] = await db.as<{ id: string }>(world.admin, `select save_product($1, $2) as id`, [
      merchantId,
      JSON.stringify({ name: 'Rice 1kg', base_price_minor: 6500, status: 'published' }),
    ]);
    await db.as(world.admin, `select set_product_availability($1, false)`, [productId]);
    await db.as(world.admin, `insert into categories (merchant_id, name) values ($1, 'Staples')`, [merchantId]);
    expect(await db.as(world.admin, `update merchants set description = 'Updated by admin' where id = $1 returning id`, [merchantId])).toHaveLength(1);
    await db.as(world.admin, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`merchants/${merchantId}/products/x.webp`]);
    await db.as(world.admin, `select set_store_published($1, true)`, [merchantId]);

    // Support staff and other users still can't edit stores.
    expect((await db.expectError(world.support, `select save_product($1, '{"name":"X","base_price_minor":1}')`, [merchantId])).code).toBe('42501');
    expect((await db.expectError(someone, `select set_product_availability($1, true)`, [productId])).code).toBe('42501');
    expect(await db.as(someone, `update merchants set description = 'x' where id = $1 returning id`, [merchantId])).toHaveLength(0);
  });
});
