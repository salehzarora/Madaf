# Madaf — local Supabase backend (M1)

The M1 backend foundation: schema, Row Level Security, storage bucket and
demo seed for the Madaf B2B catalog. **Local development only — there is
no hosted/production project in this phase, and the UI still runs on mock
data** (`NEXT_PUBLIC_MADAF_DATA_MODE=mock`, the default).

## Required tools

| Tool | Version used | Install |
|---|---|---|
| Docker Desktop | 29.x | https://docs.docker.com/desktop/ |
| Supabase CLI | 2.107+ | `npm i -g supabase`, `scoop install supabase`, or https://supabase.com/docs/guides/local-development/cli/getting-started |
| Node.js | 20+ | already required by the app |

## Run it

```bash
supabase start        # first run pulls Docker images (~a few minutes)
supabase status       # URLs + keys any time
supabase db reset     # drop + re-apply migrations/ + seed.sql
supabase stop         # shut the stack down (data volume is kept)
```

`supabase start` applies everything in `migrations/` and `seed.sql`
automatically on first boot; `db reset` re-runs both from scratch.

Madaf binds to the **55xxx port range** (API `55321`, DB `55322`, Studio
`55323`) so it can run beside other local Supabase projects on the default
54xxx ports — see `config.toml`.

- Studio: http://127.0.0.1:55323
- DB: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`

## What's inside

| File | Contents |
|---|---|
| `migrations/20260705100000_core_schema.sql` | enums, 12 tables, composite tenant FKs, triggers (updated_at, order-status history) |
| `migrations/20260705110000_rls_policies.sql` | RLS on every table, deny-by-default, tenant-membership helpers, `next_order_number()` |
| `migrations/20260705120000_storage_product_images.sql` | private `product-images` bucket + tenant-scoped policies |
| `migrations/20260705130000_order_write_rpcs.sql` | M3A: `create_order_request()` + `update_order_status()` — atomic, service-role-only order writes |
| `migrations/20260705140000_lock_order_writes.sql` | M3A.1: orders/order_items are READ-ONLY for authenticated — writes only via the RPCs |
| `migrations/20260705150000_product_crud_rpcs.sql` | M3B: product / manufacturer / inventory CRUD RPCs — service-role-only, tenant-validated |
| `migrations/20260705160000_lock_catalog_writes.sql` | M3B.1: master-data tables READ-ONLY for authenticated — writes only via the RPCs |
| `migrations/20260705170000_auth_and_private_links.sql` | M4A: `authorize_tenant()` + `current_membership()` + `create_tenant_with_owner()`; write RPCs re-gated for authenticated owner/admin/sales_rep; `customer_access_links` table + tokenized shop RPCs (`get_token_catalog`, `create_order_request_from_token`) |
| `seed.sql` | demo tenant + full 1:1 mapping of `src/lib/mock/*` |
| `bootstrap-auth.sql` | **not auto-run** — creates 4 demo auth users + memberships for local sign-in (see `docs/AUTH_AND_ACCESS_MODEL.md`) |

### Schema at a glance

```
tenants ─┬─ tenant_users (auth.users ↔ tenant, role: owner/admin/sales_rep)
         ├─ customers            (shops)
         ├─ manufacturers        (trilingual names)
         ├─ categories           (trilingual names, icon, hue)
         ├─ products             (trilingual, package info, price excl. VAT)
         │    └─ inventory_items (stock in packages, low-stock, expiry)
         ├─ orders               (status pipeline, denormalized totals)
         │    ├─ order_items     (full snapshots: names, price, VAT, totals)
         │    ├─ order_status_history  (written by trigger, append-only)
         │    └─ documents       (order_request / delivery_note / invoice_draft)
         └─ audit_events         (append-only)
```

Every tenant-owned table carries `tenant_id`, and every intra-tenant
reference is a **composite FK** `(tenant_id, x_id) → parent (tenant_id,
id)` so rows can never point at another tenant's parents (plain FK checks
bypass RLS). Trilingual text is explicit `name_ar` / `name_he` / `name_en`
columns. The mock `availability` field is **derived**, not stored:
`quantity_available` = 0 → out of stock, below `low_stock_threshold` →
low stock, else in stock. Orders snapshot the buyer
(`customer_snapshot`) and every line snapshots product/price data, so
documents stay renderable after catalog or customer changes.

> ⚠️ **Legal:** `documents.document_type = 'invoice_draft'` is a draft
> preview, never a legal tax invoice. A CHECK constraint refuses invoice
> drafts without their `legal_notice`; there is no DELETE policy on
> documents (void them instead); orders with documents cannot be deleted
> at all (FK `NO ACTION` + no delete policy — cancel instead). Do not
> weaken any of these without reading
> `docs/DOCUMENTS_AND_INVOICES_GUIDE.md`.

### RLS model (deny by default, hardened in M1.1; auth path live in M4A)

- `anon` has **no table grants and no read policies** — zero direct
  database access, and the catalog is never globally public. Its ONLY
  reach is the two anon-granted tokenized-shop RPCs (`get_token_catalog`,
  `create_order_request_from_token`), which validate a link token and
  scope everything server-side. A raw anon `SELECT` on any table still
  raises `permission denied`, so the app's read layer short-circuits to
  empty for tenantless callers before querying (see `supabase-reads.ts`).
- `authenticated` reaches only rows of tenants they belong to, via
  `is_tenant_member(tenant_id)` / `has_tenant_role(tenant_id, roles[])` —
  SECURITY DEFINER helpers over `tenant_users`.
- Role tiers: **any member** (incl. `sales_rep`) reads everything in
  their tenant. Master-data and order tables are all **read-only at the
  table level for every authenticated client** — writes flow only
  through validated, service-role-only RPCs (see below). A member can
  never change a price, name, stock level, order or customer directly.
- `orders` and `order_items` are read-only for authenticated (M3A.1):
  no write policies, no write grants — including TRUNCATE/REFERENCES/
  TRIGGER/MAINTAIN, which Supabase's default ACL would otherwise leave
  behind (TRUNCATE is RLS-exempt and is stripped from ALL tables for API
  roles). Creating an order goes EXCLUSIVELY through
  `create_order_request()` and status changes EXCLUSIVELY through
  `update_order_status()`; even `next_order_number()` is not callable by
  authenticated users — nobody can forge order numbers, totals, price
  snapshots, or jump statuses.
- `products`, `inventory_items`, `manufacturers`, `categories` and
  `customers` are read-only for authenticated too (M3B.1): the M1.1
  owner/admin direct-write policies were dropped and the grants revoked.
  Product/manufacturer/inventory writes go EXCLUSIVELY through the M3B
  RPCs; `categories`/`customers` have no write RPC yet, so they are
  read-only until a future validated RPC. No client can bypass the RPC
  validation (name/description length caps, image_url sanity, SKU
  uniqueness, cross-tenant guards) with a direct write, insert or delete.
- `documents`, `order_status_history` and `audit_events` are
  **read-only for every client**: no write policies AND no write grants
  (grants mirror the policy matrix as defense in depth). History comes
  from the status trigger; documents/audit rows come from seed/service
  role only — no client can forge an invoice draft, flip a document to
  `generated` (also blocked by CHECK, even for the service role), or
  plant audit entries.
- Admins cannot touch owner memberships or grant the owner role — only
  owners manage owners.
- Tenant onboarding is live in M4A: a signed-in, membership-less user
  creates their tenant + first `owner` `tenant_users` row atomically via
  `create_tenant_with_owner()` (authenticated, membership-less only).
- Every tenant-owned write RPC is now gated by `authorize_tenant(tenant,
  roles[])`, which derives the tenant from the caller's membership and
  rejects a mismatched client `tenant_id` or a disallowed role (`42501`).
  The client-submitted `tenant_id` is never trusted.

To sign in as a member locally, run `bootstrap-auth.sql` after a reset
(4 demo users). Full model: `docs/AUTH_AND_ACCESS_MODEL.md`.

### Storage

Bucket `product-images` (private, 5 MiB, image mime types). Path
convention: `<tenant_id>/products/<product_id>/<file>` — policies key on
the first folder segment being the tenant uuid. **M3B wires real uploads**
(`uploadProductImageAction` → `sbUploadProductImage`, service role): the
server validates JPEG/PNG/WebP + 5 MB, writes under the tenant path, and
stores that path in `products.image_url`. The read layer resolves storage
paths to short-lived **signed URLs** (the bucket stays private); external
`http(s)` image URLs pass through unchanged.

### Catalog writes (M3B)

Admin product/manufacturer/inventory edits flow client → Server Action
(`src/lib/actions/products.ts`) → data layer → service-role-only RPCs
(`20260705150000_product_crud_rpcs.sql`):

- `create_product` / `update_product` (jsonb payload; validates tenant,
  category/manufacturer ownership, ranges, lengths, SKU uniqueness;
  optionally upserts inventory in the same call).
- `set_product_active` (activate/deactivate — inactive products leave the
  customer catalog but stay in admin).
- `upsert_inventory_item` (quantity / threshold / location / expiry; no
  negative stock).
- `create_manufacturer` / `update_manufacturer` (+ `logo_url`).

All `revoke execute` from anon/authenticated — service-role only until
M4. Cross-tenant attachment is rejected by both the RPC checks and the
composite FKs. `availability` stays DERIVED from inventory (never stored).
Since M3B.1 these RPCs are the ONLY catalog write paths: direct
authenticated writes on products/inventory_items/manufacturers/
categories/customers are blocked at both the policy and grant level
(migration `20260705160000_lock_catalog_writes.sql`).

Image upload additionally sniffs magic bytes (JPEG/PNG/WebP) so a
spoofed `Content-Type` can't smuggle a non-image past the MIME + 5 MB
checks. (This blocks non-image payloads; a byte-valid image carrying an
embedded polyglot payload is still accepted — harmless here since the
bucket is private, served via signed URLs with an image content-type,
and never executed.)

## Seed data

One demo tenant (`מדף הפצה` / `مدف للتوزيع` / Madaf Distribution) with the
exact M0 mock dataset: 6 manufacturers, 6 categories, 34 products, 8
customers, 34 inventory rows, 7 orders (MDF-1041…MDF-1047) whose statuses
are *walked through the pipeline* so the history trigger produces real
`order_status_history` rows, and 12 documents derived by the mock rules
(every order → order request; preparing/delivered → delivery note;
delivered → invoice draft). Deterministic UUIDs (`dd…0001` = mock `p01`,
etc.) — the mapping table is documented at the top of `seed.sql`.

## TypeScript types

`src/lib/supabase/database.types.ts` is **generated** — do not edit by
hand. Regenerate after any migration change (stack must be running):

```bash
supabase gen types typescript --local --schema public > src/lib/supabase/database.types.ts
```

(On Windows, run this from Git Bash or cmd — PowerShell's `>` writes
UTF-16 and corrupts the file.)

## App integration (M2 — read paths live)

```bash
cp .env.example .env.local   # defaults to mock mode
npm run dev                  # app runs exactly as in M0 — no DB required
```

The mode boundary lives in `src/lib/data/` (`getDataMode()`). Every UI
read goes through it; mock is the default and needs zero configuration.

**Supabase read mode (local dev only):** set
`NEXT_PUBLIC_MADAF_DATA_MODE=supabase` and `SUPABASE_SERVICE_ROLE_KEY`
(the "Secret" key from `supabase status`) in `.env.local`, then
`npm run dev` — the entire UI (catalog, product pages, admin, documents)
renders from the seeded database.

**Since M4A this runs on real auth.** Supplier users sign in at `/login`
(create the demo users with `bootstrap-auth.sql`); the session lives in
httpOnly cookies and `src/proxy.ts` refreshes it each request. Reads and
writes both go through the cookie-bound **authenticated** client
(`src/lib/auth/session.ts` → `supabase-reads.ts` / `supabase-writes.ts`),
scoped by RLS to the member's tenant. Anonymous / not-yet-onboarded
callers carry the `NO_TENANT` sentinel and their reads short-circuit to
empty (anon holds no table grants). The old service-role context remains
only for local bootstrap/seed tooling and still refuses production builds
and non-local URLs; the app no longer uses it. Full model:
`docs/AUTH_AND_ACCESS_MODEL.md`.

**Order writes (M3A):** in supabase mode, checkout and admin status
changes are REAL. They flow client → Server Action
(`src/lib/actions/orders.ts`) → data layer → service-role-only DB RPCs:

- `create_order_request(tenant, items, customer?, notes?, source)` —
  atomic: validates tenant/customer/products (active, same tenant),
  merges duplicate lines, computes ALL money from live product data
  (client prices are never trusted), draws the number via
  `next_order_number()`, inserts order + snapshotted lines. Creates NO
  documents (M5).
- `update_order_status(tenant, order, next)` — validated pipeline
  (new → confirmed → preparing → delivered, cancel from any active
  state; terminal states stay terminal; same-status is a no-op). History
  rows come from the existing trigger.

Since M4A these RPCs are `EXECUTE`-granted to **authenticated** and gated
by `authorize_tenant` (owner/admin/sales_rep can create orders;
owner/admin change status). Since M3A.1 they remain the ONLY order write
paths: direct table writes on orders/order_items are blocked for
authenticated users at both the policy and grant level. Customers with a
private link place orders through the anon `create_order_request_from_token`
RPC (`source='remote_customer'`), which reuses the same server-side money
logic.

The temporary service-role context additionally refuses any NON-LOCAL
Supabase URL (only `127.0.0.1`/`localhost`/`::1`), on top of refusing
production builds — a dev server pointed at a hosted project cannot run
this mode.
