import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { env, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

/**
 * Version (effective date) of the current legal documents. Bump it when the
 * Terms, Privacy Policy, Rider Terms or Store Listing Terms change in a way
 * people should accept again.
 */
export const LEGAL_VERSION = '2026-10-17';
export const LEGAL_EFFECTIVE = 'October 17, 2026';

export type LegalDocument = 'terms' | 'privacy' | 'rider_terms' | 'store_terms';

/** Sign-up metadata recorded by the database when the profile is created. */
export const legalMetadata = (documents: LegalDocument[]) => ({ legal: { version: LEGAL_VERSION, documents } });

export interface LegalSettings {
  legal_name: string | null;
  business_address: string | null;
  business_registration: string | null;
  dpo_name: string | null;
  dpo_email: string | null;
  support_email: string | null;
  support_phone: string | null;
}

/** Operator and privacy contact details, set by admins in Settings. */
export function useLegalSettings() {
  return useQuery({
    queryKey: ['legal-settings'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('platform_settings')
          .select('legal_name, business_address, business_registration, dpo_name, dpo_email, support_email, support_phone')
          .eq('id', true)
          .maybeSingle(),
      ) as LegalSettings | null,
    staleTime: 10 * 60_000,
  });
}

/** How the legal pages refer to the operator and where people reach it. */
export function operatorDetails(s: LegalSettings | null | undefined) {
  const supportEmail = s?.support_email || env.supportEmail;
  const supportPhone = s?.support_phone || env.supportPhone;
  return {
    name: s?.legal_name || 'the operator of GETGO',
    shortName: s?.legal_name || 'GETGO',
    address: s?.business_address || null,
    registration: s?.business_registration || null,
    dpoName: s?.dpo_name || null,
    privacyEmail: s?.dpo_email || supportEmail || null,
    supportEmail: supportEmail || null,
    supportPhone: supportPhone || null,
  };
}

/** Which documents the signed-in person has accepted at the current version. */
export function useMyAcceptances() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['legal-acceptances', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      (unwrap(await supabase.from('legal_acceptances').select('document, version').eq('user_id', userId!).eq('version', LEGAL_VERSION)) as Array<{
        document: LegalDocument;
      }>).map((r) => r.document),
  });
}

export function useAcceptLegal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documents: LegalDocument[]) => unwrap(await supabase.rpc('accept_legal', { p_documents: documents, p_version: LEGAL_VERSION })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['legal-acceptances'] }),
  });
}

/** Downloads everything GETGO holds about the signed-in person as a JSON file. */
export function useExportMyData() {
  return useMutation({
    mutationFn: async () => {
      const data = unwrap(await supabase.rpc('export_my_data'));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `getgo-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}

export function useRequestAccountDeletion() {
  return useMutation({
    mutationFn: async (reason: string) => unwrap(await supabase.rpc('request_account_deletion', { p_reason: reason.trim() || null })) as string,
  });
}
