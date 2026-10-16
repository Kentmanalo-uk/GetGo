import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createPlatform, createStore, type Store } from './fixtures';
import { evaluate, type ConfigurableProduct, type Selection } from '../../src/domain/customization';
import { ORDER_STATUSES, canTransition } from '../../src/domain/orderStatus';

/** The browser preview and the server must agree on every configuration. */
describe('client/server rule parity', () => {
  let db: TestDb;
  let store: Store;
  let product: ConfigurableProduct;

  beforeAll(async () => {
    db = await TestDb.create();
    const world = await createPlatform(db);
    store = await createStore(db, world, 'parity@example.test');
    const [p] = await db.sql<any>(`select * from products where id = $1`, [store.productId]);
    const variants = await db.sql<any>(`select * from product_variants where product_id = $1 order by sort_order`, [store.productId]);
    const groups = await db.sql<any>(
      `select g.*, pog.sort_order as link_order from option_groups g join product_option_groups pog on pog.group_id = g.id
       where pog.product_id = $1 order by pog.sort_order`,
      [store.productId],
    );
    product = {
      id: p.id,
      name: p.name,
      base_price_minor: p.base_price_minor,
      is_available: p.is_available,
      max_per_order: p.max_per_order,
      variants,
      groups: await Promise.all(
        groups.map(async (g: any) => ({
          ...g,
          values: await db.sql<any>(`select * from option_values where group_id = $1 order by sort_order`, [g.id]),
        })),
      ),
    };
  });

  test('evaluate() matches price_configuration() across many configurations', async () => {
    const valueIds = product.groups.flatMap((g) => g.values.map((v) => v.id));
    const variantChoices = [null, store.regularId, store.largeId];
    let checked = 0;
    // Deterministic pseudo-random sweep.
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 150; i++) {
      const selection: Selection = {};
      for (const id of valueIds) {
        const roll = rand(4);
        if (roll > 0) selection[id] = roll === 3 ? 1 + rand(3) : 1;
      }
      const variantId = variantChoices[rand(3)];
      const quantity = rand(12);
      const local = evaluate(product, { variantId, selection, quantity });
      const payload = JSON.stringify(Object.entries(selection).map(([option_value_id, q]) => ({ option_value_id, quantity: q })));
      const [server] = await db.as<{ unit_price_minor: number | null; error_code: string | null; error_message: string | null }>(
        'anon',
        `select * from price_configuration($1, $2, $3, $4)`,
        [product.id, variantId, payload, quantity],
      );
      expect(local.valid, JSON.stringify({ variantId, selection, quantity, server })).toBe(server.error_code === null);
      if (server.error_code === null) {
        expect(local.unitPriceMinor).toBe(server.unit_price_minor);
      } else {
        expect(local.error?.code).toBe(server.error_code);
        expect(local.error?.message).toBe(server.error_message);
      }
      checked++;
    }
    expect(checked).toBe(150);
  });

  test('canTransition() matches order_transition_allowed()', async () => {
    const rows = await db.sql<{ f: string; t: string; ok: boolean }>(
      `select f::text as f, t::text as t, order_transition_allowed(f, t) as ok
       from unnest(enum_range(null::order_status)) f, unnest(enum_range(null::order_status)) t`,
    );
    expect(rows.length).toBe(ORDER_STATUSES.length ** 2);
    for (const r of rows) {
      expect(canTransition(r.f as never, r.t as never), `${r.f}→${r.t}`).toBe(r.ok);
    }
  });
});
