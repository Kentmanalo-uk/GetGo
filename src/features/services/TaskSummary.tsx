import { DataRow } from '@/components/ui/Display';
import { formatMoney } from '@/domain/money';
import { ERRAND_TYPES, PARCEL_SIZES, type ErrandTask, type Order, type PadalaTask } from '@/types/models';

export const isServiceOrder = (o: Pick<Order, 'service'>) => o.service === 'padala' || o.service === 'errand';

/**
 * What a padala or errand involves: the parcel, or the task and its budget.
 * Shown where food and shop orders list their items.
 */
export function TaskSummary({ order }: { order: Pick<Order, 'service' | 'task' | 'subtotal_minor' | 'spent_minor'> }) {
  if (order.service === 'padala' && order.task) {
    const t = order.task as PadalaTask;
    return (
      <dl className="divide-y divide-line">
        <div className="py-3">
          <dt className="text-small text-ink-3">Sending</dt>
          <dd className="font-semibold">{t.item}</dd>
        </div>
        <div className="py-3">
          <dt className="text-small text-ink-3">Size</dt>
          <dd>
            <span className="font-semibold">{PARCEL_SIZES[t.size]?.label ?? t.size}</span>
            <span className="text-ink-3"> · {PARCEL_SIZES[t.size]?.hint}</span>
          </dd>
        </div>
      </dl>
    );
  }
  if (order.service === 'errand' && order.task) {
    const t = order.task as ErrandTask;
    const spent = order.spent_minor;
    return (
      <div className="divide-y divide-line">
        <div className="py-3">
          <p className="text-small text-ink-3">{ERRAND_TYPES[t.type]?.label ?? 'Errand'}</p>
          <p className="font-medium whitespace-pre-line">{t.description}</p>
        </div>
        {/* The budget itself is listed with the totals; this adds what was spent once the rider records it. */}
        {order.subtotal_minor > 0 && spent != null && (
          <dl className="py-2 text-small">
            <DataRow label="Spent (with receipt)">{formatMoney(spent)}</DataRow>
            <DataRow label="Change returned in cash" strong>
              {formatMoney(order.subtotal_minor - spent)}
            </DataRow>
          </dl>
        )}
      </div>
    );
  }
  return null;
}
