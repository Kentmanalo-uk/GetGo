import { beforeAll, describe, expect, test } from 'vitest';
import { TestDb } from './harness';
import { createCustomer, createPlatform, createStore, placeOrder, sel, type Store, type World } from './fixtures';

describe('online payments, webhooks, refunds and settlements', () => {
  let db: TestDb;
  let world: World;
  let store: Store;

  beforeAll(async () => {
    db = await TestDb.create();
    world = await createPlatform(db);
    store = await createStore(db, world, 'owner@example.test');
    await db.as(world.admin, `update platform_settings set online_payments_enabled = true`);
  });

  const onlineOrder = async (email: string) => {
    const customer = await createCustomer(db, world, email);
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 1)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId, { method: 'online' });
    const ref = `cs_${orderId.slice(0, 8)}`;
    await db.as('service', `select attach_checkout_session($1, $2, 'https://checkout.example/x', now() + interval '30 minutes')`, [orderId, ref]);
    const [order] = await db.sql<{ total_minor: number }>(`select total_minor from orders where id = $1`, [orderId]);
    return { customer, orderId, ref, total: order.total_minor };
  };

  const event = (id: string, type: string, ref: string, amount: number | null) =>
    db.as<{ r: string }>('service', `select apply_payment_event('paymongo', $1, $2, $3, $4, '{}') as r`, [id, type, ref, amount]);

  test('orders awaiting payment are hidden from the store queue until paid', async () => {
    const { orderId, ref, total } = await onlineOrder('pay@example.test');
    const [before] = await db.as<{ status: string }>(store.owner, `select status from orders where id = $1`, [orderId]);
    expect(before.status).toBe('awaiting_payment');
    expect(await db.as(store.owner, `select id from notifications where link like '%' || $1`, [orderId])).toHaveLength(0);

    expect((await event('evt_1', 'payment.paid', ref, total))[0].r).toBe('paid');
    // Duplicate delivery of the same event is a no-op.
    expect((await event('evt_1', 'payment.paid', ref, total))[0].r).toBe('duplicate');
    // A different event for an already-paid payment changes nothing.
    expect((await event('evt_2', 'payment.paid', ref, total))[0].r).toBe('already_paid');

    const [after] = await db.as<{ status: string; payment_status: string }>(store.owner, `select status, payment_status from orders where id = $1`, [orderId]);
    expect(after).toEqual({ status: 'pending', payment_status: 'paid' });
    const history = await db.sql<{ actor_kind: string }>(`select actor_kind from order_status_history where order_id = $1 order by id`, [orderId]);
    expect(history.map((h) => h.actor_kind)).toEqual(['customer', 'system']);
  });

  test('amount mismatches are flagged, not accepted', async () => {
    const { orderId, ref, total } = await onlineOrder('mismatch@example.test');
    expect((await event('evt_mm', 'payment.paid', ref, total - 100))[0].r).toBe('amount_mismatch');
    const [o] = await db.sql<{ status: string }>(`select status from orders where id = $1`, [orderId]);
    expect(o.status).toBe('awaiting_payment');
  });

  test('failed payments can be retried; expiry cancels the order', async () => {
    const { orderId, ref } = await onlineOrder('fail@example.test');
    expect((await event('evt_f', 'payment.failed', ref, null))[0].r).toBe('failed');
    const [o] = await db.sql<{ status: string; payment_status: string }>(`select status, payment_status from orders where id = $1`, [orderId]);
    expect(o).toEqual({ status: 'awaiting_payment', payment_status: 'failed' });

    await db.as('service', `select attach_checkout_session($1, 'cs_retry', 'https://checkout.example/y', now() + interval '30 minutes')`, [orderId]);
    expect((await event('evt_e', 'payment.expired', 'cs_retry', null))[0].r).toBe('expired');
    const [closed] = await db.sql<{ status: string }>(`select status from orders where id = $1`, [orderId]);
    expect(closed.status).toBe('cancelled');
  });

  test('stale awaiting-payment orders expire on schedule', async () => {
    const { orderId } = await onlineOrder('stale@example.test');
    await db.sql(`update orders set created_at = now() - interval '2 hours' where id = $1`, [orderId]);
    const [{ n }] = await db.as<{ n: number }>('service', `select expire_stale_orders() as n`);
    expect(n).toBeGreaterThanOrEqual(1);
    const [o] = await db.sql<{ status: string }>(`select status from orders where id = $1`, [orderId]);
    expect(o.status).toBe('cancelled');
  });

  test('payment after cancellation opens a refund', async () => {
    const { customer, orderId, ref, total } = await onlineOrder('late@example.test');
    await db.as(customer.id, `select update_order_status($1, 'cancelled')`, [orderId]);
    expect((await event('evt_late', 'payment.paid', ref, total))[0].r).toBe('paid_after_close');
    const refunds = await db.as<{ amount_minor: number; status: string }>(customer.id, `select amount_minor, status from refunds where order_id = $1`, [orderId]);
    expect(refunds).toEqual([{ amount_minor: total, status: 'requested' }]);
  });

  test('clients cannot apply payment events or attach sessions', async () => {
    const { customer, orderId, ref, total } = await onlineOrder('forge@example.test');
    const forged = await db.expectError(customer.id, `select apply_payment_event('paymongo', 'x', 'payment.paid', $1, $2, '{}')`, [ref, total]);
    expect(forged.code).toBe('42501');
    const attach = await db.expectError(customer.id, `select attach_checkout_session($1, 'cs_x', 'u', now())`, [orderId]);
    expect(attach.code).toBe('42501');
  });

  test('refund lifecycle respects roles and captured amounts', async () => {
    const { customer, orderId, ref, total } = await onlineOrder('refund@example.test');
    await event('evt_r', 'payment.paid', ref, total);

    expect((await db.expectError(customer.id, `select request_refund($1, 100, 'please')`, [orderId])).code).toBe('42501');
    expect((await db.expectError(world.support, `select request_refund($1, $2, 'too much')`, [orderId, total + 1])).hint).toBe('refund_too_large');
    const [{ id }] = await db.as<{ id: string }>(world.support, `select request_refund($1, 5000, 'Missing drink') as id`, [orderId]);

    expect((await db.expectError(world.support, `select review_refund($1, 'approve')`, [id])).code).toBe('42501');
    await db.as(world.finance, `select review_refund($1, 'approve')`, [id]);
    expect((await db.expectError(world.finance, `select review_refund($1, 'mark_processed', '')`, [id])).hint).toBe('reference_required');
    await db.as(world.finance, `select review_refund($1, 'mark_processed', 'PM-RF-001')`, [id]);

    const [o] = await db.as<{ payment_status: string }>(customer.id, `select payment_status from orders where id = $1`, [orderId]);
    expect(o.payment_status).toBe('partially_refunded');
  });

  test('settlements aggregate completed orders once', async () => {
    const customer = await createCustomer(db, world, 'settle@example.test');
    await db.as(customer.id, `select cart_add_item($1, $2, $3, 2)`, [store.productId, store.regularId, sel(store.options['Iced tea'])]);
    const orderId = await placeOrder(db, customer.id, store.merchantId, customer.addressId);
    for (const s of ['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed']) {
      await db.as(store.owner, `select update_order_status($1, $2)`, [orderId, s]);
    }
    await db.sql(`update orders set completed_at = now() - interval '3 days' where id = $1`, [orderId]);
    const period = await db.sql<{ start: string; end: string }>(
      `select to_char((now() at time zone 'Asia/Manila')::date - 7, 'YYYY-MM-DD') as start, to_char((now() at time zone 'Asia/Manila')::date - 1, 'YYYY-MM-DD') as end`,
    );
    const { start, end } = period[0];

    expect((await db.expectError(store.owner, `select generate_settlement($1, $2, $3)`, [store.merchantId, start, end])).code).toBe('42501');
    const [{ id }] = await db.as<{ id: string }>(world.finance, `select generate_settlement($1, $2, $3) as id`, [store.merchantId, start, end]);
    const [s] = await db.as<Record<string, number>>(store.owner, `select order_count, gross_minor, commission_minor, net_minor from settlements where id = $1`, [id]);
    expect(s).toEqual({ order_count: 1, gross_minor: 24000, commission_minor: 3600, net_minor: 20400 });
    expect((await db.expectError(world.finance, `select generate_settlement($1, $2, $3)`, [store.merchantId, start, end])).hint).toBe('overlap');

    expect((await db.expectError(world.finance, `select update_settlement_status($1, 'paid', 'X')`, [id])).hint).toBe('invalid_transition');
    await db.as(world.finance, `select update_settlement_status($1, 'approved')`, [id]);
    await db.as(world.finance, `select update_settlement_status($1, 'paid', 'BDO-123')`, [id]);
  });
});
