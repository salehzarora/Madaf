-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M3B.1 — force catalog / master-data writes through the RPCs
--
-- Codex review of M3B: the M1.1 policies still let authenticated
-- owner/admin write master data DIRECTLY, bypassing the M3B validation
-- RPCs (name/description length caps, image_url sanity, warehouse
-- location limits, SKU uniqueness, cross-tenant guards) and allowing raw
-- inserts/updates/deletes.
--
-- This migration mirrors M3A.1 (which locked orders/order_items): after
-- it, for `authenticated` the five master-data tables are SELECT-only —
-- no write policy, no write grant. The ONLY write paths are the
-- SECURITY DEFINER RPCs (service-role) plus the service role itself:
--   products        → create_product / update_product / set_product_active
--   inventory_items → upsert_inventory_item (or the product RPCs)
--   manufacturers   → create_manufacturer / update_manufacturer
--   categories      → (no RPC yet — read-only until a future phase)
--   customers       → (no RPC yet — read-only until a future phase)
--
-- Read policies/grants, the RPCs, the seed and the M1.1/M3A.1 order and
-- document protections are all untouched.
--
-- M4 note: when authenticated flows arrive, grant EXECUTE on the RPCs to
-- authenticated and add in-function membership/role checks — do NOT
-- restore direct table writes.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Drop the owner/admin direct-write policies (SELECT policies stay) ─────

drop policy "customers: owners/admins can insert" on public.customers;
drop policy "customers: owners/admins can update" on public.customers;
drop policy "customers: owners/admins can delete" on public.customers;

drop policy "manufacturers: owners/admins can insert" on public.manufacturers;
drop policy "manufacturers: owners/admins can update" on public.manufacturers;
drop policy "manufacturers: owners/admins can delete" on public.manufacturers;

drop policy "categories: owners/admins can insert" on public.categories;
drop policy "categories: owners/admins can update" on public.categories;
drop policy "categories: owners/admins can delete" on public.categories;

drop policy "products: owners/admins can insert" on public.products;
drop policy "products: owners/admins can update" on public.products;
drop policy "products: owners/admins can delete" on public.products;

drop policy "inventory_items: owners/admins can insert" on public.inventory_items;
drop policy "inventory_items: owners/admins can update" on public.inventory_items;
drop policy "inventory_items: owners/admins can delete" on public.inventory_items;

-- ── Revoke the matching write grants (defense in depth) ──────────────────
-- Grants mirror the policy matrix: no write policy ⇒ no write grant.

revoke insert, update, delete on
  public.customers,
  public.manufacturers,
  public.categories,
  public.products,
  public.inventory_items
from authenticated;

comment on table public.products is
  'Products. Writes go EXCLUSIVELY through create_product / update_product / set_product_active — authenticated users have read-only table access (M3B.1).';
comment on table public.inventory_items is
  'Inventory. Written EXCLUSIVELY by upsert_inventory_item / the product RPCs — authenticated users have read-only table access (M3B.1).';
comment on table public.manufacturers is
  'Manufacturers. Writes go EXCLUSIVELY through create_manufacturer / update_manufacturer — authenticated users have read-only table access (M3B.1).';
comment on table public.categories is
  'Categories. READ-ONLY for authenticated until a future validated RPC (M3B.1).';
comment on table public.customers is
  'Customers. READ-ONLY for authenticated until a future validated RPC (M3B.1).';
