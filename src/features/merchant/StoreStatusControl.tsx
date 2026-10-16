import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/errors';
import type { Merchant } from '@/types/models';
import { useSetPaused, useStoreState } from './api';

const PAUSE_OPTIONS = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: 'Until I reopen', minutes: null },
];

/** Temporary closure (sold out for the day, holiday) usable by every team member. */
export function StoreStatusControl({ merchant }: { merchant: Merchant }) {
  const state = useStoreState(merchant.id);
  const pause = useSetPaused(merchant.id);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const paused = state.data === 'paused';

  const headline = !merchant.is_published
    ? 'Not published'
    : state.data === 'open'
      ? 'Open — customers can order'
      : paused
        ? merchant.paused_until
          ? `Temporarily closed until ${new Date(merchant.paused_until).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}`
          : 'Temporarily closed until you reopen'
        : 'Closed — outside opening hours';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{state.isPending ? 'Checking status…' : headline}</p>
        {state.data === 'closed' && merchant.is_published && <p className="text-small text-ink-3">Customers can browse but not order until you open. Change hours in Store settings.</p>}
      </div>
      {merchant.is_published && state.data !== 'closed' && (
        paused ? (
          <Button
            variant="dark"
            size="sm"
            loading={pause.isPending}
            onClick={() => pause.mutateAsync({ paused: false, until: null }).then(() => toast('Store reopened'), () => undefined)}
          >
            Reopen store
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Close temporarily
          </Button>
        )
      )}
      {pause.error && !open && <Notice tone="danger">{userMessage(pause.error)}</Notice>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Close temporarily" size="sm">
        <p className="mb-4 text-ink-2">Customers can still see your products but can’t order until you reopen. Riders already buying an order may still come by.</p>
        <div className="grid grid-cols-2 gap-2">
          {PAUSE_OPTIONS.map((o) => (
            <Button
              key={o.label}
              variant="secondary"
              size="lg"
              disabled={pause.isPending}
              onClick={async () => {
                try {
                  await pause.mutateAsync({ paused: true, until: o.minutes ? new Date(Date.now() + o.minutes * 60_000).toISOString() : null });
                  setOpen(false);
                  toast('Store temporarily closed');
                } catch {
                  /* shown below */
                }
              }}
            >
              {o.label}
            </Button>
          ))}
        </div>
        {pause.error && (
          <Notice tone="danger" className="mt-4">
            {userMessage(pause.error)}
          </Notice>
        )}
      </Sheet>
    </div>
  );
}
