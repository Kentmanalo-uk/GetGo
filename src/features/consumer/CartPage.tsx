import { useState } from 'react';
import { Link } from 'react-router';
import { ShoppingBag } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { ButtonLink, Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, StoreMark } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/errors';
import { useCarts, useClearCart, type CartSummary } from './api';

export default function CartPage() {
  const { status } = useAuth();
  const carts = useCarts();
  const clear = useClearCart();
  const toast = useToast();
  const [removing, setRemoving] = useState<CartSummary | null>(null);

  return (
    <div className="page-x mx-auto max-w-3xl pb-10 lg:max-w-5xl">
      <PageHeader title="Cart" />
      {status === 'signed_out' ? (
        <EmptyState title="Sign in to see your cart" icon={<ShoppingBag className="size-8" />} action={<ButtonLink to="/sign-in?next=/cart">Sign in</ButtonLink>}>
          Your cart is saved to your account so it’s there on any device.
        </EmptyState>
      ) : carts.isPending ? (
        <PageLoading rows={2} />
      ) : carts.isError ? (
        <ErrorState error={carts.error} onRetry={() => carts.refetch()} />
      ) : carts.data.length === 0 ? (
        <EmptyState title="Your cart is empty" icon={<ShoppingBag className="size-8" />} action={<ButtonLink to="/">Find something to order</ButtonLink>} />
      ) : (
        <div className="space-y-6">
          {carts.data.length > 1 && (
            <Notice title={`You have items from ${carts.data.length} stores`}>
              Each store is checked out as a separate order with its own delivery fee, because each store prepares and hands over its order independently.
            </Notice>
          )}
          <ul className="divide-y divide-line border-y border-line lg:grid lg:grid-cols-2 lg:gap-5 lg:divide-y-0 lg:border-0">
            {carts.data.map((cart) => (
              <li key={cart.id} className="flex items-center gap-4 py-4 lg:rounded-sheet lg:bg-surface lg:p-5 lg:shadow-card">
                <StoreMark name={cart.store?.name ?? 'Store'} logoPath={cart.store?.logo_path} size="sm" />
                <div className="min-w-0 flex-1">
                  {cart.store ? (
                    <Link to={`/stores/${cart.store.slug}`} className="block truncate font-semibold hover:underline">
                      {cart.store.name}
                    </Link>
                  ) : (
                    <p className="font-semibold">Store no longer available</p>
                  )}
                  <p className="text-small text-ink-3">
                    {cart.item_count} {cart.item_count === 1 ? 'item' : 'items'}
                    {cart.store && cart.store.state !== 'open' && ` · ${cart.store.state === 'paused' ? 'Paused' : 'Closed now'}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(cart)}>
                    Remove
                  </Button>
                  {cart.store && (
                    <ButtonLink to={`/checkout/${cart.merchant_id}`} size="sm">
                      Review
                    </ButtonLink>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove this cart?"
        body={`All items from ${removing?.store?.name ?? 'this store'} will be removed.`}
        confirmLabel="Remove items"
        loading={clear.isPending}
        error={clear.error ? <Notice tone="danger">{userMessage(clear.error)}</Notice> : null}
        onConfirm={async () => {
          if (!removing) return;
          await clear.mutateAsync(removing.merchant_id);
          toast('Cart removed');
          setRemoving(null);
        }}
      />
    </div>
  );
}
