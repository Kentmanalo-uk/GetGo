import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/domain/money';
import { useReviewRefund, type RefundRow } from './api';

type RefundAction = 'approve' | 'reject' | 'mark_processed';

/** Review controls for one manual GCash refund (finance and admin). */
export function RefundActions({ refund }: { refund: RefundRow }) {
  const review = useReviewRefund();
  const toast = useToast();
  const [action, setAction] = useState<RefundAction | null>(null);
  if (refund.status !== 'requested' && refund.status !== 'approved') return null;
  const amount = formatMoney(refund.amount_minor);
  const code = refund.orders?.code ?? 'this order';

  const copy: Record<RefundAction, { title: string; body: string; confirm: string; tone: 'primary' | 'danger'; done: string }> = {
    approve: {
      title: 'Approve refund?',
      body: `Approve returning ${amount} for ${code}. Next, send it to the customer by GCash and record the GCash reference.`,
      confirm: 'Approve',
      tone: 'primary',
      done: 'Refund approved',
    },
    reject: {
      title: 'Reject refund?',
      body: `The ${amount} refund for ${code} will not be paid.`,
      confirm: 'Reject refund',
      tone: 'danger',
      done: 'Refund rejected',
    },
    mark_processed: {
      title: 'Record refund as sent?',
      body: `Confirm ${amount} has been sent to the customer by GCash for ${code}. They are notified.`,
      confirm: 'Mark processed',
      tone: 'primary',
      done: 'Refund recorded',
    },
  };
  const current = action ? copy[action] : null;

  return (
    <div className="flex flex-wrap gap-2">
      {refund.status === 'requested' ? (
        <Button size="sm" variant="secondary" onClick={() => setAction('approve')}>
          Approve
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAction('mark_processed')}>
          Mark processed
        </Button>
      )}
      <Button size="sm" variant="danger-quiet" onClick={() => setAction('reject')}>
        Reject
      </Button>
      {current && (
        <ConfirmDialog
          open
          onClose={() => {
            setAction(null);
            review.reset();
          }}
          title={current.title}
          body={current.body}
          confirmLabel={current.confirm}
          tone={current.tone}
          reason={action === 'mark_processed' ? { label: 'GCash reference number', placeholder: 'Reference from the GCash receipt', required: true } : undefined}
          loading={review.isPending}
          error={review.error ? <FormError error={review.error} /> : null}
          onConfirm={async (reference) => {
            await review.mutateAsync({ refundId: refund.id, action: action!, reference });
            toast(current.done);
            setAction(null);
          }}
        />
      )}
    </div>
  );
}
