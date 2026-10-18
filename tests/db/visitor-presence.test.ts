import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createRider, type World } from './fixtures';

describe('visitors and who is online', () => {
  let db: TestDb;
  let world: World;
  let customer: { id: string; addressId: string };
  let rider: string;

  const track = (who: string, visitor: string, path = '/', app = 'browser') =>
    db.as(who, `select track_visit($1, $2, 'Android phone', 'Chrome', $3)`, [visitor, path, app]);
  const visitors = async (who = world.admin) => {
    const [r] = await db.as<{ v: Record<string, any> }>(who, `select admin_visitors() as v`);
    return r.v;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    customer = await createCustomer(db, world, 'maria@example.test');
    rider = await createRider(db, world, 'rider@example.test');
  });

  test('guests and signed-in people show as online, with their page and device', async () => {
    const guest = randomUUID();
    const phone = randomUUID();
    await track('anon', guest, '/stores/lutong-bahay');
    await track(customer.id, phone, '/checkout/x', 'installed');

    const v = await visitors();
    expect(v).toMatchObject({ online_total: 2, online_signed_in: 1, online_guests: 1, today_visitors: 2, today_signed_in: 1 });
    const byId = Object.fromEntries(v.online.map((o: Record<string, any>) => [o.visitor_id, o]));
    expect(byId[guest]).toMatchObject({ kind: 'Guest', user_id: null, path: '/stores/lutong-bahay', device: 'Android phone', browser: 'Chrome', app: 'browser' });
    expect(byId[phone]).toMatchObject({ kind: 'Customer', full_name: 'Juan Santos', email: 'maria@example.test', path: '/checkout/x', app: 'installed' });
  });

  test('signing in on the same device links the visit to the account; page views count', async () => {
    const device = randomUUID();
    await track('anon', device, '/');
    await track(rider, device, '/rider');
    await track(rider, device, '/rider/orders');
    const [row] = await db.sql<Record<string, any>>(`select user_id, path, page_views from site_visits where visitor_id = $1`, [device]);
    expect(row).toMatchObject({ user_id: rider, path: '/rider/orders', page_views: 3 });
    const v = await visitors();
    expect(v.online.find((o: Record<string, any>) => o.visitor_id === device).kind).toBe('Rider');
  });

  test('people who haven’t checked in for 2 minutes are no longer online', async () => {
    await db.sql(`update site_visits set last_seen_at = now() - interval '3 minutes'`);
    await db.sql(`update account_activity set last_seen_at = now() - interval '3 minutes'`);
    const v = await visitors();
    expect(v).toMatchObject({ online_total: 0, online_signed_in: 0, online: [], today_visitors: 3 });
  });

  test('accounts list every signed-up person, most recently active first, with search', async () => {
    await track(customer.id, randomUUID(), '/orders');
    const [r] = await db.as<{ a: Array<Record<string, any>> }>(world.admin, `select admin_accounts(null, 50, 0) as a`);
    expect(r.a[0]).toMatchObject({ id: customer.id, online: true, last_path: '/orders', kind: 'Customer' });
    const riderRow = r.a.find((x) => x.id === rider)!;
    expect(riderRow).toMatchObject({ kind: 'Rider', online: false });
    expect(r.a.find((x) => x.id === world.admin)).toMatchObject({ kind: 'Admin', last_seen_at: null });

    const [s] = await db.as<{ a: Array<Record<string, any>> }>(world.admin, `select admin_accounts('maria', 50, 0) as a`);
    expect(s.a.map((x) => x.id)).toEqual([customer.id]);
  });

  test('only admins and support can see visitors; nobody reads the tables directly', async () => {
    expect((await visitors(world.support)).online_total).toBeGreaterThan(0);
    expect((await db.expectError(world.finance, `select admin_visitors()`)).code).toBe('42501');
    expect((await db.expectError(customer.id, `select admin_accounts()`)).code).toBe('42501');
    expect((await db.expectError('anon', `select admin_visitors()`)).code).toBe('42501');
    expect((await db.expectError(customer.id, `select * from site_visits`)).code).toBe('42501');
    expect((await db.expectError('anon', `select * from account_activity`)).code).toBe('42501');
  });

  test('check-ins are cleaned and throttled', async () => {
    const device = randomUUID();
    await db.as('anon', `select track_visit($1, $2, $3, $4, 'hacker')`, [device, 'https://evil.example/' + 'x'.repeat(300), 'D'.repeat(80), null]);
    const [row] = await db.sql<Record<string, any>>(`select path, device, browser, app from site_visits where visitor_id = $1`, [device]);
    expect(row).toMatchObject({ path: '/', browser: null, app: 'browser' });
    expect(row.device).toHaveLength(40);

    // Within 20 seconds on the same page, nothing changes.
    await db.sql(`update site_visits set last_seen_at = now() - interval '10 seconds' where visitor_id = $1`, [device]);
    const [before] = await db.sql<{ t: string }>(`select last_seen_at::text as t from site_visits where visitor_id = $1`, [device]);
    await track('anon', device, '/');
    const [after] = await db.sql<{ t: string }>(`select last_seen_at::text as t from site_visits where visitor_id = $1`, [device]);
    expect(after.t).toBe(before.t);
  });
});
