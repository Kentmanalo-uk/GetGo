import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createPlatform, createRider, gcashRef, idemKey, type World } from './fixtures';

const place = (name: string, phone: string | null, barangay: string, code: string | null, line1 = 'Purok 2, Rizal St.') =>
  ({ name, phone, line1, barangay, barangay_code: code, landmark: null });

describe('padala and errands', () => {
  let db: TestDb;
  let world: World;
  let customer: string;
  let rider: string;
  let otherRider: string;

  const padala = {
    pickup: place('Ana Reyes', '09171112222', 'Anilao', '175203001'),
    dropoff: place('Ben Cruz', '09173334444', 'Batangan', '175203002'),
    task: { item: 'Documents', size: 'small' },
  };
  const errand = {
    pickup: place('Mercury Drug', null, 'Anilao', '175203001', 'Rizal St. corner Mabini'),
    dropoff: place('Ana Reyes', '09171112222', 'Formon', '175203008'),
    task: { type: 'buy', description: 'Biogesic 500mg, 1 banig, and a bottle of alcohol', budget_minor: 50000 },
  };

  const quoteAs = async (who: string, service: string, req: { pickup: object; dropoff: object; task: object }, areaId = world.areaId) => {
    const [row] = await db.as<{ q: Record<string, number> }>(who, `select quote_service_request($1, $2, $3, $4, $5) as q`, [
      service,
      areaId,
      JSON.stringify(req.pickup),
      JSON.stringify(req.dropoff),
      JSON.stringify(req.task),
    ]);
    return row.q;
  };
  const sendAs = async (who: string, service: string, req: { pickup: object; dropoff: object; task: object }, opts: { key?: string; expected?: number } = {}) => {
    const expected = opts.expected ?? (await quoteAs(who, service, req)).total_minor;
    const [row] = await db.as<{ id: string }>(who, `select place_service_request($1, $2, $3, $4, $5, 'Call when near', $6, $7) as id`, [
      service,
      world.areaId,
      JSON.stringify(req.pickup),
      JSON.stringify(req.dropoff),
      JSON.stringify(req.task),
      expected,
      opts.key ?? idemKey(),
    ]);
    return row.id;
  };
  const errorOf = (who: string, service: string, req: { pickup: object; dropoff: object; task: object }) =>
    db.expectError(who, `select quote_service_request($1, $2, $3, $4, $5)`, [
      service,
      world.areaId,
      JSON.stringify(req.pickup),
      JSON.stringify(req.dropoff),
      JSON.stringify(req.task),
    ]);
  const order = async (id: string) => (await db.sql<Record<string, any>>(`select * from orders where id = $1`, [id]))[0];

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db); // default delivery ₱49, service fee ₱10
    // Areas price by km by default; these tests cover the per-barangay option.
    await db.sql(`update service_areas set delivery_pricing = 'barangay'`);
    customer = await db.createUser('ana@example.test', 'Ana Reyes', '09171112222');
    rider = await createRider(db, world, 'rider@example.test');
    otherRider = await createRider(db, world, 'other-rider@example.test');
    await db.as(world.admin, `select set_barangay_fees($1, $2)`, [
      world.areaId,
      JSON.stringify([
        { barangay_code: '175203001', barangay_name: 'Anilao', delivery_fee_minor: 3000 },
        { barangay_code: '175203002', barangay_name: 'Batangan', delivery_fee_minor: 6000 },
      ]),
    ]);
  });

  test('padala is priced by the farther barangay plus the area fees', async () => {
    const q = await quoteAs(customer, 'padala', padala);
    expect(q).toMatchObject({ subtotal_minor: 0, delivery_fee_minor: 6000, service_fee_minor: 1000, total_minor: 7000 });

    await db.as(world.admin, `update service_areas set padala_fee_minor = 1500 where id = $1`, [world.areaId]);
    expect((await quoteAs(customer, 'padala', padala)).total_minor).toBe(8500);
    await db.as(world.admin, `update service_areas set padala_fee_minor = 0 where id = $1`, [world.areaId]);
  });

  test('requests are validated on the server', async () => {
    expect((await db.expectError('anon', `select quote_service_request('padala', $1, '{}', '{}', '{}')`, [world.areaId])).code).toBe('42501');
    expect((await errorOf(customer, 'padala', { ...padala, task: { item: 'Box', size: 'huge' } })).hint).toBe('invalid_task');
    expect((await errorOf(customer, 'padala', { ...padala, dropoff: { ...padala.dropoff, phone: '1234' } })).hint).toBe('invalid_phone');
    expect((await errorOf(customer, 'padala', { ...padala, pickup: { ...padala.pickup, line1: '' } })).hint).toBe('invalid_place');
    expect((await errorOf(customer, 'errand', { ...errand, task: { ...errand.task, budget_minor: 0 } })).hint).toBe('budget_required');
    expect((await errorOf(customer, 'errand', { ...errand, task: { ...errand.task, budget_minor: 400000 } })).hint).toBe('budget_too_large');
    expect((await errorOf(customer, 'errand', { ...errand, task: { ...errand.task, type: 'party' } })).hint).toBe('invalid_task');

    // Barangays must belong to the area's town (PSGC code prefix).
    await db.as(world.admin, `update service_areas set psgc_code = '175203000' where id = $1`, [world.areaId]);
    expect((await errorOf(customer, 'padala', { ...padala, dropoff: { ...padala.dropoff, barangay_code: '175204002' } })).hint).toBe('outside_area');
    expect((await quoteAs(customer, 'padala', padala)).total_minor).toBe(7000);

    // Admins can switch a service off per area.
    await db.as(world.admin, `update service_areas set padala_enabled = false where id = $1`, [world.areaId]);
    expect((await errorOf(customer, 'padala', padala)).hint).toBe('service_unavailable');
    await db.as(world.admin, `update service_areas set padala_enabled = true where id = $1`, [world.areaId]);
  });

  test('a padala goes through the normal rider flow', async () => {
    const key = idemKey();
    const id = await sendAs(customer, 'padala', padala, { key });
    expect(await sendAs(customer, 'padala', padala, { key })).toBe(id); // retries are safe
    expect((await db.expectError(customer, `select place_service_request('padala', $1, $2, $3, $4, null, 1, $5)`, [
      world.areaId, JSON.stringify(padala.pickup), JSON.stringify(padala.dropoff), JSON.stringify(padala.task), idemKey(),
    ])).hint).toBe('total_changed');

    const o = await order(id);
    expect(o).toMatchObject({
      service: 'padala', merchant_id: null, merchant_name: 'Padala · Documents', status: 'pending',
      subtotal_minor: 0, delivery_fee_minor: 6000, service_fee_minor: 1000, total_minor: 7000,
      task: { item: 'Documents', size: 'small' }, customer_name: 'Ana Reyes',
    });
    expect(o.pickup_address).toMatchObject({ name: 'Ana Reyes', barangay: 'Anilao', city: 'Naga City' });
    expect(o.delivery_address).toMatchObject({ recipient_name: 'Ben Cruz', phone: '09173334444', barangay: 'Batangan' });

    // Area riders are told and can see it with the other open orders.
    const [note] = await db.sql<{ title: string; link: string }>(`select title, link from notifications where user_id = $1 order by created_at desc limit 1`, [rider]);
    expect(note.title).toMatch(/^New padala GG-/);
    expect(note.link).toBe(`/rider/orders/${id}`);
    const open = await db.as<{ id: string }>(rider, `select id from orders where status = 'pending' and service_area_id = $1`, [world.areaId]);
    expect(open.map((r) => r.id)).toContain(id);

    await db.as(rider, `select rider_accept_order($1)`, [id]);
    await db.as(customer, `select submit_gcash_payment($1, $2, 'Ana R.')`, [id, gcashRef()]);
    await db.as(rider, `select confirm_gcash_payment($1, true)`, [id]);
    const [paid] = await db.sql<{ body: string }>(`select body from notifications where user_id = $1 and kind = 'order.buying'`, [customer]);
    expect(paid.body).toBe('Your rider is on the way to pick up your parcel.');
    await db.as(rider, `select update_order_status($1, 'out_for_delivery')`, [id]);
    await db.as(rider, `select update_order_status($1, 'completed')`, [id]);
    expect((await order(id)).status).toBe('completed');
    const [done] = await db.sql<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'order.completed'`, [customer]);
    expect(done.title).toBe('Parcel delivered');
  });

  test('an errand carries a budget, and the rider records what was spent', async () => {
    const q = await quoteAs(customer, 'errand', errand);
    // Budget ₱500 + Anilao ₱30 vs default ₱49 → ₱49 + service ₱10 + errand fee ₱20.
    expect(q).toMatchObject({ subtotal_minor: 50000, delivery_fee_minor: 4900, service_fee_minor: 3000, total_minor: 57900 });

    const id = await sendAs(customer, 'errand', errand);
    expect(await order(id)).toMatchObject({ service: 'errand', merchant_name: 'Errand · Buy something', subtotal_minor: 50000, spent_minor: null });

    await db.as(rider, `select rider_accept_order($1)`, [id]);
    expect((await db.expectError(rider, `select rider_record_spent($1, 1000)`, [id])).hint).toBe('invalid_transition');
    await db.as(customer, `select submit_gcash_payment($1, $2, null)`, [id, gcashRef()]);
    await db.as(rider, `select confirm_gcash_payment($1, true)`, [id]);

    expect((await db.expectError(otherRider, `select rider_record_spent($1, 1000)`, [id])).hint).toBe('order_not_found');
    expect((await db.expectError(rider, `select rider_record_spent($1, 60000)`, [id])).hint).toBe('invalid_amount');
    await db.as(rider, `select rider_record_spent($1, 42000)`, [id]);
    expect((await order(id)).spent_minor).toBe(42000);

    // Errands without purchases (e.g. picking something up) need no budget.
    const pickup = await quoteAs(customer, 'errand', { ...errand, task: { type: 'pickup', description: 'Pick up my ID at the municipal hall', budget_minor: 0 } });
    expect(pickup.subtotal_minor).toBe(0);
  });

  test('customers can have at most 3 open requests, and stores are untouched', async () => {
    const extra = await db.createUser('busy@example.test', 'Busy Bee', '09175556666');
    for (let i = 0; i < 3; i += 1) await sendAs(extra, 'padala', padala);
    expect((await db.expectError(extra, `select place_service_request('padala', $1, $2, $3, $4, null, 7000, $5)`, [
      world.areaId, JSON.stringify(padala.pickup), JSON.stringify(padala.dropoff), JSON.stringify(padala.task), idemKey(),
    ])).hint).toBe('too_many_open');

    // Service orders can't be inserted directly or point at a store.
    expect((await db.expectError(extra, `insert into orders (code) values ('X')`)).code).toBe('42501');
    const [{ ok }] = await db.sql<{ ok: boolean }>(`select not exists (select 1 from orders where service <> 'pabili' and merchant_id is not null) as ok`);
    expect(ok).toBe(true);
  });
});
