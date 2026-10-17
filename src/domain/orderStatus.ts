/**
 * Order lifecycle vocabulary shared by every client surface. The database
 * functions enforce transitions and permissions; this module decides which
 * actions to offer and how to describe states.
 *
 *   pending → accepted → payment_submitted → buying → out_for_delivery → completed
 *   (a rider accepts, the customer pays the rider by GCash, the rider confirms,
 *   buys the items at the store and delivers them)
 */

/** pabili: food and shops (the rider buys at a store); padala: send a parcel; errand: a custom task. */
export type Service = 'pabili' | 'padala' | 'errand';

export type OrderStatus = 'pending' | 'accepted' | 'payment_submitted' | 'buying' | 'out_for_delivery' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'submitted' | 'paid' | 'cancelled' | 'refunded';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery', 'completed', 'cancelled'];

/** Mirrors public.order_transition_allowed. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  switch (from) {
    case 'pending':
      return to === 'accepted' || to === 'cancelled';
    case 'accepted':
      return to === 'pending' || to === 'payment_submitted' || to === 'cancelled';
    case 'payment_submitted':
      return to === 'accepted' || to === 'buying' || to === 'cancelled';
    case 'buying':
      return to === 'out_for_delivery' || to === 'cancelled';
    case 'out_for_delivery':
      return to === 'completed' || to === 'cancelled';
    default:
      return false;
  }
}

export const isOpenStatus = (s: OrderStatus) => s !== 'completed' && s !== 'cancelled';

/** Wording for the customer following their own order. */
export function customerStatusLabel(status: OrderStatus, service: Service = 'pabili'): string {
  switch (status) {
    case 'pending':
      return 'Finding a rider';
    case 'accepted':
      return 'Send your GCash payment';
    case 'payment_submitted':
      return 'Rider is checking your payment';
    case 'buying':
      return service === 'padala' ? 'Rider is picking up your parcel' : service === 'errand' ? 'Rider is doing your errand' : 'Rider is buying your order';
    case 'out_for_delivery':
      return 'On the way';
    case 'completed':
      return service === 'errand' ? 'Done' : 'Delivered';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Neutral wording for riders and GETGO staff. */
export function orderStatusLabel(status: OrderStatus, service: Service = 'pabili'): string {
  switch (status) {
    case 'pending':
      return 'Waiting for a rider';
    case 'accepted':
      return 'Waiting for payment';
    case 'payment_submitted':
      return 'Payment to confirm';
    case 'buying':
      return service === 'padala' ? 'Picking up' : service === 'errand' ? 'Doing the errand' : 'Buying at store';
    case 'out_for_delivery':
      return 'Out for delivery';
    case 'completed':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Visual tone for status text: only states that need attention get color. */
export type StatusTone = 'attention' | 'progress' | 'done' | 'muted' | 'danger';

export function statusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case 'pending':
    case 'payment_submitted':
      return 'attention';
    case 'accepted':
    case 'buying':
    case 'out_for_delivery':
      return 'progress';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'danger';
  }
}

export function customerCanCancel(status: OrderStatus): boolean {
  return status === 'pending' || status === 'accepted';
}

export interface RiderAction {
  to: 'out_for_delivery' | 'completed';
  label: string;
}

/** Delivery steps the assigned rider performs after payment is confirmed. */
export function riderNextStep(status: OrderStatus, service: Service = 'pabili'): RiderAction | null {
  if (status === 'buying') {
    const label = service === 'padala' ? 'Picked up — on my way' : service === 'errand' ? 'Errand done — on my way' : 'I have the items — on my way';
    return { to: 'out_for_delivery', label };
  }
  if (status === 'out_for_delivery') return { to: 'completed', label: 'Delivered to customer' };
  return null;
}

/** Progress steps for the customer tracking view. */
export function progressSteps(service: Service = 'pabili'): Array<{ label: string }> {
  return [
    { label: service === 'pabili' ? 'Order placed' : 'Request sent' },
    { label: 'Rider accepted' },
    { label: service === 'padala' ? 'Paid · picking up' : service === 'errand' ? 'Paid · doing errand' : 'Paid · rider buying' },
    { label: 'On the way' },
    { label: service === 'errand' ? 'Done' : 'Delivered' },
  ];
}
export const PROGRESS_STEPS = progressSteps();

/** Index of the last reached step in progressSteps(), or -1 when cancelled. */
export function progressIndex(status: OrderStatus): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'accepted':
    case 'payment_submitted':
      return 1;
    case 'buying':
      return 2;
    case 'out_for_delivery':
      return 3;
    case 'completed':
      return 4;
    case 'cancelled':
      return -1;
  }
}

export function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'pending':
      return 'GCash payment not sent yet';
    case 'submitted':
      return 'GCash payment sent, waiting for rider';
    case 'paid':
      return 'Paid by GCash';
    case 'cancelled':
      return 'No payment';
    case 'refunded':
      return 'Refunded to GCash';
  }
}
