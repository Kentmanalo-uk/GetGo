# GETGO

Mobile-first local delivery for the Philippines. Stores list their products; customers order from that list; a GETGO rider in the area accepts the order, receives the customer's **GCash payment**, buys the items at the store and delivers them.

```
Customer orders ─▶ Rider accepts ─▶ Customer sends GCash to rider + enters reference
      ─▶ Rider confirms payment ─▶ Rider buys at store ─▶ On the way ─▶ Delivered
```

| Area | Who | Path |
| --- | --- | --- |
| Customer app | Anyone | `/` |
| Partner page and application | Store owners | `/partner`, `/partner/apply` |
| Product list | Approved stores | `/merchant` |
| Rider app | Riders | `/rider` |
| Admin | Admin, support, finance staff | `/admin` |

Stack: React 19 + Vite + TypeScript, Tailwind CSS v4, TanStack Query, React Router, React Hook Form + Zod, Supabase (Auth, Postgres + RLS, Storage, Realtime).

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run typecheck` | TypeScript, app and tooling |
| `npm test` | Unit tests + database tests (PGlite, no Docker needed) |
| `npm run build` | Typecheck and production build to `dist/` |

## Database

All schema, policies and business rules live in `supabase/migrations/` and are applied in filename order:

| Migration | Contents |
| --- | --- |
| `…0100_foundation` | Enums, profiles, roles, audit log, service areas and fees, addresses, notifications |
| `…0200_merchants` | Partner applications and documents, stores, team members, opening hours |
| `…0300_catalog` | Categories, products, sizes, reusable choice groups, `price_configuration()` |
| `…0400_orders_and_operations` | Carts, promotions, orders and snapshots, riders, assignments, GCash payments, refunds, reviews, support |
| `…0500_checkout_and_orders` | Cart functions, checkout quote, `place_order`, rider accept/release, GCash submit/confirm, delivery steps, refunds |
| `…0600_partner_merchant_admin` | Application review, catalog management, admin operations, `storefronts` view, search |
| `…0700_storage_realtime_grants` | Storage buckets and policies, realtime publication, function grants |

### Applying migrations to a Supabase project

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Or paste each migration file, in order, into the Supabase SQL editor.

### Create the first admin

After signing up in the app with the email you'll use as admin, run once in the SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

Then from `/admin`:
1. Create at least one **service area** (Areas & fees) and mark it active, with delivery and service fees.
2. Add **riders** (Riders). Each rider signs up in the app first; then you add their vehicle, area and GCash name/number.
3. Review **partner applications** as stores apply.

### Supabase Auth settings

- **Authentication → Sign In / Providers → Email**: email/password enabled, **Confirm email turned off**. People use the app as soon as they sign up.
- Email verification is handled by GETGO itself. The Account page shows a "Verify your email" banner that sends a one-time sign-in link. Opening it calls `confirm_email_verification()`, which accepts it only if the session came from an email link in the last hour, and sets `profiles.email_verified_at`.
- **Site URL** and **Redirect URLs**: your web app origin (e.g. `https://getgo.example`), including `/account` and `/reset-password`.
- **SMTP**: Supabase's built-in email sender is heavily rate-limited and meant for testing. Set up custom SMTP (Authentication → Emails) before launch so verification and password-reset emails reach everyone.

## How the rules are enforced

The browser is never trusted with prices, totals or status changes.

- **RLS is enabled on every table** (a test fails if one is added without it). Clients only `select` most tables; writes go through `SECURITY DEFINER` functions that re-check the caller's permission.
- **Pricing**: `price_configuration()` validates every size/choice/quantity rule and prices it from current data. The browser's live price (`src/domain/customization.ts`) is a preview, and a test checks it matches the server on 150 generated configurations.
- **Checkout**: `place_order()` recomputes everything in one transaction, refuses a total that differs from what the customer saw, snapshots item names/prices/choices, and is idempotent per checkout key (double taps and retries return the same order).
- **Who sees what**
  - Customers see only their own carts, addresses, orders and payments.
  - Active riders see *open* orders in their own area. Once a rider accepts, only that rider (plus the customer and staff) can see the order.
  - Customers see their assigned rider's name, phone and GCash number; nobody else does.
  - Stores see only their own catalog and never see orders or customer details.
  - Staff roles are `admin` (everything), `support` (orders, riders, applications, tickets) and `finance` (refunds). Only admins approve stores, edit areas, settings and promotions, or grant roles.
- **Storage**
  - `media` is public-read; uploads are allowed only under `merchants/<store>/…` for that store's owners and managers, or `applications/<id>/…` for the applicant.
  - `partner-documents` is private: the applicant can read their own files (and upload while the application is editable); admin and support can read.
- Every privileged action is written to `audit_logs`.

## Payments (manual GCash)

- One `payments` row per order. When a rider accepts, it records the rider's GCash name/number as payee.
- The customer submits the GCash reference number. References are unique across all orders, so one transfer can't be used twice.
- The assigned rider confirms **received** (rider starts buying) or **not received** with a note (the customer is asked to resend).
- If an order is cancelled after payment was confirmed, a refund is opened automatically. Finance/admin approve it, send the GCash refund, then record the refund reference.

GETGO never sees or moves the money. These records exist so every peso has a trail.

## Deployment (web app)

`npm run build` produces a static site in `dist/`. Host it on any static host (Netlify, Vercel, Cloudflare Pages, Hostinger, etc.) with:
- Environment variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and optional support contacts) set at build time.
- A single-page-app fallback: every unknown path serves `index.html`.

## Backups and recovery

- Turn on Supabase daily backups (and Point-in-Time Recovery on paid plans) for the production project.
- Migrations are the source of truth for schema; never change production schema by hand without adding a migration.
- Before major releases, take a manual backup (`supabase db dump`), and test restores on a separate project.

## Secrets

- Only the URL and **anon** key belong in the web app.
- The service-role key, secret key and database password must stay out of the repo, the bundle and chat logs. `supabase-keys.txt` and `.env*` files are git-ignored.
- Rotate any key that has been shared in plain text.

## Known limitations

- **Padala and errands** are shown as "coming later". The `bookings` table exists, but intake is not built.
- Payments are manual GCash transfers verified by riders; there is no payment-gateway confirmation.
- There's no automatic expiry for orders a rider accepted but the customer never paid. The rider can release them, or staff can cancel.
- Delivery estimates use the per-area "typical delivery minutes" set by admins; there is no live map or distance pricing. Fees are flat per area.
- Store hours don't span midnight; use 11:59 PM and reopen at 12:00 AM.
- Typed database client code is hand-written in `src/types/models.ts`; regenerate with `supabase gen types` once linked if you prefer generated types.
