import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChatText, Check, ChevronRight, ListChecks, MapPin, Navigation, Package, Phone, Store } from '@/components/icons';
import { smsLink } from '@/lib/deeplinks';
import { StatusText, timeAgo } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { orderStatusLabel, statusTone } from '@/domain/orderStatus';
import { formatMoney } from '@/domain/money';
import type { OrderStatus, Service } from '@/domain/orderStatus';
import { ERRAND_TYPES, PARCEL_SIZES, type ErrandTask, type OrderWithItems, type PadalaTask } from '@/types/models';
import { itemCount, riderEarning } from './api';

function mapsUrl(parts: Array<string | null | undefined>) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.filter(Boolean).join(', '))}`;
}

/** What to buy: the order's items, choices and notes, optionally tickable. */
export function ShoppingList({ order, checkable }: { order: OrderWithItems; checkable?: boolean }) {
  const storageKey = `getgo.rider.list.${order.id}`;
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const ticked = order.order_items.filter((i) => done.includes(i.id)).length;

  return (
    <div>
      {checkable && (
        <p className="mb-2 text-small text-ink-3">
          <span className="tabular font-semibold text-ink">
            {ticked} of {order.order_items.length}
          </span>{' '}
          picked up
        </p>
      )}
      <ul className="divide-y divide-line">
        {order.order_items.map((item) => {
          const checked = done.includes(item.id);
          const body = (
            <span className={cx('min-w-0 flex-1', checked && 'text-ink-3 line-through')}>
              <span className="font-semibold">
                {item.quantity}× {item.product_name}
                {item.variant_name && <span className="font-normal text-ink-2"> · {item.variant_name}</span>}
              </span>
              {item.order_item_options.length > 0 && (
                <span className="block text-small text-ink-2">
                  {item.order_item_options.map((o) => `${o.option_name}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`).join(', ')}
                </span>
              )}
              {item.instructions && <span className="mt-0.5 block text-small font-medium text-warning">“{item.instructions}”</span>}
            </span>
          );
          return (
            <li key={item.id}>
              {checkable ? (
                <label className="flex cursor-pointer items-start gap-3 py-3">
                  <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => toggle(item.id)} />
                  <span
                    aria-hidden
                    className={cx(
                      'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
                      checked ? 'border-accent-strong bg-accent-strong text-white' : 'border-line-strong bg-surface',
                    )}
                  >
                    {checked && <Check className="size-4" weight="bold" />}
                  </span>
                  {body}
                  <span className="tabular shrink-0 text-small text-ink-3">{formatMoney(item.line_total_minor)}</span>
                </label>
              ) : (
                <div className="flex items-start gap-3 py-3">
                  {body}
                  <span className="tabular shrink-0 text-small text-ink-3">{formatMoney(item.line_total_minor)}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stop({ icon, label, title, children, actions }: { icon: ReactNode; label: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="relative flex gap-3">
      <span className="relative z-10 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">{icon}</span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-micro font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
        <p className="font-semibold">{title}</p>
        {children && <div className="text-small text-ink-2">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const chip = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-small font-semibold hover:bg-canvas';

/**
 * Pickup and drop-off as a two-stop route. The customer's exact address and
 * phone are shown once they've paid; before that, only their barangay. The
 * same applies to a padala sender, who is usually the customer.
 */
export function Route({ order, showCustomer }: { order: OrderWithItems; showCustomer: boolean }) {
  const pickup = order.pickup_address;
  const addr = order.delivery_address;
  const isStore = order.service === 'pabili';
  // A store or errand place is public; a padala sender is private until payment.
  const showPickup = order.service !== 'padala' || showCustomer;
  const pickupLabel = order.service === 'padala' ? 'Pick up from' : order.service === 'errand' ? 'Go to' : 'Buy at';
  const pickupTitle = isStore ? order.merchant_name : showPickup ? (pickup.name ?? '') : `Brgy. ${pickup.barangay}`;
  return (
    <div className="relative space-y-5">
      <span aria-hidden className="absolute top-9 bottom-9 left-[17px] w-0.5 bg-line" />
      <Stop
        icon={order.service === 'padala' ? <Package className="size-4" weight="fill" /> : order.service === 'errand' ? <ListChecks className="size-4" weight="fill" /> : <Store className="size-4" weight="fill" />}
        label={pickupLabel}
        title={pickupTitle}
        actions={
          showPickup && (
            <>
              <a className={chip} href={mapsUrl([isStore ? order.merchant_name : null, pickup.line1, pickup.barangay, pickup.city])} target="_blank" rel="noreferrer">
                <Navigation className="size-4" aria-hidden /> Directions
              </a>
              {pickup.phone && (
                <a className={chip} href={`tel:${pickup.phone}`}>
                  <Phone className="size-4" aria-hidden /> {isStore ? 'Call store' : pickup.phone}
                </a>
              )}
              {pickup.phone && order.service === 'padala' && (
                <a className={chip} href={smsLink(pickup.phone, `Hi, this is your GETGO rider for padala ${order.code}.`)}>
                  <ChatText className="size-4" aria-hidden /> Message
                </a>
              )}
            </>
          )
        }
      >
        {showPickup ? `${pickup.line1}, ${pickup.barangay}, ${pickup.city}` : `${pickup.city} · full address after payment`}
        {showPickup && !isStore && pickup.landmark && <span className="block text-ink-3">Landmark: {pickup.landmark}</span>}
      </Stop>
      <Stop
        icon={<MapPin className="size-4" weight="fill" />}
        label="Deliver to"
        title={showCustomer ? addr.recipient_name : `Brgy. ${addr.barangay}`}
        actions={
          showCustomer && (
            <>
              <a className={chip} href={mapsUrl([addr.line1, addr.barangay, addr.city])} target="_blank" rel="noreferrer">
                <Navigation className="size-4" aria-hidden /> Directions
              </a>
              <a className={chip} href={`tel:${addr.phone}`}>
                <Phone className="size-4" aria-hidden /> {addr.phone}
              </a>
              <a className={chip} href={smsLink(addr.phone, `Hi, this is your GETGO rider for order ${order.code}.`)}>
                <ChatText className="size-4" aria-hidden /> Message
              </a>
            </>
          )
        }
      >
        {showCustomer ? `${addr.line1}, ${addr.barangay}, ${addr.city}` : `${addr.city} · full address after payment`}
        {showCustomer && addr.landmark && <span className="block text-ink-3">Landmark: {addr.landmark}</span>}
      </Stop>
    </div>
  );
}

/** The money for one order from the rider's side. */
export function MoneySplit({ order, className }: { order: OrderWithItems; className?: string }) {
  const middle =
    order.service === 'pabili'
      ? [{ label: 'You pay the store', value: order.subtotal_minor }]
      : order.subtotal_minor > 0
        ? [{ label: 'Budget to spend', value: order.subtotal_minor }]
        : [];
  const cells = [{ label: 'Customer pays you', value: order.total_minor }, ...middle, { label: 'You earn', value: riderEarning(order), strong: true }];
  return (
    <dl className={cx('grid gap-px overflow-hidden rounded-media border border-line bg-line text-center', cells.length === 3 ? 'grid-cols-3' : 'grid-cols-2', className)}>
      {cells.map((m: { label: string; value: number; strong?: boolean }) => (
        <div key={m.label} className="bg-surface px-2 py-3">
          <dt className="text-micro text-ink-3">{m.label}</dt>
          <dd className={cx('tabular mt-0.5 font-bold', m.strong && 'text-accent-ink')}>{formatMoney(m.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What a list card says about the order's size: items, parcel size or errand budget. */
function sizeLine(order: OrderWithItems) {
  if (order.service === 'padala') return `${PARCEL_SIZES[(order.task as PadalaTask).size]?.label ?? ''} parcel`;
  if (order.service === 'errand') {
    const t = order.task as ErrandTask;
    return order.subtotal_minor > 0 ? `Budget ${formatMoney(order.subtotal_minor)}` : (ERRAND_TYPES[t.type]?.label ?? 'Errand');
  }
  const count = itemCount(order);
  return `${count} ${count === 1 ? 'item' : 'items'} · ${formatMoney(order.subtotal_minor)}`;
}

export function ServiceTag({ service }: { service: OrderWithItems['service'] }) {
  if (service === 'pabili') return null;
  return (
    <span className="mr-1.5 inline-flex rounded bg-accent-soft px-1.5 py-0.5 align-middle text-micro font-bold tracking-wide text-accent-ink uppercase">
      {service === 'padala' ? 'Padala' : 'Errand'}
    </span>
  );
}

/** An order in a list: store or request, destination, size and what the rider earns. */
export function OrderCard({ order, to, showStatus }: { order: OrderWithItems; to: string; showStatus?: boolean }) {
  return (
    <Link to={to} className="group block rounded-sheet border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            <ServiceTag service={order.service} />
            {order.merchant_name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-small text-ink-2">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {order.service === 'pabili'
              ? `To Brgy. ${order.delivery_address.barangay}`
              : `Brgy. ${order.pickup_address.barangay} → Brgy. ${order.delivery_address.barangay}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular font-bold text-accent-ink">+{formatMoney(riderEarning(order))}</p>
          <p className="text-micro text-ink-3">you earn</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-small">
        {showStatus ? (
          <StatusText tone={statusTone(order.status)}>{orderStatusLabel(order.status, order.service)}</StatusText>
        ) : (
          <span className="text-ink-3">
            <span className="font-mono text-ink-2">{order.code}</span> · {timeAgo(order.created_at)}
          </span>
        )}
        <span className="flex items-center gap-1 text-ink-3">
          {sizeLine(order)}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

function jobSteps(service: Service) {
  return ['Accepted', 'Paid', service === 'padala' ? 'Pick up' : service === 'errand' ? 'Errand' : 'Buying', 'On the way', service === 'errand' ? 'Done' : 'Delivered'];
}

function jobStepIndex(status: OrderStatus): number {
  switch (status) {
    case 'accepted':
      return 0;
    case 'payment_submitted':
      return 1;
    case 'buying':
      return 2;
    case 'out_for_delivery':
      return 3;
    case 'completed':
      return 4;
    default:
      return -1;
  }
}

/** Where a job is, from accepting it to handing it over. */
export function JobProgress({ status, service = 'pabili', className }: { status: OrderStatus; service?: Service; className?: string }) {
  const current = jobStepIndex(status);
  return (
    <ol className={cx('grid grid-cols-5 gap-1.5', className)} aria-label="Delivery progress">
      {jobSteps(service).map((label, i) => {
        const reached = i <= current;
        return (
          <li key={label} className="min-w-0" aria-current={i === current ? 'step' : undefined}>
            <span className={cx('block h-1.5 rounded-full', reached ? 'bg-accent-strong' : 'bg-line')} />
            <span className={cx('mt-1.5 block truncate text-micro', i === current ? 'font-semibold text-ink' : reached ? 'text-ink-2' : 'text-ink-4')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function StatCard({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-sheet border border-line bg-surface p-4', className)}>
      <p className="text-small text-ink-3">{label}</p>
      <p className="tabular mt-1 text-title leading-tight font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-micro text-ink-3">{hint}</p>}
    </div>
  );
}
