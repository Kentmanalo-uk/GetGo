import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';

describe('profile repair', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await TestDb.create();
  });

  test('a user without a profile gets one from their own auth record only', async () => {
    const orphan = await db.createUser('orphan@example.test', 'Orphan User', 'not a phone');
    const other = await db.createUser('other@example.test');
    // Simulate an account created before the profile trigger existed.
    await db.sql(`delete from profiles where id in ($1, $2)`, [orphan, other]);

    await db.as(orphan, `select ensure_my_profile()`);
    const rows = await db.sql<{ id: string; email: string; full_name: string; phone: string | null }>(
      `select id, email, full_name, phone from profiles where id in ($1, $2)`,
      [orphan, other],
    );
    expect(rows).toEqual([{ id: orphan, email: 'orphan@example.test', full_name: 'Orphan User', phone: null }]);

    // Calling again is harmless.
    await db.as(orphan, `select ensure_my_profile()`);
    expect((await db.expectError('anon', `select ensure_my_profile()`)).code).toBe('42501');
  });
});
