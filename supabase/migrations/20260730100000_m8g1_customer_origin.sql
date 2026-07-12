-- ═══════════════════════════════════════════════════════════════════════
-- M8G.1 — immutable CUSTOMER ORIGIN (acquisition classification)
--
-- Records HOW each customer originally entered Madaf — a trustworthy,
-- write-once acquisition origin. This is NOT the most recent order source, a
-- preferred ordering channel, the last editor, the relationship status, or an
-- editable marketing label. It is set by the DB create path that materialised
-- the row and never rewritten by later edits, activation, assignment, renames,
-- or orders.
--
-- VOCABULARY (closed enum public.customer_origin) — derived ONLY from the three
-- verified paths that INSERT a public.customers row (nothing else creates one;
-- direct table writes were locked in 20260705160000 — RPC-only):
--   • manual            — owner/admin created it directly (create_customer).
--   • signup            — a self-signup / "join" request was approved
--                         (approve_customer_signup_request); provably linked
--                         back through customer_signup_requests.approved_customer_id.
--   • guest_conversion  — a guest showcase order was promoted to a permanent
--                         customer (create_customer_from_order).
--   • legacy_unknown    — origin cannot be reliably determined. Used for every
--                         pre-M8G.1 row that is NOT provably a signup (historical
--                         manual + guest-promotion rows are byte-for-byte
--                         identical — no provenance was ever recorded — so they
--                         are NOT guessed), AND as a defense-in-depth default so
--                         a future create path that forgets to set origin is
--                         flagged honestly rather than silently mislabelled
--                         'manual'.
--
-- BACKFILL is deliberately conservative. The ONLY stable, immutable historical
-- evidence is customer_signup_requests.approved_customer_id (composite FK
-- (tenant_id, approved_customer_id) -> customers). Those rows become 'signup';
-- everything else stays 'legacy_unknown'. We do NOT infer origin from name,
-- phone, current orders, current status, assignment, or a linked guest order
-- (link_order_to_customer links guest-snapshot orders to PRE-EXISTING customers,
-- so a linked guest order does NOT prove guest_conversion).
--
-- IMMUTABILITY needs no trigger: customers has NO INSERT/UPDATE/DELETE RLS
-- policy for authenticated (all writes go through SECURITY DEFINER RPCs), and
-- the only writers are the three create paths (which set origin at INSERT) plus
-- update_customer / set_customer_active (which never reference origin and are
-- left untouched). No create path accepts a client-supplied origin — each
-- derives it from the operation being executed.
--
-- Additive only: one enum, one column (+ its backfill), and create-or-replace of
-- the three create RPCs. No table/policy/storage/RLS change, no data loss, no
-- Order mutation, no DROP/DELETE/TRUNCATE.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Closed origin vocabulary (mirrors the customer_type enum convention) ───
create type public.customer_origin as enum (
  'manual',
  'signup',
  'guest_conversion',
  'legacy_unknown'
);

-- ── Column: NOT NULL, defense-in-depth default = legacy_unknown ────────────
-- Adding with a default fills every existing row with legacy_unknown in one
-- pass; the signup backfill below reclassifies the provable ones.
alter table public.customers
  add column origin public.customer_origin not null default 'legacy_unknown';

comment on column public.customers.origin is
  'M8G.1 immutable acquisition origin: how the customer first entered Madaf '
  '(manual | signup | guest_conversion | legacy_unknown). Set by the create '
  'path; never rewritten by edits/lifecycle/orders. Not the recent order '
  'source or a marketing label.';

-- ── Conservative backfill: only the provable signup rows ───────────────────
-- Tenant-safe join on the composite FK. Approved-request linkage is immutable,
-- so this is deterministic and idempotent (re-running sets the same value).
update public.customers c
   set origin = 'signup'
  from public.customer_signup_requests r
 where r.approved_customer_id = c.id
   and r.tenant_id = c.tenant_id
   and c.origin = 'legacy_unknown';

-- ═══════════════════════════════════════════════════════════════════════
-- CREATE-PATH UPDATES — each path sets its own origin at INSERT. Bodies are
-- reproduced verbatim from their defining migrations with ONLY the origin
-- column added; grants are preserved by CREATE OR REPLACE and re-issued below
-- for defense-in-depth. No signature change → the data layer/actions are
-- unchanged and no client origin is ever accepted.
-- ═══════════════════════════════════════════════════════════════════════

-- ── create_customer → origin 'manual' (from 20260717100000) ───────────────
create or replace function public.create_customer(
  p_tenant_id uuid,
  p_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_city_ar text default null,
  p_city_he text default null,
  p_city_en text default null,
  p_address text default null,
  p_customer_type public.customer_type default 'grocery',
  p_notes text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_city_ar text := nullif(trim(coalesce(p_city_ar, '')), '');
  v_city_he text := nullif(trim(coalesce(p_city_he, '')), '');
  v_city_en text := nullif(trim(coalesce(p_city_en, '')), '');
  v_address text := nullif(trim(coalesce(p_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  -- owner/admin on the caller's OWN tenant; never trusts a client tenant_id.
  p_tenant_id := public.authorize_tenant(
    p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  if v_name is null then
    raise exception 'customer: name is required' using errcode = '22023';
  end if;
  if length(v_name) > 200
     or coalesce(length(v_contact), 0) > 200
     or coalesce(length(v_phone), 0) > 40
     or greatest(coalesce(length(v_city_ar), 0),
                 coalesce(length(v_city_he), 0),
                 coalesce(length(v_city_en), 0)) > 120
     or coalesce(length(v_address), 0) > 300
     or coalesce(length(v_notes), 0) > 2000 then
    raise exception 'customer: a field exceeds its maximum length'
      using errcode = '22023';
  end if;

  -- origin 'manual' is DERIVED from this operation (manual admin create) — not
  -- a parameter, so a client can never assert it.
  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (p_tenant_id, v_name, v_contact, v_phone,
     v_city_ar, v_city_he, v_city_en, v_address,
     coalesce(p_customer_type, 'grocery'), v_notes, 'manual')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  from public, anon;
grant execute on function public.create_customer(
  uuid, text, text, text, text, text, text, text, public.customer_type, text)
  to authenticated, service_role;

-- ── approve_customer_signup_request → origin 'signup' (from 20260719100000) ─
create or replace function public.approve_customer_signup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_req public.customer_signup_requests%rowtype;
  v_customer_id uuid;
  v_notes text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);
  select * into v_req
  from public.customer_signup_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant;
  if not found then
    raise exception 'approve_customer_signup_request: request unknown or another tenant'
      using errcode = '22023';
  end if;
  if v_req.approved_at is not null or v_req.rejected_at is not null then
    raise exception 'approve_customer_signup_request: request already reviewed'
      using errcode = '22023';
  end if;

  -- Keep the submitted email (customers has no email column) by folding it
  -- into the internal notes so the supplier still has it.
  v_notes := case
    when v_req.email is not null and v_req.email <> ''
      then trim(both e'\n' from coalesce(v_req.notes, '') || e'\nEmail: ' || v_req.email)
    else v_req.notes
  end;

  -- Materialise the customer — SAME column list as create_customer, origin
  -- DERIVED 'signup' (this IS the signup-approval path).
  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (v_tenant, v_req.name, v_req.contact_name, v_req.phone,
     v_req.city_ar, v_req.city_he, v_req.city_en, v_req.address, 'grocery', v_notes, 'signup')
  returning id into v_customer_id;

  update public.customer_signup_requests
     set approved_at = now(),
         approved_customer_id = v_customer_id,
         reviewed_by = (select auth.uid())
   where id = p_request_id;
  return v_customer_id;
end;
$$;

revoke all on function public.approve_customer_signup_request(uuid, uuid) from public, anon;
grant execute on function public.approve_customer_signup_request(uuid, uuid) to authenticated, service_role;

-- ── create_customer_from_order → origin 'guest_conversion' (from 20260721110000) ─
create or replace function public.create_customer_from_order(
  p_tenant_id uuid,
  p_order_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_snap jsonb;
  v_existing uuid;
  v_customer_id uuid;
  v_name text;
begin
  v_tenant := public.authorize_tenant(p_tenant_id, array['owner', 'admin']::public.tenant_role[]);

  select o.customer_id, o.customer_snapshot into v_existing, v_snap
  from public.orders o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'create_customer_from_order: order unknown or another tenant' using errcode = '22023';
  end if;
  if v_existing is not null then
    raise exception 'create_customer_from_order: order is already linked to a customer' using errcode = '22023';
  end if;
  v_name := nullif(trim(coalesce(v_snap ->> 'name', '')), '');
  if v_name is null then
    raise exception 'create_customer_from_order: order has no store details to create a customer from' using errcode = '22023';
  end if;

  -- Same column list as create_customer, sourced from the snapshot; origin
  -- DERIVED 'guest_conversion' (this IS the guest-promotion path).
  insert into public.customers
    (tenant_id, name, contact_name, phone,
     city_ar, city_he, city_en, address, customer_type, notes, origin)
  values
    (v_tenant, v_name,
     nullif(trim(coalesce(v_snap ->> 'contact_name', '')), ''),
     nullif(trim(coalesce(v_snap ->> 'phone', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,ar}', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,he}', '')), ''),
     nullif(trim(coalesce(v_snap #>> '{city,en}', '')), ''),
     nullif(trim(coalesce(v_snap ->> 'address', '')), ''),
     'grocery',
     case when nullif(trim(coalesce(v_snap ->> 'email', '')), '') is not null
       then 'Email: ' || (v_snap ->> 'email') else null end,
     'guest_conversion')
  returning id into v_customer_id;

  -- Link the order to the new customer.
  update public.orders set customer_id = v_customer_id, updated_at = now()
   where id = p_order_id;
  return v_customer_id;
end;
$$;

revoke all on function public.create_customer_from_order(uuid, uuid) from public, anon;
grant execute on function public.create_customer_from_order(uuid, uuid) to authenticated, service_role;
