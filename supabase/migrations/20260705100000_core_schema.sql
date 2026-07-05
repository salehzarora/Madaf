-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M1 — core schema
--
-- Multi-tenant from day one: every tenant-owned table carries tenant_id.
-- The TS mock model in src/lib/types.ts is the contract this schema maps
-- (see docs/FUTURE_BACKEND_HANDOFF.md for the exact column ↔ field table).
--
-- Naming notes:
-- - Trilingual text lives in explicit name_ar / name_he / name_en columns
--   (matches the app's Locale union "ar" | "he" | "en").
-- - Money is numeric(12,2) in ILS excluding VAT unless stated otherwise.
-- - vat_rate 0.18 = Israeli VAT since 2025; used for ESTIMATES only until
--   legal invoicing integration (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).
--
-- Cross-tenant integrity: RLS policies check a row's own tenant_id, but
-- plain FK lookups bypass RLS — a single-column FK would let a member of
-- tenant A attach rows pointing at tenant B's parents. Therefore every
-- intra-tenant reference is a COMPOSITE foreign key
--   (tenant_id, <parent_id>) references parent (tenant_id, id)
-- backed by unique (tenant_id, id) on the parent, so a child row's
-- tenant must equal its parent's tenant BY CONSTRUCTION.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Enums ────────────────────────────────────────────────────────────────

create type public.locale_code as enum ('ar', 'he', 'en');

create type public.tenant_role as enum ('owner', 'admin', 'sales_rep');

-- Matches CustomerType in src/lib/types.ts.
create type public.customer_type as enum
  ('grocery', 'kiosk', 'supermarket', 'minimarket');

-- Matches PackageType in src/lib/types.ts (how a product is sold wholesale).
create type public.package_unit as enum ('carton', 'pack', 'unit');

-- Matches BaseUnit in src/lib/types.ts (sellable units inside one package).
create type public.base_unit as enum
  ('bottles', 'cans', 'packs', 'units', 'bags', 'jars', 'bars', 'rolls', 'tubs');

-- Matches OrderStatus in src/lib/types.ts — the admin pipeline order.
create type public.order_status as enum
  ('new', 'confirmed', 'preparing', 'delivered', 'cancelled');

create type public.order_source as enum
  ('sales_visit', 'remote_customer', 'admin');

-- Maps DocumentType in src/lib/types.ts:
--   order → order_request · delivery → delivery_note · invoiceDraft → invoice_draft
-- LEGAL: invoice_draft is NEVER a legal tax invoice in this phase.
create type public.document_type as enum
  ('order_request', 'delivery_note', 'invoice_draft');

-- 'generated' becomes meaningful in M5 (real numbering + PDF); until then
-- everything stays 'draft'. 'voided' replaces deletion for documents.
create type public.document_status as enum ('draft', 'generated', 'voided');

-- ── updated_at trigger ───────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── tenants ──────────────────────────────────────────────────────────────
-- One row per supplier/company account (maps Supplier in src/lib/types.ts;
-- the mock phase has a single demo tenant).

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  -- Display/brand name in the three UI languages (Supplier.name).
  name_ar text not null,
  name_he text not null,
  name_en text not null,
  default_locale public.locale_code not null default 'he',
  -- Documents default to Hebrew regardless of UI language
  -- (defaultDocumentLocale in src/i18n/config.ts).
  document_locale public.locale_code not null default 'he',
  phone text,
  address_ar text,
  address_he text,
  address_en text,
  -- Tax fields are nullable on purpose: real values arrive with the legal
  -- invoicing milestone (M6). legal_name/company_id (ח.פ) appear on
  -- document previews today, so they are stored — but stay optional.
  legal_name text,
  company_id text,
  vat_registration_type text, -- e.g. עוסק מורשה / עוסק פטור — modeled in M6
  -- Monotonic per-tenant counter behind next_order_number(). Demo orders
  -- are MDF-1041…MDF-1047, so the seed sets this to 1047.
  order_seq integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is
  'Supplier/company accounts — the tenant root. Every tenant-owned table references tenants(id).';

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- ── tenant_users ─────────────────────────────────────────────────────────
-- Membership + role of an auth user inside a tenant. RLS helper functions
-- (see the rls migration) are built on this table.

create table public.tenant_users (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.tenant_role not null default 'sales_rep',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

comment on table public.tenant_users is
  'Tenant membership. The first membership of a new tenant must be created by the service role (onboarding flow lands in M4 with auth).';

create index tenant_users_user_id_idx on public.tenant_users (user_id);

-- ── customers ────────────────────────────────────────────────────────────
-- Shops the supplier sells to (maps Customer in src/lib/types.ts).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Shop names are proper nouns — rendered as-is in every locale.
  name text not null,
  contact_name text,
  phone text,
  -- City is translated per locale in the UI (Customer.city: LocalizedText).
  city_ar text,
  city_he text,
  city_en text,
  address text,
  customer_type public.customer_type not null default 'grocery',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target (see header note on cross-tenant integrity).
  unique (tenant_id, id)
);

create index customers_tenant_id_idx on public.customers (tenant_id);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ── manufacturers ────────────────────────────────────────────────────────

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name_ar text not null,
  name_he text not null,
  name_en text not null,
  logo_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target (see header note on cross-tenant integrity).
  unique (tenant_id, id)
);

create index manufacturers_tenant_id_idx on public.manufacturers (tenant_id);

create trigger manufacturers_set_updated_at
  before update on public.manufacturers
  for each row execute function public.set_updated_at();

-- ── categories ───────────────────────────────────────────────────────────

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name_ar text not null,
  name_he text not null,
  name_en text not null,
  -- Small pictogram shown on chips and placeholder product art (Category.icon).
  icon text,
  -- Base hue (0–360) driving the generated placeholder gradients
  -- (Category.hue). Replaced by real imagery/brand tokens later.
  color_hue smallint not null default 0
    check (color_hue between 0 and 360),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target (see header note on cross-tenant integrity).
  unique (tenant_id, id)
);

create index categories_tenant_id_idx on public.categories (tenant_id);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ── products ─────────────────────────────────────────────────────────────
-- Maps Product in src/lib/types.ts. Note: the mock `availability` field is
-- NOT a column — it derives from inventory_items (quantity_available vs
-- low_stock_threshold); see the data-access notes in src/lib/data/.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  manufacturer_id uuid,
  category_id uuid,
  sku text,
  barcode text,
  name_ar text not null,
  name_he text not null,
  name_en text not null,
  description_ar text,
  description_he text,
  description_en text,
  -- How the product is sold wholesale (Product.packageType).
  package_unit public.package_unit not null default 'carton',
  -- Sellable units inside one package (Product.unitsPerPackage).
  package_quantity integer not null default 1
    check (package_quantity > 0),
  -- What those units are: bottles/cans/bags… (Product.baseUnit). Needed to
  -- render the "Carton · 24 cans · 330ml" package label.
  base_unit public.base_unit not null default 'units',
  -- Consumer-facing size of one unit, e.g. '330ml', '70g' (Product.unitSize).
  unit_size text,
  -- Price of ONE package in ILS, excluding VAT (Product.wholesalePrice).
  wholesale_price numeric(12,2) not null
    check (wholesale_price >= 0),
  -- Estimate-only until legal invoicing (M6). 0.1800 = 18%.
  vat_rate numeric(5,4) not null default 0.18
    check (vat_rate >= 0 and vat_rate < 1),
  image_url text,
  -- Dairy & short-shelf-life goods get expiry tracking in inventory.
  track_expiry boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target (see header note on cross-tenant integrity).
  unique (tenant_id, id),
  -- Composite FKs: the parent must belong to the same tenant. On parent
  -- delete only the reference column is nulled (PG15+ column list) —
  -- never tenant_id.
  foreign key (tenant_id, manufacturer_id)
    references public.manufacturers (tenant_id, id)
    on delete set null (manufacturer_id),
  foreign key (tenant_id, category_id)
    references public.categories (tenant_id, id)
    on delete set null (category_id)
);

-- (tenant_id) alone is covered by the leading column of the composites.
create index products_tenant_category_idx on public.products (tenant_id, category_id);
create index products_tenant_manufacturer_idx on public.products (tenant_id, manufacturer_id);
-- M2 catalog reads: active products of a tenant.
create index products_tenant_active_idx on public.products (tenant_id, is_active);
-- SKUs are optional but must be unique inside a tenant when present.
create unique index products_tenant_sku_key
  on public.products (tenant_id, sku)
  where sku is not null;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ── inventory_items ──────────────────────────────────────────────────────
-- Warehouse stock counted in whole packages (maps InventoryItem).

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null,
  -- Stock in whole packages (InventoryItem.stockPackages).
  quantity_available integer not null default 0
    check (quantity_available >= 0),
  -- Under this many packages the item counts as "low stock"
  -- (LOW_STOCK_THRESHOLD in src/lib/mock/inventory.ts).
  low_stock_threshold integer not null default 10
    check (low_stock_threshold >= 0),
  -- Warehouse shelf location, e.g. 'A-03' (InventoryItem.location).
  warehouse_location text,
  -- Nearest expiry (InventoryItem.nearestExpiry) — only for track_expiry
  -- products.
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_id),
  foreign key (tenant_id, product_id)
    references public.products (tenant_id, id)
    on delete cascade
);

create index inventory_items_tenant_id_idx on public.inventory_items (tenant_id);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ── orders ───────────────────────────────────────────────────────────────
-- Order requests (maps Order). Totals are denormalized sums of order_items
-- and remain ESTIMATES until legal invoicing.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Nullable: a customer record may be deleted while its orders remain —
  -- customer_snapshot below preserves the buyer identity for documents.
  customer_id uuid,
  -- {"name": …, "city": {"ar","he","en"}, "phone": …, "contact_name": …}
  -- captured at order time so documents stay renderable after customer
  -- edits/deletion (same pattern as order_items snapshots).
  customer_snapshot jsonb,
  sales_rep_user_id uuid references auth.users (id) on delete set null,
  -- Human-facing number, e.g. 'MDF-1042' (Order.number). Produced by
  -- next_order_number(); unique per tenant.
  order_number text not null,
  status public.order_status not null default 'new',
  subtotal numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'ILS'
    check (char_length(currency) = 3),
  notes text,
  source public.order_source not null default 'sales_visit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number),
  -- Composite-FK target (see header note on cross-tenant integrity).
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id)
    on delete set null (customer_id)
);

-- (tenant_id) alone is covered by the leading column of the composites.
create index orders_tenant_status_idx on public.orders (tenant_id, status);
create index orders_tenant_created_at_idx on public.orders (tenant_id, created_at desc);
create index orders_customer_id_idx on public.orders (customer_id);
-- Supports auth.users ON DELETE SET NULL scans + M4 rep-scoped queries.
create index orders_sales_rep_idx on public.orders (sales_rep_user_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- next_order_number(tenant_id) lives in the RLS migration: it must be
-- SECURITY DEFINER (any member may draw a number, but only owners/admins
-- can UPDATE tenants under RLS), so it is defined next to the membership
-- helpers it depends on.

-- ── order_items ──────────────────────────────────────────────────────────
-- Lines snapshot everything needed to render an order/document even if the
-- product is later edited or deleted (maps OrderItem + snapshot columns).

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null,
  -- Nullable: the line survives product deletion thanks to the snapshots.
  product_id uuid,
  -- Trilingual name snapshot {"ar": …, "he": …, "en": …} so document
  -- previews can re-render in any document language forever.
  product_name_snapshot jsonb not null
    check (product_name_snapshot ?& array['ar', 'he', 'en']),
  manufacturer_name_snapshot jsonb
    check (
      manufacturer_name_snapshot is null
      or manufacturer_name_snapshot ?& array['ar', 'he', 'en']
    ),
  package_unit_snapshot public.package_unit not null,
  package_quantity_snapshot integer not null default 1,
  -- Quantity in packages (OrderItem.quantity).
  quantity integer not null
    check (quantity > 0),
  -- Package price in ILS excl. VAT at order time (OrderItem.unitPrice).
  unit_price_snapshot numeric(12,2) not null,
  vat_rate_snapshot numeric(5,4) not null default 0.18,
  line_subtotal numeric(12,2) not null,
  line_vat numeric(12,2) not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id)
    on delete cascade,
  foreign key (tenant_id, product_id)
    references public.products (tenant_id, id)
    on delete set null (product_id)
);

create index order_items_tenant_id_idx on public.order_items (tenant_id);
create index order_items_order_id_idx on public.order_items (order_id);
-- Supports the products ON DELETE SET NULL scan.
create index order_items_tenant_product_idx on public.order_items (tenant_id, product_id);

-- ── order_status_history ─────────────────────────────────────────────────
-- Append-only audit of the order pipeline. Rows are written automatically
-- by the trigger below — application code normally never inserts directly.

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null,
  old_status public.order_status,
  new_status public.order_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id)
    on delete cascade
);

create index order_status_history_tenant_id_idx on public.order_status_history (tenant_id);
create index order_status_history_order_id_idx on public.order_status_history (order_id);

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history
      (tenant_id, order_id, old_status, new_status, changed_by)
    values (new.tenant_id, new.id, null, new.status, (select auth.uid()));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.order_status_history
      (tenant_id, order_id, old_status, new_status, changed_by)
    values (new.tenant_id, new.id, old.status, new.status, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger orders_log_status_change
  after insert or update of status on public.orders
  for each row execute function public.log_order_status_change();

-- ── documents ────────────────────────────────────────────────────────────
-- ⚠️ LEGAL (docs/DOCUMENTS_AND_INVOICES_GUIDE.md): Madaf does NOT issue
-- legal tax invoices in this phase. 'invoice_draft' rows are draft
-- previews only — the check below refuses an invoice draft without its
-- legal notice, and rows are voided, never deleted. Real numbering,
-- signed PDFs and a certified provider integration arrive in M5/M6.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null,
  document_type public.document_type not null,
  -- e.g. 'DOC-1042-I' (OrderDocument.number). Unique per tenant. Immutable
  -- legal sequences per type/entity are an M5 concern.
  document_number text not null,
  -- Documents render Hebrew-first (defaultDocumentLocale) with an in-page
  -- language toggle; this records the locale the document was issued in.
  document_locale public.locale_code not null default 'he',
  status public.document_status not null default 'draft',
  -- The safety wording pinned at creation time (docs.notLegalNotice in the
  -- document's locale). The UI additionally renders the localized notice
  -- and DRAFT watermark on every invoice-draft surface — keep both.
  legal_notice text not null default '',
  totals_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, document_number),
  -- ON DELETE NO ACTION (not cascade): an order with documents cannot be
  -- deleted — documents are voided, never destroyed. NO ACTION (checked
  -- at end of statement) rather than RESTRICT so a whole-tenant purge by
  -- the service role, which removes the documents in the same cascade,
  -- still works.
  foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id)
    on delete no action,
  -- An invoice draft may never exist without its legal notice.
  constraint documents_invoice_draft_needs_notice check (
    document_type <> 'invoice_draft' or length(trim(legal_notice)) > 0
  )
);

comment on table public.documents is
  'Order-derived documents. invoice_draft is a DRAFT preview only — never a legal tax invoice until the M6 provider integration (docs/DOCUMENTS_AND_INVOICES_GUIDE.md).';

create index documents_tenant_id_idx on public.documents (tenant_id);
create index documents_order_id_idx on public.documents (order_id);

-- ── audit_events ─────────────────────────────────────────────────────────
-- Append-only, generic audit trail for admin-relevant actions.

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- e.g. 'order.status_changed', 'product.created', 'document.voided'.
  event_type text not null,
  -- e.g. 'order', 'product', 'customer', 'document'.
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_created_idx
  on public.audit_events (tenant_id, created_at desc);
