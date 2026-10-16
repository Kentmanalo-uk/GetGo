import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Browser client using the public anon key only. Every privileged operation is
 * enforced by RLS and SECURITY DEFINER functions in the database or by Edge
 * Functions holding server-side secrets.
 */
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const env = {
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || null,
  supportPhone: (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) || null,
};
