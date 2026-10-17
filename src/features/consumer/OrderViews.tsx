import { DataRow } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import type { Order, OrderItem } from '@/types/models';

/** Itemized order lines with their purchased options, as snapshotted at checkout. */
export function OrderItemsList({ items, showPrices = true }: { items: OrderItem[]; showPrices?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-3">
          <span className="tabular w-7 shrink-0 font-semibold">{item.quantity}×</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {item.product_name}
              {item.variant_name && <span className="font-normal text-ink-2"> · {item.variant_name}</span>}
            </p>
            {item.order_item_options.length > 0 && (
              <ul className="text-small text-ink-2">
                {item.order_item_options.map((o) => (
                  <li key={o.id}>
                    <span className="text-ink-3">{o.group_name}:</span> {o.option_name}
                    {o.quantity > 1 && ` ×${o.quantity}`}
                    {showPrices && o.price_delta_minor > 0 && <span className="text-ink-3"> (+{formatMoney(o.price_delta_minor * o.quantity)})</span>}
                  </li>
                ))}
              </ul>
            )}
            {item.instructions && <p className="mt-0.5 text-small font-medium text-warning">Note: {item.instructions}</p>}
          </div>
          {showPrices && <span className="tabular shrink-0">{formatMoney(item.line_total_minor)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function OrderTotals({
  order,
}: {
  order: Pick<Order, 'subtotal_minor' | 'delivery_fee_minor' | 'service_fee_minor' | 'small_order_fee_minor' | 'discount_minor' | 'total_minor'> &
    Partial<Pick<Order, 'service'>>;
}) {
  const service = order.service ?? 'pabili';
  return (
    <dl className="text-small">
      {service === 'pabili' && <DataRow label="Items">{formatMoney(order.subtotal_minor)}</DataRow>}
      {service === 'errand' && order.subtotal_minor > 0 && <DataRow label="Budget">{formatMoney(order.subtotal_minor)}</DataRow>}
      {order.delivery_fee_minor > 0 && <DataRow label="Delivery fee">{formatMoney(order.delivery_fee_minor)}</DataRow>}
      {order.service_fee_minor > 0 && <DataRow label={service === 'padala' ? 'Padala fee' : service === 'errand' ? 'Errand fee' : 'Service fee'}>{formatMoney(order.service_fee_minor)}</DataRow>}
      {order.small_order_fee_minor > 0 && <DataRow label="Small order fee">{formatMoney(order.small_order_fee_minor)}</DataRow>}
      {order.discount_minor > 0 && <DataRow label="Discount">−{formatMoney(order.discount_minor)}</DataRow>}
      <DataRow label="Total" strong className="mt-1 border-t border-line pt-2">
        {formatMoney(order.total_minor)}
      </DataRow>
    </dl>
  );
}
