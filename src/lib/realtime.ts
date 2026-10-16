import { supabase } from './supabase';

/**
 * Creates a realtime channel that is never shared. supabase-js returns the
 * existing channel when a topic name is reused, and adding listeners to an
 * already-subscribed channel throws — which happens when two components (or
 * React's development double-mount) subscribe to the same topic. A unique
 * suffix gives every subscription its own channel.
 */
export function realtimeChannel(name: string) {
  return supabase.channel(`${name}:${crypto.randomUUID()}`);
}
