/** Error shape returned by PostgREST / supabase-js. */
export interface ApiError {
  message: string;
  code?: string;
  hint?: string | null;
  details?: string | null;
}

export class AppError extends Error {
  code?: string;
  hint?: string | null;
  constructor(message: string, code?: string, hint?: string | null) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/** Throws a readable AppError for a failed Supabase call. */
export function raise(error: ApiError): never {
  throw new AppError(userMessage(error), error.code, error.hint);
}

/** Unwraps a supabase-js `{ data, error }` result. */
export function unwrap<T>(result: { data: T | null; error: ApiError | null }): T {
  if (result.error) raise(result.error);
  return result.data as T;
}

export function userMessage(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You appear to be offline. Check your connection and try again.';
  }
  if (error instanceof AppError) return error.message;
  const e = error as ApiError;
  // Business rule violations raised by our database functions carry a
  // customer-facing message.
  if (e.code === 'P0001' && e.message) return e.message;
  if (e.code === '42501') return 'You don’t have permission to do that.';
  if (e.code === '23505') return 'That already exists.';
  if (e.code === 'PGRST116') return 'We couldn’t find what you were looking for.';
  if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
    return 'We couldn’t reach GETGO. Check your connection and try again.';
  }
  if (e.message?.includes('Invalid login credentials')) return 'That email and password don’t match.';
  if (e.message?.includes('Email not confirmed')) return 'Confirm your email first — check your inbox for the link.';
  if (e.message?.includes('User already registered')) return 'An account with this email already exists. Sign in instead.';
  return e.message || 'Something went wrong.';
}

export const errorHint = (error: unknown): string | null | undefined => (error as AppError | null)?.hint;
