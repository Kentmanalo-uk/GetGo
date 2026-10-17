import type { OrderStatus, PaymentStatus, Service } from '@/domain/orderStatus';

export type AppRole = 'admin' | 'support' | 'finance' | 'rider';
export type MemberRole = 'owner' | 'manager' | 'staff';
export type MerchantCategory = 'restaurant' | 'cafe' | 'bakery' | 'grocery' | 'convenience' | 'specialty';
export type ApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'needs_changes' | 'approved' | 'rejected';
export type ProductStatus = 'draft' | 'published' | 'archived';
export type StoreState = 'open' | 'paused' | 'closed';
export type DocumentType = 'business_permit' | 'dti_sec_registration' | 'bir_registration' | 'government_id' | 'food_safety_permit' | 'other';

export const CATEGORY_LABELS: Record<MerchantCategory, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bakery: 'Bakery',
  grocery: 'Grocery',
  convenience: 'Convenience store',
  specialty: 'Specialty food',
};

export const FOOD_CATEGORIES: MerchantCategory[] = ['restaurant', 'cafe', 'bakery'];
export const SHOP_CATEGORIES: MerchantCategory[] = ['grocery', 'convenience', 'specialty'];

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  email_verified_at: string | null;
  /** Profile picture in the public media bucket (avatars/<id>/…). */
  avatar_path: string | null;
}

export interface ServiceArea {
  id: string;
  name: string;
  city: string;
  province: string;
  is_active: boolean;
  delivery_fee_minor: number;
  service_fee_minor: number;
  small_order_threshold_minor: number | null;
  small_order_fee_minor: number;
  typical_delivery_minutes: number | null;
  /** PSGC city/municipality code (official list), when picked from it. */
  psgc_code: string | null;
  province_code: string | null;
  padala_enabled: boolean;
  errands_enabled: boolean;
  padala_fee_minor: number;
  errand_fee_minor: number;
  errand_max_budget_minor: number;
}

export interface Address {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  barangay: string;
  city: string;
  landmark: string | null;
  service_area_id: string;
  is_default: boolean;
  barangay_code: string | null;
}

export interface Storefront {
  id: string;
  slug: string;
  name: string;
  category: MerchantCategory;
  description: string | null;
  logo_path: string | null;
  cover_path: string | null;
  address_line: string;
  barangay: string;
  city: string;
  service_area_id: string;
  service_area_name: string;
  min_order_minor: number;
  delivery_fee_minor: number;
  service_fee_minor: number;
  typical_delivery_minutes: number | null;
  state: StoreState;
  next_open_at: string | null;
  rating_avg: string | null;
  rating_count: number;
  /** Lowest delivery fee in the store's area (barangay prices can differ). */
  delivery_fee_from_minor: number;
  delivery_fee_varies: boolean;
}

export interface Merchant {
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
  status: 'active' | 'suspended' | 'closed';
  is_published: boolean;
  accepting_orders: boolean;
  paused_until: string | null;
  min_order_minor: number;
  created_at: string;
}

export interface Category {
  id: string;
  merchant_id: string;
  name: string;
  sort_order: number;
}

export interface ProductVariantRow {
  id: string;
  product_id: string;
  name: string;
  price_minor: number;
  is_available: boolean;
  sort_order: number;
}

export interface OptionValueRow {
  id: string;
  group_id: string;
  name: string;
  price_delta_minor: number;
  is_available: boolean;
  max_quantity: number;
  sort_order: number;
}

export interface OptionGroupRow {
  id: string;
  merchant_id: string;
  name: string;
  min_select: number;
  max_select: number;
  option_values: OptionValueRow[];
}

export interface ProductRow {
  id: string;
  merchant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_path: string | null;
  base_price_minor: number;
  status: ProductStatus;
  is_available: boolean;
  max_per_order: number;
  sort_order: number;
  updated_at: string;
  product_variants: ProductVariantRow[];
  product_option_groups: Array<{ sort_order: number; group_id: string; option_groups: OptionGroupRow | null }>;
}

export interface QuoteItem {
  cart_item_id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  instructions: string | null;
  selection: Array<{ option_value_id: string; quantity: number }>;
  options: Array<{ option_value_id: string; group_id: string; group_name: string; option_name: string; price_delta_minor: number; quantity: number }>;
  unit_price_minor: number | null;
  line_total_minor: number | null;
  previous_unit_price_minor: number;
  price_changed: boolean;
  error_code: string | null;
  error_message: string | null;
}

export interface Quote {
  merchant: {
    id: string;
    name: string;
    slug: string;
    state: StoreState;
    min_order_minor: number;
    service_area_id: string;
    service_area_name: string;
  };
  items: QuoteItem[];
  subtotal_minor: number;
  delivery_fee_minor: number;
  service_fee_minor: number;
  small_order_fee_minor: number;
  discount_minor: number;
  total_minor: number;
  promo: { code: string; applied: boolean; title?: string; message: string | null } | null;
  issues: Array<{ code: string; message: string }>;
  can_checkout: boolean;
}

export interface OrderItemOption {
  id: string;
  group_name: string;
  option_name: string;
  price_delta_minor: number;
  quantity: number;
}

export interface OrderItem {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
  instructions: string | null;
  order_item_options: OrderItemOption[];
  /** The product's current photo (null if the product was removed). */
  product?: { image_path: string | null } | null;
}

export interface DeliveryAddressSnapshot {
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  barangay: string;
  city: string;
  landmark: string | null;
}

export interface PadalaTask {
  item: string;
  size: 'small' | 'medium' | 'large';
}

export type ErrandType = 'buy' | 'bill' | 'pickup' | 'other';
export interface ErrandTask {
  type: ErrandType;
  description: string;
  budget_minor: number;
}

export const PARCEL_SIZES: Record<PadalaTask['size'], { label: string; hint: string }> = {
  small: { label: 'Small', hint: 'Documents, a small pouch' },
  medium: { label: 'Medium', hint: 'A shoebox, fits on a motorcycle' },
  large: { label: 'Large', hint: 'A big box, up to 20 kg' },
};

export const ERRAND_TYPES: Record<ErrandType, { label: string; hint: string; needsBudget: boolean }> = {
  buy: { label: 'Buy something', hint: 'Medicine, hardware, anything not on GETGO', needsBudget: true },
  bill: { label: 'Pay a bill', hint: 'Electric, water, internet, tuition', needsBudget: true },
  pickup: { label: 'Pick up something', hint: 'Documents, orders, items left somewhere', needsBudget: false },
  other: { label: 'Other task', hint: 'Anything else a rider can do in town', needsBudget: false },
};

export interface Order {
  id: string;
  code: string;
  customer_id: string;
  service: Service;
  /** The store for food and shop orders; null for padala and errands. */
  merchant_id: string | null;
  /** The store's name, or the request title ("Padala · Documents"). */
  merchant_name: string;
  /** The store; for padala the sender; for errands the place to go. */
  pickup_address: { line1: string; barangay: string; city: string; phone: string | null; name?: string; landmark?: string | null };
  task: PadalaTask | ErrandTask | null;
  /** Errands: what the rider spent out of the budget (subtotal). */
  spent_minor: number | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string;
  customer_phone: string;
  delivery_address: DeliveryAddressSnapshot;
  notes: string | null;
  subtotal_minor: number;
  delivery_fee_minor: number;
  service_fee_minor: number;
  small_order_fee_minor: number;
  discount_minor: number;
  total_minor: number;
  cancel_reason: string | null;
  accepted_at: string | null;
  paid_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderPayment {
  id: string;
  status: PaymentStatus;
  amount_minor: number;
  refunded_minor: number;
  payee_name: string | null;
  payee_number: string | null;
  gcash_reference: string | null;
  sender_name: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  rejection_note: string | null;
}

export interface OrderRider {
  status: 'active' | 'completed' | 'released';
  rider_id: string;
  rider: { full_name: string; phone: string; vehicle_type: string; plate_number: string | null } | null;
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[];
  /** One payment per order (payments.order_id is unique), so the API embeds an object. */
  payments: OrderPayment | null;
  assignments: OrderRider[];
}

export interface StatusHistoryEntry {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_kind: 'customer' | 'rider' | 'admin' | 'system';
  note: string | null;
  created_at: string;
}

export interface PartnerApplication {
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

export interface ApplicationDocument {
  id: string;
  application_id: string;
  doc_type: DocumentType;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Promotion {
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

export interface PlatformSettings {
  partner_fee_note: string | null;
  support_email: string | null;
  support_phone: string | null;
}
