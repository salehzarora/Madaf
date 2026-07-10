# M7G — Customer Order Privacy + New-Store Signup

Status: implemented on `feature/M7G-customer-order-privacy-store-signup` (not
merged). Builds on M7F. Mock stays the zero-env default; supabase mode is the
staging target.

## Part A — customer vs internal order number

**Rule:** customers see ONLY the random public ref `MDF-XXXXXXXX`; the internal
sequential `order_number` (`MDF-N`) is warehouse/admin-only.

| Surface | Before | After |
|---|---|---|
| Shop token success (`/shop/<token>`) | public ref (M7E) | unchanged ✓ |
| Regular checkout success (`/order-success`) | internal number via `?n=` | **public ref** (admin create path reads back `public_ref`; no RPC signature change) |
| Draft document preview (`document-view`) | `order.number` (internal) | **`order.publicRef`** |
| Draft document PDF (`render-document`) | `source.orderNumber` | **`source.publicRef`** |
| Document NUMBER (`DOC-…`) | `DOC-<internalSerial>-X` | **`DOC-<publicRef>-X`** (migration `20260718100000`) |
| Admin order detail | internal number only-ish | internal (labeled "Internal/warehouse") **and** customer ref |

`OrderDocumentSource` gained a `publicRef` field (supabase reads `public_ref`;
mock reuses the demo number). If `public_ref` is ever absent it falls back to
"—", **never** to the internal number.

**Document number migration (`20260718100000`):** adds a natural
`unique (tenant_id, order_id, document_type)` and moves the upsert's
`ON CONFLICT` onto it (idempotency no longer keyed on the derived number), then
derives the number from `public_ref`. Documents stay non-legal drafts (the
watermark, not-a-tax-invoice notice, and the never-generated/needs-notice
CHECKs are untouched). `legal_effective` stays false; the M6G gate is intact.

## Part B — public_ref uniqueness (verified, no migration)

The M7E mechanism is sufficient and was re-verified end to end:
- `public_ref` is **NOT NULL**, **unique per tenant** (`orders (tenant_id,
  public_ref)`), the BEFORE INSERT trigger **retries on collision**, and every
  create path (admin `create_order_request` + token
  `create_order_request_from_token`) funnels through `_order_create_core` so
  the trigger always fires.
- Format: `MDF-` + 8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- Probed at scale: 400 orders (300 admin + 100 token) → **0 null, 0
  bad-format, 0 per-tenant duplicates**, all internal numbers sequential;
  `create_order_document` verified (as a real owner) to emit
  `DOC-<publicRef>-X`.
- **Cosmetic note:** the generator's `floor(random()*30)+1` makes the final
  literal char `9` unreachable (effective 30-char alphabet). Harmless to
  uniqueness/non-null; left as-is to avoid churn.

## Part C — new-store self-signup

Supplier-controlled self-registration. No catalog is ever exposed.

**Flow:** owner/admin generate a tenant-scoped tokenized link
(`/[locale]/join/<token>`, copied once, hash-only) → a prospective store opens
it (no login, no catalog) and submits a localized form → the submission lands
as a **pending** request on `/admin/customers/signup` (a "Store signups"
button on the shops list shows the pending count) → owner/admin **approve**
(materialises a real `customers` row) or **reject**.

**Schema (`20260719100000`):**
- `customer_signup_links` — tenant-scoped, `token_hash` unique, label,
  expires_at, revoked_at, last_used_at, created_by.
- `customer_signup_requests` — submitted store fields + derived status
  (`approved_at` / `rejected_at`), `approved_customer_id`, `reviewed_by`.
- RLS: owner/admin **read** only (`has_tenant_role`); **all writes via RPC**;
  `token_hash` is **not** column-selectable; **no anon table access**.

**RPCs (mirroring the hardened link/invite patterns):**
- `insert/revoke_customer_signup_link` — owner/admin, `authorize_tenant` with
  explicit `p_tenant_id`.
- `_resolve_signup_token` — **service_role only**; the raw token is hashed
  in-DB (a leaked hash is not replayable).
- `submit_customer_signup_request` — **anon**; the shared token rate limiter
  (new `signup_submit` purpose) + a **per-link cap of 50 pending** bound
  flooding through a valid link; tenant + link come from the token, never the
  client.
- `approve/reject_customer_signup_request` — owner/admin; approve reuses the
  `create_customer` INSERT column list (the submitted email is folded into the
  customer notes, since `customers` has no email column).

## Security model

- Only `token_hash` stored; the raw token is generated in the action and
  returned once. High entropy (`randomBytes(32).base64url`). Expirable +
  revocable.
- The submit endpoint validates the token server-side (in-DB hash) and is
  rate-limited; visitors see a neutral failure with no detail leaked.
- No `service_role` in the client; no direct anon table writes; the tenant is
  never client-supplied; RLS restricts reads to owner/admin.

## i18n

Added `admin.customers.signup` (management) and `access.signup` (visitor form)
blocks across `ar/he/en`, plus `admin.orders.detail.internalRef` and the Arabic
`customerRef` = "رقم الطلب للزبون". Types regenerated.

## Verification (local)

`npm run lint` / `npx tsc --noEmit` / `npm run build` / `npm audit` clean; the
three detail routes stay `ƒ`. `supabase db reset --local` applies both
migrations; `db lint` = no schema errors; `db advisors` = no issues. See the
probes above.

## Hosted staging steps (operator — confirm STAGING first; never reset/config-push)

1. `supabase db push` to Frankfurt (`xcfjxgdfgjvsqkhuiczu`) — applies
   `20260718100000_customer_facing_document_number` and
   `20260719100000_store_signup_links`.
2. Redeploy Vercel from the merged branch with **build cache OFF**; confirm the
   three detail routes still render `ƒ`.

## Known limitations / next

- The document number scheme changed to `DOC-<publicRef>-X`; **existing** hosted
  documents keep their old numbers (only new/regenerated docs use the new
  scheme).
- Approve doesn't dedupe against existing customers (same name/phone) — a
  future nicety.
- The visitor `/join` page renders the form without a GET-time token check;
  invalidity surfaces on submit (neutral). A GET-time "link invalid" screen is
  a possible enhancement.
- The per-link pending cap is 50; a global per-tenant request cap could be
  added later.
