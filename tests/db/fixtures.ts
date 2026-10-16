import type { TestDb } from './harness';

export const ALL_DAY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '00:00', closes: '23:59' }));

export interface World {
  admin: string;
  support: string;
  finance: string;
  areaId: string;
  otherAreaId: string;
}

/** Platform staff and service areas. Area fees: delivery ₱49, service ₱10. */
export async function createPlatform(db: TestDb): Promise<World> {
  const admin = await db.createUser('admin@getgo.test', 'Ada Admin');
  const support = await db.createUser('support@getgo.test', 'Sam Support');
  const finance = await db.createUser('finance@getgo.test', 'Fin Ance');
  await db.sql(`insert into user_roles (user_id, role) values ($1, 'admin'), ($2, 'support'), ($3, 'finance')`, [
    admin,
    support,
    finance,
  ]);
  const [area] = await db.as<{ id: string }>(
    admin,
    `insert into service_areas (name, city, province, is_active, delivery_fee_minor, service_fee_minor)
     values ('Naga City Centro', 'Naga City', 'Camarines Sur', true, 4900, 1000) returning id`,
  );
  const [other] = await db.as<{ id: string }>(
    admin,
    `insert into service_areas (name, city, province, is_active, delivery_fee_minor, service_fee_minor)
     values ('Pili Poblacion', 'Pili', 'Camarines Sur', true, 3900, 1000) returning id`,
  );
  return { admin, support, finance, areaId: area.id, otherAreaId: other.id };
}

/** Creates a complete draft application with documents, as the applicant. */
export async function createApplication(db: TestDb, applicant: string, areaId: string, name = 'Lutong Bahay ni Aling Rosa') {
  const [app] = await db.as<{ id: string }>(
    applicant,
    `insert into partner_applications (business_name, category, description, owner_name, owner_phone, owner_email,
       address_line, barangay, city, service_area_id, hours, prep_time_minutes, supports_delivery, supports_pickup, menu_items)
     values ($1, 'restaurant', 'Home-style Bicolano meals', 'Rosa Dela Cruz', '09171112222', 'rosa@example.test',
       '12 Elias Angeles St', 'Dinaga', 'Naga City', $2, $3, 20, true, true,
       '[{"name":"Bicol Express Rice Meal","description":"With rice","price_minor":12000,"category":"Rice meals"}]')
     returning id`,
    [name, areaId, JSON.stringify(ALL_DAY_HOURS)],
  );
  for (const docType of ['government_id', 'business_permit', 'dti_sec_registration']) {
    const path = `${applicant}/${app.id}/${docType}.pdf`;
    await db.as(applicant, `insert into storage.objects (bucket_id, name, owner) values ('partner-documents', $1, $2)`, [
      path,
      applicant,
    ]);
    await db.as(
      applicant,
      `insert into application_documents (application_id, doc_type, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, $3, $4, 'application/pdf', 20000)`,
      [app.id, docType, path, `${docType}.pdf`],
    );
  }
  return app.id;
}

export interface Store {
  owner: string;
  merchantId: string;
  productId: string;
  regularId: string;
  largeId: string;
  drinkGroupId: string;
  addonGroupId: string;
  options: Record<string, string>;
}

/**
 * Runs the real onboarding path (apply → submit → approve) and configures a
 * rice meal with sizes, a required drink choice and optional add-ons, then
 * publishes the store.
 *
 * Rice meal: Regular ₱120 / Large ₱150
 * Drink (choose 1): Iced tea ₱0, Coke ₱15, Buko juice ₱25 (sold out)
 * Add-ons (up to 3): Extra rice ₱20 (max 2), Egg ₱15
 */
export async function createStore(db: TestDb, world: World, email: string, name?: string): Promise<Store> {
  const owner = await db.createUser(email, 'Rosa Dela Cruz');
  const appId = await createApplication(db, owner, world.areaId, name);
  await db.as(owner, `select submit_partner_application($1)`, [appId]);
  const [{ merchant_id: merchantId }] = await db.as<{ merchant_id: string }>(
    world.admin,
    `select review_partner_application($1, 'approved', 'Documents verified', 1500) as merchant_id`,
    [appId],
  );

  const [drink] = await db.as<{ id: string }>(
    owner,
    `select save_option_group($1, $2) as id`,
    [
      merchantId,
      JSON.stringify({
        name: 'Drink',
        min_select: 1,
        max_select: 1,
        values: [
          { name: 'Iced tea', price_delta_minor: 0 },
          { name: 'Coke', price_delta_minor: 1500 },
          { name: 'Buko juice', price_delta_minor: 2500, is_available: false },
        ],
      }),
    ],
  );
  const [addon] = await db.as<{ id: string }>(
    owner,
    `select save_option_group($1, $2) as id`,
    [
      merchantId,
      JSON.stringify({
        name: 'Add-ons',
        min_select: 0,
        max_select: 3,
        values: [
          { name: 'Extra rice', price_delta_minor: 2000, max_quantity: 2 },
          { name: 'Egg', price_delta_minor: 1500 },
        ],
      }),
    ],
  );
  const [{ id: productId }] = await db.as<{ id: string }>(
    owner,
    `select id from products where merchant_id = $1 and name = 'Bicol Express Rice Meal'`,
    [merchantId],
  );
  await db.as(owner, `select save_product($1, $2)`, [
    merchantId,
    JSON.stringify({
      id: productId,
      name: 'Bicol Express Rice Meal',
      description: 'Pork in coconut milk and chili, with rice',
      base_price_minor: 12000,
      status: 'published',
      max_per_order: 10,
      variants: [
        { name: 'Regular', price_minor: 12000 },
        { name: 'Large', price_minor: 15000 },
      ],
      option_group_ids: [drink.id, addon.id],
    }),
  ]);
  await db.as(owner, `select set_store_published($1, true)`, [merchantId]);

  const variants = await db.sql<{ id: string; name: string }>(`select id, name from product_variants where product_id = $1`, [
    productId,
  ]);
  const values = await db.sql<{ id: string; name: string }>(
    `select id, name from option_values where group_id in ($1, $2)`,
    [drink.id, addon.id],
  );
  return {
    owner,
    merchantId,
    productId,
    regularId: variants.find((v) => v.name === 'Regular')!.id,
    largeId: variants.find((v) => v.name === 'Large')!.id,
    drinkGroupId: drink.id,
    addonGroupId: addon.id,
    options: Object.fromEntries(values.map((v) => [v.name, v.id])),
  };
}

export async function createCustomer(db: TestDb, world: World, email: string, areaId = world.areaId) {
  const id = await db.createUser(email, 'Juan Santos');
  const [address] = await db.as<{ id: string }>(
    id,
    `insert into addresses (label, recipient_name, phone, line1, barangay, city, service_area_id, is_default)
     values ('Home', 'Juan Santos', '09181234567', '45 Peñafrancia Ave', 'Lerma', 'Naga City', $1, true) returning id`,
    [areaId],
  );
  return { id, addressId: address.id };
}

export function sel(...items: Array<string | [string, number]>) {
  return JSON.stringify(
    items.map((item) => (Array.isArray(item) ? { option_value_id: item[0], quantity: item[1] } : { option_value_id: item, quantity: 1 })),
  );
}

let keyCounter = 0;
export const idemKey = () => `test-key-${Date.now()}-${++keyCounter}`;

export async function quote(db: TestDb, customer: string, merchantId: string, addressId: string | null, promo: string | null = null) {
  const [row] = await db.as<{ q: Record<string, any> }>(
    customer,
    `select quote_checkout($1, $2, $3, $4) as q`,
    [merchantId, addressId ? 'delivery' : 'pickup', addressId, promo],
  );
  return row.q;
}

export async function placeOrder(
  db: TestDb,
  customer: string,
  merchantId: string,
  addressId: string | null,
  opts: { promo?: string | null; method?: 'cod' | 'online'; key?: string; expected?: number } = {},
) {
  const q = await quote(db, customer, merchantId, addressId, opts.promo ?? null);
  const [row] = await db.as<{ id: string }>(
    customer,
    `select place_order($1, $2, $3, $4, 'Gate is blue', $5, $6, $7) as id`,
    [
      merchantId,
      addressId ? 'delivery' : 'pickup',
      addressId,
      opts.method ?? 'cod',
      opts.promo ?? null,
      opts.expected ?? q.total_minor,
      opts.key ?? idemKey(),
    ],
  );
  return row.id;
}
