import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';
import type { ApplicationDocument, DocumentType, PartnerApplication } from '@/types/models';

export const DOCUMENT_TYPES: Array<{ type: DocumentType; label: string; required: boolean; hint: string }> = [
  { type: 'government_id', label: 'Government ID of the owner', required: true, hint: 'Front side, all corners visible.' },
  { type: 'business_permit', label: 'Mayor’s or business permit', required: true, hint: 'Current year.' },
  { type: 'dti_sec_registration', label: 'DTI or SEC registration', required: true, hint: 'Certificate of business name or SEC registration.' },
  { type: 'bir_registration', label: 'BIR certificate of registration', required: false, hint: 'Form 2303, if available.' },
  { type: 'food_safety_permit', label: 'Sanitary or food safety permit', required: false, hint: 'For food businesses, if available.' },
];

export function useMyApplication() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['my-application', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase.from('partner_applications').select('*').eq('applicant_id', userId!).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ) as PartnerApplication | null,
  });
}

export function useStartApplication() {
  const qc = useQueryClient();
  const { userId, profile } = useAuth();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from('partner_applications')
          .insert({ owner_name: profile?.full_name ?? null, owner_phone: profile?.phone ?? null, owner_email: profile?.email ?? null })
          .select()
          .single(),
      ) as PartnerApplication,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-application', userId] }),
  });
}

export type ApplicationPatch = Partial<
  Omit<PartnerApplication, 'id' | 'applicant_id' | 'status' | 'review_notes' | 'submitted_at' | 'reviewed_at' | 'merchant_id' | 'created_at' | 'updated_at'>
>;

export function useSaveApplication(id: string | undefined) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async (patch: ApplicationPatch) => {
      const rows = unwrap(await supabase.from('partner_applications').update(patch).eq('id', id!).select()) as PartnerApplication[];
      if (rows.length === 0) throw new Error('This application can no longer be edited.');
      return rows[0];
    },
    onSuccess: (row) => qc.setQueryData(['my-application', userId], row),
  });
}

export function useApplicationDocuments(applicationId: string | undefined) {
  return useQuery({
    queryKey: ['application-documents', applicationId],
    enabled: Boolean(applicationId),
    queryFn: async () =>
      unwrap(await supabase.from('application_documents').select('*').eq('application_id', applicationId!).order('created_at')) as ApplicationDocument[],
  });
}

const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function useUploadDocument(applicationId: string) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async ({ docType, file }: { docType: DocumentType; file: File }) => {
      if (!DOC_MIME.includes(file.type)) throw new Error('Upload a PDF, JPG, PNG or WebP file.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller.');
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const path = `${userId}/${applicationId}/${docType}-${crypto.randomUUID()}.${ext}`;
      const upload = await supabase.storage.from('partner-documents').upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) throw new Error('Upload failed. Check your connection and try again.');
      const { error } = await supabase.from('application_documents').insert({
        application_id: applicationId,
        doc_type: docType,
        storage_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (error) {
        await supabase.storage.from('partner-documents').remove([path]);
        throw new Error('We couldn’t save this document. Try again.');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application-documents', applicationId] }),
  });
}

export function useDeleteDocument(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doc: ApplicationDocument) => {
      unwrap(await supabase.from('application_documents').delete().eq('id', doc.id));
      await supabase.storage.from('partner-documents').remove([doc.storage_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application-documents', applicationId] }),
  });
}

export async function openDocument(path: string) {
  const { data, error } = await supabase.storage.from('partner-documents').createSignedUrl(path, 120);
  if (error || !data) throw new Error('This document can’t be opened right now.');
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function useMissingItems(applicationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['application-missing', applicationId],
    enabled: Boolean(applicationId) && enabled,
    queryFn: async () => unwrap(await supabase.rpc('application_missing_items', { p_application_id: applicationId })) as string[],
    staleTime: 0,
  });
}

export function useSubmitApplication(applicationId: string | undefined) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('submit_partner_application', { p_application_id: applicationId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-application', userId] }),
  });
}
