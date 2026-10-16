import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { realtimeChannel } from '@/lib/realtime';
import { unwrap } from '@/lib/errors';
import type { AppRole, MemberRole, MerchantCategory, Profile } from '@/types/models';

export interface Membership {
  merchant_id: string;
  role: MemberRole;
  merchant: { id: string; name: string; slug: string; status: string; is_published: boolean; category: MerchantCategory; logo_path: string | null };
}

interface AuthContextValue {
  status: 'loading' | 'signed_out' | 'signed_in';
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  roles: AppRole[];
  memberships: Membership[];
  isStaff: boolean;
  hasRole: (role: AppRole) => boolean;
  refreshIdentity: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadIdentity(userId: string) {
  const [profile, roles, memberships] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, email_verified_at').eq('id', userId).single().then(unwrap),
    supabase.from('user_roles').select('role').eq('user_id', userId).then(unwrap),
    supabase
      .from('merchant_members')
      .select('merchant_id, role, merchant:merchants(id, name, slug, status, is_published, category, logo_path)')
      .eq('user_id', userId)
      .then(unwrap),
  ]);
  return {
    profile: profile as Profile,
    roles: (roles as Array<{ role: AppRole }>).map((r) => r.role),
    memberships: (memberships as unknown as Membership[]).filter((m) => m.merchant),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const lastUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      lastUser.current = data.session?.user.id ?? null;
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      const nextUser = next?.user.id ?? null;
      // Never let one account's cached private data be shown to another.
      if (lastUser.current !== undefined && lastUser.current !== nextUser) queryClient.clear();
      lastUser.current = nextUser;
      setSession(next);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id ?? null;
  // One live subscription to the user's notifications for the whole app;
  // components read them through useNotifications().
  useEffect(() => {
    if (!userId) return;
    const channel = realtimeChannel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () =>
        queryClient.invalidateQueries({ queryKey: ['notifications', userId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const identity = useQuery({
    queryKey: ['identity', userId],
    queryFn: () => loadIdentity(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const value = useMemo<AuthContextValue>(() => {
    const roles = identity.data?.roles ?? [];
    const loading = !ready || (Boolean(userId) && identity.isPending && !identity.isError);
    return {
      status: loading ? 'loading' : userId ? 'signed_in' : 'signed_out',
      session,
      userId,
      profile: identity.data?.profile ?? null,
      roles,
      memberships: identity.data?.memberships ?? [],
      isStaff: roles.some((r) => r === 'admin' || r === 'support' || r === 'finance'),
      hasRole: (role) => roles.includes(role),
      refreshIdentity: () => identity.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
      },
    };
  }, [ready, session, userId, identity, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
