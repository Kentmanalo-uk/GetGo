import { QueryClient } from '@tanstack/react-query';
import { AppError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Permission and business-rule errors will not succeed on retry.
        const code = (error as AppError)?.code;
        if (code === '42501' || code === 'P0001' || code === 'PGRST116') return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Stable idempotency key for one checkout attempt. */
export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}
