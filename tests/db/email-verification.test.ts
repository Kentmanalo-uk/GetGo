import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';

const now = () => Math.floor(Date.now() / 1000);

describe('email verification', () => {
  let db: TestDb;
  let user: string;

  beforeAll(async () => {
    db = await TestDb.create();
    user = await db.createUser('verify@example.test');
  });

  const verified = async () => (await db.sql<{ v: string | null }>(`select email_verified_at as v from profiles where id = $1`, [user]))[0].v;

  test('new accounts start unverified and can use the app', async () => {
    expect(await verified()).toBeNull();
    const [p] = await db.as<{ email: string }>(user, `select email from profiles where id = $1`, [user]);
    expect(p.email).toBe('verify@example.test');
  });

  test('users cannot mark themselves verified', async () => {
    expect((await db.expectError(user, `update profiles set email_verified_at = now() where id = $1`, [user])).code).toBe('42501');
    // A password session does not prove inbox access.
    const passwordOnly = await db.expectError(user, `select confirm_email_verification()`, [], {
      email: 'verify@example.test',
      amr: [{ method: 'password', timestamp: now() }],
    });
    expect(passwordOnly.hint).toBe('not_verified');
    // An old email-link sign-in doesn't count either.
    const stale = await db.expectError(user, `select confirm_email_verification()`, [], {
      email: 'verify@example.test',
      amr: [{ method: 'otp', timestamp: now() - 7200 }],
    });
    expect(stale.hint).toBe('not_verified');
    expect(await verified()).toBeNull();
  });

  test('a recent email-link session verifies the address; changing email resets it', async () => {
    const mismatch = await db.expectError(user, `select confirm_email_verification()`, [], {
      email: 'someone-else@example.test',
      amr: [{ method: 'otp', timestamp: now() }],
    });
    expect(mismatch.hint).toBe('email_mismatch');

    await db.as(user, `select confirm_email_verification()`, [], { email: 'verify@example.test', amr: [{ method: 'otp', timestamp: now() }] });
    expect(await verified()).not.toBeNull();

    await db.sql(`update auth.users set email = 'new@example.test' where id = $1`, [user]);
    expect(await verified()).toBeNull();
  });
});
