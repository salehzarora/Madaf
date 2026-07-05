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
| `seed.sql` | demo tenant + full 1:1 mapping of `src/lib/mock/*` |

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

### RLS model (deny by default)

- `anon` has **no grants and no policies** — zero database access. The
  public demo UI keeps running on mock data and never touches the DB.
- `authenticated` reaches only rows of tenants they belong to, via
  `is_tenant_member(tenant_id)` / `has_tenant_role(tenant_id, roles[])` —
  SECURITY DEFINER helpers over `tenant_users`.
- Append-only tables (`order_status_history`, `audit_events`) and
  `documents` have no UPDATE/DELETE (or admin-only UPDATE) policies.
  History is written **only** by the status trigger; audit inserts must
  be attributed to the caller (or null).
- Admins cannot touch owner memberships or grant the owner role — only
  owners manage owners.
- Tenant onboarding (creating `tenants` + first `tenant_users` row) is
  service-role only until the M4 auth milestone.

To explore as a member locally: create a user in Studio → Authentication,
then run the membership snippet at the top of `seed.sql`.

### Storage

Bucket `product-images` (private, 5 MiB, image mime types). Path
convention: `product-images/<tenant_id>/<product_id>/<file>` — policies
key on the first folder segment being the tenant uuid. Uploads arrive with
the M3 product form.

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

## App integration (today)

```bash
cp .env.example .env.local   # defaults to mock mode
npm run dev                  # app runs exactly as in M0 — no DB required
```

The mode boundary lives in `src/lib/data/` (`getDataMode()`), and the
clients in `src/lib/supabase/`. In M1 every data function is mock-backed;
setting `NEXT_PUBLIC_MADAF_DATA_MODE=supabase` fails loudly by design
until the M2 read paths land. The M2 integration path is described in
`docs/FUTURE_BACKEND_HANDOFF.md`.
