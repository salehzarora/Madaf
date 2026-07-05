-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M1 — Row Level Security (hardened in M1.1)
--
-- Posture: deny by default.
-- - RLS is enabled on every table; a row is only reachable through an
--   explicit policy.
-- - `anon` gets NO grants and NO policies: the public mock UI never touches
--   the database (it runs on src/lib/mock/* via NEXT_PUBLIC_MADAF_DATA_MODE
--   =mock), so real tenant data is never exposed publicly.
-- - `authenticated` users only reach rows of tenants they are members of
--   (tenant_users), via the security-definer helpers below.
--
-- Role tiers inside a tenant (M1.1):
-- - ANY member (incl. sales_rep): READ everything in their tenant; run the
--   order flow (create orders + lines, move status, draw order numbers).
-- - owner/admin ONLY: mutate master data (customers, manufacturers,
--   categories, products, inventory_items) and the tenant row.
-- - NOBODY via the API: write documents, order_status_history or
--   audit_events — those are seed/service-role/trigger territory in M1,
--   enforced BOTH by the absence of policies AND by table grants
--   (authenticated only has SELECT on them).
--
-- TEMPORARY / FUTURE (M4 — auth milestone):
-- - Sales reps currently read ALL tenant rows like admins. M4 narrows
--   order visibility to rows they created and scopes the shop picker.
-- - Shop owners (tokenized remote ordering links) are not modeled yet;
--   they will get customer-scoped policies of their own in M4.
-- - Tenant onboarding (insert into tenants + first owner membership) is
--   service-role only for now — there is deliberately no INSERT policy on
--   tenants/tenant_users for regular users.
-- - If sales reps ever need to register a new shop in the field, add a
--   dedicated RPC ("customer request") with its own validation — do NOT
--   reopen direct table writes.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Helper functions ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on tenant_users itself (and every other
-- table) can consult memberships without recursive RLS evaluation.
-- search_path is pinned empty; all references are schema-qualified.

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
  );
$$;

comment on function public.is_tenant_member(uuid) is
  'True when the calling authenticated user is a member (any role) of the tenant.';

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and tu.role = any (p_roles)
  );
$$;

comment on function public.has_tenant_role(uuid, public.tenant_role[]) is
  'True when the calling authenticated user has one of the given roles in the tenant.';

revoke all on function public.is_tenant_member(uuid) from public, anon;
revoke all on function public.has_tenant_role(uuid, public.tenant_role[]) from public, anon;
grant execute on function public.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated, service_role;

-- ── next_order_number ────────────────────────────────────────────────────
-- Concurrency-safe human order number: MDF-1048, MDF-1049, … The row
-- update takes a lock, so two simultaneous checkouts cannot get the same
-- number. SECURITY DEFINER on purpose: ANY tenant member may draw a
-- number when creating an order, but under RLS only owners/admins can
-- UPDATE tenants — so the membership gate below is the real access check.

create or replace function public.next_order_number(p_tenant_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  -- Members draw numbers for their own tenant; service-role callers
  -- (trusted server scripts) are exempt from the membership check.
  if not (
    public.is_tenant_member(p_tenant_id)
    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
  ) then
    raise exception 'next_order_number: not a member of tenant %', p_tenant_id
      using errcode = '42501'; -- insufficient_privilege
  end if;
  update public.tenants
     set order_seq = order_seq + 1
   where id = p_tenant_id
  returning 'MDF-' || order_seq::text into v_number;
  return v_number;
end;
$$;

comment on function public.next_order_number(uuid) is
  'Draws the next human order number (MDF-####) for a tenant. Members only; atomic via row lock on tenants.';

revoke all on function public.next_order_number(uuid) from public, anon;
grant execute on function public.next_order_number(uuid) to authenticated, service_role;

-- ── Grants ───────────────────────────────────────────────────────────────
-- Newer Supabase defaults do not auto-expose new tables through the Data
-- API; we grant explicitly — to `authenticated` and `service_role` only.
-- `anon` deliberately gets nothing.
--
-- Grants mirror the policy matrix exactly (defense in depth): a table
-- with no UPDATE policy also carries no UPDATE grant, so even a future
-- policy mistake cannot silently open a write path.

grant usage on schema public to authenticated, service_role;

-- service_role: full access (bypasses RLS anyway; used by seed/scripts).
grant select, insert, update, delete on
  public.tenants,
  public.tenant_users,
  public.customers,
  public.manufacturers,
  public.categories,
  public.products,
  public.inventory_items,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.documents,
  public.audit_events
to service_role;

-- authenticated: everything is readable (RLS scopes rows to the tenant)…
grant select on
  public.tenants,
  public.tenant_users,
  public.customers,
  public.manufacturers,
  public.categories,
  public.products,
  public.inventory_items,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.documents,
  public.audit_events
to authenticated;

-- …but write grants exist only where a write policy exists:
grant update on public.tenants to authenticated;                    -- owner/admin (policy)
grant insert, update, delete on public.tenant_users to authenticated; -- owner/admin (policy)
grant insert, update, delete on
  public.customers,
  public.manufacturers,
  public.categories,
  public.products,
  public.inventory_items
to authenticated;                                                    -- owner/admin (policy)
grant insert, update on public.orders to authenticated;              -- members (policy); no delete
grant insert, update, delete on public.order_items to authenticated; -- members (policy)
-- documents, order_status_history, audit_events: SELECT only —
-- seed/service-role/trigger writes exclusively in M1.

-- audit_events uses an identity column (service-role inserts only).
grant usage, select on all sequences in schema public to service_role;

-- Belt & braces: make sure anon has nothing, even if defaults change.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ── Enable RLS everywhere ────────────────────────────────────────────────

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.customers enable row level security;
alter table public.manufacturers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

-- ── tenants ──────────────────────────────────────────────────────────────
-- Read: any member. Update: owner/admin. No insert/delete policy —
-- onboarding and offboarding run through the service role until M4.

create policy "tenants: members can read their tenant"
  on public.tenants for select to authenticated
  using (public.is_tenant_member(id));

create policy "tenants: owners/admins can update their tenant"
  on public.tenants for update to authenticated
  using (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]));

-- ── tenant_users ─────────────────────────────────────────────────────────
-- Users always see their own memberships; owners/admins see and manage the
-- whole roster. The helpers are SECURITY DEFINER, so these policies do not
-- recurse into themselves.
--
-- Escalation guard: only OWNERS may create/modify/remove owner rows.
-- Admins manage non-owner members but can neither touch an owner row
-- (USING excludes them) nor grant the owner role (WITH CHECK excludes
-- it) — otherwise an admin could simply promote themselves.
-- (Preventing a tenant from losing its last owner is an M4 concern.)

create policy "tenant_users: users can read their own memberships"
  on public.tenant_users for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
  );

create policy "tenant_users: owners/admins can add members"
  on public.tenant_users for insert to authenticated
  with check (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

create policy "tenant_users: owners/admins can change roles"
  on public.tenant_users for update to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  )
  with check (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

create policy "tenant_users: owners/admins can remove members"
  on public.tenant_users for delete to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    or (
      public.has_tenant_role(tenant_id, array['admin']::public.tenant_role[])
      and role <> 'owner'
    )
  );

-- ── Master data: customers / manufacturers / categories / products /
--    inventory_items ──────────────────────────────────────────────────────
-- M1.1 hardening: ALL members read; ONLY owner/admin write. A sales_rep
-- must never change a price, product name, stock quantity, manufacturer,
-- category or customer record — their job in M1 is browsing the catalog
-- and creating orders. If reps later need to register shops in the field,
-- that becomes a dedicated validated RPC, not a direct table write.

create policy "customers: members can read"
  on public.customers for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "customers: owners/admins can insert"
  on public.customers for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "customers: owners/admins can update"
  on public.customers for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "customers: owners/admins can delete"
  on public.customers for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "manufacturers: members can read"
  on public.manufacturers for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "manufacturers: owners/admins can insert"
  on public.manufacturers for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "manufacturers: owners/admins can update"
  on public.manufacturers for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "manufacturers: owners/admins can delete"
  on public.manufacturers for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "categories: members can read"
  on public.categories for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "categories: owners/admins can insert"
  on public.categories for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "categories: owners/admins can update"
  on public.categories for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "categories: owners/admins can delete"
  on public.categories for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "products: members can read"
  on public.products for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "products: owners/admins can insert"
  on public.products for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "products: owners/admins can update"
  on public.products for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "products: owners/admins can delete"
  on public.products for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "inventory_items: members can read"
  on public.inventory_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "inventory_items: owners/admins can insert"
  on public.inventory_items for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "inventory_items: owners/admins can update"
  on public.inventory_items for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy "inventory_items: owners/admins can delete"
  on public.inventory_items for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- ── orders & order_items ─────────────────────────────────────────────────
-- Members run the order flow end to end (create, edit lines, move status).
-- ⚠️ There is deliberately NO delete policy on orders: hard-deleting an
-- order would cascade into order_items and order_status_history and
-- collide with the never-delete rule on documents — cancelling
-- (status = 'cancelled') is the only removal path through the API.
-- M4 will narrow sales reps to orders they created.

create policy "orders: members can read"
  on public.orders for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "orders: members can insert"
  on public.orders for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "orders: members can update"
  on public.orders for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "order_items: members can read"
  on public.order_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "order_items: members can insert"
  on public.order_items for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy "order_items: members can update"
  on public.order_items for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy "order_items: members can delete"
  on public.order_items for delete to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── order_status_history ─────────────────────────────────────────────────
-- Trigger-only writes: log_order_status_change is SECURITY DEFINER and
-- runs as the table owner, which is not subject to these policies — so
-- history needs NO insert policy at all. Deliberately none exists:
-- members cannot forge history rows (arbitrary changed_by / transitions),
-- and no update/delete policies means history is immutable via the API.

create policy "order_status_history: members can read"
  on public.order_status_history for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── documents ────────────────────────────────────────────────────────────
-- ⚠️ LEGAL (M1.1): documents are READ-ONLY for every authenticated client
-- — no insert/update/delete policies (and no write grants, see above).
-- No client can forge an invoice_draft, tamper with totals_snapshot,
-- flip status to 'generated', strip a legal notice, or void/remove a
-- document. Creation happens only via seed/service role in M1; the M5
-- write path will be a server-side flow, never a direct table insert.
-- The table CHECKs additionally guarantee (even against the service
-- role) that invoice drafts always carry their legal notice and cannot
-- be marked 'generated' before the M5/M6 legal integration.

create policy "documents: members can read"
  on public.documents for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ── audit_events ─────────────────────────────────────────────────────────
-- M1.1: READ-ONLY for authenticated clients — no insert/update/delete
-- policies (and no write grants). An audit trail that clients can write
-- to is not an audit trail: rows are produced only by triggers/server
-- code via the service role. (No such triggers exist yet beyond the
-- order-status one writing to order_status_history — that is fine; the
-- seed's demo events show the intended shape.)

create policy "audit_events: members can read"
  on public.audit_events for select to authenticated
  using (public.is_tenant_member(tenant_id));
