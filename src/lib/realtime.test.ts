import { afterAll, expect, test } from 'vitest';
import { supabase } from './supabase';
import { realtimeChannel } from './realtime';

afterAll(() => supabase.removeAllChannels());

test('each subscription gets its own channel, so listeners can always be added', () => {
  const first = realtimeChannel('notifications:user-1');
  const second = realtimeChannel('notifications:user-1');
  expect(first).not.toBe(second);
  expect(first.topic).not.toBe(second.topic);
  // Adding listeners to a fresh channel never throws, even when another
  // channel for the same user already exists.
  expect(() => second.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {})).not.toThrow();
});
