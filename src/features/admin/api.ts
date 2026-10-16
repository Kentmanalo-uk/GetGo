import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AppError, unwrap } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';
import { ORDER_SELECT } from '@/features/consumer/api';
import type { Ticket, TicketStatus } from '@/features/support/SupportPages';
import type {
  AppRole,
  ApplicationDocument,
  ApplicationStatus,
  DeliveryAddressSnapshot,
  MemberRole,
  MerchantCategory,
  OrderItem,
  Profile,
  ServiceArea,
} from '@/types/models';

export const PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Admin-local row types. Defined here (not imported from shared models) so the
// admin surface states exactly which columns it relies on.
// ---------------------------------------------------------------------------

/** Rider-bought ("pabili") delivery lifecycle with manual GCash payment. */
export type OrderStatus = 'pending' | 'accepted' | 'payment_submitted' | 'buying' | 'out_for_delivery' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'submitted' | 'paid' | 'cancelled' | 'refunded';

export const ORDER_STATUS_LIST: OrderStatus[] = ['pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery', 'completed', 'cancelled'];
export const isFinalStatus = (s: OrderStatus) => s === 'completed' || s === 'cancelled';

export interface AdminOrder {
  id: string;
  code: string;
  customer_id: string;
  merchant_id: string;
  merchant_name: string;
  service_area_id: string;
  pickup_address: { line1: string; barangay: string; city: string; phone: string | null } | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string;
  customer_phone: string;
  delivery_address: DeliveryAddressSnapshot | null;
  notes: string | null;
  subtotal_minor: number;
  delivery_fee_minor: number;
  service_fee_minor: number;
  small_order_fee_minor: number;
  discount_minor: number;
  total_minor: number;
  cancel_reason: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
}

export interface StatusHistoryRow {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_kind: 'customer' | 'merchant' | 'rider' | 'admin' | 'system';
  note: string | null;
  created_at: string;
}

export type MerchantStatus = 'active' | 'suspended' | 'closed';

export interface AdminMerchant {
  id: string;
  slug: string;
  name: string;
  category: MerchantCategory;
  description: string | null;
  phone: string | null;
  address_line: string;
  barangay: string;
  city: string;
  service_area_id: string;
  logo_path: string | null;
  cover_path: string | null;
  status: MerchantStatus;
  is_published: boolean;
  accepting_orders?: boolean;
  paused_until?: string | null;
  min_order_minor?: number;
  application_id: string | null;
  /** Owner email for an admin-created store whose owner hasn't signed up yet. */
  pending_owner_email?: string | null;
  created_at: string;
}

export interface AdminApplication {
  id: string;
  applicant_id: string;
  status: ApplicationStatus;
  business_name: string | null;
  category: MerchantCategory | null;
  description: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  business_phone: string | null;
  address_line: string | null;
  barangay: string | null;
  city: string | null;
  service_area_id: string | null;
  hours: Array<{ weekday: number; opens: string; closes: string }>;
  logo_path: string | null;
  cover_path: string | null;
  menu_items: Array<{ name: string; description?: string; price_minor: number; category?: string }>;
  review_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  merchant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromotionRecord {
  id: string;
  code: string;
  title: string;
  description: string | null;
  merchant_id: string | null;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  max_discount_minor: number | null;
  min_subtotal_minor: number;
  starts_at: string;
  ends_at: string | null;
  usage_limit: number | null;
  per_user_limit: number;
  is_active: boolean;
  is_public: boolean;
}

export interface AdminPlatformSettings {
  partner_fee_note: string | null;
  support_email: string | null;
  support_phone: string | null;
}

// ---------------------------------------------------------------------------
// Permissions (UI only — the database enforces the same rules)
// ---------------------------------------------------------------------------
export function usePermissions() {
  const { hasRole, userId } = useAuth();
  const isAdmin = hasRole('admin');
  const isSupport = hasRole('support');
  const isFinance = hasRole('finance');
  return {
    userId,
    isAdmin,
    isSupport,
    isFinance,
    /** View applications, mark under review, request changes. */
    canReviewApplications: isAdmin || isSupport,
    /** Approve or reject partners. */
    canDecideApplications: isAdmin,
    /** Cancel orders, assign riders. */
    canOperateOrders: isAdmin || isSupport,
    /** Payment records and refund review. */
    canHandleMoney: isAdmin || isFinance,
    /** Support tickets. */
    canHandleTickets: isAdmin || isSupport,
    /** Areas, promotions, roles, riders, store status, platform settings, audit log. */
    canConfigure: isAdmin,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Paged list with "Load more", backed by PostgREST `.range()`. */
function usePaged<T>(
  queryKey: unknown[],
  fetchPage: (from: number, to: number) => Promise<T[]>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    enabled: options.enabled ?? true,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(pageParam * PAGE_SIZE, pageParam * PAGE_SIZE + PAGE_SIZE - 1),
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length : undefined),
    refetchInterval: options.refetchInterval,
  });
  return { query, items: query.data?.pages.flat() ?? [] };
}

export type PagedResult<T> = ReturnType<typeof usePaged<T>>;

/** Strips characters that would break a PostgREST filter expression. */
export function cleanSearch(term: string): string {
  return term.replace(/[%,()*\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Basis points (1000 = 10%) to an editable percent string ("10" or "12.5"). */
export function bpsToPercentInput(bps: number | null | undefined): string {
  if (bps == null) return '';
  return String(Number((bps / 100).toFixed(2)));
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: unknown[][]) => {
    for (const queryKey of keys) qc.invalidateQueries({ queryKey });
  };
}

export interface AdminProfile extends Profile {
  created_at: string;
}

export function personLabel(p: Pick<Profile, 'full_name' | 'email'> | null | undefined, fallback = 'Unknown'): string {
  return p?.full_name?.trim() || p?.email || fallback;
}

/** Looks up profiles for a set of user ids (staff can read all profiles). */
export function useProfiles(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  return useQuery({
    queryKey: ['admin', 'profiles', unique],
    enabled: unique.length > 0,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from('profiles').select('id, email, full_name, phone, created_at').in('id', unique),
      ) as AdminProfile[];
      return Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, AdminProfile>;
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export interface AdminOverview {
  applications_waiting: number;
  orders_today: number;
  orders_open: number;
  orders_waiting_for_rider: number;
  payments_to_confirm: number;
  gmv_today_minor: number;
  active_merchants: number;
  open_tickets: number;
  refunds_waiting: number;
  riders_pending: number;
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => unwrap(await supabase.rpc('admin_overview')) as AdminOverview,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Service areas and platform settings
// ---------------------------------------------------------------------------
export function useAllServiceAreas() {
  return useQuery({
    queryKey: ['admin', 'areas'],
    queryFn: async () => unwrap(await supabase.from('service_areas').select('*').order('name')) as ServiceArea[],
    staleTime: 5 * 60_000,
  });
}

export type ServiceAreaInput = Omit<ServiceArea, 'id'>;

export function useSaveServiceArea() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...input }: ServiceAreaInput & { id?: string }) => {
      const result = id ? await supabase.from('service_areas').update(input).eq('id', id) : await supabase.from('service_areas').insert(input);
      if (result.error?.code === '23505') throw new AppError('Another area already uses this name.', '23505');
      return unwrap(result);
    },
    onSuccess: () => invalidate(['admin', 'areas'], ['service-areas']),
  });
}

export function useDeleteServiceArea() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await supabase.from('service_areas').delete().eq('id', id);
      if (result.error?.code === '23503') {
        throw new AppError('Stores, riders, addresses or orders use this area, so it can’t be deleted. Turn it off instead.', '23503');
      }
      return unwrap(result);
    },
    onSuccess: () => invalidate(['admin', 'areas'], ['service-areas']),
  });
}

export function usePlatformSettings() {
  return useQuery({
    queryKey: ['admin', 'platform-settings'],
    queryFn: async () =>
      unwrap(
        await supabase.from('platform_settings').select('partner_fee_note, support_email, support_phone, updated_at').eq('id', true).maybeSingle(),
      ) as (AdminPlatformSettings & { updated_at: string }) | null,
  });
}

export function useSavePlatformSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: AdminPlatformSettings) =>
      unwrap(await supabase.from('platform_settings').update(input).eq('id', true).select('id').single()),
    onSuccess: () => invalidate(['admin', 'platform-settings'], ['platform-settings']),
  });
}

// ---------------------------------------------------------------------------
// Partner applications
// ---------------------------------------------------------------------------
export type ApplicationTab = 'waiting' | 'needs_changes' | 'approved' | 'rejected' | 'draft';

export const APPLICATION_TAB_STATUSES: Record<ApplicationTab, ApplicationStatus[]> = {
  waiting: ['submitted', 'under_review'],
  needs_changes: ['needs_changes'],
  approved: ['approved'],
  rejected: ['rejected'],
  draft: ['draft'],
};

export type ApplicationListRow = Pick<
  AdminApplication,
  'id' | 'status' | 'business_name' | 'category' | 'owner_name' | 'city' | 'submitted_at' | 'updated_at' | 'reviewed_at' | 'service_area_id'
> & { service_areas: { name: string } | null };

export function useApplications(tab: ApplicationTab, enabled: boolean) {
  return usePaged<ApplicationListRow>(
    ['admin', 'applications', tab],
    async (from, to) => {
      let q = supabase
        .from('partner_applications')
        .select('id, status, business_name, category, owner_name, city, submitted_at, updated_at, reviewed_at, service_area_id, service_areas(name)')
        .in('status', APPLICATION_TAB_STATUSES[tab]);
      q = tab === 'waiting' ? q.order('submitted_at', { ascending: true }) : q.order('updated_at', { ascending: false });
      return unwrap(await q.range(from, to)) as unknown as ApplicationListRow[];
    },
    { enabled },
  );
}

export function useApplicationCounts(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'applications', 'counts'],
    enabled,
    queryFn: async () => {
      const tabs = Object.keys(APPLICATION_TAB_STATUSES) as ApplicationTab[];
      const counts = await Promise.all(
        tabs.map(async (tab) => {
          const { count, error } = await supabase
            .from('partner_applications')
            .select('id', { count: 'exact', head: true })
            .in('status', APPLICATION_TAB_STATUSES[tab]);
          if (error) throw new AppError(error.message, error.code);
          return [tab, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(counts) as Record<ApplicationTab, number>;
    },
  });
}

export function useApplication(applicationId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'application', applicationId],
    enabled: Boolean(applicationId),
    queryFn: async () => {
      const [application, documents, missing] = await Promise.all([
        supabase.from('partner_applications').select('*, service_areas(name, city, is_active)').eq('id', applicationId!).maybeSingle().then(unwrap),
        supabase.from('application_documents').select('*').eq('application_id', applicationId!).order('created_at').then(unwrap),
        supabase.rpc('application_missing_items', { p_application_id: applicationId }).then(unwrap),
      ]);
      return {
        application: application as (AdminApplication & { service_areas: { name: string; city: string; is_active: boolean } | null }) | null,
        documents: documents as ApplicationDocument[],
        missing: (missing as string[] | null) ?? [],
      };
    },
  });
}

export function useReviewApplication() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { applicationId: string; decision: ApplicationStatus; notes?: string }) =>
      unwrap(
        await supabase.rpc('review_partner_application', {
          p_application_id: input.applicationId,
          p_decision: input.decision,
          p_notes: input.notes?.trim() || null,
        }),
      ) as string | null,
    onSuccess: (_d, input) =>
      invalidate(['admin', 'application', input.applicationId], ['admin', 'applications'], ['admin', 'overview'], ['admin', 'merchants']),
  });
}

/** Opens a short-lived signed link to a private verification document. */
export async function openDocument(path: string) {
  // Open the tab synchronously so popup blockers allow it, then point it at
  // the signed URL once we have one.
  const win = window.open('', '_blank');
  try {
    const { data, error } = await supabase.storage.from('partner-documents').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'We couldn’t open this document.');
    if (win) {
      win.opener = null;
      win.location.href = data.signedUrl;
    } else {
      window.location.assign(data.signedUrl);
    }
  } catch (e) {
    win?.close();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------
export type MerchantTab = 'all' | MerchantStatus;

export type MerchantListRow = Pick<
  AdminMerchant,
  'id' | 'slug' | 'name' | 'category' | 'status' | 'is_published' | 'created_at' | 'logo_path' | 'service_area_id'
> & { service_areas: { name: string } | null };

export function useMerchants(tab: MerchantTab, search: string) {
  const term = cleanSearch(search);
  return usePaged<MerchantListRow>(['admin', 'merchants', tab, term], async (from, to) => {
    let q = supabase.from('merchants').select('id, slug, name, category, status, is_published, created_at, logo_path, service_area_id, service_areas(name)');
    if (tab !== 'all') q = q.eq('status', tab);
    if (term) q = q.or(`name.ilike.%${term}%,slug.ilike.%${term.replace(/\s+/g, '-')}%`);
    return unwrap(await q.order('name').range(from, to)) as unknown as MerchantListRow[];
  });
}

/** Lightweight list for pickers (promotion scope). */
export function useMerchantOptions() {
  return useQuery({
    queryKey: ['admin', 'merchants', 'options'],
    queryFn: async () =>
      unwrap(await supabase.from('merchants').select('id, name, status').order('name').limit(1000)) as Array<{
        id: string;
        name: string;
        status: MerchantStatus;
      }>,
    staleTime: 5 * 60_000,
  });
}

export interface MerchantMember {
  user_id: string;
  role: MemberRole;
  created_at: string;
  profile: AdminProfile | null;
}

export function useMerchant(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'merchant', merchantId],
    enabled: Boolean(merchantId),
    queryFn: async () => {
      const [merchant, members, hours] = await Promise.all([
        supabase.from('merchants').select('*, service_areas(name, city)').eq('id', merchantId!).maybeSingle().then(unwrap),
        supabase.from('merchant_members').select('user_id, role, created_at').eq('merchant_id', merchantId!).then(unwrap),
        supabase.from('store_hours').select('weekday, opens_at, closes_at').eq('merchant_id', merchantId!).then(unwrap),
      ]);
      const memberRows = members as Array<Omit<MerchantMember, 'profile'>>;
      const profiles = memberRows.length
        ? (unwrap(
            await supabase
              .from('profiles')
              .select('id, email, full_name, phone, created_at')
              .in(
                'id',
                memberRows.map((m) => m.user_id),
              ),
          ) as AdminProfile[])
        : [];
      const rank: Record<MemberRole, number> = { owner: 0, manager: 1, staff: 2 };
      return {
        merchant: merchant as (AdminMerchant & { service_areas: { name: string; city: string } | null }) | null,
        members: memberRows
          .map((m) => ({ ...m, profile: profiles.find((p) => p.id === m.user_id) ?? null }))
          .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9)),
        hours: hours as Array<{ weekday: number; opens_at: string; closes_at: string }>,
      };
    },
  });
}

export function useMerchantRecentOrders(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'merchant', merchantId, 'orders'],
    enabled: Boolean(merchantId),
    queryFn: async () =>
      unwrap(
        await supabase.from('orders').select(ORDER_LIST_SELECT).eq('merchant_id', merchantId!).order('created_at', { ascending: false }).limit(10),
      ) as unknown as OrderListRow[],
  });
}

export interface CreateStoreInput {
  ownerEmail: string;
  store: {
    name: string;
    category: MerchantCategory;
    description: string;
    phone: string;
    address_line: string;
    barangay: string;
    city: string;
    service_area_id: string;
    hours: Array<{ weekday: number; opens: string; closes: string }>;
  };
}

/** Creates a store for an owner email (linked now, or when that email signs up). */
export function useCreateStore() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: CreateStoreInput) =>
      unwrap(await supabase.rpc('admin_create_store', { p_owner_email: input.ownerEmail, p_store: input.store })) as {
        merchant_id: string;
        owner_linked: boolean;
        slug: string;
      },
    onSuccess: () => invalidate(['admin', 'merchants'], ['admin', 'overview']),
  });
}

export function useSetMerchantStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { merchantId: string; status: MerchantStatus; reason: string }) =>
      unwrap(await supabase.rpc('set_merchant_status', { p_merchant_id: input.merchantId, p_status: input.status, p_reason: input.reason })),
    onSuccess: (_d, input) => invalidate(['admin', 'merchant', input.merchantId], ['admin', 'merchants'], ['admin', 'overview']),
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export type AssignmentStatus = 'active' | 'completed' | 'released';

export const ORDER_LIST_SELECT =
  'id, code, status, payment_status, merchant_id, merchant_name, customer_name, total_minor, service_area_id, created_at, ' +
  'assignments(rider_id, status, rider_profiles(full_name))';

export type OrderListRow = Pick<
  AdminOrder,
  'id' | 'code' | 'status' | 'payment_status' | 'merchant_id' | 'merchant_name' | 'customer_name' | 'total_minor' | 'service_area_id' | 'created_at'
> & { assignments: Array<{ rider_id: string; status: AssignmentStatus; rider_profiles: { full_name: string } | null }> };

export const activeRiderName = (o: OrderListRow) => o.assignments?.find((a) => a.status === 'active')?.rider_profiles?.full_name ?? null;

export type OrderTab = 'active' | 'needs_rider' | 'awaiting_payment' | 'confirm_payment' | 'delivering' | 'completed' | 'cancelled' | 'all';

export const ORDER_TAB_STATUSES: Record<Exclude<OrderTab, 'all'>, OrderStatus[]> = {
  active: ['pending', 'accepted', 'payment_submitted', 'buying', 'out_for_delivery'],
  needs_rider: ['pending'],
  awaiting_payment: ['accepted'],
  confirm_payment: ['payment_submitted'],
  delivering: ['buying', 'out_for_delivery'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export function useAdminOrders(tab: OrderTab, search: string, options: { oldestFirst?: boolean } = {}) {
  const term = cleanSearch(search).toUpperCase();
  return usePaged<OrderListRow>(
    ['admin', 'orders', 'list', tab, term, Boolean(options.oldestFirst)],
    async (from, to) => {
      let q = supabase.from('orders').select(ORDER_LIST_SELECT);
      if (tab !== 'all') q = q.in('status', ORDER_TAB_STATUSES[tab]);
      if (term) q = q.ilike('code', `%${term}%`);
      return unwrap(await q.order('created_at', { ascending: Boolean(options.oldestFirst) }).range(from, to)) as unknown as OrderListRow[];
    },
    { refetchInterval: 30_000 },
  );
}

export interface PaymentRow {
  id: string;
  provider: string;
  status: PaymentStatus;
  amount_minor: number;
  refunded_minor: number;
  /** The rider account the customer was told to pay. */
  payee_name: string | null;
  payee_number: string | null;
  gcash_reference: string | null;
  sender_name: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  rejection_note: string | null;
  created_at: string;
}

export type RefundStatus = 'requested' | 'approved' | 'processed' | 'rejected';

export interface RefundRow {
  id: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  reason: string;
  status: RefundStatus;
  reference: string | null;
  requested_by: string | null;
  reviewed_by: string | null;
  processed_at: string | null;
  created_at: string;
  orders?: { code: string; merchant_name: string; customer_name: string } | null;
}

export interface AssignmentRow {
  id: string;
  rider_id: string;
  status: AssignmentStatus;
  assigned_by: string | null;
  created_at: string;
  completed_at: string | null;
  rider_profiles: { full_name: string; phone: string; vehicle_type: VehicleType; gcash_name: string | null; gcash_number: string | null } | null;
}

export function useAdminOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'order', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const [order, history, refunds, assignments, payments] = await Promise.all([
        supabase.from('orders').select(ORDER_SELECT).eq('id', orderId!).maybeSingle().then(unwrap),
        supabase.from('order_status_history').select('*').eq('order_id', orderId!).order('created_at').then(unwrap),
        supabase.from('refunds').select('*').eq('order_id', orderId!).order('created_at').then(unwrap),
        supabase
          .from('assignments')
          .select('id, rider_id, status, assigned_by, created_at, completed_at, rider_profiles(full_name, phone, vehicle_type, gcash_name, gcash_number)')
          .eq('order_id', orderId!)
          .order('created_at', { ascending: false })
          .then(unwrap),
        // RLS limits payment rows to the roles allowed to see them.
        supabase.from('payments').select('*').eq('order_id', orderId!).order('created_at').then(unwrap),
      ]);
      return {
        order: order as unknown as AdminOrder | null,
        history: history as StatusHistoryRow[],
        refunds: refunds as RefundRow[],
        assignments: assignments as unknown as AssignmentRow[],
        payments: payments as PaymentRow[],
      };
    },
  });
}

export function useAssignRider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { orderId: string; riderId: string }) =>
      unwrap(await supabase.rpc('assign_rider', { p_order_id: input.orderId, p_rider_id: input.riderId })),
    onSuccess: (_d, input) => invalidate(['admin', 'order', input.orderId], ['admin', 'orders'], ['admin', 'overview'], ['admin', 'riders']),
  });
}

/** Staff cancellation (the only status change staff make; a reason is required). */
export function useCancelOrder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { orderId: string; reason: string }) =>
      unwrap(await supabase.rpc('update_order_status', { p_order_id: input.orderId, p_status: 'cancelled', p_note: input.reason.trim() })),
    onSuccess: (_d, input) =>
      invalidate(['admin', 'order', input.orderId], ['admin', 'orders'], ['admin', 'overview'], ['admin', 'refunds'], ['order', input.orderId]),
  });
}

export function useRequestRefund() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { orderId: string; amountMinor: number; reason: string }) =>
      unwrap(await supabase.rpc('request_refund', { p_order_id: input.orderId, p_amount_minor: input.amountMinor, p_reason: input.reason })),
    onSuccess: (_d, input) => invalidate(['admin', 'order', input.orderId], ['admin', 'refunds'], ['admin', 'overview']),
  });
}

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------
export type VehicleType = 'motorcycle' | 'bicycle' | 'car';
export type RiderStatus = 'pending' | 'active' | 'suspended';

export const VEHICLE_LABELS: Record<VehicleType, string> = { motorcycle: 'Motorcycle', bicycle: 'Bicycle', car: 'Car' };

export interface RiderRow {
  user_id: string;
  full_name: string;
  phone: string;
  vehicle_type: VehicleType;
  plate_number: string | null;
  service_area_id: string;
  gcash_name: string;
  gcash_number: string;
  status: RiderStatus;
  created_at: string;
  service_areas: { name: string } | null;
  profiles: { email: string | null } | null;
}

export function useRiders(status: RiderStatus | 'all') {
  return usePaged<RiderRow>(['admin', 'riders', 'list', status], async (from, to) => {
    let q = supabase.from('rider_profiles').select('*, service_areas(name), profiles(email)');
    if (status !== 'all') q = q.eq('status', status);
    return unwrap(await q.order('full_name').range(from, to)) as unknown as RiderRow[];
  });
}

/** Active delivery count per rider. */
export function useRiderLoad() {
  return useQuery({
    queryKey: ['admin', 'riders', 'load'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('assignments').select('rider_id').eq('status', 'active').limit(1000)) as Array<{ rider_id: string }>;
      const load: Record<string, number> = {};
      for (const r of rows) load[r.rider_id] = (load[r.rider_id] ?? 0) + 1;
      return load;
    },
    refetchInterval: 60_000,
  });
}

export function useActiveRiders(serviceAreaId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'riders', 'active', serviceAreaId],
    enabled: Boolean(serviceAreaId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('rider_profiles')
          .select('user_id, full_name, phone, vehicle_type')
          .eq('status', 'active')
          .eq('service_area_id', serviceAreaId!)
          .order('full_name'),
      ) as Array<Pick<RiderRow, 'user_id' | 'full_name' | 'phone' | 'vehicle_type'>>,
  });
}

export interface RiderInput {
  email: string;
  fullName: string;
  phone: string;
  vehicle: VehicleType;
  plate: string;
  serviceAreaId: string;
  gcashName: string;
  gcashNumber: string;
}

export function useCreateRider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: RiderInput) =>
      unwrap(
        await supabase.rpc('create_rider', {
          p_email: input.email.trim(),
          p_full_name: input.fullName.trim(),
          p_phone: input.phone.trim(),
          p_vehicle: input.vehicle,
          p_plate: input.plate.trim() || null,
          p_service_area_id: input.serviceAreaId,
          p_gcash_name: input.gcashName.trim(),
          p_gcash_number: input.gcashNumber.trim(),
        }),
      ) as string,
    onSuccess: () => invalidate(['admin', 'riders']),
  });
}

export function useSetRiderStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { userId: string; status: Exclude<RiderStatus, 'pending'> }) =>
      unwrap(await supabase.rpc('set_rider_status', { p_user_id: input.userId, p_status: input.status })),
    onSuccess: () => invalidate(['admin', 'riders'], ['admin', 'orders'], ['admin', 'overview']),
  });
}

export function useRejectRider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { userId: string; reason: string }) =>
      unwrap(await supabase.rpc('reject_rider_application', { p_user_id: input.userId, p_reason: input.reason })),
    onSuccess: () => invalidate(['admin', 'riders'], ['admin', 'overview']),
  });
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------
export type PromotionRow = PromotionRecord & {
  created_at: string;
  merchants: { name: string } | null;
  promotion_redemptions: Array<{ count: number }>;
};

export type PromotionTab = 'active' | 'inactive' | 'all';

export function usePromotions(tab: PromotionTab) {
  return usePaged<PromotionRow>(['admin', 'promotions', tab], async (from, to) => {
    let q = supabase.from('promotions').select('*, merchants(name), promotion_redemptions(count)');
    if (tab === 'active') q = q.eq('is_active', true);
    if (tab === 'inactive') q = q.eq('is_active', false);
    return unwrap(await q.order('created_at', { ascending: false }).range(from, to)) as unknown as PromotionRow[];
  });
}

export const redemptionCount = (p: PromotionRow) => p.promotion_redemptions?.[0]?.count ?? 0;

export type PromotionInput = Omit<PromotionRecord, 'id'>;

export function useSavePromotion() {
  const invalidate = useInvalidate();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...input }: PromotionInput & { id?: string }) => {
      const result = id
        ? await supabase.from('promotions').update(input).eq('id', id)
        : await supabase.from('promotions').insert({ ...input, created_by: userId });
      if (result.error?.code === '23505') throw new AppError('Another promotion already uses this code.', '23505');
      return unwrap(result);
    },
    onSuccess: () => invalidate(['admin', 'promotions'], ['promotions']),
  });
}

export function useSetPromotionActive() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) =>
      unwrap(await supabase.from('promotions').update({ is_active: input.active }).eq('id', input.id)),
    onSuccess: () => invalidate(['admin', 'promotions'], ['promotions']),
  });
}

export function useDeletePromotion() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await supabase.from('promotions').delete().eq('id', id);
      if (result.error?.code === '23503') throw new AppError('This promotion has been used on orders. Deactivate it instead.', '23503');
      return unwrap(result);
    },
    onSuccess: () => invalidate(['admin', 'promotions'], ['promotions']),
  });
}

// ---------------------------------------------------------------------------
// Refunds (manual GCash)
// ---------------------------------------------------------------------------
export type RefundTab = 'open' | 'processed' | 'rejected';

export const REFUND_TAB_STATUSES: Record<RefundTab, RefundStatus[]> = {
  open: ['requested', 'approved'],
  processed: ['processed'],
  rejected: ['rejected'],
};

export function useRefunds(tab: RefundTab, enabled: boolean) {
  return usePaged<RefundRow>(
    ['admin', 'refunds', tab],
    async (from, to) =>
      unwrap(
        await supabase
          .from('refunds')
          .select('*, orders(code, merchant_name, customer_name)')
          .in('status', REFUND_TAB_STATUSES[tab])
          .order('created_at', { ascending: tab === 'open' })
          .range(from, to),
      ) as unknown as RefundRow[],
    { enabled },
  );
}

export function useReviewRefund() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { refundId: string; action: 'approve' | 'reject' | 'mark_processed'; reference?: string }) =>
      unwrap(
        await supabase.rpc('review_refund', {
          p_refund_id: input.refundId,
          p_action: input.action,
          p_reference: input.reference?.trim() || null,
        }),
      ),
    onSuccess: () => invalidate(['admin', 'refunds'], ['admin', 'overview'], ['admin', 'order']),
  });
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------
export type TicketTab = TicketStatus | 'active' | 'mine' | 'all';

export function useAdminTickets(tab: TicketTab, enabled: boolean) {
  const { userId } = useAuth();
  return usePaged<Ticket>(
    ['tickets', 'admin', tab, userId],
    async (from, to) => {
      let q = supabase.from('support_tickets').select('*');
      if (tab === 'mine') q = q.eq('assigned_to', userId!).in('status', ['open', 'pending']);
      else if (tab === 'active') q = q.in('status', ['open', 'pending']);
      else if (tab !== 'all') q = q.eq('status', tab);
      // 'high' sorts before 'normal'.
      return unwrap(await q.order('priority', { ascending: true }).order('updated_at', { ascending: false }).range(from, to)) as Ticket[];
    },
    { enabled, refetchInterval: 60_000 },
  );
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; changes: Partial<Pick<Ticket, 'status' | 'priority' | 'assigned_to'>> }) =>
      unwrap(await supabase.from('support_tickets').update(input.changes).eq('id', input.ticketId)),
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ['ticket', input.ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });
}

export function useOrderSummary(orderId: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'order-summary', orderId],
    enabled: Boolean(orderId),
    queryFn: async () =>
      unwrap(
        await supabase.from('orders').select('id, code, status, merchant_name, total_minor, payment_status, created_at').eq('id', orderId!).maybeSingle(),
      ) as Pick<AdminOrder, 'id' | 'code' | 'status' | 'merchant_name' | 'total_minor' | 'payment_status' | 'created_at'> | null,
  });
}

// ---------------------------------------------------------------------------
// People and roles
// ---------------------------------------------------------------------------
export type StaffRole = Exclude<AppRole, 'rider'>;
export const STAFF_ROLES: StaffRole[] = ['admin', 'support', 'finance'];
export const ROLE_LABELS: Record<AppRole, string> = { admin: 'Admin', support: 'Support', finance: 'Finance', rider: 'Rider' };

export interface RoleHolder {
  user_id: string;
  role: StaffRole;
  created_at: string;
  granted_by: string | null;
}

export function useRoleHolders(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'roles'],
    enabled,
    queryFn: async () =>
      unwrap(await supabase.from('user_roles').select('user_id, role, created_at, granted_by').in('role', STAFF_ROLES).order('created_at')) as RoleHolder[],
  });
}

export function useGrantRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { email: string; role: StaffRole }) =>
      unwrap(await supabase.rpc('grant_role', { p_email: input.email.trim(), p_role: input.role })) as string,
    onSuccess: () => invalidate(['admin', 'roles'], ['admin', 'user-roles'], ['identity']),
  });
}

export function useRevokeRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { userId: string; role: StaffRole }) =>
      unwrap(await supabase.rpc('revoke_role', { p_user_id: input.userId, p_role: input.role })),
    onSuccess: () => invalidate(['admin', 'roles'], ['admin', 'user-roles'], ['identity']),
  });
}

export function useProfileSearch(search: string) {
  const term = cleanSearch(search);
  return useQuery({
    queryKey: ['admin', 'profile-search', term],
    enabled: term.length >= 2,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('profiles')
          .select('id, email, full_name, phone, created_at')
          .or(`email.ilike.%${term}%,full_name.ilike.%${term}%,phone.ilike.%${term}%`)
          .order('created_at', { ascending: false })
          .limit(20),
      ) as AdminProfile[],
  });
}

export function useCustomerOrders(userId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'customer-orders', userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase.from('orders').select(ORDER_LIST_SELECT).eq('customer_id', userId!).order('created_at', { ascending: false }).limit(5),
      ) as unknown as OrderListRow[],
  });
}

export function useUserRoles(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'user-roles', userId],
    enabled: Boolean(userId) && enabled,
    queryFn: async () => (unwrap(await supabase.from('user_roles').select('role').eq('user_id', userId!)) as Array<{ role: AppRole }>).map((r) => r.role),
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export interface AuditEntry {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
}

export function useAuditLogs(entityType: string, enabled: boolean) {
  return usePaged<AuditEntry>(
    ['admin', 'audit', entityType],
    async (from, to) => {
      let q = supabase.from('audit_logs').select('*');
      if (entityType !== 'all') q = q.eq('entity_type', entityType);
      return unwrap(await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)) as AuditEntry[];
    },
    { enabled },
  );
}
