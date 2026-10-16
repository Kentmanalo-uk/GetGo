import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const migrationsDir = join(root, 'supabase', 'migrations');

export type Actor = string | 'anon' | 'service';

export interface DbError extends Error {
  code?: string;
  hint?: string;
}

/**
 * A fresh Postgres (PGlite) with the Supabase shim and every migration applied.
 * Queries run as a specific actor inside a transaction, the way PostgREST runs
 * requests: `SET LOCAL ROLE` plus JWT claims.
 */
export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'));
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    return new TestDb(pg);
  }

  /** Superuser query (test setup only). */
  async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(query, params)).rows;
  }

  async createUser(email: string, fullName = email.split('@')[0], phone: string | null = '09171234567'): Promise<string> {
    const [row] = await this.sql<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text, 'phone', $3::text)) returning id`,
      [email, fullName, phone],
    );
    return row.id;
  }

  async as<T = Record<string, unknown>>(actor: Actor, query: string, params: unknown[] = []): Promise<T[]> {
    return this.pg.transaction(async (tx: Transaction) => {
      if (actor === 'anon') {
        await tx.exec('set local role anon');
      } else if (actor === 'service') {
        await tx.exec('set local role service_role');
      } else {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor]);
        await tx.exec('set local role authenticated');
      }
      return (await tx.query<T>(query, params)).rows;
    });
  }

  /** Runs a query expected to fail and returns the error. */
  async expectError(actor: Actor, query: string, params: unknown[] = []): Promise<DbError> {
    try {
      await this.as(actor, query, params);
    } catch (error) {
      return error as DbError;
    }
    throw new Error(`Expected query to fail: ${query}`);
  }
}
