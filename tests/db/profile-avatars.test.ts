import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';

describe('profile pictures', () => {
  let db: TestDb;
  let me: string;
  let other: string;

  beforeAll(async () => {
    db = await TestDb.create();
    me = await db.createUser('me@example.test');
    other = await db.createUser('other@example.test');
  });

  test('people upload only into their own avatar folder', async () => {
    await db.as(me, `insert into storage.objects (bucket_id, name, owner) values ('media', $1, $2)`, [`avatars/${me}/a.webp`, me]);
    expect((await db.expectError(me, `insert into storage.objects (bucket_id, name, owner) values ('media', $1, $2)`, [`avatars/${other}/a.webp`, me])).code).toBe('42501');
    expect((await db.expectError(me, `insert into storage.objects (bucket_id, name, owner) values ('media', $1, $2)`, [`avatars/${me}/x/a.webp`, me])).code).toBe('42501');
  });

  test('the saved path must be in the person’s own folder', async () => {
    await db.as(me, `update profiles set avatar_path = $1 where id = $2`, [`avatars/${me}/a.webp`, me]);
    const [p] = await db.as<{ avatar_path: string }>(me, `select avatar_path from profiles where id = $1`, [me]);
    expect(p.avatar_path).toBe(`avatars/${me}/a.webp`);
    expect((await db.expectError(me, `update profiles set avatar_path = $1 where id = $2`, [`avatars/${other}/a.webp`, me])).code).toBe('23514');
    // Someone else's profile can't be changed at all.
    await db.as(other, `update profiles set avatar_path = null where id = $1`, [me]);
    const [still] = await db.sql<{ avatar_path: string }>(`select avatar_path from profiles where id = $1`, [me]);
    expect(still.avatar_path).toBe(`avatars/${me}/a.webp`);
  });
});
