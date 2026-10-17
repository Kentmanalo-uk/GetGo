import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, type World } from './fixtures';

describe('legal acceptances and privacy tools', () => {
  let db: TestDb;
  let world: World;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
  });

  test('accepting at sign-up is recorded with the version', async () => {
    const [u] = await db.sql<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('new@example.test', '{"full_name":"New Person","legal":{"version":"2026-10-17","documents":["terms","privacy","bogus"]}}')
       returning id`,
    );
    const rows = await db.as<{ document: string; version: string }>(u.id, `select document, version from legal_acceptances order by document`);
    expect(rows).toEqual([
      { document: 'privacy', version: '2026-10-17' },
      { document: 'terms', version: '2026-10-17' },
    ]);
  });

  test('people accept documents for themselves only, and only known ones', async () => {
    const me = await db.createUser('me@example.test');
    const other = await db.createUser('other@example.test');
    await db.as(me, `select accept_legal(array['rider_terms'], '2026-10-17')`);
    await db.as(me, `select accept_legal(array['rider_terms'], '2026-10-17')`); // idempotent
    expect((await db.expectError(me, `select accept_legal(array['anything'], '2026-10-17')`)).hint).toBe('invalid_request');
    expect((await db.expectError(me, `select accept_legal(array['terms'], 'v2')`)).hint).toBe('invalid_request');
    expect((await db.expectError('anon', `select accept_legal(array['terms'], '2026-10-17')`)).code).toBe('42501');
    expect(await db.as(other, `select * from legal_acceptances where user_id = $1`, [me])).toEqual([]);
    expect((await db.expectError(me, `insert into legal_acceptances (user_id, document, version) values ($1, 'terms', '2026-10-17')`, [me])).code).toBe('42501');
  });

  test('export_my_data returns only the caller’s data', async () => {
    const a = await createCustomer(db, world, 'a@example.test');
    const b = await createCustomer(db, world, 'b@example.test');
    await db.as(b.id, `update addresses set line1 = 'Secret St.' where id = $1`, [b.addressId]);
    const [{ data }] = await db.as<{ data: Record<string, any> }>(a.id, `select export_my_data() as data`);
    expect(data.profile.email).toBe('a@example.test');
    expect(data.addresses).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('Secret St.');
    expect(data.orders).toEqual([]);
    expect((await db.expectError('anon', `select export_my_data()`)).code).toBe('42501');
  });

  test('account deletion requests open one staff ticket', async () => {
    const c = await createCustomer(db, world, 'leaving@example.test');
    const [{ id }] = await db.as<{ id: string }>(c.id, `select request_account_deletion('Not using it') as id`);
    const [{ id: again }] = await db.as<{ id: string }>(c.id, `select request_account_deletion() as id`);
    expect(again).toBe(id);
    const [ticket] = await db.sql<{ subject: string; priority: string }>(`select subject, priority from support_tickets where id = $1`, [id]);
    expect(ticket).toEqual({ subject: 'Account deletion request', priority: 'high' });
    const notes = await db.sql(`select 1 from notifications where user_id = $1 and kind = 'privacy.deletion_request'`, [world.admin]);
    expect(notes).toHaveLength(1);
  });

  test('only admins set the operator details shown on the legal pages', async () => {
    const someone = await db.createUser('someone@example.test');
    await db.as(someone, `update platform_settings set legal_name = 'Hacker Inc.'`);
    await db.as(world.admin, `update platform_settings set legal_name = 'GETGO Delivery Services', dpo_email = 'privacy@getgo.test'`);
    const [s] = await db.as<{ legal_name: string; dpo_email: string }>('anon', `select legal_name, dpo_email from platform_settings`);
    expect(s).toEqual({ legal_name: 'GETGO Delivery Services', dpo_email: 'privacy@getgo.test' });
    expect((await db.expectError(world.admin, `update platform_settings set dpo_email = 'not-an-email'`)).code).toBe('23514');
  });
});
